/**
 * Cloudflare Workers - D1 Database Operations
 * ใช้ในการจัดการ D1 Database จากฝั่ง Worker
 */

// Example: Load pending transactions
export async function loadPendingTransactions(env, tenantId) {
  const stmt = env.DB.prepare(`
    SELECT * FROM pending_transactions 
    WHERE tenantId = ? 
    ORDER BY createdAt DESC
    LIMIT 100
  `);
  
  const result = await stmt.bind(tenantId).all();
  return result.results;
}

// Example: Create pending transaction
export async function createPendingTransaction(env, data) {
  const id = crypto.randomUUID();
  const now = Date.now();
  
  const stmt = env.DB.prepare(`
    INSERT INTO pending_transactions 
    (id, tenantId, amount, senderName, senderAccount, slipRef, slipData, userId, userCategory, status, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  await stmt.bind(
    id,
    data.tenantId,
    data.amount,
    data.senderName,
    data.senderAccount,
    data.slipRef,
    JSON.stringify(data.slipData),
    data.userId || null,
    data.userCategory || null,
    data.status || 'pending',
    now,
    now
  ).run();
  
  return { id, ...data, createdAt: now, updatedAt: now };
}

// Example: Update pending status
export async function updatePendingStatus(env, id, status, userId = null, userCategory = null) {
  const now = Date.now();
  
  const stmt = env.DB.prepare(`
    UPDATE pending_transactions 
    SET status = ?, userId = ?, userCategory = ?, updatedAt = ?
    WHERE id = ?
  `);
  
  await stmt.bind(status, userId, userCategory, now, id).run();
  return true;
}

// Example: Delete pending transaction
export async function deletePendingTransaction(env, id) {
  const stmt = env.DB.prepare(`
    DELETE FROM pending_transactions 
    WHERE id = ?
  `);
  
  await stmt.bind(id).run();
  return true;
}

// Example: Check duplicate slip
export async function checkDuplicateSlip(env, slipRef) {
  const stmt = env.DB.prepare(`
    SELECT id FROM pending_transactions 
    WHERE slipRef = ?
    LIMIT 1
  `);
  
  const result = await stmt.bind(slipRef).first();
  return result !== null;
}

// Example: Cleanup old pending (midnight job)
export async function cleanupOldPending(env, olderThan) {
  const stmt = env.DB.prepare(`
    DELETE FROM pending_transactions 
    WHERE createdAt < ?
  `);
  
  await stmt.bind(olderThan).run();
  return true;
}

// Example: Load tenant settings
export async function loadTenantSettings(env, tenantId) {
  const stmt = env.DB.prepare(`
    SELECT * FROM tenant_settings 
    WHERE tenantId = ?
  `);
  
  const result = await stmt.bind(tenantId).first();
  return result;
}

// Example: Save tenant settings
export async function saveTenantSettings(env, data) {
  const now = Date.now();
  
  const stmt = env.DB.prepare(`
    INSERT INTO tenant_settings 
    (id, tenantId, name, lineChannelId, lineChannelSecret, lineAccessToken, easyslipKey, apiBaseUrl, sessionMode, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenantId) DO UPDATE SET
      name = excluded.name,
      lineChannelId = excluded.lineChannelId,
      lineChannelSecret = excluded.lineChannelSecret,
      lineAccessToken = excluded.lineAccessToken,
      easyslipKey = excluded.easyslipKey,
      apiBaseUrl = excluded.apiBaseUrl,
      sessionMode = excluded.sessionMode,
      updatedAt = excluded.updatedAt
  `);
  
  const id = data.id || crypto.randomUUID();
  
  await stmt.bind(
    id,
    data.tenantId,
    data.name,
    data.lineChannelId,
    data.lineChannelSecret,
    data.lineAccessToken,
    data.easyslipKey,
    data.apiBaseUrl,
    data.sessionMode,
    now,
    now
  ).run();
  
  return { id, ...data };
}

// Example: Load message templates
export async function loadMessageTemplates(env, tenantId) {
  const stmt = env.DB.prepare(`
    SELECT * FROM message_templates 
    WHERE tenantId = ?
  `);
  
  const result = await stmt.bind(tenantId).all();
  
  // Transform to object
  const templates = {};
  result.results.forEach(row => {
    templates[row.messageType] = {
      enabled: row.enabled === 1,
      template: row.template
    };
  });
  
  return templates;
}

// Example: Save message template
export async function saveMessageTemplate(env, tenantId, messageType, enabled, template) {
  const now = Date.now();
  
  const stmt = env.DB.prepare(`
    INSERT INTO message_templates 
    (id, tenantId, messageType, enabled, template, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenantId, messageType) DO UPDATE SET
      enabled = excluded.enabled,
      template = excluded.template,
      updatedAt = excluded.updatedAt
  `);
  
  const id = crypto.randomUUID();
  
  await stmt.bind(
    id,
    tenantId,
    messageType,
    enabled ? 1 : 0,
    template,
    now,
    now
  ).run();
  
  return true;
}
