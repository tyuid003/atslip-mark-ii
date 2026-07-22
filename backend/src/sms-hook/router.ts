// ============================================================
// SMS-HOOK SUB-PROJECT (isolated module)
// ============================================================
// วัตถุประสงค์: รับรูปสลิปจาก LINE OA → สแกนด้วย team API keys →
//   แปลงเป็นข้อความรูปแบบ SMS (เหมือน 100%) → ยิง webhook เข้าระบบปลายทาง
//   (ระบบปลายทางเป็นคนจัดการเครดิตเอง)
//
// เป็นโปรเจคย่อยที่แยกออกจาก ATslip หลักโดยสิ้นเชิง — ถอดออกได้โดย:
//   1) ลบโฟลเดอร์ backend/src/sms-hook/
//   2) ลบ 2 บรรทัดที่ mount `handleSmsHookRoute` ใน backend/src/index.ts
//   3) (ถ้าต้องการ) DROP TABLE smshook_sites, smshook_banks, smshook_logs
//
// ตารางทั้งหมดขึ้นต้นด้วย `smshook_` และถูกสร้างแบบ lazy (CREATE IF NOT EXISTS)
// จึงไม่แตะ migration ของ ATslip หลัก
// ============================================================

import type { Env } from '../types';
import {
  jsonResponse,
  successResponse,
  errorResponse,
  generateId,
  currentTimestamp,
} from '../utils/helpers';
import { ScanService } from '../services/scan.service';
import { fetchLineImage } from '../utils/line-utils';

// ──────────────────────────────────────────────────────────────
// DB — lazy table creation
// ──────────────────────────────────────────────────────────────
let tablesReady = false;
async function ensureTables(env: Env): Promise<void> {
  if (tablesReady) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS smshook_sites (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      name TEXT NOT NULL,
      line_channel_id TEXT,
      line_channel_secret TEXT,
      line_channel_access_token TEXT,
      webhook_url TEXT NOT NULL DEFAULT '',
      webhook_method TEXT NOT NULL DEFAULT 'POST',
      webhook_content_type TEXT NOT NULL DEFAULT 'application/json',
      webhook_body_template TEXT NOT NULL DEFAULT '{"message":"{message}"}',
      webhook_headers TEXT NOT NULL DEFAULT '{}',
      bank_code_map TEXT NOT NULL DEFAULT '{}',
      mock_total TEXT NOT NULL DEFAULT '1,000.00',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`
  ).run();
  await env.DB.prepare(
    `CREATE INDEX IF NOT EXISTS idx_smshook_sites_team ON smshook_sites(team_id)`
  ).run();

  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS smshook_banks (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      team_id TEXT NOT NULL,
      bank_short TEXT NOT NULL,
      account_number TEXT NOT NULL,
      account_name TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`
  ).run();
  await env.DB.prepare(
    `CREATE INDEX IF NOT EXISTS idx_smshook_banks_site ON smshook_banks(site_id)`
  ).run();

  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS smshook_logs (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      team_id TEXT NOT NULL,
      slip_ref TEXT,
      message TEXT,
      status TEXT,
      http_status INTEGER,
      response_body TEXT,
      created_at INTEGER NOT NULL
    )`
  ).run();
  await env.DB.prepare(
    `CREATE INDEX IF NOT EXISTS idx_smshook_logs_site ON smshook_logs(site_id, created_at)`
  ).run();
  // ป้องกันยิงซ้ำ (LINE retry) ด้วย unique (site_id, slip_ref)
  await env.DB.prepare(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_smshook_logs_dedup ON smshook_logs(site_id, slip_ref)`
  ).run();

  tablesReady = true;
}

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────
async function getTeamBySlug(env: Env, slug: string): Promise<{ id: string; name: string; slug: string } | null> {
  return await env.DB.prepare('SELECT id, name, slug FROM teams WHERE slug = ? LIMIT 1')
    .bind(slug)
    .first<{ id: string; name: string; slug: string }>();
}

function sanitizeSite(row: any): any {
  if (!row) return row;
  // ไม่ปิดบัง credential เพราะเป็นหน้าจัดการของทีมเอง (แนวเดียวกับ team-api-keys)
  return {
    ...row,
    webhook_headers: safeParseJson(row.webhook_headers, {}),
    bank_code_map: safeParseJson(row.bank_code_map, {}),
  };
}

function safeParseJson(text: any, fallback: any): any {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}

// ──────────────────────────────────────────────────────────────
// SMS message formatting
// รูปแบบ (ต้องเหมือน 100%):
//   {dd}/{mm}@{hh}:{mm} {amount} จาก{shortbankname}/x{sender}เข้าx{receiver} ใช้ได้{total}บ
//   ตัวอย่าง: 22/07@13:00 1,700.00 จากBAY/x079229เข้าx542728 ใช้ได้2,813.09บ
// ──────────────────────────────────────────────────────────────
function last6Digits(acc: any): string {
  const digits = String(acc || '').replace(/\D/g, '');
  return digits.slice(-6);
}

function formatAmount(n: any): string {
  const num = Number(n) || 0;
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatThaiDateTime(dateStr: string): { dd: string; mm: string; hh: string; min: string } {
  const d = new Date(dateStr);
  // แปลงเป็นเวลาไทย (UTC+7) แล้วอ่าน field แบบ UTC
  const th = isNaN(d.getTime()) ? new Date() : new Date(d.getTime() + 7 * 3600 * 1000);
  return {
    dd: String(th.getUTCDate()).padStart(2, '0'),
    mm: String(th.getUTCMonth() + 1).padStart(2, '0'),
    hh: String(th.getUTCHours()).padStart(2, '0'),
    min: String(th.getUTCMinutes()).padStart(2, '0'),
  };
}

function buildSmsMessage(slip: any, bankCodeMap: Record<string, string>, mockTotal: string): string {
  const { dd, mm, hh, min } = formatThaiDateTime(slip.date);
  const amount = formatAmount(slip.amount?.amount);

  const rawShort = String(slip.sender?.bank?.short || slip.sender?.bank?.id || '').trim();
  const shortBank = bankCodeMap[rawShort] || bankCodeMap[rawShort.toUpperCase()] || rawShort;

  const senderAcc = last6Digits(
    slip.sender?.account?.bank?.account || slip.sender?.account?.proxy?.account
  );
  const receiverAcc = last6Digits(
    slip.receiver?.account?.bank?.account || slip.receiver?.account?.proxy?.account
  );

  return `${dd}/${mm}@${hh}:${min} ${amount} จาก${shortBank}/x${senderAcc}เข้าx${receiverAcc} ใช้ได้${mockTotal}บ`;
}

// ──────────────────────────────────────────────────────────────
// Fire webhook เข้าระบบปลายทาง
// ──────────────────────────────────────────────────────────────
function buildBody(template: string, message: string, contentType: string): string {
  let val: string;
  if (contentType.includes('json')) {
    // escape ให้อยู่ใน JSON string ได้ (ตัด double-quote ครอบออก)
    val = JSON.stringify(message).slice(1, -1);
  } else if (contentType.includes('urlencoded')) {
    val = encodeURIComponent(message);
  } else {
    val = message;
  }
  return template.split('{message}').join(val);
}

async function fireWebhook(
  site: any,
  message: string
): Promise<{ ok: boolean; httpStatus: number; body: string }> {
  const method = (site.webhook_method || 'POST').toUpperCase();
  const contentType = site.webhook_content_type || 'application/json';
  const bodyTemplate = site.webhook_body_template || '{"message":"{message}"}';
  const extraHeaders = safeParseJson(site.webhook_headers, {});

  const headers: Record<string, string> = { 'Content-Type': contentType };
  for (const [k, v] of Object.entries(extraHeaders)) {
    if (typeof v === 'string') headers[k] = v;
  }

  const body = ['GET', 'HEAD'].includes(method) ? undefined : buildBody(bodyTemplate, message, contentType);

  try {
    const resp = await fetch(site.webhook_url, { method, headers, body });
    const text = await resp.text().catch(() => '');
    return { ok: resp.ok, httpStatus: resp.status, body: text.slice(0, 500) };
  } catch (err: any) {
    return { ok: false, httpStatus: 0, body: String(err?.message || err).slice(0, 500) };
  }
}

// ──────────────────────────────────────────────────────────────
// LINE inbound: /api/smshook/line/:siteId
// ──────────────────────────────────────────────────────────────
function base64FromArrayBuffer(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function verifyLineSignature(rawBody: string, channelSecret: string, signature: string | null): Promise<boolean> {
  if (!signature || !channelSecret) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(channelSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  return base64FromArrayBuffer(signed) === signature;
}

async function processSlipEvent(env: Env, site: any, messageId: string): Promise<void> {
  const log = (...a: any[]) => console.log('[SmsHook]', ...a);

  // 1) ดาวน์โหลดรูปจาก LINE
  const imageFile = await fetchLineImage(site.line_channel_access_token, messageId);
  if (!imageFile) {
    log('ไม่สามารถโหลดรูปจาก LINE ได้', { siteId: site.id, messageId });
    return;
  }

  // 2) สแกนด้วย team API keys (round-robin ตาม last_used_at + priority)
  const keys = await env.DB.prepare(
    `SELECT id, service, api_key, branch_id FROM team_api_keys
     WHERE team_id = ? AND status = 'active'
     ORDER BY COALESCE(last_used_at, 0) ASC, priority ASC`
  ).bind(site.team_id).all<{ id: string; service: any; api_key: string; branch_id: string | null }>();

  const pickedKeys = keys.results || [];
  if (pickedKeys.length === 0) {
    log('ทีมนี้ยังไม่มี API key สำหรับสแกน', { teamId: site.team_id });
    await recordLog(env, site, null, null, 'scan_failed', 0, 'no team api key');
    return;
  }

  let slip: any = null;
  const errors: string[] = [];
  for (const key of pickedKeys) {
    await env.DB.prepare(`UPDATE team_api_keys SET last_used_at = ? WHERE id = ?`)
      .bind(currentTimestamp(), key.id).run();
    try {
      const result = await ScanService.callProvider(imageFile, key);
      if (result?.success && result?.data?.status === 200) {
        slip = result.data.data;
        break;
      }
      errors.push(`${key.service}: ${(result as any)?.data?.message || 'scan failed'}`);
    } catch (err: any) {
      errors.push(`${key.service}: ${err?.message || 'error'}`);
    }
  }

  if (!slip) {
    log('สแกนไม่สำเร็จ', errors.join(' | '));
    await recordLog(env, site, null, null, 'scan_failed', 0, errors.join(' | '));
    return;
  }

  const slipRef = String(slip.transRef || '');

  // 3) dedup — กันยิงซ้ำจาก LINE retry
  if (slipRef) {
    const dup = await env.DB.prepare(
      `SELECT id FROM smshook_logs WHERE site_id = ? AND slip_ref = ? LIMIT 1`
    ).bind(site.id, slipRef).first();
    if (dup) {
      log('สลิปซ้ำ ข้ามการยิง webhook', { slipRef });
      return;
    }
  }

  // 4) แปลงเป็นข้อความ SMS + ยิง webhook
  const bankCodeMap = safeParseJson(site.bank_code_map, {});
  const message = buildSmsMessage(slip, bankCodeMap, site.mock_total || '1,000.00');
  log('SMS message:', message);

  if (!site.webhook_url) {
    await recordLog(env, site, slipRef, message, 'failed', 0, 'no webhook_url configured');
    return;
  }

  const res = await fireWebhook(site, message);
  await recordLog(
    env, site, slipRef, message,
    res.ok ? 'sent' : 'failed', res.httpStatus, res.body
  );
}

async function recordLog(
  env: Env, site: any, slipRef: string | null, message: string | null,
  status: string, httpStatus: number, responseBody: string
): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO smshook_logs (id, site_id, team_id, slip_ref, message, status, http_status, response_body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      generateId(), site.id, site.team_id, slipRef, message, status, httpStatus, responseBody, currentTimestamp()
    ).run();
  } catch {
    // unique(site_id, slip_ref) ชนกัน = ซ้ำ → เพิกเฉย
  }
}

async function handleLineInbound(request: Request, env: Env, ctx: ExecutionContext, siteId: string): Promise<Response> {
  const site = await env.DB.prepare(`SELECT * FROM smshook_sites WHERE id = ? LIMIT 1`)
    .bind(siteId).first<any>();
  if (!site) return jsonResponse({ success: true, ignored: true, reason: 'site not found' });
  if (Number(site.enabled) !== 1) return jsonResponse({ success: true, ignored: true, reason: 'disabled' });

  const rawBody = await request.text();
  const signature = request.headers.get('x-line-signature');
  const valid = await verifyLineSignature(rawBody, site.line_channel_secret, signature);
  if (!valid) return jsonResponse({ success: false, error: 'Invalid LINE signature' }, 401);

  const payload = safeParseJson(rawBody, {});
  const events = Array.isArray(payload.events) ? payload.events : [];

  for (const event of events) {
    if (event?.type === 'message' && event?.message?.type === 'image' && event?.message?.id) {
      ctx.waitUntil(processSlipEvent(env, site, event.message.id));
    }
  }
  return jsonResponse({ success: true, received: true });
}

// ──────────────────────────────────────────────────────────────
// Admin CRUD (เรียกจากหน้า /{teamslug})
// ──────────────────────────────────────────────────────────────
async function handleGetTeam(env: Env, slug: string): Promise<Response> {
  const team = await getTeamBySlug(env, slug);
  if (!team) return errorResponse('Team not found', 404);
  return successResponse({ team });
}

async function handleListSites(env: Env, slug: string, baseUrl: string): Promise<Response> {
  const team = await getTeamBySlug(env, slug);
  if (!team) return errorResponse('Team not found', 404);
  const rows = await env.DB.prepare(
    `SELECT * FROM smshook_sites WHERE team_id = ? ORDER BY created_at DESC`
  ).bind(team.id).all<any>();
  const sites = (rows.results || []).map((r: any) => ({
    ...sanitizeSite(r),
    line_webhook_url: `${baseUrl}/api/smshook/line/${r.id}`,
  }));
  return successResponse({ team, sites });
}

async function handleCreateSite(request: Request, env: Env, slug: string): Promise<Response> {
  const team = await getTeamBySlug(env, slug);
  if (!team) return errorResponse('Team not found', 404);
  const body = await request.json().catch(() => ({})) as any;
  if (!body.name || !String(body.name).trim()) return errorResponse('name is required', 400);

  const id = generateId();
  const now = currentTimestamp();
  await env.DB.prepare(
    `INSERT INTO smshook_sites
      (id, team_id, name, line_channel_id, line_channel_secret, line_channel_access_token,
       webhook_url, webhook_method, webhook_content_type, webhook_body_template, webhook_headers,
       bank_code_map, mock_total, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, team.id, String(body.name).trim(),
    body.line_channel_id || null,
    body.line_channel_secret || null,
    body.line_channel_access_token || null,
    body.webhook_url || '',
    body.webhook_method || 'POST',
    body.webhook_content_type || 'application/json',
    body.webhook_body_template || '{"message":"{message}"}',
    JSON.stringify(body.webhook_headers || {}),
    JSON.stringify(body.bank_code_map || {}),
    body.mock_total || '1,000.00',
    body.enabled === 0 ? 0 : 1,
    now, now
  ).run();

  return successResponse({ id }, 'Site created');
}

const SITE_UPDATABLE = [
  'name', 'line_channel_id', 'line_channel_secret', 'line_channel_access_token',
  'webhook_url', 'webhook_method', 'webhook_content_type', 'webhook_body_template',
  'mock_total', 'enabled',
];

async function handleUpdateSite(request: Request, env: Env, slug: string, siteId: string): Promise<Response> {
  const team = await getTeamBySlug(env, slug);
  if (!team) return errorResponse('Team not found', 404);
  const site = await env.DB.prepare(`SELECT id FROM smshook_sites WHERE id = ? AND team_id = ? LIMIT 1`)
    .bind(siteId, team.id).first();
  if (!site) return errorResponse('Site not found', 404);

  const body = await request.json().catch(() => ({})) as any;
  const updates: string[] = [];
  const binds: any[] = [];

  for (const field of SITE_UPDATABLE) {
    if (field in body) {
      updates.push(`${field} = ?`);
      binds.push(field === 'enabled' ? (body[field] ? 1 : 0) : body[field]);
    }
  }
  // JSON fields
  if ('webhook_headers' in body) {
    updates.push('webhook_headers = ?');
    binds.push(JSON.stringify(body.webhook_headers || {}));
  }
  if ('bank_code_map' in body) {
    updates.push('bank_code_map = ?');
    binds.push(JSON.stringify(body.bank_code_map || {}));
  }

  if (updates.length === 0) return errorResponse('No fields to update', 400);
  updates.push('updated_at = ?');
  binds.push(currentTimestamp());
  binds.push(siteId, team.id);

  await env.DB.prepare(
    `UPDATE smshook_sites SET ${updates.join(', ')} WHERE id = ? AND team_id = ?`
  ).bind(...binds).run();

  return successResponse({ id: siteId }, 'Site updated');
}

async function handleDeleteSite(env: Env, slug: string, siteId: string): Promise<Response> {
  const team = await getTeamBySlug(env, slug);
  if (!team) return errorResponse('Team not found', 404);
  await env.DB.prepare(`DELETE FROM smshook_banks WHERE site_id = ?`).bind(siteId).run();
  await env.DB.prepare(`DELETE FROM smshook_logs WHERE site_id = ?`).bind(siteId).run();
  await env.DB.prepare(`DELETE FROM smshook_sites WHERE id = ? AND team_id = ?`).bind(siteId, team.id).run();
  return successResponse({ id: siteId }, 'Site deleted');
}

async function handleListBanks(env: Env, slug: string, siteId: string): Promise<Response> {
  const team = await getTeamBySlug(env, slug);
  if (!team) return errorResponse('Team not found', 404);
  const rows = await env.DB.prepare(
    `SELECT * FROM smshook_banks WHERE site_id = ? ORDER BY created_at ASC`
  ).bind(siteId).all<any>();
  return successResponse({ banks: rows.results || [] });
}

async function handleCreateBank(request: Request, env: Env, slug: string, siteId: string): Promise<Response> {
  const team = await getTeamBySlug(env, slug);
  if (!team) return errorResponse('Team not found', 404);
  const site = await env.DB.prepare(`SELECT id FROM smshook_sites WHERE id = ? AND team_id = ? LIMIT 1`)
    .bind(siteId, team.id).first();
  if (!site) return errorResponse('Site not found', 404);

  const body = await request.json().catch(() => ({})) as any;
  if (!body.bank_short || !body.account_number) {
    return errorResponse('bank_short and account_number are required', 400);
  }
  const id = generateId();
  const now = currentTimestamp();
  await env.DB.prepare(
    `INSERT INTO smshook_banks (id, site_id, team_id, bank_short, account_number, account_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, siteId, team.id,
    String(body.bank_short).trim().toUpperCase(),
    String(body.account_number).trim(),
    body.account_name ? String(body.account_name).trim() : null,
    now, now
  ).run();
  return successResponse({ id }, 'Bank added');
}

async function handleDeleteBank(env: Env, slug: string, siteId: string, bankId: string): Promise<Response> {
  const team = await getTeamBySlug(env, slug);
  if (!team) return errorResponse('Team not found', 404);
  await env.DB.prepare(`DELETE FROM smshook_banks WHERE id = ? AND site_id = ? AND team_id = ?`)
    .bind(bankId, siteId, team.id).run();
  return successResponse({ id: bankId }, 'Bank deleted');
}

async function handleListLogs(env: Env, slug: string, siteId: string): Promise<Response> {
  const team = await getTeamBySlug(env, slug);
  if (!team) return errorResponse('Team not found', 404);
  const rows = await env.DB.prepare(
    `SELECT id, slip_ref, message, status, http_status, response_body, created_at
     FROM smshook_logs WHERE site_id = ? ORDER BY created_at DESC LIMIT 50`
  ).bind(siteId).all<any>();
  return successResponse({ logs: rows.results || [] });
}

// ──────────────────────────────────────────────────────────────
// ROUTER — entry point (mount ครั้งเดียวใน index.ts)
// คืน null ถ้า path ไม่ใช่ของ sub-project นี้ (ให้ router หลักทำงานต่อ)
// ──────────────────────────────────────────────────────────────
export async function handleSmsHookRoute(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response | null> {
  const url = new URL(request.url);
  const pathname = url.pathname;
  if (!pathname.startsWith('/api/smshook/')) return null;

  await ensureTables(env);
  const method = request.method;
  const baseUrl = `${url.protocol}//${url.host}`;

  // LINE inbound: POST /api/smshook/line/:siteId
  const lineMatch = pathname.match(/^\/api\/smshook\/line\/([^/]+)$/);
  if (lineMatch && method === 'POST') {
    return handleLineInbound(request, env, ctx, lineMatch[1]);
  }

  // Admin endpoints: /api/smshook/:slug/...
  const rest = pathname.slice('/api/smshook/'.length);
  const parts = rest.split('/').filter(Boolean);
  // parts[0] = slug
  const slug = parts[0];
  if (!slug || slug === 'line') return errorResponse('Not found', 404);

  // GET /api/smshook/:slug  → team info
  if (parts.length === 1) {
    if (method === 'GET') return handleGetTeam(env, slug);
    return errorResponse('Method not allowed', 405);
  }

  // /api/smshook/:slug/sites ...
  if (parts[1] === 'sites') {
    const siteId = parts[2];
    // /sites
    if (!siteId) {
      if (method === 'GET') return handleListSites(env, slug, baseUrl);
      if (method === 'POST') return handleCreateSite(request, env, slug);
      return errorResponse('Method not allowed', 405);
    }
    const sub = parts[3];
    // /sites/:siteId
    if (!sub) {
      if (method === 'PATCH' || method === 'PUT') return handleUpdateSite(request, env, slug, siteId);
      if (method === 'DELETE') return handleDeleteSite(env, slug, siteId);
      return errorResponse('Method not allowed', 405);
    }
    // /sites/:siteId/banks[/:bankId]
    if (sub === 'banks') {
      const bankId = parts[4];
      if (!bankId) {
        if (method === 'GET') return handleListBanks(env, slug, siteId);
        if (method === 'POST') return handleCreateBank(request, env, slug, siteId);
        return errorResponse('Method not allowed', 405);
      }
      if (method === 'DELETE') return handleDeleteBank(env, slug, siteId, bankId);
      return errorResponse('Method not allowed', 405);
    }
    // /sites/:siteId/logs
    if (sub === 'logs' && method === 'GET') {
      return handleListLogs(env, slug, siteId);
    }
  }

  return errorResponse('Not found', 404);
}
