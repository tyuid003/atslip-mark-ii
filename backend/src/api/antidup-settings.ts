// Anti-Duplicate Settings API
// GET  /api/settings/antidup  — ดึง accountId ที่เปิด anti-dup
// POST /api/settings/antidup  — เปิด/ปิด anti-dup สำหรับ accountId ใด accountId หนึ่ง

import { jsonResponse, errorResponse } from '../utils/helpers';
import type { Env } from '../types';

function antidupKvKey(teamId: string): string {
  return `team:${teamId}:antidup`;
}

async function getEnabledAccounts(env: Env, teamId: string): Promise<string[]> {
  const raw = await env.BANK_KV.get(antidupKvKey(teamId));
  if (!raw) return [];
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

async function getTeamIdFromRequest(request: Request, env: Env): Promise<string | null> {
  const url = new URL(request.url);
  const teamSlug = request.headers.get('X-Team-Slug') || url.searchParams.get('team_slug');
  if (!teamSlug) return null;
  const team = await env.DB.prepare('SELECT id FROM teams WHERE slug = ? LIMIT 1')
    .bind(teamSlug)
    .first<{ id: string }>();
  return team?.id || null;
}

export const AntidupSettingsAPI = {
  /** GET /api/settings/antidup */
  async handleGet(request: Request, env: Env): Promise<Response> {
    const teamId = await getTeamIdFromRequest(request, env);
    if (!teamId) return errorResponse('team_slug required', 400);

    const enabled = await getEnabledAccounts(env, teamId);
    return jsonResponse({ success: true, enabled_accounts: enabled });
  },

  /** POST /api/settings/antidup  body: { account_id: string, enabled: boolean } */
  async handlePost(request: Request, env: Env): Promise<Response> {
    const teamId = await getTeamIdFromRequest(request, env);
    if (!teamId) return errorResponse('team_slug required', 400);

    const body = await request.json() as { account_id?: unknown; enabled?: unknown };
    const accountId = String(body.account_id ?? '').trim();
    if (!accountId) return errorResponse('account_id required', 400);
    const enable = body.enabled === true || body.enabled === 'true';

    const current = await getEnabledAccounts(env, teamId);
    const updated = enable
      ? Array.from(new Set([...current, accountId]))
      : current.filter((id) => id !== accountId);

    await env.BANK_KV.put(antidupKvKey(teamId), JSON.stringify(updated));
    return jsonResponse({ success: true, enabled_accounts: updated });
  },

  /** ตรวจสอบว่า accountId เปิด anti-dup หรือไม่ */
  async isEnabled(env: Env, teamId: string, accountId: string | number): Promise<boolean> {
    const enabled = await getEnabledAccounts(env, teamId);
    return enabled.includes(String(accountId));
  },
};
