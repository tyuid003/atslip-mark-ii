// API: User Presence (online status per team)
// POST /api/presence      — heartbeat (upsert last_seen)
// GET  /api/presence      — list online users in a team (?team_id=xxx)

import { jsonResponse, errorResponse } from '../utils/helpers';

interface Env {
  DB: D1Database;
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
    ? body.photo.substring(0, 32768)
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
    `SELECT user_id, display_name, photo, last_seen
     FROM user_presence
     WHERE team_id = ? AND last_seen > ?
     ORDER BY last_seen DESC
     LIMIT 50`
  )
    .bind(teamId, cutoff)
    .all<{ user_id: string; display_name: string; photo: string | null; last_seen: number }>();

  return jsonResponse({ ok: true, users: result.results ?? [] });
}
