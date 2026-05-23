/**
 * Telegram Connections API
 *
 * จัดการการเชื่อมต่อ Telegram Group ของแต่ละทีม (Phase A)
 *
 * Endpoints:
 *  GET    /api/teams/:teamId/telegram-connection         - ดู connection ปัจจุบัน
 *  PUT    /api/teams/:teamId/telegram-connection         - สร้าง/แก้ไข connection (upsert)
 *  DELETE /api/teams/:teamId/telegram-connection         - ลบ connection
 *  POST   /api/teams/:teamId/telegram-connection/enable  - เปิด feature flag (telegram_enabled=1)
 *  POST   /api/teams/:teamId/telegram-connection/disable - ปิด feature flag (telegram_enabled=0)
 *
 * Note (Phase A): endpoint นี้ยังไม่ตั้ง webhook กับ Telegram จริง — เก็บข้อมูลอย่างเดียว
 * Phase B จะเพิ่ม setWebhook() ที่เรียก api.telegram.org/bot{token}/setWebhook
 */
import type { Env, TeamTelegramConnection } from '../types';
import { jsonResponse, errorResponse, generateId, currentTimestamp } from '../utils/helpers';
import {
  encryptBotToken,
  decryptBotToken,
  generateWebhookSecret,
  maskToken,
  getConnectionByTeamId,
} from '../services/telegram.service';

/**
 * GET /api/teams/:teamId/telegram-connection
 */
export async function handleGetTelegramConnection(env: Env, teamId: string): Promise<Response> {
  try {
    const conn = await getConnectionByTeamId(env, teamId);
    if (!conn) {
      return jsonResponse({ success: true, data: null });
    }

    // อย่าส่ง bot_token ดิบกลับ ส่งแค่ masked
    const key = env.TELEGRAM_TOKEN_KEY || '';
    let masked = '***';
    try {
      const plain = decryptBotToken(conn.telegram_bot_token, key);
      masked = maskToken(plain);
    } catch {
      // ignore
    }

    // โหลด feature flag ของทีม
    const team = await env.DB.prepare(
      `SELECT telegram_enabled FROM teams WHERE id = ? LIMIT 1`,
    )
      .bind(teamId)
      .first<{ telegram_enabled: number }>();

    return jsonResponse({
      success: true,
      data: {
        id: conn.id,
        team_id: conn.team_id,
        telegram_group_id: conn.telegram_group_id,
        telegram_group_title: conn.telegram_group_title,
        telegram_bot_id: conn.telegram_bot_id,
        telegram_bot_token_masked: masked,
        webhook_secret_set: !!conn.webhook_secret,
        status: conn.status,
        telegram_enabled: team?.telegram_enabled === 1,
        created_at: conn.created_at,
        updated_at: conn.updated_at,
      },
    });
  } catch (err) {
    console.error('[TelegramConnectionsAPI] get error:', err);
    return errorResponse('Failed to get telegram connection', 500);
  }
}

/**
 * PUT /api/teams/:teamId/telegram-connection  (upsert)
 * Body: { telegram_group_id, telegram_group_title?, telegram_bot_token }
 * (telegram_bot_id is auto-extracted from the token)
 */
export async function handleUpsertTelegramConnection(
  request: Request,
  env: Env,
  teamId: string,
): Promise<Response> {
  try {
    const body = await request.json<any>().catch(() => null);
    if (!body) return errorResponse('Invalid JSON body', 400);

    const groupId = String(body.telegram_group_id || '').trim();
    const groupTitle = body.telegram_group_title ? String(body.telegram_group_title).trim() : null;
    const botToken = String(body.telegram_bot_token || '').trim();

    if (!groupId || !botToken) {
      return errorResponse('telegram_group_id and telegram_bot_token are required', 400);
    }

    // ตรวจรูปแบบ: bot token ปกติคือ "<botid>:<base64ish>"
    if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(botToken)) {
      return errorResponse('Invalid telegram_bot_token format (ตัวอย่าง: 123456789:AAH...)', 400);
    }

    // auto-extract bot_id จาก token (เลขก่อน :)
    const botId = botToken.split(':')[0];

    // ตรวจว่า group_id นี้ถูกผูกกับทีมอื่นไหม (one group -> one team)
    const conflict = await env.DB.prepare(
      `SELECT team_id FROM team_telegram_connections WHERE telegram_group_id = ? AND team_id != ? LIMIT 1`,
    )
      .bind(groupId, teamId)
      .first<{ team_id: string }>();
    if (conflict) {
      return errorResponse('Telegram group นี้ผูกกับทีมอื่นอยู่แล้ว', 409);
    }

    // ตรวจว่าทีมมีอยู่จริง
    const team = await env.DB.prepare(`SELECT id FROM teams WHERE id = ? LIMIT 1`)
      .bind(teamId)
      .first();
    if (!team) return errorResponse('Team not found', 404);

    const key = env.TELEGRAM_TOKEN_KEY || '';
    if (!key) {
      // dev mode: เก็บ plain แต่จะ warn
      console.warn('[TelegramConnectionsAPI] TELEGRAM_TOKEN_KEY not set — storing token plain (dev only)');
    }
    const encryptedToken = key ? encryptBotToken(botToken, key) : botToken;

    const existing = await getConnectionByTeamId(env, teamId);
    const now = currentTimestamp();

    if (existing) {
      // update — preserve webhook_secret เดิม (rotate ได้ผ่าน endpoint แยก ถ้าต้อง)
      await env.DB.prepare(
        `UPDATE team_telegram_connections
         SET telegram_group_id = ?, telegram_group_title = ?,
             telegram_bot_id = ?, telegram_bot_token = ?,
             status = 'active', updated_at = ?
         WHERE team_id = ?`,
      )
        .bind(groupId, groupTitle, botId, encryptedToken, now, teamId)
        .run();
      return jsonResponse({ success: true, data: { id: existing.id, updated: true } });
    } else {
      const id = generateId();
      const webhookSecret = generateWebhookSecret();
      await env.DB.prepare(
        `INSERT INTO team_telegram_connections
         (id, team_id, telegram_group_id, telegram_group_title,
          telegram_bot_id, telegram_bot_token, webhook_secret,
          status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      )
        .bind(id, teamId, groupId, groupTitle, botId, encryptedToken, webhookSecret, now, now)
        .run();
      return jsonResponse({ success: true, data: { id, created: true } });
    }
  } catch (err: any) {
    console.error('[TelegramConnectionsAPI] upsert error:', err);
    return errorResponse(err?.message || 'Failed to save telegram connection', 500);
  }
}

/**
 * DELETE /api/teams/:teamId/telegram-connection
 */
export async function handleDeleteTelegramConnection(env: Env, teamId: string): Promise<Response> {
  try {
    await env.DB.prepare(`DELETE FROM team_telegram_connections WHERE team_id = ?`)
      .bind(teamId)
      .run();
    // ปิด feature flag ด้วย
    await env.DB.prepare(`UPDATE teams SET telegram_enabled = 0, updated_at = ? WHERE id = ?`)
      .bind(currentTimestamp(), teamId)
      .run();
    return jsonResponse({ success: true, data: { deleted: true } });
  } catch (err) {
    console.error('[TelegramConnectionsAPI] delete error:', err);
    return errorResponse('Failed to delete telegram connection', 500);
  }
}

/**
 * POST /api/teams/:teamId/telegram-connection/enable
 */
export async function handleEnableTelegram(env: Env, teamId: string): Promise<Response> {
  try {
    const conn = await getConnectionByTeamId(env, teamId);
    if (!conn) {
      return errorResponse('ต้องตั้งค่า Telegram connection ก่อนถึงจะเปิดใช้งานได้', 400);
    }
    await env.DB.prepare(`UPDATE teams SET telegram_enabled = 1, updated_at = ? WHERE id = ?`)
      .bind(currentTimestamp(), teamId)
      .run();
    return jsonResponse({ success: true, data: { enabled: true } });
  } catch (err) {
    console.error('[TelegramConnectionsAPI] enable error:', err);
    return errorResponse('Failed to enable telegram', 500);
  }
}

/**
 * POST /api/teams/:teamId/telegram-connection/disable
 */
export async function handleDisableTelegram(env: Env, teamId: string): Promise<Response> {
  try {
    await env.DB.prepare(`UPDATE teams SET telegram_enabled = 0, updated_at = ? WHERE id = ?`)
      .bind(currentTimestamp(), teamId)
      .run();
    return jsonResponse({ success: true, data: { enabled: false } });
  } catch (err) {
    console.error('[TelegramConnectionsAPI] disable error:', err);
    return errorResponse('Failed to disable telegram', 500);
  }
}

const BOT_COMMANDS = [
  { command: 'menu',         description: 'แสดงเมนูทั้งหมด' },
  { command: 'start',        description: 'เริ่มต้นใช้งาน' },
  { command: 'status',       description: 'ตรวจสอบสถานะ bot' },
  { command: 'list_all',     description: 'รายการสลิปล่าสุด (พร้อม pagination)' },
  { command: 'list_pending', description: 'รายการรอจับคู่ล่าสุด' },
];

/**
 * POST /api/teams/:teamId/telegram-connection/sync-commands
 * ลงทะเบียนคำสั่ง bot กับ Telegram ด้วย setMyCommands
 * (แก้ปัญหา /list_all โดยไม่มี @botname ไม่ทำงานในกลุ่ม)
 */
export async function handleSyncCommands(env: Env, teamId: string): Promise<Response> {
  try {
    const conn = await getConnectionByTeamId(env, teamId);
    if (!conn) return errorResponse('ต้องบันทึก Telegram connection ก่อน', 400);

    const key = env.TELEGRAM_TOKEN_KEY || '';
    let plainToken: string;
    try {
      plainToken = key ? decryptBotToken(conn.telegram_bot_token, key) : conn.telegram_bot_token;
    } catch {
      return errorResponse('ถอดรหัส bot token ไม่สำเร็จ — กรุณาบันทึก token ใหม่', 500);
    }

    const tgResp = await fetch(
      `https://api.telegram.org/bot${plainToken}/setMyCommands`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commands: BOT_COMMANDS }),
      },
    );
    const tgData = await tgResp.json<any>().catch(() => ({ ok: false }));
    if (!tgData.ok) {
      return errorResponse(`Telegram ตอบกลับ: ${tgData.description || JSON.stringify(tgData)}`, 502);
    }

    return jsonResponse({ success: true, data: { synced: true, commands: BOT_COMMANDS.map(c => c.command) } });
  } catch (err: any) {
    console.error('[TelegramConnectionsAPI] sync-commands error:', err);
    return errorResponse(err?.message || 'Failed to sync commands', 500);
  }
}

/**
 * POST /api/teams/:teamId/telegram-connection/register-webhook
 * เรียก Telegram setWebhook API ให้อัตโนมัติ แล้วเปิด feature flag ทันที
 */
export async function handleRegisterWebhook(
  request: Request,
  env: Env,
  teamId: string,
): Promise<Response> {
  try {
    const conn = await getConnectionByTeamId(env, teamId);
    if (!conn) return errorResponse('ต้องบันทึก Telegram connection ก่อน', 400);

    const key = env.TELEGRAM_TOKEN_KEY || '';
    let plainToken: string;
    try {
      plainToken = key ? decryptBotToken(conn.telegram_bot_token, key) : conn.telegram_bot_token;
    } catch {
      return errorResponse('ถอดรหัส bot token ไม่สำเร็จ — กรุณาบันทึก token ใหม่', 500);
    }

    // สร้าง webhook URL จาก origin ของ request (dynamic ทำงานได้ทุก env)
    const origin = new URL(request.url).origin;
    const webhookUrl = `${origin}/api/telegram-webhook/${conn.telegram_group_id}`;
    console.log('[RegisterWebhook] Setting webhook:', webhookUrl.replace(plainToken, '***'));

    const tgResp = await fetch(
      `https://api.telegram.org/bot${plainToken}/setWebhook`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: webhookUrl,
          secret_token: conn.webhook_secret,
          allowed_updates: ['message', 'callback_query'],
          drop_pending_updates: true,
        }),
      },
    );

    const tgData = await tgResp.json<any>().catch(() => ({ ok: false }));
    if (!tgData.ok) {
      console.error('[RegisterWebhook] Telegram error:', tgData);
      return errorResponse(
        `Telegram ตอบกลับ: ${tgData.description || JSON.stringify(tgData)}`,
        502,
      );
    }

    // ลงทะเบียนคำสั่งบอทกับ Telegram (best-effort — ทำให้ /cmd ทำงานได้แม้ไม่มี @botname ต่อท้าย)
    try {
      await fetch(
        `https://api.telegram.org/bot${plainToken}/setMyCommands`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ commands: BOT_COMMANDS }),
        },
      );
    } catch (cmdErr) {
      console.warn('[RegisterWebhook] setMyCommands failed (non-fatal):', cmdErr);
    }

    // เปิด feature flag อัตโนมัติเมื่อลงทะเบียน webhook สำเร็จ
    await env.DB.prepare(`UPDATE teams SET telegram_enabled = 1, updated_at = ? WHERE id = ?`)
      .bind(currentTimestamp(), teamId)
      .run();

    return jsonResponse({
      success: true,
      data: { webhook_url: webhookUrl, telegram_response: tgData.description || 'Webhook was set' },
    });
  } catch (err: any) {
    console.error('[TelegramConnectionsAPI] register-webhook error:', err);
    return errorResponse(err?.message || 'Failed to register webhook', 500);
  }
}
