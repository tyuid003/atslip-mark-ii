// ============================================================
// MASTER ADMIN API — เฉพาะ is_master = 1
// GET  /api/master/teams                       — รายการทีมทั้งหมด
// POST /api/master/teams                       — สร้างทีมใหม่
// PATCH /api/master/teams/:slug                — แก้ไขชื่อ / slug
// DELETE /api/master/teams/:slug               — ลบทีม
// GET  /api/master/users                       — รายการ user ทั้งหมด + ทีม
// POST /api/master/users/:tid/add-to-team      — เพิ่ม user เข้าทีม
// POST /api/master/users/:tid/kick             — เตะ user จากทีม (body: { team_slug })
// POST /api/master/users/:tid/ban              — ban user จากทีม (body: { team_slug, reason? })
// ============================================================

import type { Env } from '../types';
import { jsonResponse, errorResponse } from '../utils/helpers';
import { nanoid } from 'nanoid';

function extractToken(req: Request): string | null {
  const auth = req.headers.get('Authorization') ?? '';
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
}

async function getMasterUser(db: D1Database, token: string) {
  const user = await db
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
      is_master: number;
    }>();
  if (!user || !user.is_master) return null;
  return user;
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

// ── GET /api/master/teams ──────────────────────────────────

export async function handleMasterListTeams(
  request: Request,
  env: Env,
): Promise<Response> {
  const token = extractToken(request);
  if (!token) return errorResponse('Unauthorized', 401);
  if (!(await getMasterUser(env.DB, token))) return errorResponse('Forbidden', 403);

  const rows = await env.DB
    .prepare(
      `SELECT t.id, t.name, t.slug, t.status, t.created_at,
              COUNT(up.user_id) AS member_count
       FROM teams t
       LEFT JOIN user_presence up ON up.team_id = t.id
       GROUP BY t.id
       ORDER BY t.created_at DESC`
    )
    .all();
  return jsonResponse({ ok: true, teams: rows.results ?? [] });
}

// ── POST /api/master/teams ─────────────────────────────────

export async function handleMasterCreateTeam(
  request: Request,
  env: Env,
): Promise<Response> {
  const token = extractToken(request);
  if (!token) return errorResponse('Unauthorized', 401);
  if (!(await getMasterUser(env.DB, token))) return errorResponse('Forbidden', 403);

  const body = await request.json<{ name: string; slug: string }>().catch(() => null);
  if (!body?.name || !body?.slug) return errorResponse('name and slug required');

  const slug = body.slug.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const now = Date.now();
  const id = nanoid(16);

  try {
    await env.DB
      .prepare(
        `INSERT INTO teams (id, name, slug, status, created_at, updated_at)
         VALUES (?, ?, ?, 'active', ?, ?)`
      )
      .bind(id, body.name, slug, now, now)
      .run();
  } catch (e: any) {
    if (String(e?.message).includes('UNIQUE')) return errorResponse('slug already exists', 409);
    throw e;
  }

  return jsonResponse({ ok: true, team: { id, name: body.name, slug } }, 201);
}

// ── PATCH /api/master/teams/:slug ─────────────────────────

export async function handleMasterUpdateTeam(
  request: Request,
  env: Env,
  slug: string,
): Promise<Response> {
  const token = extractToken(request);
  if (!token) return errorResponse('Unauthorized', 401);
  if (!(await getMasterUser(env.DB, token))) return errorResponse('Forbidden', 403);

  const team = await env.DB
    .prepare(`SELECT id FROM teams WHERE slug = ? LIMIT 1`)
    .bind(slug)
    .first<{ id: string }>();
  if (!team) return errorResponse('Team not found', 404);

  const body = await request.json<{ name?: string; slug?: string }>().catch(() => ({}));
  const now = Date.now();

  const updates: string[] = ['updated_at = ?'];
  const binds: unknown[] = [now];

  if (body.name) { updates.push('name = ?'); binds.push(body.name); }
  if (body.slug) {
    const newSlug = body.slug.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    updates.push('slug = ?');
    binds.push(newSlug);
  }
  binds.push(team.id);

  await env.DB
    .prepare(`UPDATE teams SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run();

  return jsonResponse({ ok: true });
}

// ── DELETE /api/master/teams/:slug ────────────────────────

export async function handleMasterDeleteTeam(
  request: Request,
  env: Env,
  slug: string,
): Promise<Response> {
  const token = extractToken(request);
  if (!token) return errorResponse('Unauthorized', 401);
  if (!(await getMasterUser(env.DB, token))) return errorResponse('Forbidden', 403);

  const team = await env.DB
    .prepare(`SELECT id FROM teams WHERE slug = ? LIMIT 1`)
    .bind(slug)
    .first<{ id: string }>();
  if (!team) return errorResponse('Team not found', 404);

  await env.DB.prepare(`DELETE FROM teams WHERE id = ?`).bind(team.id).run();

  return jsonResponse({ ok: true });
}

// ── GET /api/master/users ─────────────────────────────────

export async function handleMasterListUsers(
  request: Request,
  env: Env,
): Promise<Response> {
  const token = extractToken(request);
  if (!token) return errorResponse('Unauthorized', 401);
  if (!(await getMasterUser(env.DB, token))) return errorResponse('Forbidden', 403);

  // ดึง user ทั้งหมดที่เคย register
  const users = await env.DB
    .prepare(
      `SELECT tu.telegram_id, tu.display_name,
              tu.telegram_first_name, tu.telegram_last_name,
              tu.photo_kv_key, tu.is_master,
              ds.last_seen
       FROM telegram_users tu
       LEFT JOIN (
         SELECT telegram_user_id, MAX(updated_at) AS last_seen
         FROM device_sessions
         WHERE is_active = 1
         GROUP BY telegram_user_id
       ) ds ON ds.telegram_user_id = tu.id
       ORDER BY tu.id DESC`
    )
    .all<{
      telegram_id: string;
      display_name: string | null;
      telegram_first_name: string | null;
      telegram_last_name: string | null;
      photo_kv_key: string | null;
      is_master: number;
      last_seen: number | null;
    }>();

  // ดึงทีมของแต่ละ user
  const presenceRows = await env.DB
    .prepare(
      `SELECT up.user_id, t.id AS team_id, t.name AS team_name, t.slug AS team_slug
       FROM user_presence up
       JOIN teams t ON t.id = up.team_id`
    )
    .all<{ user_id: string; team_id: string; team_name: string; team_slug: string }>();

  const teamsByUser = new Map<string, { id: string; name: string; slug: string }[]>();
  for (const row of presenceRows.results ?? []) {
    if (!teamsByUser.has(row.user_id)) teamsByUser.set(row.user_id, []);
    teamsByUser.get(row.user_id)!.push({ id: row.team_id, name: row.team_name, slug: row.team_slug });
  }

  // แนบรูป + ประกอบข้อมูล
  const result = await Promise.all(
    (users.results ?? []).map(async (u) => {
      let photo: string | null = null;
      if (u.photo_kv_key) {
        try { photo = await env.BANK_KV.get(u.photo_kv_key); } catch { /* ignore */ }
      }
      const telegramName = [u.telegram_first_name, u.telegram_last_name]
        .filter(Boolean).join(' ') || null;
      return {
        telegram_id: u.telegram_id,
        display_name: u.display_name || telegramName || u.telegram_id,
        telegram_name: telegramName,
        photo,
        is_master: u.is_master === 1,
        last_seen: u.last_seen,
        teams: teamsByUser.get(u.telegram_id) ?? [],
      };
    })
  );

  return jsonResponse({ ok: true, users: result });
}

// ── POST /api/master/users/:tid/add-to-team ───────────────

export async function handleMasterAddToTeam(
  request: Request,
  env: Env,
  targetTelegramId: string,
): Promise<Response> {
  const token = extractToken(request);
  if (!token) return errorResponse('Unauthorized', 401);
  if (!(await getMasterUser(env.DB, token))) return errorResponse('Forbidden', 403);

  const body = await request.json<{ team_slug: string }>().catch(() => null);
  if (!body?.team_slug) return errorResponse('team_slug required');

  const team = await env.DB
    .prepare(`SELECT id FROM teams WHERE slug = ? LIMIT 1`)
    .bind(body.team_slug)
    .first<{ id: string }>();
  if (!team) return errorResponse('Team not found', 404);

  // ดึงชื่อ user
  const tu = await env.DB
    .prepare(
      `SELECT display_name, telegram_first_name, telegram_last_name, photo_kv_key
       FROM telegram_users WHERE telegram_id = ? LIMIT 1`
    )
    .bind(targetTelegramId)
    .first<{ display_name: string | null; telegram_first_name: string | null; telegram_last_name: string | null; photo_kv_key: string | null }>();

  const displayName = tu?.display_name ||
    [tu?.telegram_first_name, tu?.telegram_last_name].filter(Boolean).join(' ') ||
    targetTelegramId;

  const now = Math.floor(Date.now() / 1000);
  await env.DB
    .prepare(
      `INSERT INTO user_presence (user_id, team_id, display_name, photo, last_seen)
       VALUES (?, ?, ?, NULL, ?)
       ON CONFLICT(user_id, team_id) DO UPDATE SET last_seen = excluded.last_seen`
    )
    .bind(targetTelegramId, team.id, displayName, now)
    .run();

  return jsonResponse({ ok: true });
}

// ── POST /api/master/users/:tid/kick ──────────────────────

export async function handleMasterKick(
  request: Request,
  env: Env,
  targetTelegramId: string,
): Promise<Response> {
  const token = extractToken(request);
  if (!token) return errorResponse('Unauthorized', 401);
  const actor = await getMasterUser(env.DB, token);
  if (!actor) return errorResponse('Forbidden', 403);

  const body = await request.json<{ team_slug: string }>().catch(() => null);
  if (!body?.team_slug) return errorResponse('team_slug required');

  const team = await env.DB
    .prepare(`SELECT id FROM teams WHERE slug = ? LIMIT 1`)
    .bind(body.team_slug)
    .first<{ id: string }>();
  if (!team) return errorResponse('Team not found', 404);

  await env.DB
    .prepare(`DELETE FROM user_presence WHERE team_id = ? AND user_id = ?`)
    .bind(team.id, targetTelegramId)
    .run();

  // ล้าง sessions
  await env.DB
    .prepare(
      `UPDATE device_sessions SET is_active = 0
       WHERE telegram_user_id = (SELECT id FROM telegram_users WHERE telegram_id = ?)`
    )
    .bind(targetTelegramId)
    .run();

  await broadcastToTeam(env, team.id, {
    type: 'member_kicked',
    data: { telegram_id: targetTelegramId, team_id: team.id },
  });

  return jsonResponse({ ok: true });
}

// ── POST /api/master/users/:tid/ban ───────────────────────

export async function handleMasterBan(
  request: Request,
  env: Env,
  targetTelegramId: string,
): Promise<Response> {
  const token = extractToken(request);
  if (!token) return errorResponse('Unauthorized', 401);
  const actor = await getMasterUser(env.DB, token);
  if (!actor) return errorResponse('Forbidden', 403);

  const body = await request.json<{ team_slug: string; reason?: string }>().catch(() => null);
  if (!body?.team_slug) return errorResponse('team_slug required');

  const team = await env.DB
    .prepare(`SELECT id FROM teams WHERE slug = ? LIMIT 1`)
    .bind(body.team_slug)
    .first<{ id: string }>();
  if (!team) return errorResponse('Team not found', 404);

  const now = Date.now();
  await env.DB
    .prepare(
      `INSERT INTO team_bans (id, team_id, telegram_id, banned_by, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(team_id, telegram_id) DO UPDATE SET
         banned_by = excluded.banned_by, reason = excluded.reason, created_at = excluded.created_at`
    )
    .bind(nanoid(16), team.id, targetTelegramId, actor.telegram_id, body.reason ?? null, now)
    .run();

  await env.DB
    .prepare(`DELETE FROM user_presence WHERE team_id = ? AND user_id = ?`)
    .bind(team.id, targetTelegramId)
    .run();

  await env.DB
    .prepare(
      `UPDATE device_sessions SET is_active = 0
       WHERE telegram_user_id = (SELECT id FROM telegram_users WHERE telegram_id = ?)`
    )
    .bind(targetTelegramId)
    .run();

  await broadcastToTeam(env, team.id, {
    type: 'member_kicked',
    data: { telegram_id: targetTelegramId, team_id: team.id },
  });

  return jsonResponse({ ok: true });
}
