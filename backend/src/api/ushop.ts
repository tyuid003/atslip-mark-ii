import type { Env } from '../types';
import {
  successResponse,
  errorResponse,
  parseRequestBody,
  generateId,
  currentTimestamp,
} from '../utils/helpers';
import { enqueueScanJob, processQueueOnce } from '../services/scan-queue.service';
import { getLineMessageSettingsReadOnly } from '../services/line-message-settings.service';

// ============================================================
// U-SHOP INTEGRATION
// เชื่อมต่อ ATslip กับ univers_shop (ระบบรวมแชท LINE OA)
//   - univers_shop รับ webhook LINE → ส่งสลิปมาที่ /api/ushop/inbound
//   - ATslip ประมวลผล → สั่ง univers_shop ตอบกลับลูกค้าผ่าน reply bridge
//   - แต่ละ tenant มี api_key ของตัวเอง (per-tenant connection)
// ============================================================

export interface UshopConnection {
  id: string;
  tenant_id: string;
  team_id: string;
  enabled: number;
  ushop_base_url: string;
  api_key: string;
  created_at: number;
  updated_at: number;
}

export async function ensureUshopTable(env: Env): Promise<void> {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS ushop_connections (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL UNIQUE,
      team_id TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      ushop_base_url TEXT NOT NULL DEFAULT '',
      api_key TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`
  ).run();
  await env.DB.prepare(
    `CREATE INDEX IF NOT EXISTS idx_ushop_conn_api_key ON ushop_connections(api_key)`
  ).run();
}

function generateApiKey(): string {
  return `ushop_${crypto.randomUUID().replace(/-/g, '')}`;
}

export async function getConnectionByTenantId(
  env: Env,
  tenantId: string
): Promise<UshopConnection | null> {
  await ensureUshopTable(env);
  return await env.DB.prepare(
    `SELECT * FROM ushop_connections WHERE tenant_id = ? LIMIT 1`
  )
    .bind(tenantId)
    .first<UshopConnection>();
}

export async function getConnectionByApiKey(
  env: Env,
  apiKey: string
): Promise<UshopConnection | null> {
  await ensureUshopTable(env);
  return await env.DB.prepare(
    `SELECT * FROM ushop_connections WHERE api_key = ? LIMIT 1`
  )
    .bind(apiKey)
    .first<UshopConnection>();
}

function extractApiKey(request: Request): string | null {
  const headerKey = request.headers.get('X-Ushop-Key');
  if (headerKey && headerKey.trim()) return headerKey.trim();
  const auth = request.headers.get('Authorization');
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  return null;
}

/**
 * postUshopBridgeReply — ส่งคำสั่งตอบกลับไปที่ univers_shop reply bridge
 * (best-effort, ไม่ throw)
 */
async function postUshopBridgeReply(
  baseUrl: string,
  apiKey: string,
  payload: {
    channel_id: string;
    line_user_id: string;
    reply_token: string | null;
    messages: any[];
    log_entries?: any[];
  }
): Promise<void> {
  if (!baseUrl) return;
  const url = `${baseUrl.replace(/\/+$/, '')}/api/ushop-bridge/reply`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Ushop-Key': apiKey },
      body: JSON.stringify(payload),
    });
  } catch {
    // ignore — ปล่อยให้ flow หลักทำงานต่อ
  }
}

// ============================================================
// ADMIN: จัดการ connection (เรียกจาก frontend ในการ์ด tenant)
// ============================================================

// GET /api/tenants/:tenantId/ushop-connection
export async function handleGetUshopConnection(
  env: Env,
  tenantId: string,
  baseUrl: string
): Promise<Response> {
  try {
    const conn = await getConnectionByTenantId(env, tenantId);
    if (!conn) {
      return successResponse({
        tenant_id: tenantId,
        enabled: 0,
        ushop_base_url: '',
        api_key: '',
        configured: false,
        inbound_url: `${baseUrl}/api/ushop/inbound`,
        tenants_url: `${baseUrl}/api/ushop/tenants`,
      });
    }
    return successResponse({
      tenant_id: conn.tenant_id,
      enabled: conn.enabled,
      ushop_base_url: conn.ushop_base_url,
      api_key: conn.api_key,
      configured: true,
      inbound_url: `${baseUrl}/api/ushop/inbound`,
      tenants_url: `${baseUrl}/api/ushop/tenants`,
    });
  } catch (error: any) {
    return errorResponse(error.message, 500);
  }
}

// PUT /api/tenants/:tenantId/ushop-connection
// body: { enabled?: 0|1, ushop_base_url?: string, regenerate_key?: boolean }
export async function handleSaveUshopConnection(
  request: Request,
  env: Env,
  tenantId: string,
  baseUrl: string
): Promise<Response> {
  try {
    const body = await parseRequestBody<any>(request);

    // ต้องมี team_id ของ tenant
    const tenant = await env.DB.prepare(
      `SELECT team_id FROM tenants WHERE id = ? LIMIT 1`
    )
      .bind(tenantId)
      .first<{ team_id: string }>();
    if (!tenant) {
      return errorResponse('Tenant not found', 404);
    }

    const now = currentTimestamp();
    const existing = await getConnectionByTenantId(env, tenantId);

    const enabled =
      body.enabled === undefined
        ? existing?.enabled ?? 1
        : body.enabled
        ? 1
        : 0;
    const ushopBaseUrl =
      body.ushop_base_url !== undefined
        ? String(body.ushop_base_url).trim().replace(/\/+$/, '')
        : existing?.ushop_base_url ?? '';

    if (!existing) {
      const id = generateId();
      const apiKey = generateApiKey();
      await env.DB.prepare(
        `INSERT INTO ushop_connections
         (id, tenant_id, team_id, enabled, ushop_base_url, api_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(id, tenantId, tenant.team_id, enabled, ushopBaseUrl, apiKey, now, now)
        .run();
    } else {
      const apiKey = body.regenerate_key ? generateApiKey() : existing.api_key;
      await env.DB.prepare(
        `UPDATE ushop_connections
         SET enabled = ?, ushop_base_url = ?, api_key = ?, team_id = ?, updated_at = ?
         WHERE tenant_id = ?`
      )
        .bind(enabled, ushopBaseUrl, apiKey, tenant.team_id, now, tenantId)
        .run();
    }

    return await handleGetUshopConnection(env, tenantId, baseUrl);
  } catch (error: any) {
    return errorResponse(error.message, 400);
  }
}

// ============================================================
// U-SHOP → ATslip: รายชื่อ tenant (ให้ univers_shop เลือก map ช่อง)
// GET /api/ushop/tenants   (auth: X-Ushop-Key)
// คืน tenant ทั้งหมดในทีมเดียวกับ connection ของคีย์นี้
// ============================================================

export async function handleUshopListTenants(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const apiKey = extractApiKey(request);
    if (!apiKey) {
      return errorResponse('Missing X-Ushop-Key', 401);
    }
    const conn = await getConnectionByApiKey(env, apiKey);
    if (!conn) {
      return errorResponse('Invalid API key', 401);
    }

    const rows = await env.DB.prepare(
      `SELECT id, name, status FROM tenants WHERE team_id = ? AND status = 'active' ORDER BY name ASC`
    )
      .bind(conn.team_id)
      .all<{ id: string; name: string; status: string }>();

    const tenants = (rows.results || []).map((t) => ({
      id: t.id,
      name: t.name,
      // tenant ที่ผูกกับคีย์นี้โดยตรง (ใช้สำหรับ inbound)
      is_connected: t.id === conn.tenant_id,
    }));

    return successResponse({
      connected_tenant_id: conn.tenant_id,
      tenants,
    });
  } catch (error: any) {
    return errorResponse(error.message, 500);
  }
}

// ============================================================
// U-SHOP → ATslip: รับสลิปจากลูกค้า
// POST /api/ushop/inbound   (auth: X-Ushop-Key)
// body: {
//   channel_id, line_user_id, message_id?, reply_token?,
//   image_base64, image_mime?
// }
// ============================================================

export async function handleUshopInbound(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  try {
    const apiKey = extractApiKey(request);
    if (!apiKey) {
      return errorResponse('Missing X-Ushop-Key', 401);
    }
    const conn = await getConnectionByApiKey(env, apiKey);
    if (!conn) {
      return errorResponse('Invalid API key', 401);
    }
    if (Number(conn.enabled) !== 1) {
      return successResponse({ ignored: true, reason: 'Connection disabled' });
    }

    const body = await parseRequestBody<any>(request);
    const channelId = String(body.channel_id || '').trim();
    const lineUserId = String(body.line_user_id || '').trim();
    const messageId = String(body.message_id || '').trim();
    const replyToken = String(body.reply_token || '').trim() || null;
    const imageBase64 = String(body.image_base64 || '').trim();
    const imageMime = String(body.image_mime || 'image/jpeg').trim();
    const requestedTenantId = String(body.tenant_id || '').trim();

    if (!lineUserId) {
      return errorResponse('line_user_id is required', 400);
    }
    if (!imageBase64) {
      return errorResponse('image_base64 is required', 400);
    }

    // เลือก tenant ปลายทาง: ใช้ tenant_id ที่ U-shop ส่งมา (ที่แอดมินเลือกในหน้าตั้งค่า)
    // ถ้าอยู่ในทีมเดียวกับ api_key — เพื่อให้ระบบรู้ว่าไลน์นี้เป็นของ tenant ไหนจริง ๆ
    // ถ้าไม่ได้ส่งมา/ไม่อยู่ในทีม → fallback เป็น tenant ของ api_key
    let effectiveTenantId = conn.tenant_id;
    if (requestedTenantId && requestedTenantId !== conn.tenant_id) {
      const owned = await env.DB.prepare(
        `SELECT id FROM tenants WHERE id = ? AND team_id = ? AND status = 'active' LIMIT 1`
      )
        .bind(requestedTenantId, conn.team_id)
        .first<{ id: string }>();
      if (owned) {
        effectiveTenantId = requestedTenantId;
      }
    }

    const idemKey = `ushop-${effectiveTenantId}-${channelId || 'na'}-${messageId || crypto.randomUUID()}`;

    // ส่งข้อความตอบกลับทันที (processing reply) ตามการตั้งค่าของ tenant
    // ใช้ reply_token (ฟรี) — ถ้าใช้แล้ว ผลลัพธ์สุดท้ายจะส่งแบบ push แทน
    let consumedReplyToken = false;
    try {
      const settings = await getLineMessageSettingsReadOnly(env, effectiveTenantId);
      if (Number(settings.enable_processing_reply) === 1 && settings.processing_reply_text) {
        ctx.waitUntil(
          postUshopBridgeReply(conn.ushop_base_url, conn.api_key, {
            channel_id: channelId,
            line_user_id: lineUserId,
            reply_token: replyToken,
            messages: [{ type: 'text', text: settings.processing_reply_text }],
            log_entries: [{ kind: 'text', text: settings.processing_reply_text }],
          })
        );
        consumedReplyToken = !!replyToken;
      }
    } catch {
      // ถ้าโหลด settings ไม่ได้ ก็ข้ามการตอบกลับทันที
    }

    await enqueueScanJob(env, {
      team_id: conn.team_id,
      tenant_id: effectiveTenantId,
      source: 'ushop',
      idempotency_key: idemKey,
      payload: {
        tenant_id: effectiveTenantId,
        channel_id: channelId,
        line_user_id: lineUserId,
        ushop_message_id: messageId || null,
        // ถ้า processing reply ใช้ token ไปแล้ว → ผลลัพธ์สุดท้ายต้อง push
        reply_token: consumedReplyToken ? null : replyToken,
        image_base64: imageBase64,
        image_mime: imageMime,
        // credential สำหรับ reply กลับ — ต้องใช้ของ api_key ที่ยิง inbound เข้ามา
        // (univers_shop ตรวจ atslipApiKey ของ channel ต้องตรงกับคีย์นี้)
        reply_base_url: conn.ushop_base_url,
        reply_api_key: conn.api_key,
      },
    });

    ctx.waitUntil(processQueueOnce(env, { limit: 20 }));

    return successResponse({ received: true });
  } catch (error: any) {
    return errorResponse(error.message, 400);
  }
}
