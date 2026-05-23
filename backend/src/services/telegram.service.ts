/**
 * Telegram Service (Phase A scaffold)
 *
 * จุดประสงค์:
 *  - เก็บ logic เกี่ยวกับ Telegram (encrypt bot token, send message, webhook verify)
 *  - Phase A เป็น scaffold เท่านั้น ยังไม่เปิดใช้จริงจน feature flag เปิด
 *
 * ความปลอดภัย:
 *  - bot_token ต้องเข้ารหัสก่อนเก็บ (XOR + base64 ด้วย TELEGRAM_TOKEN_KEY env)
 *  - log ต้อง mask token เสมอ
 *
 * NOTE: Phase B จะเพิ่ม sendMessage, sendPhoto, answerCallbackQuery, etc.
 */
import type { Env, TeamTelegramConnection } from '../types';

const TOKEN_PREFIX = 'tg1:'; // versioning prefix สำหรับ token ที่ encrypt แล้ว

/**
 * Mask bot token สำหรับ log: เก็บแค่ prefix:suffix
 */
export function maskToken(token: string): string {
  if (!token || token.length < 12) return '***';
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

/**
 * Encrypt bot token แบบเบา (XOR + base64) ด้วย key จาก env
 * - ไม่ใช่ encryption ที่แข็งแกร่งระดับ AES แต่ดีกว่า plaintext
 * - Phase B พิจารณาเปลี่ยนเป็น Web Crypto AES-GCM
 */
export function encryptBotToken(plain: string, key: string): string {
  if (!plain) return '';
  if (!key) throw new Error('TELEGRAM_TOKEN_KEY env not configured');
  const keyBytes = new TextEncoder().encode(key);
  const data = new TextEncoder().encode(plain);
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    out[i] = data[i] ^ keyBytes[i % keyBytes.length];
  }
  // base64 encode
  let bin = '';
  for (const b of out) bin += String.fromCharCode(b);
  return TOKEN_PREFIX + btoa(bin);
}

export function decryptBotToken(stored: string, key: string): string {
  if (!stored) return '';
  if (!key) throw new Error('TELEGRAM_TOKEN_KEY env not configured');
  if (!stored.startsWith(TOKEN_PREFIX)) {
    // ถือว่ายังเป็น plain (กรณี dev) — return ตามเดิมเพื่อ backward compat
    return stored;
  }
  const b64 = stored.slice(TOKEN_PREFIX.length);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const keyBytes = new TextEncoder().encode(key);
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = bytes[i] ^ keyBytes[i % keyBytes.length];
  }
  return new TextDecoder().decode(out);
}

/**
 * สร้าง webhook secret token แบบ random 32 chars
 */
export function generateWebhookSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/[+/=]/g, '').slice(0, 32);
}

/**
 * ตรวจสอบ secret token ที่มากับ Telegram webhook
 * (header: X-Telegram-Bot-Api-Secret-Token)
 */
export function verifyWebhookSecret(
  request: Request,
  expected: string | null | undefined,
): boolean {
  if (!expected) return false;
  const got = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
  return !!got && got === expected;
}

/**
 * ดึง connection ของทีมจาก telegram_group_id
 */
export async function getConnectionByGroupId(
  env: Env,
  telegramGroupId: string,
): Promise<TeamTelegramConnection | null> {
  const row = await env.DB.prepare(
    `SELECT * FROM team_telegram_connections
     WHERE telegram_group_id = ? AND status = 'active' LIMIT 1`,
  )
    .bind(telegramGroupId)
    .first<TeamTelegramConnection>();
  return row || null;
}

/**
 * ดึง connection ของทีมจาก team_id
 */
export async function getConnectionByTeamId(
  env: Env,
  teamId: string,
): Promise<TeamTelegramConnection | null> {
  const row = await env.DB.prepare(
    `SELECT * FROM team_telegram_connections
     WHERE team_id = ? LIMIT 1`,
  )
    .bind(teamId)
    .first<TeamTelegramConnection>();
  return row || null;
}

/**
 * ตรวจว่าทีมเปิดใช้ Telegram หรือไม่
 */
export async function isTelegramEnabledForTeam(
  env: Env,
  teamId: string,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT telegram_enabled FROM teams WHERE id = ? LIMIT 1`,
  )
    .bind(teamId)
    .first<{ telegram_enabled: number }>();
  return !!row && row.telegram_enabled === 1;
}

// ============================================================
// Telegram Bot API Senders (Phase B)
// ============================================================

const TG_API = 'https://api.telegram.org';

/**
 * ดึง bot token แบบ plain (decrypt ถ้าเก็บเป็น encrypted) สำหรับเรียก Telegram API
 */
export function getPlainBotToken(env: Env, conn: TeamTelegramConnection): string {
  const key = env.TELEGRAM_TOKEN_KEY || '';
  return decryptBotToken(conn.telegram_bot_token, key);
}

interface SendMessageOptions {
  reply_to_message_id?: number | string;
  parse_mode?: 'HTML' | 'MarkdownV2';
  reply_markup?: any;
  disable_notification?: boolean;
}

/**
 * sendMessage — ส่งข้อความเข้า group/chat
 */
export async function sendMessage(
  env: Env,
  conn: TeamTelegramConnection,
  chatId: string | number,
  text: string,
  options: SendMessageOptions = {},
): Promise<{ ok: boolean; message_id?: number; error?: string }> {
  try {
    const token = getPlainBotToken(env, conn);
    const body: any = {
      chat_id: chatId,
      text,
      ...options,
    };
    const res = await fetch(`${TG_API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json<any>();
    if (!data.ok) {
      console.warn('[Telegram] sendMessage failed:', data.description);
      return { ok: false, error: data.description };
    }
    return { ok: true, message_id: data.result?.message_id };
  } catch (err: any) {
    console.error('[Telegram] sendMessage error:', err?.message);
    return { ok: false, error: String(err?.message || err) };
  }
}

/**
 * sendPhoto — ส่งรูปภาพเข้า group/chat
 * รับ imageBytes (Uint8Array) และส่งแบบ multipart/form-data
 */
export async function sendPhoto(
  env: Env,
  conn: TeamTelegramConnection,
  chatId: string | number,
  imageBytes: Uint8Array,
  options: { caption?: string; reply_to_message_id?: number | string } = {},
): Promise<{ ok: boolean; message_id?: number; error?: string }> {
  try {
    const token = getPlainBotToken(env, conn);
    const fd = new FormData();
    fd.append('chat_id', String(chatId));
    fd.append('photo', new Blob([imageBytes], { type: 'image/png' }), 'captcha.png');
    if (options.caption) fd.append('caption', options.caption);
    if (options.reply_to_message_id != null) {
      fd.append('reply_to_message_id', String(options.reply_to_message_id));
    }
    const res = await fetch(`${TG_API}/bot${token}/sendPhoto`, {
      method: 'POST',
      body: fd,
    });
    const data = await res.json<any>();
    if (!data.ok) {
      console.warn('[Telegram] sendPhoto failed:', data.description);
      return { ok: false, error: data.description };
    }
    return { ok: true, message_id: data.result?.message_id };
  } catch (err: any) {
    console.error('[Telegram] sendPhoto error:', err?.message);
    return { ok: false, error: String(err?.message || err) };
  }
}

/**
 * editMessageText — แก้ข้อความเดิม (เช่น อัปเดตสถานะหลัง withdraw)
 */
export async function editMessageText(
  env: Env,
  conn: TeamTelegramConnection,
  chatId: string | number,
  messageId: number | string,
  text: string,
  options: { parse_mode?: 'HTML' | 'MarkdownV2'; reply_markup?: any } = {},
): Promise<boolean> {
  try {
    const token = getPlainBotToken(env, conn);
    const res = await fetch(`${TG_API}/bot${token}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text,
        ...options,
      }),
    });
    const data = await res.json<any>();
    return !!data.ok;
  } catch (err: any) {
    console.warn('[Telegram] editMessageText error:', err?.message);
    return false;
  }
}

/**
 * answerCallbackQuery — ตอบ callback button (กัน loading หมุนค้าง)
 */
export async function answerCallbackQuery(
  env: Env,
  conn: TeamTelegramConnection,
  callbackQueryId: string,
  text?: string,
  showAlert: boolean = false,
): Promise<void> {
  try {
    const token = getPlainBotToken(env, conn);
    await fetch(`${TG_API}/bot${token}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text: text || '',
        show_alert: showAlert,
      }),
    });
  } catch (err: any) {
    console.warn('[Telegram] answerCallbackQuery error:', err?.message);
  }
}

/**
 * sendChatAction — ส่งสถานะ "กำลังพิมพ์" ให้ผู้ใช้เห็นว่าบอทกำลังประมวลผล
 */
export async function sendChatAction(
  env: Env,
  conn: TeamTelegramConnection,
  chatId: string | number,
  action: 'typing' | 'upload_photo' | 'upload_document' = 'typing',
): Promise<void> {
  try {
    const token = getPlainBotToken(env, conn);
    await fetch(`${TG_API}/bot${token}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, action }),
    });
  } catch (err: any) {
    console.warn('[Telegram] sendChatAction error:', err?.message);
  }
}

/**
 * getFile — ขอ file_path จาก file_id (Telegram API จำเป็นต้องเรียกก่อนโหลด)
 */
async function tgGetFilePath(env: Env, conn: TeamTelegramConnection, fileId: string): Promise<string | null> {
  try {
    const token = getPlainBotToken(env, conn);
    const res = await fetch(`${TG_API}/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`);
    const data = await res.json<any>();
    if (!data.ok) return null;
    return data.result?.file_path || null;
  } catch (err: any) {
    console.warn('[Telegram] getFile error:', err?.message);
    return null;
  }
}

/**
 * downloadFile — ดาวน์โหลดไฟล์จาก Telegram เป็น Uint8Array
 * Telegram file URL: https://api.telegram.org/file/bot<token>/<file_path>
 */
export async function downloadFile(
  env: Env,
  conn: TeamTelegramConnection,
  fileId: string,
  timeoutMs: number = 20000,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const filePath = await tgGetFilePath(env, conn, fileId);
  if (!filePath) return null;
  const token = getPlainBotToken(env, conn);
  const url = `${TG_API}/file/bot${token}/${filePath}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      console.warn('[Telegram] downloadFile non-OK:', res.status);
      return null;
    }
    const buf = await res.arrayBuffer();
    return {
      bytes: new Uint8Array(buf),
      contentType: res.headers.get('Content-Type') || 'image/jpeg',
    };
  } catch (err: any) {
    console.warn('[Telegram] downloadFile error:', err?.message);
    return null;
  } finally {
    clearTimeout(t);
  }
}
