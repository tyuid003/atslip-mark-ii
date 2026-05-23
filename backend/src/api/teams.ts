import type { Env } from '../types';
import {
  successResponse,
  errorResponse,
} from '../utils/helpers';

// ============================================================
// GET /api/teams/:slug - ข้อมูล team ตาม slug
// ============================================================

export async function handleGetTeamBySlug(
  env: Env,
  slug: string
): Promise<Response> {
  try {
    const team = await env.DB.prepare(
      `SELECT id, name, slug, description, status, easyslip_token, created_at, updated_at
       FROM teams
       WHERE slug = ?
       LIMIT 1`
    )
      .bind(slug)
      .first();

    if (!team) {
      return errorResponse('Team not found', 404);
    }

    return successResponse(team);
  } catch (error: any) {
    return errorResponse(error.message, 500);
  }
}

// ============================================================
// GET /api/teams - รายการ team ทั้งหมด
// ============================================================

export async function handleGetAllTeams(env: Env): Promise<Response> {
  try {
    const results = await env.DB.prepare(
      `SELECT id, name, slug, description, status, easyslip_token, created_at, updated_at
       FROM teams
       WHERE status = 'active'
       ORDER BY created_at DESC`
    ).all();

    return successResponse(results.results || []);
  } catch (error: any) {
    return errorResponse(error.message, 500);
  }
}

// ============================================================
// PATCH /api/teams/:slug/settings - อัปเดต easyslip_token ระดับทีม
// ============================================================

export async function handleUpdateTeamSettings(
  request: Request,
  env: Env,
  slug: string
): Promise<Response> {
  try {
    const body = await request.json() as { easyslip_token?: string | null };

    // รับค่า token (ถ้าส่งมาเป็น empty string ให้เก็บเป็น NULL)
    const token = typeof body.easyslip_token === 'string'
      ? (body.easyslip_token.trim() || null)
      : null;

    const now = Math.floor(Date.now() / 1000);
    const result = await env.DB.prepare(
      `UPDATE teams SET easyslip_token = ?, updated_at = ? WHERE slug = ?`
    )
      .bind(token, now, slug)
      .run();

    if (!result.meta?.changes || result.meta.changes < 1) {
      return errorResponse('Team not found', 404);
    }

    return successResponse({ updated: true, easyslip_token: token ? '***' : null });
  } catch (error: any) {
    return errorResponse(error.message, 500);
  }
}
