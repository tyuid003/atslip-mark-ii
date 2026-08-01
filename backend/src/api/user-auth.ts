// API: Username/Password Authentication
// POST /api/auth/login        - เข้าสู่ระบบด้วย username + password
// POST /api/auth/register-user - Admin สร้าง user ใหม่
// GET  /api/auth/me           - ดูข้อมูลตัวเอง
// PATCH /api/auth/me/display-name - เปลี่ยนชื่อที่แสดง
// PATCH /api/auth/me/password - เปลี่ยนรหัสผ่าน
// PATCH /api/auth/me/photo    - อัพโหลด/เปลี่ยนรูปโปรไฟล์
// POST /api/auth/logout       - ออกจากระบบ
// GET  /api/auth/photo/:user_id - ดึงรูปโปรไฟล์ (public)
// POST /api/setup/bootstrap   - สร้าง master admin คนแรก (one-time, ถ้าไม่มี master ใดเลย)

import { jsonResponse, errorResponse } from '../utils/helpers';
import { nanoid } from 'nanoid';

interface Env {
  DB: D1Database;
  BANK_KV: KVNamespace;
}

// ============================================================
// PASSWORD HASHING (Web Crypto — PBKDF2)
// ============================================================

async function hashPassword(password: string): Promise<string> {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 },
    keyMaterial, 256
  );
  const hashArr = new Uint8Array(bits);
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
  const hashHex = Array.from(hashArr).map(b => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2:${saltHex}:${hashHex}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [, saltHex, hashHex] = stored.split(':');
    const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(h => parseInt(h, 16)));
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 },
      keyMaterial, 256
    );
    const hashArr = new Uint8Array(bits);
    const computedHex = Array.from(hashArr).map(b => b.toString(16).padStart(2, '0')).join('');
    // timing-safe compare
    return computedHex === hashHex;
  } catch {
    return false;
  }
}

// ============================================================
// HELPERS
// ============================================================

function extractSessionToken(request: Request): string | null {
  const auth = request.headers.get('Authorization') ?? '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return null;
}

async function getSessionUser(db: D1Database, token: string) {
  return db.prepare(
    `SELECT ds.id as session_id, ds.device_token, ds.telegram_user_id,
            tu.id as user_internal_id, tu.telegram_id, tu.username,
            tu.telegram_first_name, tu.telegram_last_name,
            tu.telegram_username, tu.display_name, tu.photo_kv_key, tu.is_master
     FROM device_sessions ds
     JOIN telegram_users tu ON tu.id = ds.telegram_user_id
     WHERE ds.app_session_token = ? AND ds.is_active = 1`
  ).bind(token).first<{
    session_id: number;
    device_token: string;
    telegram_user_id: number;
    user_internal_id: number;
    telegram_id: string;
    username: string | null;
    telegram_first_name: string;
    telegram_last_name: string;
    telegram_username: string;
    display_name: string | null;
    photo_kv_key: string | null;
    is_master: number;
  }>();
}

function escapeHtml(str: string): string {
  return String(str).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c)
  );
}

// ============================================================
// POST /api/auth/login
// Body: { username, password, device_token? }
// ============================================================
export async function handleLogin(request: Request, env: Env): Promise<Response> {
  let body: any;
  try { body = await request.json(); } catch { return errorResponse('Invalid JSON body', 400); }

  const username = String(body?.username ?? '').trim().toLowerCase();
  const password  = String(body?.password ?? '');
  const deviceToken = String(body?.device_token ?? nanoid(36));

  if (!username || !password) {
    return errorResponse('กรุณากรอก username และ password', 400);
  }

  // Lookup user by username
  const user = await env.DB.prepare(
    `SELECT id, telegram_id, username, password_hash, display_name,
            telegram_first_name, photo_kv_key, is_master
     FROM telegram_users WHERE username = ? LIMIT 1`
  ).bind(username).first<{
    id: number;
    telegram_id: string;
    username: string;
    password_hash: string | null;
    display_name: string | null;
    telegram_first_name: string;
    photo_kv_key: string | null;
    is_master: number;
  }>();

  if (!user || !user.password_hash) {
    return errorResponse('username หรือ password ไม่ถูกต้อง', 401);
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return errorResponse('username หรือ password ไม่ถูกต้อง', 401);
  }

  const now = Date.now();

  // Revoke device sessions เดิม
  await env.DB.prepare(
    `UPDATE device_sessions SET is_active = 0, updated_at = ? WHERE device_token = ? AND is_active = 1`
  ).bind(now, deviceToken).run();

  // สร้าง session ใหม่
  const appSessionToken = nanoid(48);
  await env.DB.prepare(
    `INSERT INTO device_sessions (device_token, telegram_user_id, app_session_token, is_active, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?)`
  ).bind(deviceToken, user.id, appSessionToken, now, now).run();

  // ดึงรูปโปรไฟล์
  let photo: string | null = null;
  if (user.photo_kv_key) {
    try { photo = await env.BANK_KV.get(user.photo_kv_key); } catch { /* ignore */ }
  }

  return jsonResponse({
    ok: true,
    app_session_token: appSessionToken,
    device_token: deviceToken,
    user: {
      telegram_id: user.telegram_id,
      username: user.username,
      display_name: user.display_name ?? user.telegram_first_name ?? user.username,
      is_master: !!user.is_master,
      photo,
    },
  });
}

// ============================================================
// POST /api/auth/register-user  (Admin only per team)
// Body: { username, password, display_name?, team_slug, role? }
// ============================================================
export async function handleRegisterUser(request: Request, env: Env): Promise<Response> {
  const token = extractSessionToken(request);
  if (!token) return errorResponse('Unauthorized', 401);

  const caller = await getSessionUser(env.DB, token);
  if (!caller) return errorResponse('Unauthorized', 401);

  let body: any;
  try { body = await request.json(); } catch { return errorResponse('Invalid JSON body', 400); }

  const username    = String(body?.username ?? '').trim().toLowerCase();
  const password    = String(body?.password ?? '');
  const displayName = String(body?.display_name ?? username).trim().slice(0, 100);
  const teamSlug    = String(body?.team_slug ?? '').trim();
  const role        = body?.role === 'admin' ? 'admin' : 'member';

  if (!username || !password || !teamSlug) {
    return errorResponse('username, password และ team_slug จำเป็นต้องระบุ', 400);
  }
  if (!/^[a-z0-9_]{3,30}$/.test(username)) {
    return errorResponse('username ต้องเป็นตัวอักษร a-z, 0-9, _ และมีความยาว 3-30 ตัว', 400);
  }
  // ดึง team
  const team = await env.DB.prepare(
    `SELECT id FROM teams WHERE slug = ? AND status = 'active' LIMIT 1`
  ).bind(teamSlug).first<{ id: string }>();
  if (!team) return errorResponse('ไม่พบทีม', 404);

  // ตรวจสอบว่า caller เป็น admin ของทีมนี้หรือ master
  if (!caller.is_master) {
    const presence = await env.DB.prepare(
      `SELECT role FROM user_presence WHERE team_id = ? AND user_id = ? LIMIT 1`
    ).bind(team.id, caller.telegram_id).first<{ role: string }>();
    if (!presence || presence.role !== 'admin') {
      return errorResponse('เฉพาะ Admin เท่านั้นที่สามารถเพิ่มผู้ใช้ได้', 403);
    }
  }

  // ตรวจ username ซ้ำ
  const existing = await env.DB.prepare(
    `SELECT id FROM telegram_users WHERE username = ? LIMIT 1`
  ).bind(username).first();
  if (existing) return errorResponse('username นี้ถูกใช้แล้ว', 409);

  const passwordHash = await hashPassword(password);
  const telegramId   = `usr_${nanoid(16)}`; // synthetic ID สำหรับ user ที่ไม่มี Telegram
  const now          = Date.now();

  // สร้าง user
  await env.DB.prepare(
    `INSERT INTO telegram_users
       (telegram_id, telegram_first_name, telegram_last_name, telegram_username,
        telegram_phone, session_string, username, password_hash, display_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, '', '', ?, ?, ?, ?, ?)`
  ).bind(telegramId, displayName, '', username, username, passwordHash, displayName, now, now).run();

  const newUser = await env.DB.prepare(
    `SELECT id FROM telegram_users WHERE username = ? LIMIT 1`
  ).bind(username).first<{ id: number }>();

  if (!newUser) return errorResponse('สร้าง user ล้มเหลว', 500);

  // เพิ่มเป็นสมาชิกทีมทันที (approved)
  const nowSec = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO user_presence (user_id, team_id, display_name, photo, last_seen, role)
     VALUES (?, ?, ?, NULL, ?, ?)
     ON CONFLICT(user_id, team_id) DO UPDATE SET role = excluded.role, last_seen = excluded.last_seen`
  ).bind(telegramId, team.id, displayName, nowSec, role).run();

  return jsonResponse({ ok: true, username, display_name: displayName, role });
}

// ============================================================
// GET /api/auth/me
// ============================================================
export async function handleGetMe(request: Request, env: Env): Promise<Response> {
  const token = extractSessionToken(request);
  if (!token) return errorResponse('กรุณาเข้าสู่ระบบ', 401);

  const row = await getSessionUser(env.DB, token);
  if (!row) return errorResponse('Session ไม่ถูกต้องหรือหมดอายุ', 401);

  let photo: string | null = null;
  if (row.photo_kv_key) {
    try { photo = await env.BANK_KV.get(row.photo_kv_key as string); } catch { /* ignore */ }
  }

  return jsonResponse({
    ok: true,
    user: {
      telegram_id:    row.telegram_id,
      username:       row.username ?? null,
      display_name:   row.display_name ?? row.telegram_first_name ?? row.username ?? null,
      is_master:      !!(row.is_master),
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

  const rawName: string | null = body?.display_name ?? null;
  const displayName = (typeof rawName === 'string' && rawName.trim().length > 0)
    ? rawName.trim().slice(0, 100)
    : null;

  await env.DB.prepare(
    `UPDATE telegram_users SET display_name = ?, updated_at = ? WHERE id = ?`
  ).bind(displayName, Date.now(), row.telegram_user_id).run();

  return jsonResponse({ ok: true, display_name: displayName });
}

// ============================================================
// PATCH /api/auth/me/password
// Body: { current_password, new_password }
// ============================================================
export async function handleChangePassword(request: Request, env: Env): Promise<Response> {
  const token = extractSessionToken(request);
  if (!token) return errorResponse('กรุณาเข้าสู่ระบบ', 401);

  const row = await getSessionUser(env.DB, token);
  if (!row) return errorResponse('Session ไม่ถูกต้องหรือหมดอายุ', 401);

  let body: any;
  try { body = await request.json(); } catch { return errorResponse('Invalid JSON body', 400); }

  const currentPassword = String(body?.current_password ?? '');
  const newPassword     = String(body?.new_password ?? '');

  if (!currentPassword || !newPassword) {
    return errorResponse('กรุณากรอก current_password และ new_password', 400);
  }
  // ดึง password hash ปัจจุบัน
  const userRow = await env.DB.prepare(
    `SELECT password_hash FROM telegram_users WHERE id = ? LIMIT 1`
  ).bind(row.telegram_user_id).first<{ password_hash: string | null }>();

  if (!userRow?.password_hash) {
    return errorResponse('บัญชีนี้ไม่มีรหัสผ่าน', 400);
  }

  const valid = await verifyPassword(currentPassword, userRow.password_hash);
  if (!valid) return errorResponse('รหัสผ่านปัจจุบันไม่ถูกต้อง', 401);

  const newHash = await hashPassword(newPassword);
  await env.DB.prepare(
    `UPDATE telegram_users SET password_hash = ?, updated_at = ? WHERE id = ?`
  ).bind(newHash, Date.now(), row.telegram_user_id).run();

  return jsonResponse({ ok: true });
}

// ============================================================
// PATCH /api/auth/me/photo
// Body: { photo: string }  — base64 data URI
// ============================================================
export async function handleUpdatePhoto(request: Request, env: Env): Promise<Response> {
  const token = extractSessionToken(request);
  if (!token) return errorResponse('กรุณาเข้าสู่ระบบ', 401);

  const row = await getSessionUser(env.DB, token);
  if (!row) return errorResponse('Session ไม่ถูกต้องหรือหมดอายุ', 401);

  let body: any;
  try { body = await request.json(); } catch { return errorResponse('Invalid JSON body', 400); }

  const photo = body?.photo;
  if (!photo || typeof photo !== 'string' || !photo.startsWith('data:image/')) {
    return errorResponse('รูปภาพไม่ถูกต้อง (ต้องเป็น base64 data URI)', 400);
  }
  // จำกัดขนาด ~2MB
  if (photo.length > 2_800_000) {
    return errorResponse('รูปภาพใหญ่เกินไป (สูงสุด 2MB)', 400);
  }

  const kvKey = `tg_photo:${row.telegram_id}`;
  await env.BANK_KV.put(kvKey, photo, { expirationTtl: 60 * 60 * 24 * 90 }); // 90 days
  await env.DB.prepare(
    `UPDATE telegram_users SET photo_kv_key = ?, updated_at = ? WHERE id = ?`
  ).bind(kvKey, Date.now(), row.telegram_user_id).run();

  return jsonResponse({ ok: true, photo_kv_key: kvKey });
}

// ============================================================
// POST /api/auth/logout
// ============================================================
export async function handleLogout(request: Request, env: Env): Promise<Response> {
  const token = extractSessionToken(request);
  if (!token) return jsonResponse({ ok: true });

  await env.DB.prepare(
    `UPDATE device_sessions SET is_active = 0, updated_at = ? WHERE app_session_token = ?`
  ).bind(Date.now(), token).run();

  return jsonResponse({ ok: true });
}

// ============================================================
// GET /api/auth/photo/:telegram_id
// ============================================================
export async function handleGetPhoto(env: Env, userId: string): Promise<Response> {
  const kvKey = `tg_photo:${userId}`;
  const photo = await env.BANK_KV.get(kvKey);
  if (!photo) return errorResponse('ไม่พบรูปโปรไฟล์', 404);
  return jsonResponse({ ok: true, photo });
}

// ============================================================
// POST /api/setup/bootstrap
// สร้าง master admin คนแรก — ใช้งานได้เฉพาะเมื่อยังไม่มี master user ใดเลย
// Body: { username, password, display_name? }
// ============================================================
export async function handleBootstrap(request: Request, env: Env): Promise<Response> {
  // ตรวจสอบว่ามี master user อยู่แล้วหรือเปล่า
  const existing = await env.DB.prepare(
    `SELECT id FROM telegram_users WHERE is_master = 1 LIMIT 1`
  ).first();
  if (existing) {
    return errorResponse('Master user มีอยู่แล้ว — bootstrap ไม่สามารถใช้ซ้ำได้', 403);
  }

  let body: any;
  try { body = await request.json(); } catch { return errorResponse('Invalid JSON body', 400); }

  const username    = String(body?.username ?? '').trim().toLowerCase();
  const password    = String(body?.password ?? '');
  const displayName = String(body?.display_name ?? username).trim().slice(0, 100);

  if (!username || !password) {
    return errorResponse('username และ password จำเป็นต้องระบุ', 400);
  }
  if (!/^[a-z0-9_]{3,30}$/.test(username)) {
    return errorResponse('username ต้องเป็นตัวอักษร a-z, 0-9, _ และมีความยาว 3-30 ตัว', 400);
  }
  const usernameExists = await env.DB.prepare(
    `SELECT id FROM telegram_users WHERE username = ? LIMIT 1`
  ).bind(username).first();
  if (usernameExists) return errorResponse('username นี้ถูกใช้แล้ว', 409);

  const passwordHash = await hashPassword(password);
  const telegramId   = `usr_${nanoid(16)}`;
  const now          = Date.now();

  await env.DB.prepare(
    `INSERT INTO telegram_users
       (telegram_id, telegram_first_name, telegram_last_name, telegram_username,
        telegram_phone, session_string, username, password_hash, display_name, is_master, created_at, updated_at)
     VALUES (?, ?, ?, ?, '', '', ?, ?, ?, 1, ?, ?)`
  ).bind(telegramId, displayName, '', username, username, passwordHash, displayName, now, now).run();

  return jsonResponse({ ok: true, message: `Master user "${username}" สร้างสำเร็จ` }, 201);
}

// ============================================================
// POST /api/master/create-user  (Master only)
// Body: { username, password, display_name?, team_slug?, role? }
// ============================================================
export async function handleMasterCreateUser(request: Request, env: Env): Promise<Response> {
  const token = extractSessionToken(request);
  if (!token) return errorResponse('Unauthorized', 401);

  const caller = await getSessionUser(env.DB, token);
  if (!caller || !caller.is_master) return errorResponse('Forbidden — เฉพาะ Master เท่านั้น', 403);

  let body: any;
  try { body = await request.json(); } catch { return errorResponse('Invalid JSON body', 400); }

  const username    = String(body?.username ?? '').trim().toLowerCase();
  const password    = String(body?.password ?? '');
  const displayName = String(body?.display_name ?? username).trim().slice(0, 100) || username;
  const teamSlug    = String(body?.team_slug ?? '').trim();
  const role        = body?.role === 'admin' ? 'admin' : 'member';
  const isMaster    = body?.is_master === true || body?.is_master === 1 ? 1 : 0;

  if (!username || !password) {
    return errorResponse('username และ password จำเป็นต้องระบุ', 400);
  }
  if (!/^[a-z0-9_]{3,30}$/.test(username)) {
    return errorResponse('username ต้องเป็นตัวอักษร a-z, 0-9, _ และมีความยาว 3-30 ตัว', 400);
  }

  const usernameExists = await env.DB.prepare(
    `SELECT id FROM telegram_users WHERE username = ? LIMIT 1`
  ).bind(username).first();
  if (usernameExists) return errorResponse('username นี้ถูกใช้แล้ว', 409);

  const passwordHash = await hashPassword(password);
  const telegramId   = `usr_${nanoid(16)}`;
  const now          = Date.now();

  await env.DB.prepare(
    `INSERT INTO telegram_users
       (telegram_id, telegram_first_name, telegram_last_name, telegram_username,
        telegram_phone, session_string, username, password_hash, display_name, is_master, created_at, updated_at)
     VALUES (?, ?, ?, ?, '', '', ?, ?, ?, ?, ?, ?)`
  ).bind(telegramId, displayName, '', username, username, passwordHash, displayName, isMaster, now, now).run();

  // เพิ่มเข้าทีมถ้าระบุ team_slug
  if (teamSlug) {
    const team = await env.DB.prepare(
      `SELECT id FROM teams WHERE slug = ? AND status = 'active' LIMIT 1`
    ).bind(teamSlug).first<{ id: string }>();

    if (team) {
      const nowSec = Math.floor(Date.now() / 1000);
      await env.DB.prepare(
        `INSERT INTO user_presence (user_id, team_id, display_name, photo, last_seen, role)
         VALUES (?, ?, ?, NULL, ?, ?)
         ON CONFLICT(user_id, team_id) DO UPDATE SET role = excluded.role`
      ).bind(telegramId, team.id, displayName, nowSec, role).run();
    }
  }

  return jsonResponse({
    ok: true,
    user: { username, display_name: displayName, telegram_id: telegramId, role: teamSlug ? role : null, is_master: isMaster === 1 },
  }, 201);
}
