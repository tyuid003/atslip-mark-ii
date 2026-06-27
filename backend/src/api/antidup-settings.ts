// Anti-Duplicate Settings API
// GET  /api/settings/antidup       — ดึง accountId ที่เปิด anti-dup (per-user)
// POST /api/settings/antidup       — เปิด/ปิด anti-dup สำหรับ accountId (per-user)
// GET  /api/settings/antidup-cross — ดึง cross-user anti-dup config
// POST /api/settings/antidup-cross — เปิด/ปิด cross-user anti-dup + ตั้ง window
// GET  /api/settings/account-modes — ดึง auto/manual mode ของแต่ละบัญชี
// POST /api/settings/account-modes — ตั้ง auto/manual mode ของบัญชี

import { jsonResponse, errorResponse } from '../utils/helpers';
import type { Env } from '../types';

function antidupKvKey(teamId: string): string {
  return `team:${teamId}:antidup`;
}
function antidupCrossKvKey(teamId: string): string {
  return `team:${teamId}:antidup-cross`;
}
function accountModesKvKey(teamId: string): string {
  return `team:${teamId}:account-modes`;
}

async function getEnabledAccounts(env: Env, teamId: string): Promise<string[]> {
  const raw = await env.BANK_KV.get(antidupKvKey(teamId));
  if (!raw) return [];
  try { return JSON.parse(raw) as string[]; } catch { return []; }
}

async function getCrossSettings(env: Env, teamId: string): Promise<Record<string, { enabled: boolean; windowSeconds: number }>> {
  const raw = await env.BANK_KV.get(antidupCrossKvKey(teamId));
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

async function getAccountModes(env: Env, teamId: string): Promise<Record<string, boolean>> {
  const raw = await env.BANK_KV.get(accountModesKvKey(teamId));
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
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
  // ─── Per-user anti-dup (existing) ──────────────────────────
  async handleGet(request: Request, env: Env): Promise<Response> {
    const teamId = await getTeamIdFromRequest(request, env);
    if (!teamId) return errorResponse('team_slug required', 400);
    const enabled = await getEnabledAccounts(env, teamId);
    return jsonResponse({ success: true, enabled_accounts: enabled });
  },

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

  async isEnabled(env: Env, teamId: string, accountId: string | number): Promise<boolean> {
    const enabled = await getEnabledAccounts(env, teamId);
    return enabled.includes(String(accountId));
  },

  // ─── Cross-user anti-dup (new) ─────────────────────────────
  async handleGetCross(request: Request, env: Env): Promise<Response> {
    const teamId = await getTeamIdFromRequest(request, env);
    if (!teamId) return errorResponse('team_slug required', 400);
    const settings = await getCrossSettings(env, teamId);
    return jsonResponse({ success: true, cross_settings: settings });
  },

  async handlePostCross(request: Request, env: Env): Promise<Response> {
    const teamId = await getTeamIdFromRequest(request, env);
    if (!teamId) return errorResponse('team_slug required', 400);
    const body = await request.json() as { account_id?: unknown; enabled?: unknown; window_seconds?: unknown };
    const accountId = String(body.account_id ?? '').trim();
    if (!accountId) return errorResponse('account_id required', 400);
    const enabled = body.enabled === true || body.enabled === 'true';
    const windowSeconds = Number(body.window_seconds ?? 60);
    const current = await getCrossSettings(env, teamId);
    if (enabled) {
      current[accountId] = { enabled: true, windowSeconds: Math.max(1, windowSeconds) };
    } else {
      delete current[accountId];
    }
    await env.BANK_KV.put(antidupCrossKvKey(teamId), JSON.stringify(current));
    return jsonResponse({ success: true, cross_settings: current });
  },

  async isCrossEnabled(env: Env, teamId: string, accountId: string | number): Promise<boolean> {
    const settings = await getCrossSettings(env, teamId);
    return settings[String(accountId)]?.enabled === true;
  },

  async getCrossWindowSeconds(env: Env, teamId: string, accountId: string | number): Promise<number> {
    const settings = await getCrossSettings(env, teamId);
    return settings[String(accountId)]?.windowSeconds ?? 60;
  },

  // ─── Account auto/manual mode (new) ────────────────────────
  async handleGetAccountModes(request: Request, env: Env): Promise<Response> {
    const teamId = await getTeamIdFromRequest(request, env);
    if (!teamId) return errorResponse('team_slug required', 400);
    const modes = await getAccountModes(env, teamId);
    return jsonResponse({ success: true, account_modes: modes });
  },

  async handlePostAccountMode(request: Request, env: Env): Promise<Response> {
    const teamId = await getTeamIdFromRequest(request, env);
    if (!teamId) return errorResponse('team_slug required', 400);
    const body = await request.json() as { account_id?: unknown; auto?: unknown };
    const accountId = String(body.account_id ?? '').trim();
    if (!accountId) return errorResponse('account_id required', 400);
    const auto = body.auto !== false && body.auto !== 'false'; // default true
    const current = await getAccountModes(env, teamId);
    if (auto) {
      delete current[accountId]; // true is default → don't store to keep KV lean
    } else {
      current[accountId] = false; // manual mode
    }
    await env.BANK_KV.put(accountModesKvKey(teamId), JSON.stringify(current));
    return jsonResponse({ success: true, account_modes: current });
  },

  /** true = auto (default), false = manual */
  async getAccountIsAuto(env: Env, teamId: string, accountId: string | number): Promise<boolean> {
    const modes = await getAccountModes(env, teamId);
    return modes[String(accountId)] !== false; // default auto
  },
};
