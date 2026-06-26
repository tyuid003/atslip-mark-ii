// API: Telegram User Authentication
// POST /api/auth/register      - ลงทะเบียน / login หลังจากยืนยัน Telegram สำเร็จ
// GET  /api/auth/me            - ดูข้อมูลผู้ใช้ปัจจุบัน
// PATCH /api/auth/me/display-name - เปลี่ยนชื่อที่แสดง
// POST /api/auth/logout        - ออกจากระบบ (revoke device session)

import { jsonResponse, errorResponse } from '../utils/helpers';
import { nanoid } from 'nanoid';

interface Env {
  DB: D1Database;
  BANK_KV: KVNamespace;
}

// ============================================================
// HELPERS
// ============================================================

/** ดึง app_session_token จาก Authorization header */
function extractSessionToken(request: Request): string | null {
  const auth = request.headers.get('Authorization') ?? '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return null;
}

/** ดึงข้อมูล session + user จาก token */
async function getSessionUser(db: D1Database, token: string) {
  return db
    .prepare(
      `SELECT ds.id as session_id, ds.device_token, ds.telegram_user_id,
              tu.telegram_id, tu.telegram_first_name, tu.telegram_last_name,
              tu.telegram_username, tu.telegram_phone,
              tu.display_name, tu.photo_kv_key, tu.is_master
       FROM device_sessions ds
       JOIN telegram_users tu ON tu.id = ds.telegram_user_id
       WHERE ds.app_session_token = ? AND ds.is_active = 1`
    )
    .bind(token)
    .first();
}

// ============================================================
// POST /api/auth/register
// Body: { telegram_id, telegram_first_name, telegram_last_name,
//         telegram_username, telegram_phone, session_string,
//         device_token, photo_base64? }
// ============================================================
export async function handleRegister(request: Request, env: Env): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const {
    telegram_id,
    telegram_first_name = '',
    telegram_last_name = '',
    telegram_username = '',
    telegram_phone = '',
    session_string = '',
    device_token,
    photo_base64,
  } = body ?? {};

  if (!telegram_id || !device_token) {
    return errorResponse('telegram_id และ device_token จำเป็นต้องระบุ', 400);
  }

  // Validate telegram_id is numeric string (security: prevent injection)
  if (!/^\d{1,20}$/.test(String(telegram_id))) {
    return errorResponse('telegram_id ไม่ถูกต้อง', 400);
  }

  // Validate device_token format (UUID v4)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(device_token))) {
    return errorResponse('device_token ไม่ถูกต้อง', 400);
  }

  const now = Date.now();

  // ── 1. Upsert telegram_users ──────────────────────────────
  await env.DB.prepare(
    `INSERT INTO telegram_users
       (telegram_id, telegram_first_name, telegram_last_name,
        telegram_username, telegram_phone, session_string, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(telegram_id) DO UPDATE SET
       telegram_first_name = excluded.telegram_first_name,
       telegram_last_name  = excluded.telegram_last_name,
       telegram_username   = excluded.telegram_username,
       telegram_phone      = excluded.telegram_phone,
       session_string      = excluded.session_string,
       updated_at          = excluded.updated_at`
  )
    .bind(
      String(telegram_id),
      telegram_first_name,
      telegram_last_name,
      telegram_username,
      telegram_phone,
      session_string,
      now,
    )
    .run();

  // ── 2. บันทึกรูปโปรไฟล์ใน KV (ถ้ามี) ─────────────────────
  if (photo_base64 && typeof photo_base64 === 'string' && photo_base64.startsWith('data:image/')) {
    const kvKey = `tg_photo:${telegram_id}`;
    await env.BANK_KV.put(kvKey, photo_base64, { expirationTtl: 60 * 60 * 24 * 30 }); // 30 days
    await env.DB.prepare(
      `UPDATE telegram_users SET photo_kv_key = ?, updated_at = ? WHERE telegram_id = ?`
    ).bind(kvKey, now, String(telegram_id)).run();
  }

  // ── 3. ดึง internal user id ───────────────────────────────
  const userRow = await env.DB.prepare(
    `SELECT id, display_name, photo_kv_key FROM telegram_users WHERE telegram_id = ?`
  )
    .bind(String(telegram_id))
    .first();

  if (!userRow) return errorResponse('ไม่พบผู้ใช้หลัง upsert — กรุณาลองใหม่', 500);

  // ── 4. Revoke device sessions เดิมของ device นี้ ──────────
  await env.DB.prepare(
    `UPDATE device_sessions SET is_active = 0, updated_at = ?
     WHERE device_token = ? AND is_active = 1`
  )
    .bind(now, String(device_token))
    .run();

  // ── 5. สร้าง device session ใหม่ ──────────────────────────
  const appSessionToken = nanoid(48);
  await env.DB.prepare(
    `INSERT INTO device_sessions (device_token, telegram_user_id, app_session_token, is_active, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?)`
  )
    .bind(String(device_token), userRow.id, appSessionToken, now, now)
    .run();

  return jsonResponse({
    ok: true,
    app_session_token: appSessionToken,
    user: {
      telegram_id: String(telegram_id),
      telegram_first_name,
      telegram_last_name,
      telegram_username,
      telegram_phone,
      display_name: userRow.display_name ?? null,
    },
  });
}

// ============================================================
// GET /api/auth/me
// ============================================================
export async function handleGetMe(request: Request, env: Env): Promise<Response> {
  const token = extractSessionToken(request);
  if (!token) return errorResponse('กรุณาเข้าสู่ระบบ', 401);

  const row = await getSessionUser(env.DB, token);
  if (!row) return errorResponse('Session ไม่ถูกต้องหรือหมดอายุ', 401);

  // ดึงรูปโปรไฟล์จาก KV (ถ้ามี)
  let photo: string | null = null;
  if (row.photo_kv_key) {
    try {
      photo = await env.BANK_KV.get(row.photo_kv_key as string);
    } catch { /* ignore */ }
  }

  return jsonResponse({
    ok: true,
    user: {
      telegram_id:        row.telegram_id,
      telegram_first_name: row.telegram_first_name,
      telegram_last_name:  row.telegram_last_name,
      telegram_username:   row.telegram_username,
      telegram_phone:      row.telegram_phone,
      display_name:        row.display_name ?? null,
      is_master:           !!(row as any).is_master,
      photo,
    },
  });
}

// ============================================================
// PATCH /api/auth/me/display-name
// Body: { display_name: string | null }
// ============================================================
export async function handleUpdateDisplayName(request: Request, env: Env): Promise<Response> {
  const token = extractSessionToken(request);
  if (!token) return errorResponse('กรุณาเข้าสู่ระบบ', 401);

  const row = await getSessionUser(env.DB, token);
  if (!row) return errorResponse('Session ไม่ถูกต้องหรือหมดอายุ', 401);

  let body: any;
  try { body = await request.json(); } catch { return errorResponse('Invalid JSON body', 400); }

  // display_name = null หรือ '' → reset กลับชื่อ Telegram เดิม
  const rawName: string | null = body?.display_name ?? null;
  const displayName = (typeof rawName === 'string' && rawName.trim().length > 0)
    ? rawName.trim().slice(0, 100)
    : null;

  await env.DB.prepare(
    `UPDATE telegram_users SET display_name = ?, updated_at = ? WHERE id = ?`
  )
    .bind(displayName, Date.now(), row.telegram_user_id)
    .run();

  return jsonResponse({ ok: true, display_name: displayName });
}

// ============================================================
// POST /api/auth/logout
// ============================================================
export async function handleLogout(request: Request, env: Env): Promise<Response> {
  const token = extractSessionToken(request);
  if (!token) return jsonResponse({ ok: true }); // already logged out

  await env.DB.prepare(
    `UPDATE device_sessions SET is_active = 0, updated_at = ? WHERE app_session_token = ?`
  )
    .bind(Date.now(), token)
    .run();

  return jsonResponse({ ok: true });
}

// ============================================================
// GET /api/auth/photo/:telegram_id
// Public — ดึงรูปโปรไฟล์จาก KV
// ============================================================
export async function handleGetPhoto(env: Env, telegramId: string): Promise<Response> {
  if (!/^\d{1,20}$/.test(telegramId)) return errorResponse('Invalid telegram_id', 400);

  const kvKey = `tg_photo:${telegramId}`;
  const photo = await env.BANK_KV.get(kvKey);
  if (!photo) return errorResponse('ไม่พบรูปโปรไฟล์', 404);

  return jsonResponse({ ok: true, photo });
}
