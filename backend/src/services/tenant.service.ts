import type { Env, Tenant, TenantWithStats } from '../types';
import { generateId, currentTimestamp } from '../utils/helpers';

// ============================================================
// CREATE TENANT
// ============================================================

export async function createTenant(
  env: Env,
  teamSlug: string,
  data: {
    name: string;
    admin_api_url: string;
    admin_username: string;
    admin_password: string;
    easyslip_token: string;
  }
) {
  // หา team_id จาก slug
  const teamResult = await env.DB.prepare(
    `SELECT id FROM teams WHERE slug = ? LIMIT 1`
  )
    .bind(teamSlug)
    .first();

  if (!teamResult) {
    throw new Error(`Team with slug '${teamSlug}' not found`);
  }

  const teamId = teamResult.id;
  const id = generateId();
  const now = currentTimestamp();

  await env.DB.prepare(
    `INSERT INTO tenants (
      id, team_id, name, admin_api_url, admin_username, admin_password,
      easyslip_token, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      teamId,
      data.name,
      data.admin_api_url,
      data.admin_username,
      data.admin_password,
      data.easyslip_token,
      'active',
      now,
      now
    )
    .run();

  return await getTenantById(env, id);
}

// ============================================================
// GET TENANT BY ID
// ============================================================

export async function getTenantById(env: Env, id: string): Promise<TenantWithStats | null> {
  const result = await env.DB.prepare(
    `SELECT 
      t.id, t.team_id, t.name, t.admin_api_url,
      t.auto_deposit_enabled, t.status, t.created_at, t.updated_at,
      t.admin_username, t.admin_password, t.easyslip_token,
      COUNT(DISTINCT lo.id) as line_oa_count,
      COUNT(DISTINCT CASE WHEN pt.status = 'pending' THEN pt.id END) as pending_count
    FROM tenants t
    LEFT JOIN line_oas lo ON lo.tenant_id = t.id
    LEFT JOIN pending_transactions pt ON pt.tenant_id = t.id
    WHERE t.id = ?
    GROUP BY t.id`
  )
    .bind(id)
    .first() as any;

  if (!result) {
    return null;
  }

  // เช็คว่ามีบัญชีธนาคารใน KV หรือไม่ (สถานะเชื่อมต่อ)
  const bankKey = `tenant:${id}:banks`;
  const bankData = await env.BANK_KV.get(bankKey);
  const bank_account_count = bankData ? JSON.parse(bankData).accounts.length : 0;

  // สถานะเชื่อมต่อ admin ขึ้นอยู่กับการมีบัญชีธนาคาร (ไม่ใช่ session อีกต่อไป)
  const admin_connected = bank_account_count > 0;

  return {
    ...(result as Tenant),
    line_oa_count: result.line_oa_count || 0,
    bank_account_count,
    pending_count: result.pending_count || 0,
    admin_connected,
  };
}

// ============================================================
// GET ALL TENANTS
// ============================================================

export async function getAllTenants(env: Env, teamSlug: string = 'default') {
  // หา team_id จาก slug
  const teamResult = await env.DB.prepare(
    `SELECT id FROM teams WHERE slug = ? LIMIT 1`
  )
    .bind(teamSlug)
    .first();

  if (!teamResult) {
    return []; // ถ้าไม่เจอ team ให้คืน array ว่าง
  }

  const teamId = teamResult.id;

  const results = await env.DB.prepare(
    `SELECT 
      t.id, t.team_id, t.name, t.admin_api_url,
      t.auto_deposit_enabled, t.status, t.created_at, t.updated_at,
      t.admin_username, t.admin_password,
      COUNT(DISTINCT CASE WHEN lo.status = 'active' THEN lo.id END) as line_oa_count,
      COUNT(DISTINCT CASE WHEN pt.status = 'pending' THEN pt.id END) as pending_count
    FROM tenants t
    LEFT JOIN line_oas lo ON lo.tenant_id = t.id
    LEFT JOIN pending_transactions pt ON pt.tenant_id = t.id
    WHERE t.team_id = ?
    GROUP BY t.id
    ORDER BY t.created_at DESC`
  )
    .bind(teamId)
    .all();

  const tenants = [];

  for (const tenant of results.results || []) {
    const bankKey = `tenant:${tenant.id}:banks`;
    const bankData = await env.BANK_KV.get(bankKey);
    const bank_account_count = bankData ? JSON.parse(bankData).accounts.length : 0;

    // สถานะเชื่อมต่อขึ้่นอยู่กับการมีบัญชีธนาคาร
    const admin_connected = bank_account_count > 0;

    tenants.push({
      ...tenant,
      bank_account_count,
      admin_connected,
    });
  }

  return tenants;
}

// ============================================================
// UPDATE TENANT
// ============================================================

export async function updateTenant(
  env: Env,
  id: string,
  updates: {
    name?: string;
    admin_api_url?: string;
    admin_username?: string;
    admin_password?: string;
    easyslip_token?: string;
    status?: string;
  }
) {
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.name) {
    fields.push('name = ?');
    values.push(updates.name);
  }
  if (updates.admin_api_url) {
    fields.push('admin_api_url = ?');
    values.push(updates.admin_api_url);
  }
  if (updates.admin_username) {
    fields.push('admin_username = ?');
    values.push(updates.admin_username);
  }
  if (updates.admin_password) {
    fields.push('admin_password = ?');
    values.push(updates.admin_password);
  }
  if (updates.easyslip_token) {
    fields.push('easyslip_token = ?');
    values.push(updates.easyslip_token);
  }
  if (updates.status) {
    fields.push('status = ?');
    values.push(updates.status);
  }

  fields.push('updated_at = ?');
  values.push(currentTimestamp());

  values.push(id);

  await env.DB.prepare(
    `UPDATE tenants SET ${fields.join(', ')} WHERE id = ?`
  )
    .bind(...values)
    .run();

  return await getTenantById(env, id);
}

// ============================================================
// DELETE TENANT
// ============================================================

export async function deleteTenant(env: Env, id: string) {
  // ลบ admin session
  await env.DB.prepare(`DELETE FROM admin_sessions WHERE tenant_id = ?`)
    .bind(id)
    .run();

  // ลบบัญชีธนาคารจาก KV
  const bankKey = `tenant:${id}:banks`;
  await env.BANK_KV.delete(bankKey);

  // ลบ tenant (LINE OAs และ transactions จะถูกลบอัตโนมัติด้วย CASCADE)
  await env.DB.prepare(`DELETE FROM tenants WHERE id = ?`).bind(id).run();

  return { success: true };
}

// ============================================================
// CONNECT ADMIN (Login and Cache Bank Accounts)
// ============================================================

export async function connectAdmin(
  env: Env,
  tenantId: string
): Promise<{ success: boolean; accounts?: any[]; error?: string }> {
  const tenant = await getTenantById(env, tenantId);

  if (!tenant) {
    return { success: false, error: 'Tenant not found' };
  }

  try {
    // 1. Login to Admin Backend
    const loginResponse = await fetch(`${tenant.admin_api_url}/api/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: tenant.admin_username,
        password: tenant.admin_password,
      }),
    });

    if (!loginResponse.ok) {
      return { success: false, error: 'Failed to login to admin backend' };
    }

    const loginData = await loginResponse.json();
    const sessionToken = loginData.token || loginData.access_token;

    if (!sessionToken) {
      return { success: false, error: 'No session token received' };
    }

    // 2. ดึงรายชื่อบัญชีธนาคาร
    const accountsResponse = await fetch(
      `${tenant.admin_api_url}/api/bank-accounts`,
      {
        headers: {
          Authorization: `Bearer ${sessionToken}`,
        },
      }
    );

    if (!accountsResponse.ok) {
      return { success: false, error: 'Failed to fetch bank accounts' };
    }

    const accountsData = await accountsResponse.json();
    const accounts = accountsData.data || accountsData.accounts || [];

    // 3. บันทึก session ลง D1
    const sessionId = generateId();
    const now = currentTimestamp();
    const expiresAt = now + 24 * 60 * 60; // 24 ชั่วโมง

    await env.DB.prepare(
      `INSERT INTO admin_sessions (id, tenant_id, session_token, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         session_token = excluded.session_token,
         expires_at = excluded.expires_at`
    )
      .bind(sessionId, tenantId, sessionToken, expiresAt, now)
      .run();

    // 4. บันทึกบัญชีธนาคารลง KV
    const bankKey = `tenant:${tenantId}:banks`;
    const bankCache = {
      tenant_id: tenantId,
      accounts: accounts,
      cached_at: now,
      expires_at: expiresAt,
    };

    await env.BANK_KV.put(bankKey, JSON.stringify(bankCache), {
      expirationTtl: 24 * 60 * 60,
    });

    return { success: true, accounts };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Connection failed',
    };
  }
}

// ============================================================
// GET BANK ACCOUNTS
// ============================================================

export async function getBankAccounts(env: Env, tenantId: string) {
  const bankKey = `tenant:${tenantId}:banks`;
  const bankData = await env.BANK_KV.get(bankKey);

  if (!bankData) {
    return null;
  }

  const cache = JSON.parse(bankData);

  // KV จะลบข้อมูลให้เองเมื่อ expirationTtl หมดอายุ
  // ไม่ต้องเช็ค expires_at เอง
  return cache; // คืนทั้ง object { accounts, total, updated_at }
}

// ============================================================
// DISCONNECT ADMIN
// ============================================================

export async function disconnectAdmin(env: Env, tenantId: string) {
  // ลบ session
  await env.DB.prepare(`DELETE FROM admin_sessions WHERE tenant_id = ?`)
    .bind(tenantId)
    .run();

  // ลบ bank accounts cache
  const bankKey = `tenant:${tenantId}:banks`;
  await env.BANK_KV.delete(bankKey);

  return { success: true };
}
