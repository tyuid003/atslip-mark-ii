import type { Env } from '../types';
import { generateId, currentTimestamp } from '../utils/helpers';

// ============================================================
// CREATE LINE OA
// ============================================================

export async function createLineOA(
  env: Env,
  data: {
    tenant_id: string;
    name: string;
    channel_id: string;
    channel_secret: string;
    channel_access_token: string;
  }
) {
  const id = generateId();
  const now = currentTimestamp();

  await env.DB.prepare(
    `INSERT INTO line_oas (
      id, tenant_id, name, channel_id, channel_secret,
      channel_access_token, webhook_enabled, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      data.tenant_id,
      data.name,
      data.channel_id,
      data.channel_secret,
      data.channel_access_token,
      1,
      'active',
      now,
      now
    )
    .run();

  return await getLineOAById(env, id);
}

// ============================================================
// GET LINE OA BY ID
// ============================================================

export async function getLineOAById(env: Env, id: string) {
  const result = await env.DB.prepare(
    `SELECT * FROM line_oas WHERE id = ?`
  )
    .bind(id)
    .first();

  return result;
}

// ============================================================
// GET LINE OAS BY TENANT
// ============================================================

export async function getLineOAsByTenant(env: Env, tenantId: string) {
  const results = await env.DB.prepare(
    `SELECT * FROM line_oas WHERE tenant_id = ? ORDER BY created_at DESC`
  )
    .bind(tenantId)
    .all();

  return results.results || [];
}

// ============================================================
// UPDATE LINE OA
// ============================================================

export async function updateLineOA(
  env: Env,
  id: string,
  updates: {
    name?: string;
    channel_id?: string;
    channel_secret?: string;
    channel_access_token?: string;
    webhook_enabled?: number;
    status?: string;
  }
) {
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.name !== undefined) {
    fields.push('name = ?');
    values.push(updates.name);
  }
  if (updates.channel_id !== undefined) {
    fields.push('channel_id = ?');
    values.push(updates.channel_id);
  }
  if (updates.channel_secret !== undefined) {
    fields.push('channel_secret = ?');
    values.push(updates.channel_secret);
  }
  if (updates.channel_access_token !== undefined) {
    fields.push('channel_access_token = ?');
    values.push(updates.channel_access_token);
  }
  if (updates.webhook_enabled !== undefined) {
    fields.push('webhook_enabled = ?');
    values.push(updates.webhook_enabled);
  }
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }

  fields.push('updated_at = ?');
  values.push(currentTimestamp());

  values.push(id);

  await env.DB.prepare(
    `UPDATE line_oas SET ${fields.join(', ')} WHERE id = ?`
  )
    .bind(...values)
    .run();

  return await getLineOAById(env, id);
}

// ============================================================
// DELETE LINE OA
// ============================================================

export async function deleteLineOA(env: Env, id: string) {
  await env.DB.prepare(`DELETE FROM line_oas WHERE id = ?`).bind(id).run();
  return { success: true };
}

// ============================================================
// GET LINE OA BY CHANNEL ID (for webhook routing)
// ============================================================

export async function getLineOAByChannelId(env: Env, channelId: string) {
  const result = await env.DB.prepare(
    `SELECT * FROM line_oas WHERE channel_id = ? AND status = 'active'`
  )
    .bind(channelId)
    .first();

  return result;
}
