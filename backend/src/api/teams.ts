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
      `SELECT id, name, slug, description, status, created_at, updated_at
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
      `SELECT id, name, slug, description, status, created_at, updated_at
       FROM teams
       WHERE status = 'active'
       ORDER BY created_at DESC`
    ).all();

    return successResponse(results.results || []);
  } catch (error: any) {
    return errorResponse(error.message, 500);
  }
}
