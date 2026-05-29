/**
 * Scan Queue Service (Phase B)
 *
 * รองรับงาน scan/credit จากทุกช่องทาง โดยเฉพาะ Telegram (และในอนาคต Browser)
 *
 * Design:
 *   - ทุกช่องทาง enqueue ใส่ `scan_jobs` (status=queued)
 *   - claim-and-process แบบ atomic: UPDATE...SET status='processing' WHERE id=? AND status='queued'
 *     ถ้า meta.changes==1 = claim สำเร็จ
 *   - per-team concurrency: skip job ถ้าทีมมี processing อยู่เกิน limit
 *   - retry: exponential backoff (next_attempt_at)
 *   - DLQ: status='dead_letter' เมื่อ attempts >= max_attempts
 *   - idempotency: unique(team_id, idempotency_key)
 *
 * Public API:
 *   - enqueueScanJob(env, params) → jobId (or existing one if dedup)
 *   - processScanJob(env, jobId) → claim + run + finalize one job
 *   - processQueueOnce(env, opts) → batch (used by cron + waitUntil)
 */
import type { Env, ScanJob } from '../types';
import { generateId, currentTimestamp } from '../utils/helpers';

const DEFAULT_MAX_ATTEMPTS = 5;
const PER_TEAM_CONCURRENCY = 10; // จำกัด 10 job processing พร้อมกันต่อทีม

// ============================================================
// Enqueue
// ============================================================

export interface EnqueueParams {
  team_id: string;
  tenant_id?: string | null;
  source: 'webhook' | 'manual' | 'upload' | 'telegram' | 'line';
  idempotency_key: string;
  trace_id?: string;
  payload: Record<string, any>;
  max_attempts?: number;
}

/**
 * enqueueScanJob — สร้างงานใหม่ (หรือคืน job เดิมถ้า idempotency key ซ้ำ)
 */
export async function enqueueScanJob(
  env: Env,
  params: EnqueueParams,
): Promise<{ id: string; created: boolean }> {
  const now = currentTimestamp();
  const traceId = params.trace_id || generateId();

  // ถ้ามี job ที่ idempotency key เดิม แล้วยังไม่จบ → คืน id เดิม (idempotency)
  const existing = await env.DB.prepare(
    `SELECT id FROM scan_jobs WHERE team_id = ? AND idempotency_key = ? LIMIT 1`,
  )
    .bind(params.team_id, params.idempotency_key)
    .first<{ id: string }>();

  if (existing) {
    return { id: existing.id, created: false };
  }

  const id = generateId();
  await env.DB.prepare(
    `INSERT INTO scan_jobs
     (id, team_id, tenant_id, source, idempotency_key, trace_id, payload_json,
      status, attempts, max_attempts, next_attempt_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      params.team_id,
      params.tenant_id || null,
      params.source,
      params.idempotency_key,
      traceId,
      JSON.stringify(params.payload),
      params.max_attempts || DEFAULT_MAX_ATTEMPTS,
      now,
      now,
      now,
    )
    .run();

  return { id, created: true };
}

// ============================================================
// Claim & Process
// ============================================================

/**
 * ตรวจ concurrency ของทีม
 */
async function teamProcessingCount(env: Env, teamId: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM scan_jobs WHERE team_id = ? AND status = 'processing'`,
  )
    .bind(teamId)
    .first<{ c: number }>();
  return row?.c || 0;
}

/**
 * claim job — atomic UPDATE
 */
async function claimJob(env: Env, jobId: string): Promise<ScanJob | null> {
  const now = currentTimestamp();
  const result = await env.DB.prepare(
    `UPDATE scan_jobs
     SET status = 'processing', attempts = attempts + 1, updated_at = ?
     WHERE id = ? AND status = 'queued' AND next_attempt_at <= ?`,
  )
    .bind(now, jobId, now)
    .run();

  // D1 ส่ง meta.changes/rows_written. ถ้า claim ไม่ได้ → ออก
  if (!result.meta?.changes || result.meta.changes < 1) return null;

  return await env.DB.prepare(`SELECT * FROM scan_jobs WHERE id = ? LIMIT 1`)
    .bind(jobId)
    .first<ScanJob>();
}

/**
 * finalize — success
 */
async function markSuccess(
  env: Env,
  jobId: string,
  result: any,
  pendingTransactionId?: string | null,
): Promise<void> {
  const now = currentTimestamp();
  await env.DB.prepare(
    `UPDATE scan_jobs
     SET status = 'success', result_json = ?, pending_transaction_id = ?,
         completed_at = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      JSON.stringify(result || null),
      pendingTransactionId || null,
      now,
      now,
      jobId,
    )
    .run();
}

/**
 * finalize — failure (retry หรือ DLQ)
 */
async function markFailed(env: Env, job: ScanJob, error: string): Promise<void> {
  const now = currentTimestamp();
  const willDeadLetter = job.attempts + 0 >= job.max_attempts; // attempts ถูก ++ แล้วใน claim
  if (willDeadLetter) {
    await env.DB.prepare(
      `UPDATE scan_jobs
       SET status = 'dead_letter', last_error = ?, completed_at = ?, updated_at = ?
       WHERE id = ?`,
    )
      .bind(error.slice(0, 1000), now, now, job.id)
      .run();
    return;
  }
  // exponential backoff: 30s, 60s, 120s, 240s, ...
  const backoffSec = Math.min(30 * Math.pow(2, job.attempts), 600);
  const nextAt = now + backoffSec;
  await env.DB.prepare(
    `UPDATE scan_jobs
     SET status = 'queued', last_error = ?, next_attempt_at = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(error.slice(0, 1000), nextAt, now, job.id)
    .run();
}

// ============================================================
// Handlers (per source)
// ============================================================

import { ScanAPI } from '../api/scan';
import {
  getConnectionByTeamId,
  sendMessage,
  editMessageText,
  downloadFile,
} from './telegram.service';

/**
 * แปลงวันที่ ISO เป็น "YYYY-MM-DD HH:mm" (timezone +07:00)
 */
function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    // แปลงเป็น UTC+7
    const offset = 7 * 60;
    const localMs = d.getTime() + offset * 60 * 1000;
    const local = new Date(localMs);
    const yyyy = local.getUTCFullYear();
    const mm = String(local.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(local.getUTCDate()).padStart(2, '0');
    const hh = String(local.getUTCHours()).padStart(2, '0');
    const min = String(local.getUTCMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
  } catch {
    return dateStr;
  }
}

/**
 * แปลงผล scan เป็นข้อความสำหรับส่งกลับ Telegram
 */
function formatScanResultMessage(result: any): { text: string; markup?: any } {
  const data = result?.data;
  if (!data) {
    return { text: `❌ ไม่สามารถประมวลผลสลิปได้\n${result?.error || 'unknown error'}` };
  }
  const slip = data.slip || {};
  const sender = data.sender || {};
  const tenant = data.tenant || {};
  const credit = data.credit || {};
  const status = data.status || 'unknown';
  const tenantLine = tenant.name ? `\n🌐 ${tenant.name}` : '';

  // ── credit success ───────────────────────────────────────────────────
  if (credit?.success && !credit?.duplicate) {
    return {
      text:
        `✅ เครดิตสำเร็จ\n` +
        `ยูส: ${sender.username || sender.id || '-'}\n` +
        `ชื่อ: ${sender.name || '-'}\n` +
        `ยอด: ${Number(slip.amount || 0).toLocaleString()} บาท\n` +
        `วันที่: ${formatDate(slip.date)}\n` +
        `อ้างอิง: ${slip.ref || '-'}` +
        tenantLine,
      markup: {
        inline_keyboard: [[
          { text: '↩️ ดึงเครดิตกลับ', callback_data: `wd:${data.transaction_id || ''}` },
        ]],
      },
    };
  }

  // ── duplicate ────────────────────────────────────────────────────────
  if (status === 'duplicate' || credit?.duplicate) {
    return {
      text:
        `⚠️ ยอดซ้ำ (Duplicate)\n` +
        `ผู้โอน: ${sender.name || '-'}\n` +
        `ยอด: ${Number(slip.amount || 0).toLocaleString()} บาท\n` +
        `วันที่: ${formatDate(slip.date)}\n` +
        `อ้างอิง: ${slip.ref || '-'}` +
        tenantLine,
    };
  }

  // ── matched but not credited ─────────────────────────────────────────
  if (status === 'matched') {
    return {
      text:
        `🟡 จับคู่แล้ว (ยังไม่ได้เติม)\n` +
        `ยูส: ${sender.username || sender.id || '-'}\n` +
        `ชื่อ: ${sender.name || '-'}\n` +
        `ยอด: ${Number(slip.amount || 0).toLocaleString()} บาท\n` +
        `วันที่: ${formatDate(slip.date)}\n` +
        `อ้างอิง: ${slip.ref || '-'}` +
        tenantLine,
      markup: {
        inline_keyboard: [[
          { text: '💰 เติมเครดิต', callback_data: `cr:${data.transaction_id || ''}` },
          { text: '👤 ระบุยูส', callback_data: `su:${data.transaction_id || ''}` },
        ]],
      },
    };
  }

  // ── pending (no user matched) ────────────────────────────────────────
  return {
    text:
      `⏳ ไม่พบยูสเซอร์ (Pending)\n` +
      `ผู้โอน: ${sender.name || '-'}\n` +
      `ยอด: ${Number(slip.amount || 0).toLocaleString()} บาท\n` +
      `วันที่: ${formatDate(slip.date)}\n` +
      `อ้างอิง: ${slip.ref || '-'}` +
      tenantLine,
    markup: {
      inline_keyboard: [[
        { text: '👤 ระบุยูส', callback_data: `su:${data.transaction_id || ''}` },
      ]],
    },
  };
}

/**
 * processTelegramScanJob — payload ของ telegram source
 *  payload = {
 *    telegram_group_id, telegram_user_id, telegram_message_id, file_id, status_message_id?
 *  }
 */
async function processTelegramScanJob(env: Env, job: ScanJob): Promise<{ resultText?: string; pendingTxId?: string | null }> {
  const payload = JSON.parse(job.payload_json || '{}');
  const conn = await getConnectionByTeamId(env, job.team_id);
  if (!conn) throw new Error('Telegram connection not found for team');

  // 1) ดาวน์โหลดรูปจาก Telegram
  const file = await downloadFile(env, conn, payload.file_id);
  if (!file) throw new Error('Failed to download photo from Telegram');

  // 2) สร้าง synthetic Request ส่งไปยัง ScanAPI.handleUploadSlip
  const fd = new FormData();
  // Telegram photos เป็นรูปเสมอ — ถ้า contentType ไม่ใช่ image/* ให้ fallback เป็น image/jpeg
  const mimeType = (file.contentType && file.contentType.startsWith('image/'))
    ? file.contentType
    : 'image/jpeg';
  const blob = new Blob([file.bytes], { type: mimeType });
  fd.append('file', blob, `tg-${payload.file_id}.jpg`);
  fd.append('source', 'telegram');
  // ถ้า user เลือก key ด้วย /changeapikey ให้ส่ง api_key_id ไปด้วย
  if (conn.selected_api_key_id) {
    fd.append('api_key_id', conn.selected_api_key_id);
  }

  // หา team slug เพื่อจำกัด receiver matching
  const team = await env.DB.prepare(`SELECT slug FROM teams WHERE id = ? LIMIT 1`)
    .bind(job.team_id)
    .first<{ slug: string }>();
  const headers = new Headers();
  if (team?.slug) headers.set('X-Team-Slug', team.slug);

  const syntheticReq = new Request('https://internal/api/scan/upload', {
    method: 'POST',
    body: fd,
    headers,
  });

  const resp = await ScanAPI.handleUploadSlip(syntheticReq, env);
  let json: any;
  try {
    json = await resp.json();
  } catch {
    json = { success: false, error: `Scan returned non-JSON (status ${resp.status})` };
  }

  // 3) สร้างข้อความผลลัพธ์ + ส่งกลับ Telegram
  const { text: resultText, markup } = formatScanResultMessage(json);

  // ถ้ามี status_message_id (ข้อความ "รับคำขอแล้ว") → edit แทนที่จะ send ใหม่
  let sentMessageId: number | undefined;
  if (payload.status_message_id) {
    const ok = await editMessageText(env, conn, payload.telegram_group_id, payload.status_message_id, resultText, {
      reply_markup: markup,
    });
    if (ok) sentMessageId = Number(payload.status_message_id);
  }
  if (!sentMessageId) {
    const sent = await sendMessage(env, conn, payload.telegram_group_id, resultText, {
      reply_to_message_id: payload.telegram_message_id,
      reply_markup: markup,
    });
    if (sent.ok && sent.message_id) sentMessageId = sent.message_id;
  }

  // 4) บันทึก message link → pending tx (ถ้ามี)
  const pendingTxId: string | null = json?.data?.transaction_id || null;
  if (pendingTxId && sentMessageId) {
    try {
      await env.DB.prepare(
        `INSERT INTO telegram_message_links
         (id, team_id, telegram_group_id, telegram_message_id, pending_transaction_id, message_type, created_at)
         VALUES (?, ?, ?, ?, ?, 'scan_result', ?)
         ON CONFLICT(telegram_group_id, telegram_message_id) DO NOTHING`,
      )
        .bind(
          generateId(),
          job.team_id,
          payload.telegram_group_id,
          String(sentMessageId),
          pendingTxId,
          currentTimestamp(),
        )
        .run();
    } catch (e: any) {
      console.warn('[ScanQueue] insert telegram_message_links failed:', e?.message);
    }
  }

  return { resultText, pendingTxId };
}

import { getOrCreateLineMessageSettings } from './line-message-settings.service';
import {
  fetchLineImage,
  callLinePushAPI,
  isDuplicateScanResult,
  buildFlexMessage,
} from '../utils/line-utils';

/**
 * processLineScanJob — payload ของ line source
 *  payload = { line_oa_id, line_user_id, line_message_id }
 */
async function processLineScanJob(env: Env, job: ScanJob): Promise<{ pendingTxId?: string | null }> {
  const payload = JSON.parse(job.payload_json || '{}');

  // 1. โหลด LINE OA
  const lineOA = await env.DB.prepare(
    `SELECT id, tenant_id, channel_access_token FROM line_oas WHERE id = ? AND status = 'active' LIMIT 1`,
  ).bind(payload.line_oa_id).first<any>();
  if (!lineOA) throw new Error(`LINE OA not found or inactive: ${payload.line_oa_id}`);

  // 2. ดาวน์โหลดรูปจาก LINE Content API
  const imageFile = await fetchLineImage(lineOA.channel_access_token, payload.line_message_id);
  if (!imageFile) throw new Error(`Failed to download LINE image: ${payload.line_message_id}`);

  // 3. สร้าง synthetic Request → ScanAPI.handleUploadSlip
  const fd = new FormData();
  fd.append('file', imageFile);
  fd.append('tenant_id', lineOA.tenant_id);
  fd.append('source', 'line');
  fd.append('line_oa_id', lineOA.id);

  const team = await env.DB.prepare(`SELECT slug FROM teams WHERE id = ? LIMIT 1`)
    .bind(job.team_id)
    .first<{ slug: string }>();
  const headers = new Headers();
  if (team?.slug) headers.set('X-Team-Slug', team.slug);

  const syntheticReq = new Request('https://internal/api/scan/upload', { method: 'POST', body: fd, headers });
  const resp = await ScanAPI.handleUploadSlip(syntheticReq, env);
  let json: any;
  try { json = await resp.json(); } catch { json = { success: false, error: `non-JSON (status ${resp.status})` }; }

  // 4. โหลด settings และส่ง push reply
  const settings = await getOrCreateLineMessageSettings(env, lineOA.id, lineOA.tenant_id);
  const data = json?.data || {};
  const status = data.status;
  const userId = payload.line_user_id;

  if (!resp.ok && isDuplicateScanResult(resp, json)) {
    if (settings.enable_duplicate_flex === 1) {
      await callLinePushAPI(lineOA.channel_access_token, userId, [buildFlexMessage(settings, 'duplicate', data)]);
    }
  } else if (status === 'credited' && settings.enable_success_flex === 1) {
    await callLinePushAPI(lineOA.channel_access_token, userId, [buildFlexMessage(settings, 'credited', data)]);
  } else if (status === 'duplicate' && settings.enable_duplicate_flex === 1) {
    await callLinePushAPI(lineOA.channel_access_token, userId, [buildFlexMessage(settings, 'duplicate', data)]);
  } else if ((!resp.ok || !json?.success) && settings.enable_failed_reply === 1) {
    await callLinePushAPI(lineOA.channel_access_token, userId, [{ type: 'text', text: settings.failed_reply_text }]);
  }

  return { pendingTxId: json?.data?.transaction_id || null, debugResult: json };
}

// ============================================================
// Public process API
// ============================================================

/**
 * processScanJob — claim และประมวลผลงานเดี่ยว
 */
export async function processScanJob(env: Env, jobId: string): Promise<void> {
  // ดูงานก่อนเพื่อตรวจ concurrency ต่อทีม
  const peek = await env.DB.prepare(
    `SELECT team_id, status FROM scan_jobs WHERE id = ? LIMIT 1`,
  )
    .bind(jobId)
    .first<{ team_id: string; status: string }>();
  if (!peek || peek.status !== 'queued') return;

  const proc = await teamProcessingCount(env, peek.team_id);
  if (proc >= PER_TEAM_CONCURRENCY) {
    // ไม่ claim ตอนนี้ ปล่อยให้ cron มาทำต่อ
    return;
  }

  const job = await claimJob(env, jobId);
  if (!job) return; // ถูก worker อื่นแย่งไป

  try {
    if (job.source === 'telegram') {
      const r = await processTelegramScanJob(env, job);
      await markSuccess(env, job.id, { text: r.resultText }, r.pendingTxId);
    } else if (job.source === 'line') {
      const r = await processLineScanJob(env, job);
      await markSuccess(env, job.id, r.debugResult || {}, r.pendingTxId);
    } else {
      // Phase B: ยังรองรับเฉพาะ telegram และ line ผ่าน queue
      throw new Error(`Source ${job.source} not handled by queue`);
    }
  } catch (err: any) {
    console.error('[ScanQueue] job failed:', job.id, err?.message);
    await markFailed(env, job, err?.message || String(err));
  }
}

/**
 * processQueueOnce — batch process (used by cron + waitUntil)
 * @param env
 * @param opts.limit จำนวนงานสูงสุดต่อรอบ (default 5)
 */
export async function processQueueOnce(
  env: Env,
  opts: { limit?: number } = {},
): Promise<{ processed: number }> {
  const now = currentTimestamp();
  const limit = opts.limit ?? 5;

  // Recovery: reset jobs stuck in 'processing' for > 5 minutes back to 'queued'
  const stuckCutoff = now - 5 * 60;
  await env.DB.prepare(
    `UPDATE scan_jobs
     SET status = 'queued', next_attempt_at = ?, updated_at = ?
     WHERE status = 'processing' AND updated_at < ?`,
  )
    .bind(now, now, stuckCutoff)
    .run();

  const rows = await env.DB.prepare(
    `SELECT id FROM scan_jobs
     WHERE status = 'queued' AND next_attempt_at <= ?
     ORDER BY created_at ASC
     LIMIT ?`,
  )
    .bind(now, limit)
    .all<{ id: string }>();

  const jobIds = (rows.results || []).map((r) => r.id);
  await Promise.all(jobIds.map((id) => processScanJob(env, id)));
  return { processed: jobIds.length };
}
