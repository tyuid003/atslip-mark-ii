// API: User Presence (online status per team)
// POST /api/presence      — heartbeat (upsert last_seen) + WS broadcast
// GET  /api/presence      — list online users in a team (?team_id=xxx)

import { jsonResponse, errorResponse } from '../utils/helpers';

interface Env {
  DB: D1Database;
  PENDING_NOTIFICATIONS: DurableObjectNamespace;
  BANK_KV: KVNamespace;
}

function extractToken(req: Request): string | null {
  const auth = req.headers.get('Authorization') ?? '';
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
}

async function getSessionUser(db: D1Database, token: string) {
  return db
    .prepare(
      `SELECT tu.telegram_id, tu.telegram_first_name, tu.telegram_last_name, tu.display_name
       FROM device_sessions ds
       JOIN telegram_users tu ON tu.id = ds.telegram_user_id
       WHERE ds.app_session_token = ? AND ds.is_active = 1`
    )
    .bind(token)
    .first<{ telegram_id: string; telegram_first_name: string; telegram_last_name: string; display_name: string | null }>();
}

// ============================================================
// POST /api/presence
// Body: { team_id: string }
// ============================================================
export async function handlePresenceHeartbeat(request: Request, env: Env): Promise<Response> {
  const token = extractToken(request);
  if (!token) return errorResponse('Unauthorized', 401);

  const user = await getSessionUser(env.DB, token);
  if (!user) return errorResponse('Unauthorized', 401);

  let body: any = {};
  try { body = await request.json(); } catch {}

  const teamId = body?.team_id;
  if (!teamId) return errorResponse('team_id required', 400);

  const displayName =
    user.display_name ||
    [user.telegram_first_name, user.telegram_last_name].filter(Boolean).join(' ') ||
    String(user.telegram_id);

  const photo = typeof body?.photo === 'string' && body.photo.startsWith('data:image/')
    ? (() => {
        // เก็บแค่ 4KB (rounded base64) — ลดขนาด DB + ป้องกัน ERR_INVALID_URL
        const p = body.photo.substring(0, 4096);
        const prefixEnd = p.indexOf(',') + 1;
        if (prefixEnd <= 0) return p;
        const b64Len = p.length - prefixEnd;
        const roundedLen = Math.floor(b64Len / 4) * 4;
        return p.substring(0, prefixEnd + roundedLen);
      })()
    : null;

  const now = Math.floor(Date.now() / 1000);

  // Ghost mode: master ที่เปิด ghost จะไม่ update presence (ล่องหน)
  const isGhost = request.headers.get('X-Ghost-Mode') === '1';
  if (isGhost) {
    return jsonResponse({ ok: true, ghost: true });
  }

  // UPDATE-only: อัปเดตเฉพาะ row ที่มีอยู่แล้ว (team_id ถูก set ผ่าน approval system)
  // ไม่ INSERT ใหม่ เพื่อป้องกันการ auto-associate team เมื่อเยี่ยมชม URL
  await env.DB.prepare(
    `UPDATE user_presence
     SET display_name = ?, photo = COALESCE(?, photo), last_seen = ?
     WHERE user_id = ? AND team_id = ?`
  )
    .bind(displayName, photo, now, user.telegram_id, teamId)
    .run();

  // Broadcast presence update via WebSocket so clients don't need to poll GET /api/presence
  // รวมภาพจาก KV เพื่อไม่ได้เก็บภาพแบบ truncate ใน user_presence
  try {
    let broadcastPhoto: string | null = null;
    try { broadcastPhoto = await env.BANK_KV.get(`tg_photo:${user.telegram_id}`); } catch (_) {}

    const doId = env.PENDING_NOTIFICATIONS.idFromName('global');
    const doInstance = env.PENDING_NOTIFICATIONS.get(doId);
    // fire-and-forget (ctx.waitUntil not available here — ignore rejection)
    doInstance.fetch('https://durable-object/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'presence_update',
        data: {
          team_id: teamId,
          user_id: user.telegram_id,
          display_name: displayName,
          photo: broadcastPhoto,   // full photo from KV — no truncation
          last_seen: now,
        },
      }),
    }).catch(() => {});
  } catch (_) {}

  return jsonResponse({ ok: true });
}

// ============================================================
// GET /api/presence?team_id=xxx
// ============================================================
export async function handleGetPresence(request: Request, env: Env): Promise<Response> {
  const token = extractToken(request);
  if (!token) return errorResponse('Unauthorized', 401);

  const me = await getSessionUser(env.DB, token);
  if (!me) return errorResponse('Unauthorized', 401);

  const url = new URL(request.url);
  const teamId = url.searchParams.get('team_id');
  if (!teamId) return errorResponse('team_id required', 400);

  // Consider online = last_seen within 90 seconds
  const cutoff = Math.floor(Date.now() / 1000) - 90;

  const result = await env.DB.prepare(
    `SELECT user_id, display_name, last_seen
     FROM user_presence
     WHERE team_id = ? AND last_seen > ?
     ORDER BY last_seen DESC
     LIMIT 50`
  )
    .bind(teamId, cutoff)
    .all<{ user_id: string; display_name: string; last_seen: number }>();

  const users = result.results ?? [];

  // Fetch full photos from KV in parallel — no truncation issues
  const photos = await Promise.all(
    users.map((u) =>
      env.BANK_KV.get(`tg_photo:${u.user_id}`).catch(() => null)
    )
  );

  const usersWithPhotos = users.map((u, i) => ({ ...u, photo: photos[i] || null }));

  return jsonResponse({ ok: true, users: usersWithPhotos });
}
