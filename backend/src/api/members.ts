// ============================================================
// MEMBER MANAGEMENT API
// GET    /api/teams/:slug/members          — list members
// POST   /api/teams/:slug/members/:tid/kick  — kick (remove + clear sessions)
// POST   /api/teams/:slug/members/:tid/ban   — ban (add to team_bans)
// DELETE /api/teams/:slug/members/:tid/ban   — unban
// ============================================================

import type { Env } from '../types';
import { jsonResponse, errorResponse } from '../utils/helpers';
import { nanoid } from 'nanoid';

// ── helpers ────────────────────────────────────────────────

function extractToken(req: Request): string | null {
  const auth = req.headers.get('Authorization') ?? '';
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
}

async function getSessionUser(db: D1Database, token: string) {
  return db
    .prepare(
      `SELECT tu.id as internal_id, tu.telegram_id, tu.display_name,
              tu.telegram_first_name, tu.telegram_last_name, tu.is_master
       FROM device_sessions ds
       JOIN telegram_users tu ON tu.id = ds.telegram_user_id
       WHERE ds.app_session_token = ? AND ds.is_active = 1`
    )
    .bind(token)
    .first<{
      internal_id: number;
      telegram_id: string;
      display_name: string | null;
      telegram_first_name: string | null;
      telegram_last_name: string | null;
      is_master: number;
    }>();
}

async function getTeamBySlug(db: D1Database, slug: string) {
  return db
    .prepare(`SELECT id, name, slug FROM teams WHERE slug = ? LIMIT 1`)
    .bind(slug)
    .first<{ id: string; name: string; slug: string }>();
}

async function hasMembership(db: D1Database, teamId: string, telegramId: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 FROM user_presence WHERE team_id = ? AND user_id = ? LIMIT 1`)
    .bind(teamId, telegramId)
    .first();
  return !!row;
}

async function broadcastToTeam(env: Env, teamId: string, message: unknown) {
  try {
    const id = env.PENDING_NOTIFICATIONS.idFromName('global');
    const stub = env.PENDING_NOTIFICATIONS.get(id);
    await stub.fetch('http://do/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamId, message }),
    });
  } catch { /* non-critical */ }
}

// ── GET /api/teams/:slug/members ───────────────────────────

export async function handleListMembers(
  request: Request,
  env: Env,
  slug: string,
): Promise<Response> {
  const token = extractToken(request);
  if (!token) return errorResponse('Unauthorized', 401);

  const user = await getSessionUser(env.DB, token);
  if (!user) return errorResponse('Unauthorized', 401);

  const team = await getTeamBySlug(env.DB, slug);
  if (!team) return errorResponse('Team not found', 404);

  // ต้องเป็นสมาชิกหรือ master
  if (!user.is_master && !(await hasMembership(env.DB, team.id, user.telegram_id))) {
    return errorResponse('Forbidden', 403);
  }

  // ดึงสมาชิก + ชื่อ Telegram จริง + สถานะ banned
  const members = await env.DB
    .prepare(
      `SELECT
         up.user_id AS telegram_id,
         up.display_name,
         tu.telegram_first_name,
         tu.telegram_last_name,
         tu.photo_kv_key,
         up.last_seen,
         CASE WHEN tb.telegram_id IS NOT NULL THEN 1 ELSE 0 END AS is_banned
       FROM user_presence up
       LEFT JOIN telegram_users tu
         ON tu.telegram_id = up.user_id
       LEFT JOIN team_bans tb
         ON tb.team_id = up.team_id AND tb.telegram_id = up.user_id
       WHERE up.team_id = ?
       ORDER BY up.last_seen DESC`
    )
    .bind(team.id)
    .all<{
      telegram_id: string;
      display_name: string | null;
      telegram_first_name: string | null;
      telegram_last_name: string | null;
      photo_kv_key: string | null;
      last_seen: number;
      is_banned: number;
    }>();

  // แนบรูปโปรไฟล์จาก KV
  const results = await Promise.all(
    (members.results ?? []).map(async (m) => {
      let photo: string | null = null;
      if (m.photo_kv_key) {
        try { photo = await env.BANK_KV.get(m.photo_kv_key); } catch { /* ignore */ }
      }
      const telegramName = [m.telegram_first_name, m.telegram_last_name]
        .filter(Boolean).join(' ') || null;
      return {
        telegram_id: m.telegram_id,
        display_name: m.display_name || telegramName || m.telegram_id,
        telegram_name: telegramName,
        photo,
        last_seen: m.last_seen,
        is_banned: m.is_banned === 1,
      };
    })
  );

  return jsonResponse({ ok: true, members: results });
}

// ── POST /api/teams/:slug/members/:tid/kick ─────────────────

export async function handleKickMember(
  request: Request,
  env: Env,
  slug: string,
  targetTelegramId: string,
): Promise<Response> {
  const token = extractToken(request);
  if (!token) return errorResponse('Unauthorized', 401);

  const actor = await getSessionUser(env.DB, token);
  if (!actor) return errorResponse('Unauthorized', 401);

  const team = await getTeamBySlug(env.DB, slug);
  if (!team) return errorResponse('Team not found', 404);

  // ต้องเป็นสมาชิกหรือ master
  if (!actor.is_master && !(await hasMembership(env.DB, team.id, actor.telegram_id))) {
    return errorResponse('Forbidden', 403);
  }

  // ลบออกจาก user_presence
  await env.DB
    .prepare(`DELETE FROM user_presence WHERE team_id = ? AND user_id = ?`)
    .bind(team.id, targetTelegramId)
    .run();

  // ล้าง device_sessions ทั้งหมดของ user นี้ (ทุก session ทุก device)
  await env.DB
    .prepare(
      `UPDATE device_sessions SET is_active = 0
       WHERE telegram_user_id = (
         SELECT id FROM telegram_users WHERE telegram_id = ?
       )`
    )
    .bind(targetTelegramId)
    .run();

  // Broadcast ให้ user ที่ถูกเตะ redirect ออก
  await broadcastToTeam(env, team.id, {
    type: 'member_kicked',
    data: { telegram_id: targetTelegramId, team_id: team.id },
  });

  return jsonResponse({ ok: true });
}

// ── POST /api/teams/:slug/members/:tid/ban ──────────────────

export async function handleBanMember(
  request: Request,
  env: Env,
  slug: string,
  targetTelegramId: string,
): Promise<Response> {
  const token = extractToken(request);
  if (!token) return errorResponse('Unauthorized', 401);

  const actor = await getSessionUser(env.DB, token);
  if (!actor) return errorResponse('Unauthorized', 401);

  const team = await getTeamBySlug(env.DB, slug);
  if (!team) return errorResponse('Team not found', 404);

  if (!actor.is_master && !(await hasMembership(env.DB, team.id, actor.telegram_id))) {
    return errorResponse('Forbidden', 403);
  }

  const body = await request.json<{ reason?: string }>().catch(() => ({}));

  // Upsert ban record
  const now = Date.now();
  await env.DB
    .prepare(
      `INSERT INTO team_bans (id, team_id, telegram_id, banned_by, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(team_id, telegram_id) DO UPDATE SET
         banned_by = excluded.banned_by,
         reason = excluded.reason,
         created_at = excluded.created_at`
    )
    .bind(nanoid(16), team.id, targetTelegramId, actor.telegram_id, body.reason ?? null, now)
    .run();

  // ลบออกจาก user_presence ด้วย
  await env.DB
    .prepare(`DELETE FROM user_presence WHERE team_id = ? AND user_id = ?`)
    .bind(team.id, targetTelegramId)
    .run();

  // ล้าง device_sessions
  await env.DB
    .prepare(
      `UPDATE device_sessions SET is_active = 0
       WHERE telegram_user_id = (
         SELECT id FROM telegram_users WHERE telegram_id = ?
       )`
    )
    .bind(targetTelegramId)
    .run();

  // Broadcast
  await broadcastToTeam(env, team.id, {
    type: 'member_kicked',
    data: { telegram_id: targetTelegramId, team_id: team.id },
  });

  return jsonResponse({ ok: true });
}

// ── DELETE /api/teams/:slug/members/:tid/ban ────────────────

export async function handleUnbanMember(
  request: Request,
  env: Env,
  slug: string,
  targetTelegramId: string,
): Promise<Response> {
  const token = extractToken(request);
  if (!token) return errorResponse('Unauthorized', 401);

  const actor = await getSessionUser(env.DB, token);
  if (!actor) return errorResponse('Unauthorized', 401);

  const team = await getTeamBySlug(env.DB, slug);
  if (!team) return errorResponse('Team not found', 404);

  if (!actor.is_master && !(await hasMembership(env.DB, team.id, actor.telegram_id))) {
    return errorResponse('Forbidden', 403);
  }

  await env.DB
    .prepare(`DELETE FROM team_bans WHERE team_id = ? AND telegram_id = ?`)
    .bind(team.id, targetTelegramId)
    .run();

  return jsonResponse({ ok: true });
}
