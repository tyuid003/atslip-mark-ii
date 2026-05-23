// Team API Keys API
// Endpoints สำหรับจัดการ API keys ระดับทีม (EasySlip / Slip2Go)
//
// GET    /api/teams/:slug/api-keys             - list
// POST   /api/teams/:slug/api-keys             - create
// PATCH  /api/teams/:slug/api-keys/:id         - update fields
// DELETE /api/teams/:slug/api-keys/:id         - delete
// POST   /api/teams/:slug/api-keys/reorder     - reorder { ids: [id1, id2, ...] } (ลำดับ = priority ascending)
// POST   /api/teams/:slug/api-keys/:id/move    - move up/down { direction: 'up' | 'down' }

import { successResponse, errorResponse } from '../utils/helpers';
import type { Env, SlipServiceProvider } from '../types';

function mask(token: string | null | undefined): string | null {
  if (!token) return null;
  if (token.length <= 8) return '***';
  return token.substring(0, 4) + '...' + token.substring(token.length - 4);
}

async function getTeamIdBySlug(env: Env, slug: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT id FROM teams WHERE slug = ? LIMIT 1')
    .bind(slug)
    .first<{ id: string }>();
  return row?.id || null;
}

function genId(): string {
  return 'apikey_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function isValidService(s: any): s is SlipServiceProvider {
  return s === 'easyslip' || s === 'slip2go';
}

export const TeamApiKeysAPI = {
  async list(_request: Request, env: Env, slug: string): Promise<Response> {
    const teamId = await getTeamIdBySlug(env, slug);
    if (!teamId) return errorResponse('Team not found', 404);

    const result = await env.DB.prepare(
      `SELECT id, team_id, service, label, api_key, branch_id, priority, status, created_at, updated_at
       FROM team_api_keys
       WHERE team_id = ?
       ORDER BY priority ASC, created_at ASC`
    ).bind(teamId).all();

    const keys = (result.results || []).map((row: any) => ({
      ...row,
      api_key_masked: mask(row.api_key),
      // คืน api_key ดิบไปด้วย เพื่อให้แอดมินทีมเห็นได้ในตอนแก้ไข (ทีมตัวเองเท่านั้น)
      api_key: row.api_key,
    }));

    return successResponse({ keys });
  },

  async create(request: Request, env: Env, slug: string): Promise<Response> {
    const teamId = await getTeamIdBySlug(env, slug);
    if (!teamId) return errorResponse('Team not found', 404);

    let body: any;
    try {
      body = await request.json();
    } catch {
      return errorResponse('Invalid JSON body', 400);
    }

    const service = String(body?.service || '').toLowerCase();
    const apiKey = String(body?.api_key || '').trim();
    const label = body?.label ? String(body.label).trim() : null;
    // branch_id: ไม่ใช้แล้ว (Slip2Go ใช้ API Secret เดียวต่อร้าน) — เก็บ column ไว้เพื่อ backward compat
    const branchId: string | null = null;

    if (!isValidService(service)) return errorResponse('service must be "easyslip" or "slip2go"', 400);
    if (!apiKey) return errorResponse('api_key is required', 400);

    // หา priority ถัดไป (ต่อท้าย)
    const maxRow = await env.DB.prepare(
      `SELECT COALESCE(MAX(priority), -1) AS max_p FROM team_api_keys WHERE team_id = ?`
    ).bind(teamId).first<{ max_p: number }>();
    const nextPriority = (maxRow?.max_p ?? -1) + 1;

    const id = genId();
    await env.DB.prepare(
      `INSERT INTO team_api_keys (id, team_id, service, label, api_key, branch_id, priority, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`
    )
      .bind(id, teamId, service, label, apiKey, branchId, nextPriority)
      .run();

    return successResponse({ id, service, label, priority: nextPriority });
  },

  async update(request: Request, env: Env, slug: string, keyId: string): Promise<Response> {
    const teamId = await getTeamIdBySlug(env, slug);
    if (!teamId) return errorResponse('Team not found', 404);

    let body: any;
    try {
      body = await request.json();
    } catch {
      return errorResponse('Invalid JSON body', 400);
    }

    // โหลด row เดิม
    const row = await env.DB.prepare(
      `SELECT id, service, branch_id FROM team_api_keys WHERE id = ? AND team_id = ? LIMIT 1`
    ).bind(keyId, teamId).first<{ id: string; service: string; branch_id: string | null }>();
    if (!row) return errorResponse('API key not found', 404);

    const updates: string[] = [];
    const binds: any[] = [];

    if (typeof body.label === 'string' || body.label === null) {
      updates.push('label = ?');
      binds.push(body.label || null);
    }
    if (typeof body.api_key === 'string' && body.api_key.trim()) {
      updates.push('api_key = ?');
      binds.push(body.api_key.trim());
    }
    // branch_id: legacy field — ไม่อนุญาตให้แก้ผ่าน API อีกแล้ว (Slip2Go ไม่ใช้)
    if (body.status === 'active' || body.status === 'disabled') {
      updates.push('status = ?');
      binds.push(body.status);
    }

    if (updates.length === 0) return errorResponse('No fields to update', 400);

    updates.push("updated_at = datetime('now')");
    binds.push(keyId, teamId);

    await env.DB.prepare(
      `UPDATE team_api_keys SET ${updates.join(', ')} WHERE id = ? AND team_id = ?`
    ).bind(...binds).run();

    return successResponse({ id: keyId, updated: true });
  },

  async remove(_request: Request, env: Env, slug: string, keyId: string): Promise<Response> {
    const teamId = await getTeamIdBySlug(env, slug);
    if (!teamId) return errorResponse('Team not found', 404);

    const res = await env.DB.prepare(
      `DELETE FROM team_api_keys WHERE id = ? AND team_id = ?`
    ).bind(keyId, teamId).run();

    if (!res.meta?.changes) return errorResponse('API key not found', 404);

    // หลังลบ → re-pack priority เพื่อให้ contiguous (0,1,2,...)
    const remaining = await env.DB.prepare(
      `SELECT id FROM team_api_keys WHERE team_id = ? ORDER BY priority ASC, created_at ASC`
    ).bind(teamId).all();
    const ids = (remaining.results || []).map((r: any) => r.id as string);
    for (let i = 0; i < ids.length; i++) {
      await env.DB.prepare(
        `UPDATE team_api_keys SET priority = ?, updated_at = datetime('now') WHERE id = ? AND team_id = ?`
      ).bind(i, ids[i], teamId).run();
    }

    return successResponse({ deleted: true });
  },

  async reorder(request: Request, env: Env, slug: string): Promise<Response> {
    const teamId = await getTeamIdBySlug(env, slug);
    if (!teamId) return errorResponse('Team not found', 404);

    let body: any;
    try {
      body = await request.json();
    } catch {
      return errorResponse('Invalid JSON body', 400);
    }

    const ids: any = body?.ids;
    if (!Array.isArray(ids) || ids.length === 0) return errorResponse('ids array is required', 400);

    // ตรวจสอบว่า ids ทั้งหมดเป็นของ team นี้
    const placeholders = ids.map(() => '?').join(',');
    const existing = await env.DB.prepare(
      `SELECT id FROM team_api_keys WHERE team_id = ? AND id IN (${placeholders})`
    ).bind(teamId, ...ids).all();
    if ((existing.results || []).length !== ids.length) {
      return errorResponse('Some ids do not belong to this team', 400);
    }

    // อัพเดต priority ตามลำดับใน array
    for (let i = 0; i < ids.length; i++) {
      await env.DB.prepare(
        `UPDATE team_api_keys SET priority = ?, updated_at = datetime('now') WHERE id = ? AND team_id = ?`
      ).bind(i, ids[i], teamId).run();
    }

    return successResponse({ reordered: ids.length });
  },

  async move(request: Request, env: Env, slug: string, keyId: string): Promise<Response> {
    const teamId = await getTeamIdBySlug(env, slug);
    if (!teamId) return errorResponse('Team not found', 404);

    let body: any;
    try { body = await request.json(); } catch { return errorResponse('Invalid JSON body', 400); }

    const direction = body?.direction;
    if (direction !== 'up' && direction !== 'down') {
      return errorResponse('direction must be "up" or "down"', 400);
    }

    const all = await env.DB.prepare(
      `SELECT id FROM team_api_keys WHERE team_id = ? ORDER BY priority ASC, created_at ASC`
    ).bind(teamId).all();
    const ids = (all.results || []).map((r: any) => r.id as string);
    const idx = ids.indexOf(keyId);
    if (idx < 0) return errorResponse('API key not found', 404);

    const target = direction === 'up' ? idx - 1 : idx + 1;
    if (target < 0 || target >= ids.length) {
      return successResponse({ moved: false, reason: 'already at boundary' });
    }

    // swap
    [ids[idx], ids[target]] = [ids[target], ids[idx]];

    for (let i = 0; i < ids.length; i++) {
      await env.DB.prepare(
        `UPDATE team_api_keys SET priority = ?, updated_at = datetime('now') WHERE id = ? AND team_id = ?`
      ).bind(i, ids[i], teamId).run();
    }

    return successResponse({ moved: true });
  },
};
