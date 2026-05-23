/**
 * Telegram Webhook (Phase B)
 *
 * Endpoint:  POST /api/telegram-webhook/:groupId
 *
 * รองรับ:
 *   1) photo message  → enqueue scan_job (+ ส่งสถานะ "กำลังประมวลผล")
 *   2) callback_query → withdraw (ดึงเครดิตกลับ)
 *   3) reply ใต้ข้อความผลลัพธ์ → manual match (Phase B v1: stub แสดงคำแนะนำ)
 *   4) /menu, /start, /status → command router (Phase B v1: minimal)
 *
 * Webhook handler ต้องสั้นและ return เร็ว — ทุกงานหนัก enqueue + ctx.waitUntil
 */
import type { Env, TeamTelegramConnection } from '../types';
import { errorResponse, jsonResponse } from '../utils/helpers';
import {
  getConnectionByGroupId,
  verifyWebhookSecret,
  isTelegramEnabledForTeam,
  sendMessage,
  sendPhoto,
  editMessageText,
  answerCallbackQuery,
  sendChatAction,
} from '../services/telegram.service';
import { enqueueScanJob, processScanJob } from '../services/scan-queue.service';
import { handleWithdrawPendingCredit, handleCreditPendingTransaction } from './pending-credit';

function _formatDate(iso?: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('th-TH', {
      timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short',
    });
  } catch { return iso; }
}

export async function handleTelegramWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  groupId: string,
): Promise<Response> {
  try {
    if (request.method !== 'POST') return errorResponse('Method not allowed', 405);

    const conn = await getConnectionByGroupId(env, groupId);
    if (!conn) return errorResponse('Group not bound to any team', 404);

    if (!verifyWebhookSecret(request, conn.webhook_secret)) {
      return errorResponse('Forbidden', 403);
    }

    const enabled = await isTelegramEnabledForTeam(env, conn.team_id);
    if (!enabled) {
      return jsonResponse({ success: true, data: { skipped: 'telegram_disabled' } });
    }

    let update: any = null;
    try {
      update = await request.json<any>();
    } catch {
      return errorResponse('Invalid JSON', 400);
    }

    // 1) Photo message
    if (update.message?.photo && Array.isArray(update.message.photo) && update.message.photo.length > 0) {
      ctx.waitUntil(handleIncomingPhoto(env, conn, update.message));
      return jsonResponse({ success: true, data: { handled: 'photo' } });
    }

    // 2) Callback query (button)
    if (update.callback_query) {
      ctx.waitUntil(handleCallbackQuery(env, conn, update.callback_query));
      return jsonResponse({ success: true, data: { handled: 'callback' } });
    }

    // 3) Reply to message — ตรวจ CAPTCHA ก่อน จากนั้น manual match
    if (update.message?.reply_to_message && update.message.text) {
      ctx.waitUntil(handleReply(env, conn, update.message));
      return jsonResponse({ success: true, data: { handled: 'reply' } });
    }

    // 4) Commands
    if (update.message?.text && typeof update.message.text === 'string') {
      // ตัด @botname ออกจากคำสั่งอัตโนมัติ เช่น /status@maewpaobot → /status
      const rawCmd = update.message.text.trim().split(' ')[0];
      const cmd = rawCmd.includes('@') ? rawCmd.split('@')[0] : rawCmd;

      if (cmd === '/start' || cmd === '/menu' || cmd === '/help') {
        ctx.waitUntil(handleMenuCommand(env, conn, update.message));
        return jsonResponse({ success: true, data: { handled: 'menu' } });
      }
      if (cmd === '/status') {
        ctx.waitUntil(handleStatusCommand(env, conn, update.message));
        return jsonResponse({ success: true, data: { handled: 'status' } });
      }
      if (cmd === '/list_all') {
        ctx.waitUntil(handleListCommand(env, conn, update.message, 'all', 0));
        return jsonResponse({ success: true, data: { handled: 'list_all' } });
      }
      if (cmd === '/list_pending') {
        ctx.waitUntil(handleListCommand(env, conn, update.message, 'pending', 0));
        return jsonResponse({ success: true, data: { handled: 'list_pending' } });
      }
      // /connect_<slug> — เช่น /connect_betax2 หรือ /connect_betax2@botname
      if (cmd.startsWith('/connect_')) {
        const slug = cmd.slice('/connect_'.length).toLowerCase().trim();
        if (slug) {
          ctx.waitUntil(handleConnectCommand(env, conn, update.message, slug));
          return jsonResponse({ success: true, data: { handled: 'connect' } });
        }
      }
    }

    return jsonResponse({ success: true, data: { handled: 'ignored' } });
  } catch (err: any) {
    console.error('[TelegramWebhook] error:', err);
    return errorResponse('Webhook handler error', 500);
  }
}

// ============================================================
// Handlers (waitUntil — runs after response sent)
// ============================================================

async function handleIncomingPhoto(env: Env, conn: TeamTelegramConnection, message: any): Promise<void> {
  try {
    const photos = message.photo as Array<{ file_id: string; file_size?: number }>;
    const largest = photos[photos.length - 1];
    if (!largest?.file_id) return;

    const groupId = String(message.chat.id);
    const userId = String(message.from?.id || 'unknown');
    const msgId = String(message.message_id);

    const sent = await sendMessage(env, conn, groupId, '⌛ รับคำขอแล้ว กำลังประมวลผล...', {
      reply_to_message_id: Number(msgId),
    });

    const idempotency = `tg:photo:${groupId}:${msgId}`;
    const { id: jobId, created } = await enqueueScanJob(env, {
      team_id: conn.team_id,
      source: 'telegram',
      idempotency_key: idempotency,
      payload: {
        telegram_group_id: groupId,
        telegram_user_id: userId,
        telegram_message_id: msgId,
        file_id: largest.file_id,
        status_message_id: sent.ok ? sent.message_id : null,
      },
    });

    if (!created) {
      if (sent.ok && sent.message_id) {
        await editMessageText(env, conn, groupId, sent.message_id, '⌛ งานนี้กำลังประมวลผลอยู่แล้ว');
      }
      return;
    }

    await processScanJob(env, jobId);
  } catch (err: any) {
    console.error('[TelegramWebhook] handleIncomingPhoto error:', err?.message);
    try {
      await sendMessage(env, conn, String(message.chat.id),
        `❌ เกิดข้อผิดพลาด: ${String(err?.message || err).slice(0, 200)}`);
    } catch {}
  }
}

async function handleCallbackQuery(env: Env, conn: TeamTelegramConnection, cq: any): Promise<void> {
  try {
    const data = String(cq.data || '');
    const groupId = String(cq.message?.chat?.id || '');
    const msgId = cq.message?.message_id;

    // ── ระบุยูส: แสดงรายชื่อเว็บ (su:<txId>) ─────────────────────────────
    if (data.startsWith('su:')) {
      const txId = data.slice(3);
      if (!txId) { await answerCallbackQuery(env, conn, cq.id, 'ข้อมูลไม่ถูกต้อง', true); return; }

      const tx = await env.DB.prepare(
        `SELECT id, status, team_id FROM pending_transactions WHERE id = ? LIMIT 1`,
      ).bind(txId).first<{ id: string; status: string; team_id: string }>();
      if (!tx || tx.team_id !== conn.team_id) {
        await answerCallbackQuery(env, conn, cq.id, 'ไม่พบรายการ', true); return;
      }
      if (tx.status !== 'pending' && tx.status !== 'matched') {
        await answerCallbackQuery(env, conn, cq.id, `สถานะ ${tx.status} ไม่รองรับ`, true); return;
      }

      // ดึง tenants ทั้งหมดในทีม
      const tenants = await env.DB.prepare(
        `SELECT id, name FROM tenants WHERE team_id = ? AND status = 'active' ORDER BY name`,
      ).bind(conn.team_id).all<{ id: string; name: string }>();
      const list = tenants.results || [];

      if (list.length === 0) {
        await answerCallbackQuery(env, conn, cq.id, 'ไม่มีเว็บในทีม', true); return;
      }

      // สร้าง short token เพื่อผูก txId ไว้ใน KV (หลีกเลี่ยง callback_data เกิน 64 bytes)
      const token = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
      await env.BANK_KV.put(
        `tg:sel:${groupId}:${token}`,
        JSON.stringify({ txId }),
        { expirationTtl: 300 },
      );

      await answerCallbackQuery(env, conn, cq.id, '');
      await sendChatAction(env, conn, groupId, 'typing');

      if (list.length === 1) {
        // เพียงเว็บเดียว → ข้ามการเลือก ส่ง prompt เลย
        await handleSendRematchPrompt(env, conn, groupId, token, list[0]);
      } else {
        // หลายเว็บ → แสดงปุ่มเลือกเว็บ
        const keyboard = list.map(t => [{ text: t.name, callback_data: `w:${token}:${t.id}` }]);
        await sendMessage(env, conn, groupId, '🌐 เลือกเว็บที่ต้องการค้นหาลูกค้า:', {
          reply_markup: { inline_keyboard: keyboard },
        });
      }
      return;
    }

    // ── เลือกเว็บสำหรับจับคู่ (w:<token>:<tenantId>) ─────────────────────
    if (data.startsWith('w:')) {
      const rest = data.slice(2); // "token:tenantId"
      const colonIdx = rest.indexOf(':');
      if (colonIdx < 1) { await answerCallbackQuery(env, conn, cq.id, 'ข้อมูลไม่ถูกต้อง', true); return; }
      const token = rest.slice(0, colonIdx);
      const tenantId = rest.slice(colonIdx + 1);

      const tenant = await env.DB.prepare(
        `SELECT id, name FROM tenants WHERE id = ? LIMIT 1`,
      ).bind(tenantId).first<{ id: string; name: string }>();
      if (!tenant) { await answerCallbackQuery(env, conn, cq.id, 'ไม่พบเว็บ', true); return; }

      await answerCallbackQuery(env, conn, cq.id, '');
      await handleSendRematchPrompt(env, conn, groupId, token, tenant);
      return;
    }

    // ── เติมเครดิต (cr:<txId>) ──────────────────────────────────────────
    if (data.startsWith('cr:')) {
      const txId = data.slice(3);
      if (!txId) {
        await answerCallbackQuery(env, conn, cq.id, 'รหัสรายการไม่ถูกต้อง', true);
        return;
      }
      const tx = await env.DB.prepare(
        `SELECT pt.id, pt.status, pt.team_id, pt.tenant_id, pt.amount,
                pt.matched_user_id, pt.matched_username,
                pt.slip_ref, pt.slip_data,
                t.name AS tenant_name
         FROM pending_transactions pt
         LEFT JOIN tenants t ON t.id = pt.tenant_id
         WHERE pt.id = ? LIMIT 1`,
      ).bind(txId).first<{
        id: string; status: string; team_id: string; tenant_id: string; amount: number;
        matched_user_id: string | null; matched_username: string | null;
        slip_ref: string | null; slip_data: string | null; tenant_name: string | null;
      }>();
      if (!tx) {
        await answerCallbackQuery(env, conn, cq.id, 'ไม่พบรายการ', true);
        return;
      }
      if (tx.team_id !== conn.team_id) {
        await answerCallbackQuery(env, conn, cq.id, 'ไม่มีสิทธิ์เติมเครดิตของทีมอื่น', true);
        return;
      }
      if (tx.status === 'credited') {
        await answerCallbackQuery(env, conn, cq.id, 'เติมเครดิตไปแล้ว', true);
        return;
      }
      if (tx.status !== 'matched' && tx.status !== 'pending') {
        await answerCallbackQuery(env, conn, cq.id, `สถานะปัจจุบัน: ${tx.status}`, true);
        return;
      }
      // เรียก credit endpoint
      await sendChatAction(env, conn, groupId, 'typing');
      const syntheticReq = new Request(`https://internal/api/pending-transactions/${txId}/credit`, {
        method: 'POST',
      });
      const resp = await handleCreditPendingTransaction(env, txId, syntheticReq);
      const result = await resp.json<any>().catch(() => ({ success: false }));
      if (result?.success) {
        await answerCallbackQuery(env, conn, cq.id, 'สำเร็จ');
        if (groupId && msgId) {
          // ดึง matched_user_id ที่อาจถูก resolve ใหม่หลัง credit
          const resolvedUserId = result?.data?.matched_user_id || tx.matched_user_id;
          const resolvedUsername = result?.data?.matched_username || tx.matched_username;
          const slip = tx.slip_data ? JSON.parse(tx.slip_data).catch?.(() => null) ?? (() => { try { return JSON.parse(tx.slip_data!); } catch { return null; } })() : null;
          const amount = slip?.amount?.amount ?? Number(tx.amount || 0);
          const slipRef = slip?.transRef || tx.slip_ref || '-';
          const slipDate = slip?.date ? _formatDate(slip.date) : '-';
          const tenantLine = tx.tenant_name ? `\n🌐 ${tx.tenant_name}` : '';

          await editMessageText(env, conn, groupId, msgId,
            `✅ เครดิตสำเร็จ\n` +
            `ยูส: ${resolvedUserId || '-'}\n` +
            `ชื่อ: ${resolvedUsername || '-'}\n` +
            `ยอด: ${Number(amount).toLocaleString()} บาท\n` +
            `วันที่: ${slipDate}\n` +
            `อ้างอิง: ${slipRef}` +
            tenantLine,
            {
              reply_markup: {
                inline_keyboard: [[
                  { text: '↩️ ดึงเครดิตกลับ', callback_data: `wd:${txId}` },
                ]],
              },
            },
          );
        }
      } else {
        await answerCallbackQuery(env, conn, cq.id,
          `เติมไม่สำเร็จ: ${result?.error || 'unknown'}`, true);
      }
      return;
    }

    // ── ดึงเครดิตกลับ (wd:<txId>) ────────────────────────────────────────
    if (data.startsWith('wd:')) {
      const txId = data.slice(3);
      if (!txId) {
        await answerCallbackQuery(env, conn, cq.id, 'รหัสรายการไม่ถูกต้อง', true);
        return;
      }

      const tx = await env.DB.prepare(
        `SELECT id, status, team_id FROM pending_transactions WHERE id = ? LIMIT 1`,
      )
        .bind(txId)
        .first<{ id: string; status: string; team_id: string }>();

      if (!tx) {
        await answerCallbackQuery(env, conn, cq.id, 'ไม่พบรายการ', true);
        return;
      }
      if (tx.team_id !== conn.team_id) {
        await answerCallbackQuery(env, conn, cq.id, 'ไม่มีสิทธิ์ดึงเครดิตของทีมอื่น', true);
        return;
      }
      if (tx.status !== 'credited') {
        await answerCallbackQuery(env, conn, cq.id,
          `สถานะปัจจุบัน: ${tx.status} — ไม่สามารถดึงคืนได้`, true);
        return;
      }

      const syntheticReq = new Request(`https://internal/api/pending-transactions/${txId}/withdraw`, {
        method: 'POST',
      });
      await sendChatAction(env, conn, groupId, 'typing');
      const resp = await handleWithdrawPendingCredit(env, txId, syntheticReq);
      const result = await resp.json<any>().catch(() => ({ success: false }));

      if (result?.success) {
        await answerCallbackQuery(env, conn, cq.id, 'ดึงเครดิตกลับสำเร็จ');
        if (groupId && msgId) {
          await editMessageText(env, conn, groupId, msgId,
            `↩️ ดึงเครดิตคืนแล้ว\nรหัส: ${txId}`, {
              reply_markup: {
                inline_keyboard: [[
                  { text: '💰 เติมเครดิต', callback_data: `cr:${txId}` },
                ]],
              },
            });
        }
      } else {
        await answerCallbackQuery(env, conn, cq.id,
          `ดึงคืนไม่สำเร็จ: ${result?.error || 'unknown'}`, true);
      }
      return;
    }

    // ── /list_all, /list_pending: pagination ─────────────────────────────
    // lap:<page> หรือ lpp:<page>
    if (data.startsWith('lap:') || data.startsWith('lpp:')) {
      const type: 'all' | 'pending' = data.startsWith('lap:') ? 'all' : 'pending';
      const page = parseInt(data.slice(4), 10);
      if (!Number.isFinite(page) || page < 0) {
        await answerCallbackQuery(env, conn, cq.id, 'หน้าไม่ถูกต้อง', true); return;
      }
      await answerCallbackQuery(env, conn, cq.id, '');
      await sendChatAction(env, conn, groupId, 'typing');
      await renderListMessage(env, conn, groupId, type, page, msgId);
      return;
    }

    // ── /list_all, /list_pending: action buttons ────────────────────────
    // law=list_all withdraw, lad=list_all delete, lps=list_pending select_user, lpd=list_pending delete
    if (data === 'law' || data === 'lad' || data === 'lps' || data === 'lpd') {
      const listKey = `tg:list:${groupId}:${msgId}`;
      const listRaw = await env.BANK_KV.get(listKey);
      if (!listRaw) {
        await answerCallbackQuery(env, conn, cq.id, 'รายการนี้หมดอายุแล้ว ใช้คำสั่งใหม่', true);
        return;
      }
      const listState = JSON.parse(listRaw) as { type: 'all' | 'pending'; teamId: string; page: number; txIds: string[] };
      if (listState.teamId !== conn.team_id || listState.txIds.length === 0) {
        await answerCallbackQuery(env, conn, cq.id, 'ไม่มีรายการ', true); return;
      }

      const action: 'withdraw' | 'delete' | 'select_user' =
        data === 'law' ? 'withdraw' :
        data === 'lps' ? 'select_user' : 'delete';
      const actionLabel =
        action === 'withdraw' ? 'ดึงเครดิตกลับ' :
        action === 'select_user' ? 'ระบุยูส' : 'ลบรายการ';

      await answerCallbackQuery(env, conn, cq.id, '');
      const sent = await sendMessage(env, conn, groupId,
        `📝 ตอบกลับข้อความนี้ด้วยตัวเลข 1-${listState.txIds.length} เพื่อ${actionLabel}`,
        { reply_to_message_id: Number(msgId) });
      if (sent.ok && sent.message_id) {
        await env.BANK_KV.put(
          `tg:listact:${groupId}:${sent.message_id}`,
          JSON.stringify({ action, txIds: listState.txIds, type: listState.type }),
          { expirationTtl: 300 },
        );
      }
      return;
    }

    await answerCallbackQuery(env, conn, cq.id, 'ไม่รู้จักคำสั่ง', false);
  } catch (err: any) {
    console.error('[TelegramWebhook] handleCallbackQuery error:', err?.message);
    try { await answerCallbackQuery(env, conn, cq.id, 'เกิดข้อผิดพลาด', true); } catch {}
  }
}

// ── ส่ง prompt ให้ user reply ข้อมูลลูกค้า ───────────────────────────────
async function handleSendRematchPrompt(
  env: Env,
  conn: TeamTelegramConnection,
  groupId: string,
  token: string,
  tenant: { id: string; name: string },
): Promise<void> {
  // ดึง txId จาก KV ที่เก็บไว้ตอนกด su:
  const selRaw = await env.BANK_KV.get(`tg:sel:${groupId}:${token}`);
  if (!selRaw) {
    await sendMessage(env, conn, groupId, '⏰ หมดเวลาแล้ว กรุณากดปุ่ม 👤 ระบุยูส ใหม่');
    return;
  }
  const { txId } = JSON.parse(selRaw) as { txId: string };

  // ส่ง prompt message
  const sent = await sendMessage(env, conn, groupId,
    `🔍 ค้นหาลูกค้าใน "${tenant.name}"\n💬 Reply ข้อความนี้ด้วย username หรือข้อมูลลูกค้า`,
  );

  if (sent.ok && sent.message_id) {
    // ผูก message_id → txId + tenantId เพื่อใช้ใน handleReply
    await env.BANK_KV.put(
      `tg:rematch:${groupId}:${sent.message_id}`,
      JSON.stringify({ txId, tenantId: tenant.id }),
      { expirationTtl: 300 },
    );
  }
}

async function handleReplyManualMatch(env: Env, conn: TeamTelegramConnection, message: any): Promise<void> {
  try {
    const groupId = String(message.chat.id);
    const repliedMsgId = String(message.reply_to_message.message_id);
    const text = String(message.text || '').trim();

    if (!text) return;

    // หา transaction ที่ผูกกับ message นี้
    const link = await env.DB.prepare(
      `SELECT pending_transaction_id FROM telegram_message_links
       WHERE telegram_group_id = ? AND telegram_message_id = ? LIMIT 1`,
    )
      .bind(groupId, repliedMsgId)
      .first<{ pending_transaction_id: string }>();

    if (!link) return;

    const tx = await env.DB.prepare(
      `SELECT id, status, team_id, tenant_id, amount FROM pending_transactions WHERE id = ? LIMIT 1`,
    )
      .bind(link.pending_transaction_id)
      .first<{ id: string; status: string; team_id: string; tenant_id: string; amount: number }>();

    if (!tx) return;
    if (tx.team_id !== conn.team_id) return;

    // รองรับ pending, matched (รวมถึงหลัง withdraw ที่กลับมาเป็น matched/pending)
    if (tx.status === 'credited') {
      await sendMessage(env, conn, groupId,
        '✅ รายการนี้เครดิตเรียบร้อยแล้ว',
        { reply_to_message_id: Number(message.message_id) });
      return;
    }
    if (tx.status === 'duplicate') {
      await sendMessage(env, conn, groupId,
        'ℹ️ รายการนี้เป็น duplicate',
        { reply_to_message_id: Number(message.message_id) });
      return;
    }
    if (tx.status !== 'pending' && tx.status !== 'matched') {
      await sendMessage(env, conn, groupId,
        `ℹ️ ไม่สามารถจับคู่ใหม่ได้ (สถานะ: ${tx.status})`,
        { reply_to_message_id: Number(message.message_id) });
      return;
    }

    // ดึง tenant + session
    const now = Math.floor(Date.now() / 1000);
    const tenant = await env.DB.prepare(
      `SELECT id, name, admin_api_url FROM tenants WHERE id = ? LIMIT 1`,
    ).bind(tx.tenant_id).first<{ id: string; name: string; admin_api_url: string }>();
    if (!tenant) {
      await sendMessage(env, conn, groupId, '❌ ไม่พบข้อมูลเว็บ',
        { reply_to_message_id: Number(message.message_id) });
      return;
    }

    const session = await env.DB.prepare(
      `SELECT session_token FROM admin_sessions WHERE tenant_id = ? AND expires_at > ? LIMIT 1`,
    ).bind(tenant.id, now).first<{ session_token: string }>();
    if (!session) {
      await sendMessage(env, conn, groupId,
        `❌ เว็บ "${tenant.name}" ยังไม่ได้เชื่อมต่อ\nกรุณาใช้ /status เพื่อดูและ /connect ใหม่`,
        { reply_to_message_id: Number(message.message_id) });
      return;
    }

    const token = session.session_token;
    const apiUrl = tenant.admin_api_url;

    // แสดงสถานะ typing พร้อมกับค้นหา admin backend
    await sendChatAction(env, conn, groupId, 'typing');

    // ค้นหายูสเซอร์ใน admin backend (member + non-member พร้อมกัน)
    const [memberResp, nonMemberResp] = await Promise.all([
      fetch(`${apiUrl}/api/users/list?search=${encodeURIComponent(text)}&userCategory=member&page=1&limit=10`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      }),
      fetch(`${apiUrl}/api/users/list?search=${encodeURIComponent(text)}&userCategory=non-member&page=1&limit=10`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      }),
    ]);

    const users: any[] = [];
    if (memberResp.ok) {
      const d = await memberResp.json() as { list?: any[] };
      users.push(...(d.list || []).map((u: any) => ({ ...u, category: 'member' })));
    }
    if (nonMemberResp.ok) {
      const d = await nonMemberResp.json() as { list?: any[] };
      users.push(...(d.list || []).map((u: any) => ({ ...u, category: 'non-member' })));
    }

    if (users.length === 0) {
      await sendMessage(env, conn, groupId,
        `❌ ไม่พบยูสเซอร์ "${text}" ในระบบ`,
        { reply_to_message_id: Number(message.message_id) });
      return;
    }

    // ถ้าหลายผล → แสดงรายการตัวเลข ให้ผู้ใช้ตอบกลับด้วยเลข
    if (users.length > 1) {
      const listText = users.slice(0, 10).map((u: any, i: number) => {
        const uname = u.memberCode || u.username || null;
        const fname = u.fullname || (u.firstName ? `${u.firstName} ${u.lastName}`.trim() : '-');
        return uname ? `${i + 1}. ${fname} — ยูส: ${uname}` : `${i + 1}. ${fname} — ยังไม่มียูสเซอร์`;
      }).join('\n');
      const sent = await sendMessage(env, conn, groupId,
        `🔍 พบ ${users.length} ผลลัพธ์ สำหรับ "${text}":\n${listText}\n\nตอบกลับข้อความนี้ด้วยตัวเลข เช่น 1 หรือ 2 เพื่อเลือก`,
        { reply_to_message_id: Number(message.message_id) });
      if (sent.ok && sent.message_id) {
        await env.BANK_KV.put(
          `tg:usel:${groupId}:${sent.message_id}`,
          JSON.stringify({
            txId: tx.id,
            tenantId: tenant.id,
            users: users.slice(0, 10).map((u: any) => ({
              memberCode: u.memberCode || u.username || null,
              adminId: u.id ? String(u.id) : null,
              fullname: u.fullname || (u.firstName ? `${u.firstName} ${u.lastName}`.trim() : null),
            })),
          }),
          { expirationTtl: 300 },
        );
      }
      return;
    }

    // พบ 1 ผล → อัปเดท transaction
    const user = users[0];
    const memberCode = user.memberCode || user.username || String(user.id || '') || null;
    const fullname = user.fullname || (user.firstName ? `${user.firstName} ${user.lastName}`.trim() : text);

    await env.DB.prepare(
      `UPDATE pending_transactions
       SET matched_user_id = ?, matched_username = ?, status = 'matched', updated_at = ?
       WHERE id = ?`,
    ).bind(memberCode, fullname, now, tx.id).run();

    await sendMessage(env, conn, groupId,
      `✅ จับคู่ใหม่สำเร็จ\n` +
      `ยูส: ${memberCode || '-'}\n` +
      `ชื่อ: ${fullname || '-'}\n\n` +
      `กดปุ่มด้านล่างเพื่อเติมเครดิต`,
      {
        reply_to_message_id: Number(message.message_id),
        reply_markup: { inline_keyboard: [[{ text: '💰 เติมเครดิต', callback_data: `cr:${tx.id}` }]] },
      });
  } catch (err: any) {
    console.error('[TelegramWebhook] handleReplyManualMatch error:', err?.message);
  }
}

// รวม reply handler: CAPTCHA verification + manual match
async function handleReply(env: Env, conn: TeamTelegramConnection, message: any): Promise<void> {
  try {
    const groupId = String(message.chat.id);
    const repliedMsgId = String(message.reply_to_message.message_id);
    const replyText = String(message.text || '').trim();

    // ตรวจว่า replied message มี CAPTCHA รอยืนยันหรือไม่
    const captchaKey = `tg:captcha:${groupId}:${repliedMsgId}`;
    const captchaRaw = await env.BANK_KV.get(captchaKey);
    if (captchaRaw) {
      const captcha = JSON.parse(captchaRaw) as {
        slug: string; tenant_id: string; captcha_id: string; expires_at: number;
      };
      if (Date.now() > captcha.expires_at) {
        await env.BANK_KV.delete(captchaKey);
        await sendMessage(env, conn, groupId,
          '⏰ CAPTCHA หมดอายุแล้ว กรุณาส่ง /connect_' + captcha.slug + ' ใหม่อีกครั้ง',
          { reply_to_message_id: Number(message.message_id) });
        return;
      }

      // ดึงข้อมูล tenant เพื่อ login
      const tenant = await env.DB.prepare(
        `SELECT id, name, admin_api_url, admin_username, admin_password FROM tenants WHERE id = ? LIMIT 1`,
      ).bind(captcha.tenant_id).first<{
        id: string; name: string; admin_api_url: string;
        admin_username: string; admin_password: string;
      }>();
      if (!tenant) {
        await sendMessage(env, conn, groupId, '❌ ไม่พบข้อมูลเว็บ กรุณาลองใหม่',
          { reply_to_message_id: Number(message.message_id) });
        await env.BANK_KV.delete(captchaKey);
        return;
      }

      // Login ไปที่ admin backend ด้วย CAPTCHA ที่ผู้ใช้ reply มา
      let loginOk = false;
      let sessionToken = '';
      try {
        const loginResp = await fetch(`${tenant.admin_api_url}/api/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            username: tenant.admin_username,
            password: tenant.admin_password,
            captchaId: captcha.captcha_id,
            captchaValue: replyText,
            agent: 'TelegramBot/ATslip',
            ipAddress: '0.0.0.0',
          }),
        });
        if (loginResp.ok) {
          const loginData = await loginResp.json() as { token?: string; access_token?: string };
          sessionToken = loginData.token || loginData.access_token || '';
          loginOk = !!sessionToken;
        }
      } catch (e: any) {
        console.error('[TelegramWebhook] admin login error:', e?.message);
      }

      await env.BANK_KV.delete(captchaKey);

      if (!loginOk) {
        await sendMessage(env, conn, groupId,
          '❌ CAPTCHA ไม่ถูกต้องหรือ login ไม่สำเร็จ กรุณาส่ง /connect_' + captcha.slug + ' ใหม่อีกครั้ง',
          { reply_to_message_id: Number(message.message_id) });
        return;
      }

      // Login สำเร็จ → บันทึก session + ดึง bank accounts + เปิด auto_deposit
      const now = Math.floor(Date.now() / 1000);
      const sessionId = crypto.randomUUID();
      const expiresAt = now + 24 * 60 * 60;
      await env.DB.prepare('DELETE FROM admin_sessions WHERE tenant_id = ?').bind(tenant.id).run();
      await env.DB.prepare(
        `INSERT INTO admin_sessions (id, tenant_id, session_token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
      ).bind(sessionId, tenant.id, sessionToken, expiresAt, now).run();
      await env.DB.prepare(
        `UPDATE tenants SET auto_deposit_enabled = 1, updated_at = ? WHERE id = ?`,
      ).bind(now, tenant.id).run();

      // ดึง bank accounts แล้วเก็บลง KV → frontend ถึงเห็นสถานะ admin_connected
      try {
        const accResp = await fetch(`${tenant.admin_api_url}/api/accounting/bankaccounts/list?limit=100`, {
          headers: { Authorization: `Bearer ${sessionToken}`, Accept: 'application/json' },
        });
        if (accResp.ok) {
          const accData = await accResp.json() as { list?: any[]; data?: any[]; accounts?: any[] };
          const accounts = accData.list || accData.data || accData.accounts || [];
          const bankKey = `tenant:${tenant.id}:banks`;
          await env.BANK_KV.put(bankKey, JSON.stringify({
            tenant_id: tenant.id, accounts, cached_at: now, expires_at: expiresAt,
          }), { expirationTtl: 24 * 60 * 60 });
        }
      } catch (e: any) {
        console.warn('[TelegramWebhook] fetch bank accounts error:', e?.message);
      }

      await sendMessage(env, conn, groupId,
        `✅ เชื่อมต่อ "${tenant.name}" สำเร็จ\nระบบจะสแกนสลิปและเติมเครดิตอัตโนมัติแล้ว`,
        { reply_to_message_id: Number(message.message_id) });
      return;
    }

    // ไม่ใช่ CAPTCHA → ตรวจ rematch (จากปุ่ม ระบุยูส) ก่อน
    const rematchKey = `tg:rematch:${groupId}:${repliedMsgId}`;
    const rematchRaw = await env.BANK_KV.get(rematchKey);
    if (rematchRaw) {
      await env.BANK_KV.delete(rematchKey);
      const rematch = JSON.parse(rematchRaw) as { txId: string; tenantId: string };
      await handleRematchWithTenant(env, conn, message, rematch.txId, rematch.tenantId);
      return;
    }

    // ตรวจ list action (ดึงเครดิตกลับ / ลบรายการ / ระบุยูส จาก /list_all,/list_pending)
    const listActKey = `tg:listact:${groupId}:${repliedMsgId}`;
    const listActRaw = await env.BANK_KV.get(listActKey);
    if (listActRaw) {
      await env.BANK_KV.delete(listActKey);
      const listAct = JSON.parse(listActRaw) as {
        action: 'withdraw' | 'delete' | 'select_user';
        txIds: string[];
        type: 'all' | 'pending';
      };
      const num = parseInt(replyText, 10);
      if (isNaN(num) || num < 1 || num > listAct.txIds.length) {
        await sendMessage(env, conn, groupId,
          `❌ กรุณาตอบด้วยตัวเลข 1-${listAct.txIds.length}`,
          { reply_to_message_id: Number(message.message_id) });
        return;
      }
      const txId = listAct.txIds[num - 1];
      await handleListActionExecute(env, conn, message, listAct.action, txId);
      return;
    }

    // ตรวจ user selection (จากรายการตัวเลขที่พบหลายผล)
    const uselKey = `tg:usel:${groupId}:${repliedMsgId}`;
    const uselRaw = await env.BANK_KV.get(uselKey);
    if (uselRaw) {
      const num = parseInt(replyText, 10);
      const usel = JSON.parse(uselRaw) as { txId: string; tenantId: string; users: Array<{ memberCode: string | null; adminId?: string | null; fullname: string | null }> };
      if (isNaN(num) || num < 1 || num > usel.users.length) {
        await sendMessage(env, conn, groupId,
          `❌ กรุณาตอบด้วยตัวเลข 1-${usel.users.length}`,
          { reply_to_message_id: Number(message.message_id) });
        return;
      }
      await env.BANK_KV.delete(uselKey);
      await handleUserSelectionConfirm(env, conn, message, usel.txId, usel.tenantId, usel.users[num - 1]);
      return;
    }

    // fallback → direct reply โดยใช้ tenant จาก transaction
    await handleReplyManualMatch(env, conn, message);
  } catch (err: any) {
    console.error('[TelegramWebhook] handleReply error:', err?.message);
  }
}

// ── ยืนยันการเลือกยูสเซอร์จากรายการตัวเลข ──────────────────────────────────
async function handleUserSelectionConfirm(
  env: Env,
  conn: TeamTelegramConnection,
  message: any,
  txId: string,
  tenantId: string,
  user: { memberCode: string | null; adminId?: string | null; fullname: string | null },
): Promise<void> {
  const groupId = String(message.chat.id);
  const now = Math.floor(Date.now() / 1000);

  const tx = await env.DB.prepare(
    `SELECT id, status, team_id FROM pending_transactions WHERE id = ? LIMIT 1`,
  ).bind(txId).first<{ id: string; status: string; team_id: string }>();

  if (!tx || tx.team_id !== conn.team_id) return;

  if (tx.status !== 'pending' && tx.status !== 'matched') {
    await sendMessage(env, conn, groupId,
      `ℹ️ รายการนี้ ${tx.status} แล้ว ไม่สามารถจับคู่ได้`,
      { reply_to_message_id: Number(message.message_id) });
    return;
  }

  const memberCode = user.memberCode || user.adminId || null;
  const fullname = user.fullname || '-';

  await env.DB.prepare(
    `UPDATE pending_transactions
     SET matched_user_id = ?, matched_username = ?, tenant_id = ?, status = 'matched', updated_at = ?
     WHERE id = ?`,
  ).bind(memberCode, fullname, tenantId, now, txId).run();

  await sendMessage(env, conn, groupId,
    `✅ เลือก ${fullname}${memberCode ? ` (ยูส: ${memberCode})` : ''} เรียบร้อยแล้ว\n\n` +
    `กดปุ่มด้านล่างเพื่อเติมเครดิต`,
    {
      reply_to_message_id: Number(message.message_id),
      reply_markup: { inline_keyboard: [[{ text: '💰 เติมเครดิต', callback_data: `cr:${txId}` }]] },
    });
}

// ── จับคู่ด้วยเว็บที่ผู้ใช้เลือก (จากปุ่ม ระบุยูส) ─────────────────────────
async function handleRematchWithTenant(
  env: Env,
  conn: TeamTelegramConnection,
  message: any,
  txId: string,
  tenantId: string,
): Promise<void> {
  const groupId = String(message.chat.id);
  const text = String(message.text || '').trim();
  if (!text) return;

  const now = Math.floor(Date.now() / 1000);

  const tx = await env.DB.prepare(
    `SELECT id, status, team_id FROM pending_transactions WHERE id = ? LIMIT 1`,
  ).bind(txId).first<{ id: string; status: string; team_id: string }>();

  if (!tx || tx.team_id !== conn.team_id) return;

  if (tx.status !== 'pending' && tx.status !== 'matched') {
    await sendMessage(env, conn, groupId,
      `ℹ️ รายการนี้ ${tx.status} แล้ว ไม่สามารถจับคู่ใหม่ได้`,
      { reply_to_message_id: Number(message.message_id) });
    return;
  }

  const tenant = await env.DB.prepare(
    `SELECT id, name, admin_api_url FROM tenants WHERE id = ? LIMIT 1`,
  ).bind(tenantId).first<{ id: string; name: string; admin_api_url: string }>();
  if (!tenant) {
    await sendMessage(env, conn, groupId, '❌ ไม่พบข้อมูลเว็บ',
      { reply_to_message_id: Number(message.message_id) });
    return;
  }

  const session = await env.DB.prepare(
    `SELECT session_token FROM admin_sessions WHERE tenant_id = ? AND expires_at > ? LIMIT 1`,
  ).bind(tenant.id, now).first<{ session_token: string }>();
  if (!session) {
    await sendMessage(env, conn, groupId,
      `❌ เว็บ "${tenant.name}" ยังไม่ได้เชื่อมต่อ\nกรุณาใช้ /status และ /connect_<slug> ก่อน`,
      { reply_to_message_id: Number(message.message_id) });
    return;
  }

  const apiToken = session.session_token;
  const apiUrl = tenant.admin_api_url;

  // แสดงสถานะ typing พร้อมกับค้นหา admin backend
  await sendChatAction(env, conn, groupId, 'typing');

  // ค้นหา user (member + non-member พร้อมกัน)
  const [memberResp, nonMemberResp] = await Promise.all([
    fetch(`${apiUrl}/api/users/list?search=${encodeURIComponent(text)}&userCategory=member&page=1&limit=10`, {
      headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
    }),
    fetch(`${apiUrl}/api/users/list?search=${encodeURIComponent(text)}&userCategory=non-member&page=1&limit=10`, {
      headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
    }),
  ]);

  const users: any[] = [];
  if (memberResp.ok) {
    const d = await memberResp.json() as { list?: any[] };
    users.push(...(d.list || []).map((u: any) => ({ ...u, _cat: 'member' })));
  }
  if (nonMemberResp.ok) {
    const d = await nonMemberResp.json() as { list?: any[] };
    users.push(...(d.list || []).map((u: any) => ({ ...u, _cat: 'non-member' })));
  }

  if (users.length === 0) {
    await sendMessage(env, conn, groupId,
      `❌ ไม่พบยูสเซอร์ "${text}" ใน ${tenant.name}`,
      { reply_to_message_id: Number(message.message_id) });
    return;
  }

  if (users.length > 1) {
    const listText = users.slice(0, 10).map((u: any, i: number) => {
      const uname = u.memberCode || u.username || null;
      const fname = u.fullname || (u.firstName ? `${u.firstName} ${u.lastName}`.trim() : '-');
      return uname ? `${i + 1}. ${fname} — ยูส: ${uname}` : `${i + 1}. ${fname} — ยังไม่มียูสเซอร์`;
    }).join('\n');
    const sent = await sendMessage(env, conn, groupId,
      `🔍 พบ ${users.length} ผลลัพธ์ใน ${tenant.name} สำหรับ "${text}":\n${listText}\n\nตอบกลับข้อความนี้ด้วยตัวเลข เช่น 1 หรือ 2 เพื่อเลือก`,
      { reply_to_message_id: Number(message.message_id) });
    if (sent.ok && sent.message_id) {
      await env.BANK_KV.put(
        `tg:usel:${groupId}:${sent.message_id}`,
        JSON.stringify({
          txId,
          tenantId: tenant.id,
          users: users.slice(0, 10).map((u: any) => ({
            memberCode: u.memberCode || u.username || null,
            adminId: u.id ? String(u.id) : null,
            fullname: u.fullname || (u.firstName ? `${u.firstName} ${u.lastName}`.trim() : null),
          })),
        }),
        { expirationTtl: 300 },
      );
    }
    return;
  }

  // พบ 1 ผล → อัปเดท transaction
  const user = users[0];
  const memberCode = user.memberCode || user.username || String(user.id || '') || null;
  const fullname = user.fullname || (user.firstName ? `${user.firstName} ${user.lastName}`.trim() : text);

  await env.DB.prepare(
    `UPDATE pending_transactions
     SET matched_user_id = ?, matched_username = ?, tenant_id = ?, status = 'matched', updated_at = ?
     WHERE id = ?`,
  ).bind(memberCode, fullname, tenant.id, now, txId).run();

  await sendMessage(env, conn, groupId,
    `✅ จับคู่ใหม่สำเร็จ (${tenant.name})\n` +
    `ยูส: ${memberCode || '-'}\n` +
    `ชื่อ: ${fullname || '-'}\n\n` +
    `กดปุ่มด้านล่างเพื่อเติมเครดิต`,
    {
      reply_to_message_id: Number(message.message_id),
      reply_markup: { inline_keyboard: [[{ text: '💰 เติมเครดิต', callback_data: `cr:${txId}` }]] },
    });
}

async function handleMenuCommand(env: Env, conn: TeamTelegramConnection, message: any): Promise<void> {
  const groupId = String(message.chat.id);
  await sendChatAction(env, conn, groupId, 'typing');
  await sendMessage(env, conn, groupId,
    '📋 เมนูคำสั่ง ATslip\n' +
    '• ส่งรูปสลิปเข้ากลุ่ม → ระบบสแกนและเติมเครดิตอัตโนมัติ\n' +
    '• Reply ใต้ข้อความผลลัพธ์ → จับคู่ด้วยมือ\n' +
    '• /status → สถานะแต่ละเว็บ\n' +
    '• /list_all → รายการล่าสุด 20 รายการ\n' +
    '• /list_pending → รอจับคู่ล่าสุด 20 รายการ\n' +
    '• /menu → เมนูนี้\n',
    { reply_to_message_id: Number(message.message_id) });
}

// ดึง slug จาก admin_api_url hostname เช่น https://api.winsure24.com → winsure24
function toTenantSlug(adminApiUrl: string): string {
  try {
    const host = new URL(adminApiUrl).hostname; // e.g. api.winsure24.com
    // ตัด subdomain ที่ไม่ใช่ชื่อเว็บ (api., admin., www., etc.)
    const parts = host.split('.');
    // หา segment ที่ไม่ใช่ TLD และไม่ใช่ common prefix
    const commonPrefix = new Set(['api', 'admin', 'www', 'app', 'm', 'v1', 'v2', 'backend']);
    const namePart = parts.find((p, i) => i < parts.length - 1 && !commonPrefix.has(p)) || parts[0];
    return namePart.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  } catch {
    return adminApiUrl.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20);
  }
}

async function handleStatusCommand(env: Env, conn: TeamTelegramConnection, message: any): Promise<void> {
  const groupId = String(message.chat.id);
  await sendChatAction(env, conn, groupId, 'typing');
  const now = Math.floor(Date.now() / 1000);

  const team = await env.DB.prepare(`SELECT name, slug FROM teams WHERE id = ? LIMIT 1`)
    .bind(conn.team_id)
    .first<{ name: string; slug: string }>();

  // ดึง tenants พร้อมเช็ค session จริง (เหมือน frontend)
  const tenants = await env.DB.prepare(
    `SELECT t.id, t.name, t.status, t.admin_api_url, t.auto_deposit_enabled,
            CASE WHEN s.id IS NOT NULL AND s.expires_at > ? THEN 1 ELSE 0 END AS has_session
     FROM tenants t
     LEFT JOIN admin_sessions s ON s.tenant_id = t.id
     WHERE t.team_id = ?
     ORDER BY t.name`,
  ).bind(now, conn.team_id).all<{
    id: string; name: string; status: string; admin_api_url: string;
    auto_deposit_enabled: number; has_session: number;
  }>();

  const list = tenants.results || [];

  let lines = `📊 สถานะทีม "${team?.name || conn.team_id}"\n\n`;
  if (list.length === 0) {
    lines += 'ยังไม่มีเว็บในทีมนี้';
  } else {
    for (const t of list) {
      // เชื่อมต่อแล้ว = active + มี session ไม่หมดอายุ + auto_deposit เปิด
      const isConnected = t.status === 'active' && t.has_session === 1 && t.auto_deposit_enabled === 1;
      const icon = isConnected ? '🟢' : '🔴';
      const statusTxt = isConnected ? 'เชื่อมต่อแล้ว' : 'ขาดการเชื่อมต่อ';
      const slug = toTenantSlug(t.admin_api_url);
      lines += `${t.name}\n${icon} ${statusTxt}\n/connect_${slug}\n\n`;
    }
  }

  await sendMessage(env, conn, groupId, lines.trim(),
    { reply_to_message_id: Number(message.message_id) });
}

async function handleConnectCommand(
  env: Env,
  conn: TeamTelegramConnection,
  message: any,
  slug: string,
): Promise<void> {
  const groupId = String(message.chat.id);
  await sendChatAction(env, conn, groupId, 'typing');
  try {
    // ตรวจว่า slug ตรงกับเว็บในทีมหรือไม่
    const tenants = await env.DB.prepare(
      `SELECT id, name, admin_api_url FROM tenants WHERE team_id = ? AND status = 'active'`,
    ).bind(conn.team_id).all<{ id: string; name: string; admin_api_url: string }>();
    const matched = (tenants.results || []).find(
      (t) => toTenantSlug(t.admin_api_url) === slug,
    );
    if (!matched) {
      await sendMessage(env, conn, groupId,
        `❌ ไม่พบเว็บ "${slug}" ในทีมนี้\nลองใช้ /status เพื่อดูรายการเว็บทั้งหมด`,
        { reply_to_message_id: Number(message.message_id) });
      return;
    }

    // ดึง CAPTCHA จาก admin backend API จริง
    let captchaId = '';
    let captchaImageBytes: Uint8Array | null = null;

    try {
      const captchaResp = await fetch(`${matched.admin_api_url}/api/captcha`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (captchaResp.ok) {
        const captchaData = await captchaResp.json() as { id?: string; base64?: string };
        captchaId = captchaData.id || '';
        if (captchaData.base64) {
          // ตัด "data:image/png;base64," prefix ออก
          const b64 = captchaData.base64.replace(/^data:[^;]+;base64,/, '');
          // Decode base64 → Uint8Array
          const binary = atob(b64);
          captchaImageBytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            captchaImageBytes[i] = binary.charCodeAt(i);
          }
        }
      }
    } catch (e: any) {
      console.warn('[TelegramWebhook] captcha fetch error:', e?.message);
    }

    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 นาที
    let sent: { ok: boolean; message_id?: number };

    if (captchaImageBytes && captchaId) {
      // ส่งรูป CAPTCHA จริง
      sent = await sendPhoto(env, conn, groupId, captchaImageBytes, {
        caption:
          `🔐 ยืนยันการเชื่อมต่อ "${matched.name}"\n` +
          `⚠️ Reply รูปนี้ด้วยรหัส CAPTCHA ในภาพเพื่อเชื่อมต่อ\n` +
          `(หมดอายุใน 5 นาที — พิมพ์ลงกลุ่มปกติไม่นับ)`,
        reply_to_message_id: Number(message.message_id),
      });
    } else {
      // Fallback: ไม่มี CAPTCHA จาก admin API → ส่งข้อความ "ไม่สามารถดึง CAPTCHA"
      sent = await sendMessage(env, conn, groupId,
        `⚠️ ไม่สามารถดึง CAPTCHA จากเว็บ "${matched.name}" ได้\n` +
        `กรุณาเชื่อมต่อผ่านหน้าเว็บ ATslip แทน`,
        { reply_to_message_id: Number(message.message_id) });
      return;
    }

    if (!sent.ok || !sent.message_id) {
      console.error('[TelegramWebhook] handleConnectCommand: failed to send captcha');
      return;
    }

    // เก็บ captchaId + tenantId ใน KV โดยใช้ message_id ของภาพที่บอทส่ง
    const captchaKey = `tg:captcha:${groupId}:${sent.message_id}`;
    await env.BANK_KV.put(captchaKey, JSON.stringify({
      slug,
      tenant_id: matched.id,
      captcha_id: captchaId,
      expires_at: expiresAt,
    }), { expirationTtl: 300 });

  } catch (err: any) {
    console.error('[TelegramWebhook] handleConnectCommand error:', err?.message);
    await sendMessage(env, conn, groupId, `❌ เกิดข้อผิดพลาด: ${String(err?.message || '').slice(0, 100)}`);
  }
}


// ============================================================
// /list_all, /list_pending — รายการล่าสุด
// ============================================================

const LIST_PAGE_SIZE = 20;

// Format Unix timestamp (sec) → "21/05/2569 19:17" (Buddhist year, Bangkok TZ)
function formatThaiDateTime(tsSec: number): string {
  if (!tsSec) return '-';
  try {
    const d = new Date(tsSec * 1000);
    const fmt = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
      timeZone: 'Asia/Bangkok',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const parts: Record<string, string> = {};
    for (const p of fmt.formatToParts(d)) parts[p.type] = p.value;
    const dd = parts.day || '--';
    const mm = parts.month || '--';
    const yy = parts.year || '----';
    const hh = parts.hour || '--';
    const mi = parts.minute || '--';
    return `${dd}/${mm}/${yy} ${hh}:${mi}`;
  } catch {
    return new Date(tsSec * 1000).toISOString();
  }
}

function statusIcon(status: string): string {
  switch (status) {
    case 'credited': return '✅';
    case 'duplicate': return '⚠️';
    case 'failed': return '❌';
    case 'matched': return '🔍';
    case 'pending':
    default: return '⏳';
  }
}

// ตัดชื่อยาวเกินให้สั้นลง — เก็บเฉพาะคำแรก ๆ
function shortenName(name: string | null | undefined, max: number = 18): string {
  if (!name) return '-';
  const t = String(name).trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + '…';
}

interface ListRow {
  id: string;
  status: string;
  amount: number;
  sender_name: string | null;
  receiver_name: string | null;
  matched_user_id: string | null;
  matched_username: string | null;
  created_at: number;
  tenant_name: string | null;
}

async function fetchListRows(
  env: Env,
  teamId: string,
  type: 'all' | 'pending',
  page: number,
): Promise<{ rows: ListRow[]; total: number }> {
  const offset = page * LIST_PAGE_SIZE;
  const where = type === 'pending'
    ? `pt.team_id = ? AND pt.status = 'pending'`
    : `pt.team_id = ?`;

  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM pending_transactions pt WHERE ${where}`,
  ).bind(teamId).first<{ c: number }>();
  const total = Number(totalRow?.c || 0);

  const result = await env.DB.prepare(
    `SELECT pt.id, pt.status, pt.amount,
            pt.sender_name, pt.receiver_name,
            pt.matched_user_id, pt.matched_username,
            pt.created_at,
            t.name AS tenant_name
     FROM pending_transactions pt
     LEFT JOIN tenants t ON t.id = pt.tenant_id
     WHERE ${where}
     ORDER BY pt.created_at DESC
     LIMIT ? OFFSET ?`,
  ).bind(teamId, LIST_PAGE_SIZE, offset).all<ListRow>();

  return { rows: result.results || [], total };
}

function buildListText(type: 'all' | 'pending', rows: ListRow[], page: number, total: number): string {
  const header = type === 'all'
    ? `📜 รายการล่าสุด (หน้า ${page + 1} • ${total} รายการ)`
    : `⏳ รอจับคู่ล่าสุด (หน้า ${page + 1} • ${total} รายการ)`;

  if (rows.length === 0) {
    return `${header}\n\n— ไม่มีรายการ —`;
  }

  const lines: string[] = [header, ''];
  rows.forEach((r, i) => {
    const idx = i + 1;
    const date = formatThaiDateTime(r.created_at);
    const amount = Number(r.amount || 0).toLocaleString();
    const sender = shortenName(r.sender_name);
    const receiver = shortenName(r.receiver_name);
    const tenant = r.tenant_name ? `[${r.tenant_name}]` : '';

    if (type === 'all') {
      const icon = statusIcon(r.status);
      const fname = r.matched_username || '-';
      const code = r.matched_user_id ? ` (${r.matched_user_id})` : '';
      lines.push(`${icon} (${idx}) ${fname}${code}`);
      lines.push(` 📅 ${date} | 💰 ${amount} บาท`);
      lines.push(`🏦 ${sender} ➡️ ${receiver} ${tenant}`.trim());
      lines.push('');
    } else {
      lines.push(`(${idx}) 📅 ${date} | 💰 ${amount} บาท`);
      lines.push(`🏦 ${sender} ➡️ ${receiver} ${tenant}`.trim());
      lines.push('');
    }
  });

  return lines.join('\n').trim();
}

function buildListKeyboard(type: 'all' | 'pending', page: number, total: number, rowCount: number): any {
  const hasPrev = page > 0;
  const hasNext = (page + 1) * LIST_PAGE_SIZE < total;
  const navRow: any[] = [];
  if (hasPrev) navRow.push({ text: '⬅️ ก่อนหน้า', callback_data: `${type === 'all' ? 'lap' : 'lpp'}:${page - 1}` });
  if (hasNext) navRow.push({ text: 'ถัดไป ➡️', callback_data: `${type === 'all' ? 'lap' : 'lpp'}:${page + 1}` });

  const actionRow: any[] = [];
  if (rowCount > 0) {
    if (type === 'all') {
      actionRow.push({ text: '↩️ ดึงเครดิตกลับ', callback_data: 'law' });
      actionRow.push({ text: '🗑 ลบรายการ', callback_data: 'lad' });
    } else {
      actionRow.push({ text: '👤 ระบุยูส', callback_data: 'lps' });
      actionRow.push({ text: '🗑 ลบรายการ', callback_data: 'lpd' });
    }
  }

  const keyboard: any[][] = [];
  if (navRow.length > 0) keyboard.push(navRow);
  if (actionRow.length > 0) keyboard.push(actionRow);
  return { inline_keyboard: keyboard };
}

async function handleListCommand(
  env: Env,
  conn: TeamTelegramConnection,
  message: any,
  type: 'all' | 'pending',
  page: number,
): Promise<void> {
  const groupId = String(message.chat.id);
  await sendChatAction(env, conn, groupId, 'typing');

  const { rows, total } = await fetchListRows(env, conn.team_id, type, page);
  const text = buildListText(type, rows, page, total);
  const reply_markup = buildListKeyboard(type, page, total, rows.length);

  const sent = await sendMessage(env, conn, groupId, text, {
    reply_to_message_id: Number(message.message_id),
    reply_markup,
  });

  if (sent.ok && sent.message_id && rows.length > 0) {
    await env.BANK_KV.put(
      `tg:list:${groupId}:${sent.message_id}`,
      JSON.stringify({
        type, teamId: conn.team_id, page,
        txIds: rows.map(r => r.id),
      }),
      { expirationTtl: 60 * 60 },
    );
  }
}

async function renderListMessage(
  env: Env,
  conn: TeamTelegramConnection,
  groupId: string,
  type: 'all' | 'pending',
  page: number,
  msgId: number | string,
): Promise<void> {
  const { rows, total } = await fetchListRows(env, conn.team_id, type, page);
  const text = buildListText(type, rows, page, total);
  const reply_markup = buildListKeyboard(type, page, total, rows.length);

  await editMessageText(env, conn, groupId, msgId, text, { reply_markup });

  if (rows.length > 0) {
    await env.BANK_KV.put(
      `tg:list:${groupId}:${msgId}`,
      JSON.stringify({
        type, teamId: conn.team_id, page,
        txIds: rows.map(r => r.id),
      }),
      { expirationTtl: 60 * 60 },
    );
  } else {
    await env.BANK_KV.delete(`tg:list:${groupId}:${msgId}`);
  }
}

async function handleListActionExecute(
  env: Env,
  conn: TeamTelegramConnection,
  message: any,
  action: 'withdraw' | 'delete' | 'select_user',
  txId: string,
): Promise<void> {
  const groupId = String(message.chat.id);
  await sendChatAction(env, conn, groupId, 'typing');

  // ตรวจ ownership
  const tx = await env.DB.prepare(
    `SELECT id, status, team_id, tenant_id FROM pending_transactions WHERE id = ? LIMIT 1`,
  ).bind(txId).first<{ id: string; status: string; team_id: string; tenant_id: string }>();
  if (!tx || tx.team_id !== conn.team_id) {
    await sendMessage(env, conn, groupId, '❌ ไม่พบรายการนี้',
      { reply_to_message_id: Number(message.message_id) });
    return;
  }

  if (action === 'withdraw') {
    if (tx.status !== 'credited') {
      await sendMessage(env, conn, groupId,
        `ℹ️ สถานะปัจจุบัน: ${tx.status} — ไม่สามารถดึงเครดิตคืนได้`,
        { reply_to_message_id: Number(message.message_id) });
      return;
    }
    const syntheticReq = new Request(`https://internal/api/pending-transactions/${txId}/withdraw`, {
      method: 'POST',
    });
    const resp = await handleWithdrawPendingCredit(env, txId, syntheticReq);
    const result = await resp.json<any>().catch(() => ({ success: false }));
    if (result?.success) {
      await sendMessage(env, conn, groupId,
        `↩️ ดึงเครดิตกลับสำเร็จ\nรหัส: ${txId}`,
        { reply_to_message_id: Number(message.message_id) });
    } else {
      await sendMessage(env, conn, groupId,
        `❌ ดึงคืนไม่สำเร็จ: ${result?.error || 'unknown'}`,
        { reply_to_message_id: Number(message.message_id) });
    }
    return;
  }

  if (action === 'delete') {
    await env.DB.prepare(`DELETE FROM pending_transactions WHERE id = ? AND team_id = ?`)
      .bind(txId, conn.team_id).run();
    await sendMessage(env, conn, groupId,
      `🗑 ลบรายการเรียบร้อยแล้ว\nรหัส: ${txId}`,
      { reply_to_message_id: Number(message.message_id) });
    return;
  }

  if (action === 'select_user') {
    if (tx.status !== 'pending' && tx.status !== 'matched') {
      await sendMessage(env, conn, groupId,
        `ℹ️ สถานะปัจจุบัน: ${tx.status} — ไม่สามารถระบุยูสได้`,
        { reply_to_message_id: Number(message.message_id) });
      return;
    }

    // ดึง tenants ทั้งหมดในทีม
    const tenants = await env.DB.prepare(
      `SELECT id, name FROM tenants WHERE team_id = ? AND status = 'active' ORDER BY name`,
    ).bind(conn.team_id).all<{ id: string; name: string }>();
    const list = tenants.results || [];
    if (list.length === 0) {
      await sendMessage(env, conn, groupId, '❌ ไม่มีเว็บในทีม',
        { reply_to_message_id: Number(message.message_id) });
      return;
    }

    // ผูก txId ใน KV ใต้ short token (เหมือน su: flow)
    const token = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    await env.BANK_KV.put(
      `tg:sel:${groupId}:${token}`,
      JSON.stringify({ txId }),
      { expirationTtl: 300 },
    );

    if (list.length === 1) {
      // เว็บเดียว → ส่ง prompt เลย (reply ของ prompt จะใช้ flow handleRematchWithTenant)
      await handleSendRematchPrompt(env, conn, groupId, token, list[0]);
    } else {
      const keyboard = list.map(t => [{ text: t.name, callback_data: `w:${token}:${t.id}` }]);
      await sendMessage(env, conn, groupId,
        '🌐 เลือกเว็บที่ต้องการค้นหาลูกค้า:',
        {
          reply_to_message_id: Number(message.message_id),
          reply_markup: { inline_keyboard: keyboard },
        });
    }
    return;
  }
}

