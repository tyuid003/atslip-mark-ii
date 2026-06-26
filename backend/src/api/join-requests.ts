// API: Team Join Requests
// POST /api/teams/:slug/join-request          — ส่งคำขอเข้าทีม
// GET  /api/teams/:slug/join-requests/pending — ดู pending requests (สำหรับสมาชิก)
// POST /api/teams/:slug/join-request/:id/approve — อนุมัติ
// POST /api/teams/:slug/join-request/:id/reject  — ปฏิเสธ

import { jsonResponse, errorResponse } from '../utils/helpers';
import type { Env } from '../types';
import { nanoid } from 'nanoid';

function extractToken(req: Request): string | null {
  const auth = req.headers.get('Authorization') ?? '';
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
}

async function getSessionUser(db: D1Database, token: string) {
  return db
    .prepare(
      `SELECT tu.id as internal_id, tu.telegram_id, tu.telegram_first_name, tu.telegram_last_name,
              tu.display_name, tu.photo_kv_key, tu.is_master
       FROM device_sessions ds
       JOIN telegram_users tu ON tu.id = ds.telegram_user_id
       WHERE ds.app_session_token = ? AND ds.is_active = 1`
    )
    .bind(token)
    .first<{
      internal_id: number;
      telegram_id: string;
      telegram_first_name: string;
      telegram_last_name: string;
      display_name: string | null;
      photo_kv_key: string | null;
      is_master: number;
    }>();
}

async function getTeamBySlug(db: D1Database, slug: string) {
  return db
    .prepare(`SELECT id, name FROM teams WHERE slug = ? AND status = 'active' LIMIT 1`)
    .bind(slug)
    .first<{ id: string; name: string }>();
}

/** ตรวจสอบว่า user มี presence row อยู่แล้วในทีม (approved member) */
async function hasMembership(db: D1Database, teamId: string, telegramId: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 FROM user_presence WHERE team_id = ? AND user_id = ? LIMIT 1`)
    .bind(teamId, telegramId)
    .first();
  return row !== null;
}

/** ตรวจสอบว่าทีมมีสมาชิกอยู่แล้วไหม (bootstrap: ถ้าไม่มีเลย = ให้ผ่านได้) */
async function teamHasAnyMember(db: D1Database, teamId: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 FROM user_presence WHERE team_id = ? LIMIT 1`)
    .bind(teamId)
    .first();
  return row !== null;
}

/** Broadcast ผ่าน Durable Object */
async function broadcastToTeam(env: Env, teamId: string, payload: any) {
  try {
    const doId = env.PENDING_NOTIFICATIONS.idFromName('global');
    const doStub = env.PENDING_NOTIFICATIONS.get(doId);
    await doStub.fetch('https://internal/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, data: { ...payload.data, team_id: teamId } }),
    });
  } catch { /* non-critical */ }
}

// ============================================================
// POST /api/teams/:slug/join-request
// ============================================================
export async function handleCreateJoinRequest(
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

  // ตรวจสอบว่าถูก ban ไหม
  const isBanned = await env.DB
    .prepare(`SELECT 1 FROM team_bans WHERE team_id = ? AND telegram_id = ? LIMIT 1`)
    .bind(team.id, user.telegram_id)
    .first();
  if (isBanned) return jsonResponse({ ok: false, status: 'banned' }, 403);

  // Master user: เข้าได้เลยทุกทีมโดยไม่ต้องรอ approve
  if (user.is_master) {
    const nowSec = Math.floor(Date.now() / 1000);
    let photo: string | null = null;
    if (user.photo_kv_key) {
      try { photo = await env.BANK_KV.get(user.photo_kv_key); } catch { /* ignore */ }
    }
    const displayName =
      user.display_name ||
      [user.telegram_first_name, user.telegram_last_name].filter(Boolean).join(' ') ||
      String(user.telegram_id);
    await env.DB.prepare(
      `INSERT INTO user_presence (user_id, team_id, display_name, photo, last_seen)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, team_id) DO UPDATE SET last_seen = excluded.last_seen`
    ).bind(user.telegram_id, team.id, displayName, photo, nowSec).run();
    return jsonResponse({ ok: true, status: 'already_member' });
  }

  // Bootstrap mode: ถ้าทีมยังไม่มีสมาชิกคนแรก → ให้ผ่านได้เลย (seed first member)
  const hasMembers = await teamHasAnyMember(env.DB, team.id);
  if (!hasMembers) {
    // สร้าง presence row ให้เลย (first member)
    const nowSec = Math.floor(Date.now() / 1000);
    let photo: string | null = null;
    if (user.photo_kv_key) {
      try { photo = await env.BANK_KV.get(user.photo_kv_key); } catch { /* ignore */ }
    }
    const displayName =
      user.display_name ||
      [user.telegram_first_name, user.telegram_last_name].filter(Boolean).join(' ') ||
      String(user.telegram_id);
    await env.DB.prepare(
      `INSERT INTO user_presence (user_id, team_id, display_name, photo, last_seen)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, team_id) DO UPDATE SET last_seen = excluded.last_seen`
    ).bind(user.telegram_id, team.id, displayName, photo, nowSec).run();
    return jsonResponse({ ok: true, status: 'already_member' });
  }

  // ถ้ามี membership อยู่แล้ว ไม่ต้องขอ
  if (await hasMembership(env.DB, team.id, user.telegram_id)) {
    return jsonResponse({ ok: true, status: 'already_member' });
  }

  // ดึงรูปโปรไฟล์จาก KV
  let photo: string | null = null;
  if (user.photo_kv_key) {
    try { photo = await env.BANK_KV.get(user.photo_kv_key); } catch { /* ignore */ }
  }

  const displayName =
    user.display_name ||
    [user.telegram_first_name, user.telegram_last_name].filter(Boolean).join(' ') ||
    String(user.telegram_id);

  const now = Date.now();

  // Upsert join request (reset status → pending ถ้าเคย reject มาก่อน)
  const existing = await env.DB
    .prepare(`SELECT id, status FROM team_join_requests WHERE team_id = ? AND telegram_id = ? LIMIT 1`)
    .bind(team.id, user.telegram_id)
    .first<{ id: string; status: string }>();

  let requestId: string;
  if (existing) {
    if (existing.status === 'pending') {
      return jsonResponse({ ok: true, status: 'pending', request_id: existing.id });
    }
    // ส่งใหม่ได้ถ้าเคยถูก reject
    requestId = existing.id;
    await env.DB
      .prepare(`UPDATE team_join_requests SET status = 'pending', display_name = ?, photo = ?, updated_at = ? WHERE id = ?`)
      .bind(displayName, photo, now, requestId)
      .run();
  } else {
    requestId = nanoid(16);
    await env.DB
      .prepare(
        `INSERT INTO team_join_requests (id, team_id, telegram_id, display_name, photo, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`
      )
      .bind(requestId, team.id, user.telegram_id, displayName, photo, now, now)
      .run();
  }

  // Broadcast ไปทุกคนที่ online อยู่ในทีม
  await broadcastToTeam(env, team.id, {
    type: 'join_request',
    data: {
      team_id: team.id,
      team_name: team.name,
      request_id: requestId,
      telegram_id: user.telegram_id,
      display_name: displayName,
      photo: photo ? photo.substring(0, 32768) : null,
    },
  });

  return jsonResponse({ ok: true, status: 'pending', request_id: requestId });
}

// ============================================================
// GET /api/teams/:slug/join-requests/pending
// ============================================================
export async function handleGetPendingRequests(
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

  // Master ผ่านเสมอ — ไม่ต้องรออนุมัติ
  if ((user as any).is_master) return jsonResponse({ ok: true, requests: [] });

  // ต้องเป็นสมาชิกของทีมถึงจะดู pending requests ได้ (ไม่มี bootstrap bypass)
  if (!(await hasMembership(env.DB, team.id, user.telegram_id))) {
    return errorResponse('Forbidden', 403);
  }

  const rows = await env.DB
    .prepare(
      `SELECT id, telegram_id, display_name, photo, created_at
       FROM team_join_requests
       WHERE team_id = ? AND status = 'pending'
       ORDER BY created_at ASC`
    )
    .bind(team.id)
    .all<{ id: string; telegram_id: string; display_name: string; photo: string | null; created_at: number }>();

  return jsonResponse({ ok: true, requests: rows.results ?? [] });
}

// ============================================================
// POST /api/teams/:slug/join-request/:id/approve
// POST /api/teams/:slug/join-request/:id/reject
// ============================================================
export async function handleResolveJoinRequest(
  request: Request,
  env: Env,
  slug: string,
  requestId: string,
  action: 'approve' | 'reject',
): Promise<Response> {
  const token = extractToken(request);
  if (!token) return errorResponse('Unauthorized', 401);

  const resolver = await getSessionUser(env.DB, token);
  if (!resolver) return errorResponse('Unauthorized', 401);

  const team = await getTeamBySlug(env.DB, slug);
  if (!team) return errorResponse('Team not found', 404);

  // ต้องเป็นสมาชิกถึงจะ approve/reject ได้
  if (!(await hasMembership(env.DB, team.id, resolver.telegram_id))) {
    return errorResponse('Forbidden', 403);
  }

  const joinReq = await env.DB
    .prepare(`SELECT id, telegram_id, display_name, photo FROM team_join_requests WHERE id = ? AND team_id = ? AND status = 'pending' LIMIT 1`)
    .bind(requestId, team.id)
    .first<{ id: string; telegram_id: string; display_name: string; photo: string | null }>();

  if (!joinReq) return errorResponse('Join request not found or already resolved', 404);

  const now = Date.now();

  await env.DB
    .prepare(`UPDATE team_join_requests SET status = ?, resolved_by = ?, updated_at = ? WHERE id = ?`)
    .bind(action === 'approve' ? 'approved' : 'rejected', resolver.telegram_id, now, requestId)
    .run();

  if (action === 'approve') {
    // สร้าง user_presence row เพื่อให้ heartbeat อัปเดตได้
    const nowSec = Math.floor(now / 1000);
    await env.DB
      .prepare(
        `INSERT INTO user_presence (user_id, team_id, display_name, photo, last_seen)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id, team_id) DO UPDATE SET display_name = excluded.display_name, last_seen = excluded.last_seen`
      )
      .bind(joinReq.telegram_id, team.id, joinReq.display_name, joinReq.photo, nowSec)
      .run();
  }

  // Broadcast ผลลัพธ์กลับไปให้ผู้ขอ (เพื่อให้ frontend รู้ว่า approved/rejected)
  await broadcastToTeam(env, team.id, {
    type: 'join_request_resolved',
    data: {
      team_id: team.id,
      request_id: requestId,
      telegram_id: joinReq.telegram_id,
      action,
    },
  });

  return jsonResponse({ ok: true, action });
}
