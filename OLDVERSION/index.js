var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/tenant-repository.ts
async function upsertTenant(env, settings) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await env.DB.prepare(`
    INSERT INTO tenants (
      tenant_id, tenant_name, api_base_url, admin_username,
      line_channel_id, line_channel_secret, line_access_token,
      session_mode, account_list_ttl_min, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id) DO UPDATE SET
      tenant_name = excluded.tenant_name,
      api_base_url = excluded.api_base_url,
      admin_username = excluded.admin_username,
      line_channel_id = excluded.line_channel_id,
      line_channel_secret = excluded.line_channel_secret,
      line_access_token = excluded.line_access_token,
      session_mode = excluded.session_mode,
      account_list_ttl_min = excluded.account_list_ttl_min,
      updated_at = excluded.updated_at
  `).bind(
    settings.tenantId,
    settings.tenantName,
    settings.apiBaseUrl,
    settings.adminUsername ?? null,
    settings.lineChannelId ?? null,
    settings.lineChannelSecret ?? null,
    settings.lineAccessToken ?? null,
    settings.sessionMode,
    settings.accountListTtl,
    now,
    now
  ).run();
}
__name(upsertTenant, "upsertTenant");
async function getTenant(env, tenantId) {
  const result = await env.DB.prepare(`
    SELECT 
      t.tenant_id, t.tenant_name, t.api_base_url, t.admin_username, 
      t.line_channel_id, t.line_channel_secret, 
      t.line_access_token, t.session_mode, t.account_list_ttl_min,
      CASE 
        WHEN s.token IS NOT NULL AND s.status = 'ACTIVE' THEN 'connected'
        ELSE 'not_connected'
      END as admin_auth_status,
      CASE 
        WHEN e.token IS NOT NULL AND e.is_active = 1 THEN 'connected'
        ELSE 'not_connected'
      END as easyslip_status
    FROM tenants t
    LEFT JOIN tenant_sessions s ON t.tenant_id = s.tenant_id
    LEFT JOIN easyslip_configs e ON t.tenant_id = e.tenant_id
    WHERE t.tenant_id = ?
  `).bind(tenantId).first();
  if (!result) {
    return null;
  }
  return {
    tenantId: result.tenant_id,
    tenantName: result.tenant_name,
    apiBaseUrl: result.api_base_url,
    adminUsername: result.admin_username,
    lineChannelId: result.line_channel_id,
    lineChannelSecret: result.line_channel_secret,
    lineAccessToken: result.line_access_token,
    sessionMode: result.session_mode,
    accountListTtl: result.account_list_ttl_min,
    adminAuthStatus: result.admin_auth_status,
    easyslipStatus: result.easyslip_status
  };
}
__name(getTenant, "getTenant");
async function listTenants(env) {
  const results = await env.DB.prepare(`
    SELECT 
      t.tenant_id, t.tenant_name, t.api_base_url, t.admin_username, 
      t.line_channel_id, t.line_channel_secret, 
      t.line_access_token, t.session_mode, t.account_list_ttl_min,
      CASE 
        WHEN s.token IS NOT NULL AND s.status = 'ACTIVE' THEN 'connected'
        ELSE 'not_connected'
      END as admin_auth_status,
      CASE 
        WHEN e.token IS NOT NULL AND e.is_active = 1 THEN 'connected'
        ELSE 'not_connected'
      END as easyslip_status,
      COALESCE((SELECT COUNT(*) FROM line_oas WHERE tenant_id = t.tenant_id), 0) as line_oa_count
    FROM tenants t
    LEFT JOIN tenant_sessions s ON t.tenant_id = s.tenant_id
    LEFT JOIN easyslip_configs e ON t.tenant_id = e.tenant_id
    ORDER BY t.created_at DESC
  `).all();
  return (results.results || []).map((row) => ({
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    apiBaseUrl: row.api_base_url,
    adminUsername: row.admin_username,
    lineChannelId: row.line_channel_id,
    lineChannelSecret: row.line_channel_secret,
    lineAccessToken: row.line_access_token,
    lineChannelName: row.line_oa_count > 0 ? `${row.line_oa_count} LINE OA(s)` : void 0,
    sessionMode: row.session_mode,
    accountListTtl: row.account_list_ttl_min,
    adminAuthStatus: row.admin_auth_status,
    easyslipStatus: row.easyslip_status
  }));
}
__name(listTenants, "listTenants");
async function deleteTenant(env, tenantId) {
  await env.DB.prepare(`DELETE FROM tenant_sessions WHERE tenant_id = ?`).bind(tenantId).run();
  await env.DB.prepare(`DELETE FROM easyslip_configs WHERE tenant_id = ?`).bind(tenantId).run();
  await env.DB.prepare(`DELETE FROM tenants WHERE tenant_id = ?`).bind(tenantId).run();
  await env.SESSION_KV.delete(`tenant:${tenantId}:session`);
}
__name(deleteTenant, "deleteTenant");

// src/api/tenants.ts
async function handleTenantsRequest(request, env, pathname) {
  const method = request.method;
  if (method === "POST" && pathname === "/api/tenants") {
    return await createOrUpdateTenant(request, env);
  }
  const sessionMatch = pathname.match(/^\/api\/tenants\/([^/]+)\/session$/);
  if (method === "GET" && sessionMatch) {
    const tenantId = decodeURIComponent(sessionMatch[1]);
    return await getTenantSession(tenantId, env);
  }
  const refreshMatch = pathname.match(/^\/api\/tenants\/([^/]+)\/accounts\/refresh$/);
  if (method === "POST" && refreshMatch) {
    const tenantId = decodeURIComponent(refreshMatch[1]);
    return await refreshTenantAccounts(tenantId, env);
  }
  const accountsMatch = pathname.match(/^\/api\/tenants\/([^/]+)\/accounts$/);
  if (method === "GET" && accountsMatch) {
    const tenantId = decodeURIComponent(accountsMatch[1]);
    return await getTenantAccounts(tenantId, env);
  }
  const getByIdMatch = pathname.match(/^\/api\/tenants\/([^/]+)$/);
  if (method === "GET" && getByIdMatch) {
    const tenantId = decodeURIComponent(getByIdMatch[1]);
    return await getTenantById(tenantId, env);
  }
  const deleteMatch = pathname.match(/^\/api\/tenants\/([^/]+)$/);
  if (method === "DELETE" && deleteMatch) {
    const tenantId = decodeURIComponent(deleteMatch[1]);
    return await deleteTenantById(tenantId, env);
  }
  if (method === "GET" && pathname === "/api/tenants") {
    return await getAllTenants(env);
  }
  return new Response(
    JSON.stringify({
      error: "Not Found",
      message: `No handler for ${method} ${pathname}`
    }),
    { status: 404, headers: { "Content-Type": "application/json" } }
  );
}
__name(handleTenantsRequest, "handleTenantsRequest");
async function createOrUpdateTenant(request, env) {
  try {
    const body = await request.json();
    if (!body.tenantId || !body.tenantName || !body.apiBaseUrl) {
      return new Response(
        JSON.stringify({
          error: "Validation Error",
          message: "Missing required fields: tenantId, tenantName, apiBaseUrl"
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    const settings = {
      tenantId: body.tenantId,
      tenantName: body.tenantName,
      apiBaseUrl: body.apiBaseUrl,
      adminUsername: body.adminUsername,
      lineChannelId: body.lineChannelId,
      lineChannelSecret: body.lineChannelSecret,
      lineAccessToken: body.lineAccessToken,
      sessionMode: body.sessionMode || "kv",
      accountListTtl: body.accountListTtl || 5
    };
    await upsertTenant(env, settings);
    return new Response(
      JSON.stringify({
        success: true,
        tenant: settings
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in createOrUpdateTenant:", error);
    return new Response(
      JSON.stringify({
        error: "Internal Server Error",
        message: error instanceof Error ? error.message : "Unknown error"
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
__name(createOrUpdateTenant, "createOrUpdateTenant");
async function getTenantById(tenantId, env) {
  try {
    const tenant = await getTenant(env, tenantId);
    if (!tenant) {
      return new Response(
        JSON.stringify({
          error: "Not Found",
          message: `Tenant ${tenantId} does not exist`
        }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(JSON.stringify(tenant), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    console.error("Error in getTenantById:", error);
    return new Response(
      JSON.stringify({
        error: "Internal Server Error",
        message: error instanceof Error ? error.message : "Unknown error"
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
__name(getTenantById, "getTenantById");
async function getAllTenants(env) {
  try {
    const tenants = await listTenants(env);
    return new Response(JSON.stringify({ tenants, total: tenants.length }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  } catch (error) {
    console.error("Error in getAllTenants:", error);
    return new Response(
      JSON.stringify({
        error: "Internal Server Error",
        message: error instanceof Error ? error.message : "Unknown error"
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      }
    );
  }
}
__name(getAllTenants, "getAllTenants");
async function deleteTenantById(tenantId, env) {
  try {
    const tenant = await getTenant(env, tenantId);
    if (!tenant) {
      return new Response(
        JSON.stringify({
          error: "Not Found",
          message: `Tenant ${tenantId} does not exist`
        }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }
    await deleteTenant(env, tenantId);
    return new Response(
      JSON.stringify({
        success: true,
        message: `Tenant ${tenantId} deleted successfully`
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in deleteTenantById:", error);
    return new Response(
      JSON.stringify({
        error: "Internal Server Error",
        message: error instanceof Error ? error.message : "Unknown error"
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
__name(deleteTenantById, "deleteTenantById");
async function getTenantAccounts(tenantId, env) {
  try {
    const tenant = await getTenant(env, tenantId);
    if (!tenant) {
      return new Response(
        JSON.stringify({
          error: "Not Found",
          message: `Tenant ${tenantId} does not exist`
        }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }
    const cacheKey = `tenant:${tenantId}:accounts`;
    console.log(`Checking cache for key: ${cacheKey}`);
    const cached = await env.SESSION_KV.get(cacheKey);
    if (cached) {
      try {
        const cacheData = JSON.parse(cached);
        console.log(`Found cached accounts for tenant ${tenantId}: ${cacheData.accounts?.length || 0} accounts`);
        return new Response(
          JSON.stringify({
            success: true,
            accounts: cacheData.accounts || [],
            total: (cacheData.accounts || []).length,
            cached: true,
            cachedAt: cacheData.cachedAt
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      } catch (e) {
        console.warn("Invalid cache data, will fetch fresh:", e);
      }
    } else {
      console.log(`No cache found for ${cacheKey}, will fetch from API`);
    }
    const sessionResult = await env.DB.prepare(
      `SELECT token FROM tenant_sessions WHERE tenant_id = ? AND status = 'ACTIVE'`
    ).bind(tenantId).first();
    if (!sessionResult) {
      return new Response(
        JSON.stringify({
          error: "Authentication Failed",
          message: "\u0E44\u0E21\u0E48\u0E2A\u0E32\u0E21\u0E32\u0E23\u0E16\u0E40\u0E0A\u0E37\u0E48\u0E2D\u0E21\u0E15\u0E48\u0E2D\u0E01\u0E31\u0E1A\u0E23\u0E30\u0E1A\u0E1A\u0E44\u0E14\u0E49 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E40\u0E0A\u0E37\u0E48\u0E2D\u0E21\u0E15\u0E48\u0E2D Admin \u0E01\u0E48\u0E2D\u0E19"
        }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }
    const response = await fetch(
      `${tenant.apiBaseUrl}/api/summary-report/account-list`,
      {
        headers: {
          Authorization: `Bearer ${sessionResult.token}`
        }
      }
    );
    if (!response.ok) {
      return new Response(
        JSON.stringify({
          error: "API Error",
          message: `\u0E44\u0E21\u0E48\u0E2A\u0E32\u0E21\u0E32\u0E23\u0E16\u0E14\u0E36\u0E07\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E1A\u0E31\u0E0D\u0E0A\u0E35\u0E44\u0E14\u0E49 (${response.status})`
        }),
        { status: response.status, headers: { "Content-Type": "application/json" } }
      );
    }
    const data = await response.json();
    const accounts = Array.isArray(data) ? data : data.list || [];
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const cacheTtl = tenant.accountListTtl ? tenant.accountListTtl * 60 : 300;
    await env.SESSION_KV.put(
      cacheKey,
      JSON.stringify({
        accounts,
        cachedAt: now
      }),
      { expirationTtl: cacheTtl }
    );
    console.log(`Fetched and cached ${accounts.length} accounts for tenant ${tenantId}`);
    return new Response(
      JSON.stringify({
        success: true,
        accounts,
        total: accounts.length,
        cached: false
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in getTenantAccounts:", error);
    return new Response(
      JSON.stringify({
        error: "Internal Server Error",
        message: error instanceof Error ? error.message : "Unknown error"
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
__name(getTenantAccounts, "getTenantAccounts");
async function refreshTenantAccounts(tenantId, env) {
  try {
    const tenant = await getTenant(env, tenantId);
    if (!tenant) {
      return new Response(
        JSON.stringify({
          error: "Not Found",
          message: `Tenant ${tenantId} does not exist`
        }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }
    const sessionResult = await env.DB.prepare(
      `SELECT token FROM tenant_sessions WHERE tenant_id = ? AND status = 'ACTIVE'`
    ).bind(tenantId).first();
    if (!sessionResult) {
      return new Response(
        JSON.stringify({
          error: "Authentication Failed",
          message: "\u0E44\u0E21\u0E48\u0E2A\u0E32\u0E21\u0E32\u0E23\u0E16\u0E40\u0E0A\u0E37\u0E48\u0E2D\u0E21\u0E15\u0E48\u0E2D\u0E01\u0E31\u0E1A\u0E23\u0E30\u0E1A\u0E1A\u0E44\u0E14\u0E49 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E40\u0E0A\u0E37\u0E48\u0E2D\u0E21\u0E15\u0E48\u0E2D Admin \u0E01\u0E48\u0E2D\u0E19"
        }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }
    const apiUrl = `${tenant.apiBaseUrl}/api/summary-report/account-list`;
    console.log(`[refreshTenantAccounts] Calling API: ${apiUrl}`);
    console.log(`[refreshTenantAccounts] Using token: ${sessionResult.token.substring(0, 20)}...`);
    const response = await fetch(apiUrl, {
      headers: {
        Authorization: `Bearer ${sessionResult.token}`
      }
    });
    console.log(`[refreshTenantAccounts] API response status: ${response.status}`);
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[refreshTenantAccounts] API error response: ${errorText.substring(0, 200)}`);
      return new Response(
        JSON.stringify({
          error: "API Error",
          message: `\u0E44\u0E21\u0E48\u0E2A\u0E32\u0E21\u0E32\u0E23\u0E16\u0E14\u0E36\u0E07\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E1A\u0E31\u0E0D\u0E0A\u0E35\u0E44\u0E14\u0E49 (${response.status})`
        }),
        { status: response.status, headers: { "Content-Type": "application/json" } }
      );
    }
    const data = await response.json();
    console.log(`[refreshTenantAccounts] API response data:`, JSON.stringify(data).substring(0, 300));
    const accounts = Array.isArray(data) ? data : data.list || [];
    console.log(`[refreshTenantAccounts] Extracted ${accounts.length} accounts from response`);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const cacheTtl = tenant.accountListTtl ? tenant.accountListTtl * 60 : 300;
    const cacheKey = `tenant:${tenantId}:accounts`;
    await env.SESSION_KV.put(
      cacheKey,
      JSON.stringify({
        accounts,
        cachedAt: now
      }),
      { expirationTtl: cacheTtl }
    );
    console.log(`Force refreshed and cached ${accounts.length} accounts for tenant ${tenantId}`);
    return new Response(
      JSON.stringify({
        success: true,
        accounts,
        total: accounts.length,
        refreshed: true,
        cachedAt: now
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in refreshTenantAccounts:", error);
    return new Response(
      JSON.stringify({
        error: "Internal Server Error",
        message: error instanceof Error ? error.message : "Unknown error"
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
__name(refreshTenantAccounts, "refreshTenantAccounts");
async function getTenantSession(tenantId, env) {
  try {
    console.log(`[getTenantSession] Getting session for tenant: ${tenantId}`);
    const sessionResult = await env.DB.prepare(
      `SELECT token, refresh_token, status, last_validated_at 
       FROM tenant_sessions 
       WHERE tenant_id = ? AND status = 'ACTIVE'`
    ).bind(tenantId).first();
    console.log(`[getTenantSession] Session found:`, sessionResult ? "YES" : "NO");
    if (!sessionResult || !sessionResult.token) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "No active session found. Please login as admin first."
        }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(
      JSON.stringify({
        success: true,
        token: sessionResult.token,
        refreshToken: sessionResult.refresh_token,
        status: sessionResult.status,
        lastValidated: sessionResult.last_validated_at
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[getTenantSession] Error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: "Internal Server Error",
        message: error instanceof Error ? error.message : "Unknown error"
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
__name(getTenantSession, "getTenantSession");

// src/api/admin-login.ts
async function handleAdminLogin(request, env, tenantId) {
  try {
    const body = await request.json();
    if (!body.username || !body.password || !body.captchaId || !body.captchaCode) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Missing required fields"
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    const loginUrl = `${body.apiBaseUrl}/api/login`;
    const loginResponse = await fetch(loginUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        captchaId: body.captchaId,
        captchaValue: body.captchaCode,
        username: body.username,
        password: body.password
      })
    });
    if (!loginResponse.ok) {
      let errorMessage = `Login failed: ${loginResponse.status} ${loginResponse.statusText}`;
      try {
        const errorData = await loginResponse.clone().json();
        errorMessage = errorData.message || errorMessage;
      } catch (e) {
        try {
          const text = await loginResponse.text();
          errorMessage = text || errorMessage;
        } catch (te) {
        }
      }
      return new Response(
        JSON.stringify({
          success: false,
          message: `${errorMessage} (URL: ${loginUrl})`,
          statusCode: loginResponse.status
        }),
        { status: loginResponse.status, headers: { "Content-Type": "application/json" } }
      );
    }
    let loginData;
    try {
      loginData = await loginResponse.json();
    } catch (e) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Invalid JSON response from login endpoint"
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
    const token = loginData.data?.token || loginData.token;
    if (!token) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "No token returned from login"
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
    const meUrl = `${body.apiBaseUrl}/api/admins/me`;
    const meResponse = await fetch(meUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    if (!meResponse.ok) {
      let errorDetail = `${meResponse.status} ${meResponse.statusText}`;
      try {
        const errorData = await meResponse.clone().json();
        errorDetail = errorData.message || errorDetail;
      } catch (e) {
      }
      return new Response(
        JSON.stringify({
          success: false,
          message: `Token verification failed: ${errorDetail} (URL: ${meUrl})`
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
    let meData;
    try {
      meData = await meResponse.json();
    } catch (e) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Invalid JSON response from me endpoint"
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
    const username = meData.data?.username || body.username;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    await env.DB.prepare(`
      INSERT INTO tenant_sessions (
        tenant_id, token, refresh_token, token_expired_at, status, last_validated_at, updated_at
      ) VALUES (?, ?, NULL, NULL, 'ACTIVE', ?, ?)
      ON CONFLICT(tenant_id) DO UPDATE SET
        token = excluded.token,
        status = 'ACTIVE',
        last_validated_at = excluded.last_validated_at,
        updated_at = excluded.updated_at
    `).bind(tenantId, token, now, now).run();
    await env.SESSION_KV.put(
      `tenant:${tenantId}:session`,
      JSON.stringify({
        token,
        username,
        status: "ACTIVE",
        lastValidatedAt: now
      })
    );
    try {
      const accountListUrl = `${body.apiBaseUrl}/api/summary-report/account-list`;
      console.log(`Prefetching account list for tenant ${tenantId} from ${accountListUrl}`);
      console.log(`Using token: ${token.substring(0, 20)}...`);
      const accountResponse = await fetch(accountListUrl, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      console.log(`Prefetch response status: ${accountResponse.status}`);
      if (accountResponse.ok) {
        const accountData = await accountResponse.json();
        console.log(`Prefetch response data:`, JSON.stringify(accountData).substring(0, 300));
        const accounts = Array.isArray(accountData) ? accountData : accountData.list || [];
        console.log(`Prefetched ${accounts.length} accounts for tenant ${tenantId}`);
        const cacheTtl = 300;
        await env.SESSION_KV.put(
          `tenant:${tenantId}:accounts`,
          JSON.stringify({
            accounts,
            cachedAt: now
          }),
          { expirationTtl: cacheTtl }
        );
        console.log(`Successfully cached ${accounts.length} accounts for tenant ${tenantId}`);
      } else {
        console.warn(`Failed to prefetch accounts: ${accountResponse.status} ${accountResponse.statusText}`);
        const errorText = await accountResponse.text();
        console.warn(`Account prefetch error response: ${errorText.substring(0, 200)}`);
      }
    } catch (prefetchError) {
      console.error("Account list prefetch error:", prefetchError);
      if (prefetchError instanceof Error) {
        console.error("Prefetch error details:", prefetchError.message);
      }
    }
    return new Response(
      JSON.stringify({
        success: true,
        token,
        username,
        message: "Login successful"
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Admin login error:", error);
    let errorDetails = "Unknown error";
    if (error instanceof Error) {
      errorDetails = `${error.name}: ${error.message}`;
    } else if (typeof error === "string") {
      errorDetails = error;
    }
    return new Response(
      JSON.stringify({
        success: false,
        message: errorDetails
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
__name(handleAdminLogin, "handleAdminLogin");

// src/api/logout.ts
async function handleLogout(request, env, tenantId) {
  try {
    console.log(`[logout] Starting logout for tenant: ${tenantId}`);
    const sessionQuery = await env.DB.prepare(`
      SELECT 
        ts.token,
        t.api_base_url
      FROM tenant_sessions ts
      JOIN tenants t ON ts.tenant_id = t.tenant_id
      WHERE ts.tenant_id = ?
    `).bind(tenantId).first();
    if (!sessionQuery) {
      console.log(`[logout] No session found for tenant ${tenantId}`);
      return Response.json({
        success: false,
        message: "\u0E44\u0E21\u0E48\u0E1E\u0E1A session \u0E17\u0E35\u0E48\u0E15\u0E49\u0E2D\u0E07 logout"
      }, { status: 404 });
    }
    const token = sessionQuery.token;
    const apiBaseUrl = sessionQuery.api_base_url;
    try {
      console.log(`[logout] Calling logout API: ${apiBaseUrl}/th/wait-signout`);
      const logoutResponse = await fetch(`${apiBaseUrl}/th/wait-signout`, {
        method: "GET",
        headers: {
          "Cookie": `access-token=${token}`
        }
      });
      console.log(`[logout] Target system logout response: ${logoutResponse.status}`);
    } catch (error) {
      console.warn("[logout] Target system logout failed, continuing local cleanup:", error);
    }
    await env.DB.prepare("DELETE FROM tenant_sessions WHERE tenant_id = ?").bind(tenantId).run();
    console.log(`[logout] Deleted session from D1 for tenant ${tenantId}`);
    const sessionKey = `session:${tenantId}`;
    await env.SESSION_KV.delete(sessionKey);
    console.log(`[logout] Deleted KV session key: ${sessionKey}`);
    const accountsCacheKey = `tenant:${tenantId}:accounts`;
    await env.SESSION_KV.delete(accountsCacheKey);
    console.log(`[logout] Deleted KV accounts cache key: ${accountsCacheKey}`);
    console.log(`[logout] Successfully logged out tenant ${tenantId}`);
    return Response.json({
      success: true,
      message: "Logout \u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08",
      tenantId
    });
  } catch (error) {
    console.error("[logout] Error:", error);
    return Response.json({
      success: false,
      message: error.message || "Logout failed"
    }, { status: 500 });
  }
}
__name(handleLogout, "handleLogout");

// src/api/line-config.ts
async function saveLineConfig(env, tenantId, config) {
  try {
    await env.DB.prepare(`
      UPDATE tenants
      SET line_channel_id = ?,
          line_channel_secret = ?,
          line_access_token = ?,
          updated_at = ?
      WHERE tenant_id = ?
    `).bind(
      config.lineChannelId,
      config.lineChannelSecret,
      config.lineAccessToken,
      (/* @__PURE__ */ new Date()).toISOString(),
      tenantId
    ).run();
    return true;
  } catch (error) {
    console.error("Error saving LINE config:", error);
    return false;
  }
}
__name(saveLineConfig, "saveLineConfig");
async function getLineConfig(env, tenantId) {
  try {
    const result = await env.DB.prepare(`
      SELECT line_channel_id, line_channel_secret, line_access_token
      FROM tenants
      WHERE tenant_id = ?
      LIMIT 1
    `).bind(tenantId).first();
    if (!result || !result.line_channel_id) {
      return null;
    }
    return {
      lineChannelId: result.line_channel_id,
      lineChannelSecret: result.line_channel_secret,
      lineAccessToken: result.line_access_token
    };
  } catch (error) {
    console.error("Error getting LINE config:", error);
    return null;
  }
}
__name(getLineConfig, "getLineConfig");
async function handleLineConfig(request, env) {
  const url = new URL(request.url);
  const tenantId = url.searchParams.get("tenantId");
  if (!tenantId) {
    return Response.json({ success: false, message: "tenantId is required" }, { status: 400 });
  }
  if (request.method === "GET") {
    const config = await getLineConfig(env, tenantId);
    return Response.json({
      success: true,
      hasConfig: !!config,
      config: config ? {
        lineChannelId: config.lineChannelId,
        // Don't return secrets
        hasSecret: !!config.lineChannelSecret,
        hasToken: !!config.lineAccessToken
      } : null
    });
  }
  if (request.method === "POST") {
    try {
      const body = await request.json();
      if (!body.lineChannelId || !body.lineChannelSecret || !body.lineAccessToken) {
        return Response.json(
          { success: false, message: "All LINE OA fields are required" },
          { status: 400 }
        );
      }
      const saved = await saveLineConfig(env, tenantId, body);
      if (saved) {
        return Response.json({ success: true, message: "LINE OA config saved" });
      } else {
        return Response.json({ success: false, message: "Failed to save" }, { status: 500 });
      }
    } catch (error) {
      return Response.json({
        success: false,
        message: error instanceof Error ? error.message : "Unknown error"
      }, { status: 500 });
    }
  }
  if (request.method === "DELETE") {
    try {
      await env.DB.prepare(`
        UPDATE tenants
        SET line_channel_id = NULL,
            line_channel_secret = NULL,
            line_access_token = NULL,
            updated_at = ?
        WHERE tenant_id = ?
      `).bind((/* @__PURE__ */ new Date()).toISOString(), tenantId).run();
      return Response.json({ success: true, message: "LINE OA config cleared" });
    } catch (error) {
      return Response.json({
        success: false,
        message: error instanceof Error ? error.message : "Unknown error"
      }, { status: 500 });
    }
  }
  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
__name(handleLineConfig, "handleLineConfig");

// src/api/easyslip.ts
async function getEasySlipToken(env, tenantId) {
  try {
    if (tenantId) {
      const tenantResult = await env.DB.prepare(`
        SELECT token FROM easyslip_configs 
        WHERE tenant_id = ? AND is_active = TRUE
        LIMIT 1
      `).bind(tenantId).first();
      if (tenantResult?.token) {
        return tenantResult.token;
      }
    }
    const globalResult = await env.DB.prepare(`
      SELECT token FROM easyslip_configs 
      WHERE tenant_id IS NULL AND is_active = TRUE
      LIMIT 1
    `).first();
    return globalResult?.token || null;
  } catch (error) {
    console.error("Error getting EasySlip token:", error);
    return null;
  }
}
__name(getEasySlipToken, "getEasySlipToken");
async function saveEasySlipToken(env, token, tenantId) {
  try {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    await env.DB.prepare(`
      INSERT INTO easyslip_configs (tenant_id, token, is_active, created_at, updated_at)
      VALUES (?, ?, TRUE, ?, ?)
      ON CONFLICT(tenant_id) DO UPDATE SET
        token = excluded.token,
        is_active = TRUE,
        updated_at = excluded.updated_at
    `).bind(tenantId || null, token, now, now).run();
    return true;
  } catch (error) {
    console.error("Error saving EasySlip token:", error);
    return false;
  }
}
__name(saveEasySlipToken, "saveEasySlipToken");
async function handleEasySlipConfig(request, env) {
  const url = new URL(request.url);
  const tenantId = url.searchParams.get("tenantId");
  if (request.method === "GET") {
    const token = await getEasySlipToken(env, tenantId || void 0);
    return Response.json({
      success: true,
      hasToken: !!token,
      scope: tenantId ? "tenant" : "global"
    });
  }
  if (request.method === "POST") {
    try {
      const body = await request.json();
      if (!body.token) {
        return Response.json({ success: false, message: "Token is required" }, { status: 400 });
      }
      const saved = await saveEasySlipToken(env, body.token, body.tenantId || null);
      if (saved) {
        return Response.json({
          success: true,
          message: "Token saved",
          scope: body.tenantId ? "tenant" : "global"
        });
      } else {
        return Response.json({ success: false, message: "Failed to save" }, { status: 500 });
      }
    } catch (error) {
      return Response.json({
        success: false,
        message: error instanceof Error ? error.message : "Unknown error"
      }, { status: 500 });
    }
  }
  if (request.method === "DELETE") {
    try {
      await env.DB.prepare(`
        UPDATE easyslip_configs 
        SET is_active = FALSE, updated_at = ?
        WHERE tenant_id ${tenantId ? "= ?" : "IS NULL"}
      `).bind((/* @__PURE__ */ new Date()).toISOString(), ...tenantId ? [tenantId] : []).run();
      return Response.json({ success: true, message: "Token deleted" });
    } catch (error) {
      return Response.json({
        success: false,
        message: error instanceof Error ? error.message : "Unknown error"
      }, { status: 500 });
    }
  }
  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
__name(handleEasySlipConfig, "handleEasySlipConfig");

// src/api/message-settings.ts
async function initMessageSettingsTable(env) {
  try {
    try {
      const checkTable = await env.DB.prepare(`
        SELECT sql FROM sqlite_master WHERE type='table' AND name='message_settings'
      `).first();
      if (checkTable) {
        const checkColumn = await env.DB.prepare(`
          PRAGMA table_info(message_settings);
        `).all();
        const hasTenantId = checkColumn.results?.some((col) => col.name === "tenant_id");
        const hasDuplicateReply = checkColumn.results?.some((col) => col.name === "duplicate_reply_enabled");
        const hasGameUrl = checkColumn.results?.some((col) => col.name === "game_url");
        if (!hasTenantId || !hasDuplicateReply || !hasGameUrl) {
          console.log("[initMessageSettingsTable] Migrating old schema - dropping and recreating table");
          await env.DB.prepare(`DROP TABLE IF EXISTS message_settings`).run();
        }
      }
    } catch (checkError) {
      console.log("[initMessageSettingsTable] Check error (non-critical):", checkError);
    }
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS message_settings (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        image_reply_enabled INTEGER DEFAULT 1,
        image_reply_message TEXT DEFAULT '\u0E02\u0E2D\u0E1A\u0E04\u0E38\u0E13\u0E04\u0E48\u0E30 \u0E40\u0E23\u0E32\u0E44\u0E14\u0E49\u0E23\u0E31\u0E1A\u0E20\u0E32\u0E1E\u0E2A\u0E25\u0E34\u0E1B\u0E02\u0E2D\u0E07\u0E04\u0E38\u0E13\u0E41\u0E25\u0E49\u0E27
\u0E01\u0E33\u0E25\u0E31\u0E07\u0E15\u0E23\u0E27\u0E08\u0E2A\u0E2D\u0E1A\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E23\u0E2D\u0E2A\u0E31\u0E01\u0E04\u0E23\u0E39\u0E48\u0E19\u0E30\u0E04\u0E30 \u{1F64F}',
        duplicate_reply_enabled INTEGER DEFAULT 1,
        flex_message_enabled INTEGER DEFAULT 1,
        flex_logo_url TEXT DEFAULT '',
        game_url TEXT DEFAULT '',
        color_header_footer_bg TEXT DEFAULT '#000000',
        color_body_bg TEXT DEFAULT '#1A1A1A',
        color_primary TEXT DEFAULT '#D4AF37',
        color_success_text TEXT DEFAULT '#33FF33',
        color_value_text TEXT DEFAULT '#FFFFFF',
        color_separator TEXT DEFAULT '#333333',
        color_muted_text TEXT DEFAULT '#888888',
        updated_at TEXT NOT NULL,
        FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE,
        UNIQUE(tenant_id)
      )
    `).run();
    console.log("[initMessageSettingsTable] message_settings table ready");
  } catch (error) {
    console.error("[initMessageSettingsTable] Error:", error);
    if (error instanceof Error) {
      console.error("[initMessageSettingsTable] Error details:", error.message);
    }
  }
}
__name(initMessageSettingsTable, "initMessageSettingsTable");
async function getMessageSettings(env, tenantId) {
  try {
    console.log(`[getMessageSettings] Getting settings for tenant: ${tenantId}`);
    await initMessageSettingsTable(env);
    try {
      const tenantExists = await env.DB.prepare(`
        SELECT tenant_id FROM tenants WHERE tenant_id = ?
      `).bind(tenantId).first();
      if (!tenantExists) {
        console.error(`[getMessageSettings] Tenant not found: ${tenantId}`);
        throw new Error(`Tenant ${tenantId} does not exist`);
      }
    } catch (tenantError) {
      if (tenantError instanceof Error) {
        console.error(`[getMessageSettings] Error checking tenant:`, tenantError.message);
      }
    }
    const result = await env.DB.prepare(`
      SELECT * FROM message_settings WHERE tenant_id = ?
    `).bind(tenantId).first();
    if (!result) {
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const id = `msg-${tenantId}-${Date.now()}`;
      console.log(`[getMessageSettings] Creating default settings for tenant: ${tenantId}`);
      await env.DB.prepare(`
        INSERT INTO message_settings (id, tenant_id, updated_at) VALUES (?, ?, ?)
      `).bind(id, tenantId, now).run();
      return {
        id,
        tenantId,
        imageReplyEnabled: true,
        imageReplyMessage: "\u0E02\u0E2D\u0E1A\u0E04\u0E38\u0E13\u0E04\u0E48\u0E30 \u0E40\u0E23\u0E32\u0E44\u0E14\u0E49\u0E23\u0E31\u0E1A\u0E20\u0E32\u0E1E\u0E2A\u0E25\u0E34\u0E1B\u0E02\u0E2D\u0E07\u0E04\u0E38\u0E13\u0E41\u0E25\u0E49\u0E27\n\u0E01\u0E33\u0E25\u0E31\u0E07\u0E15\u0E23\u0E27\u0E08\u0E2A\u0E2D\u0E1A\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E23\u0E2D\u0E2A\u0E31\u0E01\u0E04\u0E23\u0E39\u0E48\u0E19\u0E30\u0E04\u0E30 \u{1F64F}",
        duplicateReplyEnabled: true,
        flexMessageEnabled: true,
        flexLogoUrl: "",
        gameUrl: "",
        colorHeaderFooterBg: "#000000",
        colorBodyBg: "#1A1A1A",
        colorPrimary: "#D4AF37",
        colorSuccessText: "#33FF33",
        colorValueText: "#FFFFFF",
        colorSeparator: "#333333",
        colorMutedText: "#888888",
        updatedAt: now
      };
    }
    return {
      id: result.id,
      tenantId: result.tenant_id,
      imageReplyEnabled: result.image_reply_enabled === 1,
      imageReplyMessage: result.image_reply_message || "",
      duplicateReplyEnabled: result.duplicate_reply_enabled === 1,
      flexMessageEnabled: result.flex_message_enabled === 1,
      flexLogoUrl: result.flex_logo_url || "",
      gameUrl: result.game_url || "",
      colorHeaderFooterBg: result.color_header_footer_bg || "#000000",
      colorBodyBg: result.color_body_bg || "#1A1A1A",
      colorPrimary: result.color_primary || "#D4AF37",
      colorSuccessText: result.color_success_text || "#33FF33",
      colorValueText: result.color_value_text || "#FFFFFF",
      colorSeparator: result.color_separator || "#333333",
      colorMutedText: result.color_muted_text || "#888888",
      updatedAt: result.updated_at
    };
  } catch (error) {
    console.error("[getMessageSettings] Error getting settings for tenant", tenantId, ":", error);
    if (error instanceof Error) {
      console.error("Error message:", error.message);
      console.error("Error stack:", error.stack);
    }
    throw error;
  }
}
__name(getMessageSettings, "getMessageSettings");
async function updateMessageSettings(env, tenantId, settings) {
  try {
    console.log(`[updateMessageSettings] Updating settings for tenant: ${tenantId}`);
    await initMessageSettingsTable(env);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const existing = await env.DB.prepare(`
      SELECT id FROM message_settings WHERE tenant_id = ?
    `).bind(tenantId).first();
    console.log(`[updateMessageSettings] Existing record: ${existing ? existing.id : "none"}`);
    if (existing) {
      console.log(`[updateMessageSettings] Updating existing record for tenant: ${tenantId}`);
      const result = await env.DB.prepare(`
        UPDATE message_settings 
        SET image_reply_enabled = ?, 
            image_reply_message = ?,
            duplicate_reply_enabled = ?,
            flex_message_enabled = ?,
            flex_logo_url = ?,
            game_url = ?,
            color_header_footer_bg = ?,
            color_body_bg = ?,
            color_primary = ?,
            color_success_text = ?,
            color_value_text = ?,
            color_separator = ?,
            color_muted_text = ?,
            updated_at = ?
        WHERE tenant_id = ?
      `).bind(
        settings.imageReplyEnabled ? 1 : 0,
        settings.imageReplyMessage || "",
        settings.duplicateReplyEnabled ? 1 : 0,
        settings.flexMessageEnabled ? 1 : 0,
        settings.flexLogoUrl || "",
        settings.gameUrl || "",
        settings.colorHeaderFooterBg || "#000000",
        settings.colorBodyBg || "#1A1A1A",
        settings.colorPrimary || "#D4AF37",
        settings.colorSuccessText || "#33FF33",
        settings.colorValueText || "#FFFFFF",
        settings.colorSeparator || "#333333",
        settings.colorMutedText || "#888888",
        now,
        tenantId
      ).run();
      console.log(`[updateMessageSettings] Update result:`, result);
    } else {
      try {
        console.log(`[updateMessageSettings] Deleting orphaned records for tenant: ${tenantId}`);
        await env.DB.prepare(`
          DELETE FROM message_settings WHERE tenant_id = ? AND id NOT IN (
            SELECT id FROM message_settings WHERE tenant_id = ? LIMIT 1
          )
        `).bind(tenantId, tenantId).run();
      } catch (deleteError) {
        console.log(`[updateMessageSettings] Delete error (non-critical):`, deleteError);
      }
      const id = `msg-${tenantId}-${Date.now()}`;
      console.log(`[updateMessageSettings] Creating new record: ${id} for tenant: ${tenantId}`);
      const result = await env.DB.prepare(`
        INSERT INTO message_settings 
        (id, tenant_id, image_reply_enabled, image_reply_message, duplicate_reply_enabled, 
         flex_message_enabled, flex_logo_url, game_url, color_header_footer_bg, color_body_bg, color_primary, 
         color_success_text, color_value_text, color_separator, color_muted_text, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id,
        tenantId,
        settings.imageReplyEnabled ? 1 : 0,
        settings.imageReplyMessage || "",
        settings.duplicateReplyEnabled ? 1 : 0,
        settings.flexMessageEnabled ? 1 : 0,
        settings.flexLogoUrl || "",
        settings.gameUrl || "",
        settings.colorHeaderFooterBg || "#000000",
        settings.colorBodyBg || "#1A1A1A",
        settings.colorPrimary || "#D4AF37",
        settings.colorSuccessText || "#33FF33",
        settings.colorValueText || "#FFFFFF",
        settings.colorSeparator || "#333333",
        settings.colorMutedText || "#888888",
        now
      ).run();
      console.log(`[updateMessageSettings] Insert result:`, result);
    }
    console.log(`[updateMessageSettings] Successfully updated settings for tenant: ${tenantId}`);
    return true;
  } catch (error) {
    console.error("[updateMessageSettings] Error updating settings for tenant", tenantId, ":", error);
    if (error instanceof Error) {
      console.error("Error message:", error.message);
      console.error("Error stack:", error.stack);
    }
    return false;
  }
}
__name(updateMessageSettings, "updateMessageSettings");
async function updateImageReplySettings(env, settings) {
  try {
    await initMessageSettingsTable(env);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    await env.DB.prepare(`
      INSERT OR IGNORE INTO message_settings (id, tenant_id, updated_at) VALUES ('default', 'default', ?)
    `).bind(now).run();
    await env.DB.prepare(`
      UPDATE message_settings 
      SET image_reply_enabled = ?, 
          image_reply_message = ?,
          updated_at = ?
      WHERE tenant_id = 'default'
    `).bind(settings.enabled ? 1 : 0, settings.message, now).run();
    return true;
  } catch (error) {
    console.error("[updateImageReplySettings] Error:", error);
    return false;
  }
}
__name(updateImageReplySettings, "updateImageReplySettings");
async function updateFlexMessageSettings(env, settings) {
  try {
    await initMessageSettingsTable(env);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    await env.DB.prepare(`
      INSERT OR IGNORE INTO message_settings (id, tenant_id, updated_at) VALUES ('default', 'default', ?)
    `).bind(now).run();
    await env.DB.prepare(`
      UPDATE message_settings 
      SET flex_message_enabled = ?,
          flex_logo_url = ?,
          color_header_footer_bg = ?,
          color_body_bg = ?,
          color_primary = ?,
          color_success_text = ?,
          color_value_text = ?,
          color_separator = ?,
          color_muted_text = ?,
          updated_at = ?
      WHERE tenant_id = 'default'
    `).bind(
      settings.enabled ? 1 : 0,
      settings.logoUrl,
      settings.colors.headerFooterBg,
      settings.colors.bodyBg,
      settings.colors.primary,
      settings.colors.successText,
      settings.colors.valueText,
      settings.colors.separator,
      settings.colors.mutedText,
      now
    ).run();
    return true;
  } catch (error) {
    console.error("[updateFlexMessageSettings] Error:", error);
    return false;
  }
}
__name(updateFlexMessageSettings, "updateFlexMessageSettings");
async function handleMessageSettingsRequests(request, env, pathname) {
  const getTenantMatch = pathname.match(/^\/api\/message-settings\/([^/]+)$/);
  if (request.method === "GET" && getTenantMatch) {
    try {
      const tenantId = decodeURIComponent(getTenantMatch[1]);
      const settings = await getMessageSettings(env, tenantId);
      return new Response(
        JSON.stringify(settings),
        {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        }
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error("[GET /api/message-settings] Error:", errorMsg, error);
      return new Response(JSON.stringify({ error: "Failed to get settings", detail: errorMsg }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }
  }
  const postTenantMatch = pathname.match(/^\/api\/message-settings\/([^/]+)$/);
  if (request.method === "POST" && postTenantMatch) {
    try {
      const tenantId = decodeURIComponent(postTenantMatch[1]);
      const body = await request.json();
      body.tenantId = tenantId;
      const success = await updateMessageSettings(env, tenantId, body);
      if (success) {
        return new Response(JSON.stringify({ success: true }), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        });
      } else {
        return new Response(JSON.stringify({ error: "Failed to update" }), {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error("[POST /api/message-settings] Error:", errorMsg, error);
      return new Response(JSON.stringify({ error: "Invalid request", detail: errorMsg }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }
  }
  if (request.method === "POST" && pathname === "/api/message-settings/image-reply") {
    try {
      const body = await request.json();
      const success = await updateImageReplySettings(env, body);
      if (success) {
        return new Response(JSON.stringify({ success: true }), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        });
      } else {
        return new Response(JSON.stringify({ error: "Failed to update" }), {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        });
      }
    } catch (error) {
      return new Response(JSON.stringify({ error: "Invalid request" }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }
  }
  if (request.method === "POST" && pathname === "/api/message-settings/flex-message") {
    try {
      const body = await request.json();
      const success = await updateFlexMessageSettings(env, body);
      if (success) {
        return new Response(JSON.stringify({ success: true }), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        });
      } else {
        return new Response(JSON.stringify({ error: "Failed to update" }), {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        });
      }
    } catch (error) {
      return new Response(JSON.stringify({ error: "Invalid request" }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }
  }
  if (request.method === "POST" && pathname === "/api/message-settings/image-reply") {
    try {
      const body = await request.json();
      const success = await updateImageReplySettings(env, body);
      if (success) {
        return new Response(JSON.stringify({ success: true }), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        });
      } else {
        return new Response(JSON.stringify({ error: "Failed to update" }), {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        });
      }
    } catch (error) {
      return new Response(JSON.stringify({ error: "Invalid request" }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }
  }
  if (request.method === "POST" && pathname === "/api/message-settings/flex-message") {
    try {
      const body = await request.json();
      const success = await updateFlexMessageSettings(env, body);
      if (success) {
        return new Response(JSON.stringify({ success: true }), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        });
      } else {
        return new Response(JSON.stringify({ error: "Failed to update" }), {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        });
      }
    } catch (error) {
      return new Response(JSON.stringify({ error: "Invalid request" }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }
  }
  return null;
}
__name(handleMessageSettingsRequests, "handleMessageSettingsRequests");

// src/api/line-oa.ts
async function initLineOaTable(env) {
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS line_oas (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        name TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        channel_secret TEXT NOT NULL,
        access_token TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
      )
    `).run();
    console.log("[initLineOaTable] line_oas table ready");
  } catch (error) {
    console.error("[initLineOaTable] Error:", error);
  }
}
__name(initLineOaTable, "initLineOaTable");
async function getLineOas(env, tenantId) {
  try {
    const results = await env.DB.prepare(`
      SELECT id, tenant_id, name, channel_id, channel_secret, access_token, created_at
      FROM line_oas
      WHERE tenant_id = ?
      ORDER BY created_at ASC
    `).bind(tenantId).all();
    return (results.results || []).map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      name: row.name,
      channelId: row.channel_id,
      channelSecret: row.channel_secret,
      accessToken: row.access_token,
      createdAt: row.created_at
    }));
  } catch (error) {
    console.error("[getLineOas] Error:", error);
    return [];
  }
}
__name(getLineOas, "getLineOas");
async function createLineOa(env, lineOa) {
  try {
    const id = `lineoa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    await env.DB.prepare(`
      INSERT INTO line_oas (id, tenant_id, name, channel_id, channel_secret, access_token, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      lineOa.tenantId,
      lineOa.name,
      lineOa.channelId,
      lineOa.channelSecret,
      lineOa.accessToken,
      now
    ).run();
    return { success: true, id };
  } catch (error) {
    console.error("[createLineOa] Error:", error);
    return { success: false };
  }
}
__name(createLineOa, "createLineOa");
async function updateLineOa(env, oaId, lineOa) {
  try {
    await env.DB.prepare(`
      UPDATE line_oas
      SET name = ?, channel_id = ?, channel_secret = ?, access_token = ?
      WHERE id = ?
    `).bind(
      lineOa.name,
      lineOa.channelId,
      lineOa.channelSecret,
      lineOa.accessToken,
      oaId
    ).run();
    return { success: true };
  } catch (error) {
    console.error("[updateLineOa] Error:", error);
    return { success: false };
  }
}
__name(updateLineOa, "updateLineOa");
async function deleteLineOa(env, oaId) {
  try {
    await env.DB.prepare(`DELETE FROM line_oas WHERE id = ?`).bind(oaId).run();
    return { success: true };
  } catch (error) {
    console.error("[deleteLineOa] Error:", error);
    return { success: false };
  }
}
__name(deleteLineOa, "deleteLineOa");
async function handleLineOaRequests(request, env, pathname) {
  const getMatch = pathname.match(/^\/api\/tenants\/([^\/]+)\/line-oas$/);
  if (getMatch && request.method === "GET") {
    const tenantId = decodeURIComponent(getMatch[1]);
    const lineOas = await getLineOas(env, tenantId);
    return Response.json({ success: true, lineOas });
  }
  const postMatch = pathname.match(/^\/api\/tenants\/([^\/]+)\/line-oas$/);
  if (postMatch && request.method === "POST") {
    const tenantId = decodeURIComponent(postMatch[1]);
    const body = await request.json();
    body.tenantId = tenantId;
    const result = await createLineOa(env, body);
    if (result.success) {
      return Response.json({ success: true, id: result.id });
    } else {
      return Response.json(
        { success: false, message: "Failed to create LINE OA" },
        { status: 500 }
      );
    }
  }
  const putMatch = pathname.match(
    /^\/api\/tenants\/([^\/]+)\/line-oas\/([^\/]+)$/
  );
  if (putMatch && request.method === "PUT") {
    const oaId = decodeURIComponent(putMatch[2]);
    const body = await request.json();
    const result = await updateLineOa(env, oaId, body);
    if (result.success) {
      return Response.json({ success: true });
    } else {
      return Response.json(
        { success: false, message: "Failed to update LINE OA" },
        { status: 500 }
      );
    }
  }
  const deleteMatch = pathname.match(
    /^\/api\/tenants\/([^\/]+)\/line-oas\/([^\/]+)$/
  );
  if (deleteMatch && request.method === "DELETE") {
    const oaId = decodeURIComponent(deleteMatch[2]);
    const result = await deleteLineOa(env, oaId);
    if (result.success) {
      return Response.json({ success: true });
    } else {
      return Response.json(
        { success: false, message: "Failed to delete LINE OA" },
        { status: 500 }
      );
    }
  }
  return null;
}
__name(handleLineOaRequests, "handleLineOaRequests");

// src/api/pending-and-settings.ts
async function getPendingTransactions(env) {
  try {
    const results = await env.DB.prepare(`
      SELECT 
        pt.id, pt.tenant_id, t.tenant_name, pt.slip_data, pt.slip_ref, pt.user_data, pt.status, pt.amount,
        pt.sender_account, pt.sender_bank, pt.receiver_account,
        pt.created_at, pt.credited_at
      FROM pending_transactions pt
      LEFT JOIN tenants t ON pt.tenant_id = t.tenant_id
      WHERE pt.status IN ('pending', 'matched', 'credited', 'duplicate')
      ORDER BY pt.created_at DESC
      LIMIT 100
    `).all();
    return (results.results || []).map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      tenantName: row.tenant_name,
      slipData: JSON.parse(row.slip_data),
      slipRef: row.slip_ref,
      userData: row.user_data ? JSON.parse(row.user_data) : null,
      status: row.status,
      amount: row.amount,
      senderAccount: JSON.parse(row.slip_data).receiver?.account?.name?.th || JSON.parse(row.slip_data).receiver?.account?.name?.en || row.receiver_account,
      senderBank: row.sender_bank,
      receiverAccount: row.receiver_account,
      createdAt: row.created_at,
      creditedAt: row.credited_at
    }));
  } catch (error) {
    console.error("Error getting pending transactions:", error);
    return [];
  }
}
__name(getPendingTransactions, "getPendingTransactions");
async function createPendingTransaction(env, transaction) {
  try {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    if (transaction.slipRef) {
      const existing = await env.DB.prepare(`
        SELECT id, status FROM pending_transactions WHERE tenant_id = ? AND slip_ref = ? LIMIT 1
      `).bind(transaction.tenantId, transaction.slipRef).first();
      if (existing) {
        console.log(`[createPendingTransaction] Duplicate slip_ref detected: ${transaction.slipRef} (id: ${existing.id})`);
        return { success: true, id: existing.id };
      }
    }
    const result = await env.DB.prepare(`
      INSERT INTO pending_transactions (
        tenant_id, slip_data, slip_ref, user_data, status, amount,
        sender_account, sender_bank, receiver_account, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      transaction.tenantId,
      JSON.stringify(transaction.slipData),
      transaction.slipRef || null,
      transaction.userData ? JSON.stringify(transaction.userData) : null,
      transaction.status,
      transaction.amount || null,
      transaction.senderAccount || null,
      transaction.senderBank || null,
      transaction.receiverAccount || null,
      now
    ).run();
    return {
      success: true,
      id: result.meta.last_row_id
    };
  } catch (error) {
    console.error("Error creating pending transaction:", error);
    return { success: false };
  }
}
__name(createPendingTransaction, "createPendingTransaction");
async function deletePendingTransaction(env, id) {
  try {
    await env.DB.prepare(`DELETE FROM pending_transactions WHERE id = ?`).bind(id).run();
    return true;
  } catch (error) {
    console.error("Error deleting pending transaction:", error);
    return false;
  }
}
__name(deletePendingTransaction, "deletePendingTransaction");
async function updatePendingStatus(env, id, status, creditedAt) {
  try {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    await env.DB.prepare(`
      UPDATE pending_transactions 
      SET status = ?, credited_at = ?
      WHERE id = ?
    `).bind(status, creditedAt || (status === "credited" ? now : null), id).run();
    return true;
  } catch (error) {
    console.error("Error updating pending status:", error);
    return false;
  }
}
__name(updatePendingStatus, "updatePendingStatus");
async function cleanupOldPending(env) {
  try {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1e3).toISOString();
    const result = await env.DB.prepare(`
      DELETE FROM pending_transactions 
      WHERE created_at < ? AND status != 'credited'
    `).bind(oneDayAgo).run();
    return result.meta.changes || 0;
  } catch (error) {
    console.error("Error cleaning up old pending:", error);
    return 0;
  }
}
__name(cleanupOldPending, "cleanupOldPending");
async function handlePendingRequests(request, env, pathname) {
  if (pathname === "/api/scan/pending" && request.method === "GET") {
    const items = await getPendingTransactions(env);
    return Response.json({ success: true, items });
  }
  if (pathname === "/api/scan/pending" && request.method === "POST") {
    try {
      const body = await request.json();
      const transaction = {
        tenantId: body.tenantId,
        slipData: body.slipData,
        slipRef: body.slipRef || body.slipData?.transRef || null,
        userData: body.userData || null,
        status: body.status || (body.userData ? "matched" : "pending"),
        amount: body.slipData?.amount?.amount,
        senderAccount: body.slipData?.sender?.account?.value,
        senderBank: body.slipData?.sender?.account?.bank?.short,
        receiverAccount: body.slipData?.receiver?.account?.value
      };
      const result = await createPendingTransaction(env, transaction);
      if (result.success) {
        return Response.json({ success: true, id: result.id });
      } else {
        return Response.json(
          { success: false, message: "Failed to create" },
          { status: 500 }
        );
      }
    } catch (error) {
      return Response.json(
        {
          success: false,
          message: error instanceof Error ? error.message : "Unknown error"
        },
        { status: 500 }
      );
    }
  }
  const deleteMatch = pathname.match(/^\/api\/scan\/pending\/(\d+)$/);
  if (deleteMatch && request.method === "DELETE") {
    const id = parseInt(deleteMatch[1], 10);
    const success = await deletePendingTransaction(env, id);
    if (success) {
      return Response.json({ success: true });
    } else {
      return Response.json(
        { success: false, message: "Failed to delete" },
        { status: 500 }
      );
    }
  }
  const updateStatusMatch = pathname.match(/^\/api\/scan\/pending\/(\d+)\/status$/);
  if (updateStatusMatch && request.method === "PUT") {
    try {
      const id = parseInt(updateStatusMatch[1], 10);
      const body = await request.json();
      const success = await updatePendingStatus(
        env,
        id,
        body.status,
        body.status === "credited" || body.status === "duplicate" ? (/* @__PURE__ */ new Date()).toISOString() : void 0
      );
      if (success) {
        return Response.json({ success: true });
      } else {
        return Response.json(
          { success: false, message: "Failed to update status" },
          { status: 500 }
        );
      }
    } catch (error) {
      return Response.json(
        {
          success: false,
          message: error instanceof Error ? error.message : "Unknown error"
        },
        { status: 500 }
      );
    }
  }
  return Response.json({ error: "Not found" }, { status: 404 });
}
__name(handlePendingRequests, "handlePendingRequests");
async function getGlobalSetting(env, key) {
  try {
    const result = await env.DB.prepare(
      `SELECT value FROM global_settings WHERE key = ?`
    ).bind(key).first();
    return result?.value || null;
  } catch (error) {
    console.error("Error getting global setting:", error);
    return null;
  }
}
__name(getGlobalSetting, "getGlobalSetting");
async function setGlobalSetting(env, key, value) {
  try {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    await env.DB.prepare(`
      INSERT INTO global_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `).bind(key, value, now).run();
    return true;
  } catch (error) {
    console.error("Error setting global setting:", error);
    return false;
  }
}
__name(setGlobalSetting, "setGlobalSetting");
async function handleSettingsRequests(request, env, pathname) {
  if (pathname === "/api/settings/auto-credit" && request.method === "GET") {
    const value = await getGlobalSetting(env, "auto_credit_enabled");
    const enabled = value !== "false";
    return Response.json({ enabled });
  }
  if (pathname === "/api/settings/auto-credit" && request.method === "POST") {
    try {
      const body = await request.json();
      const success = await setGlobalSetting(
        env,
        "auto_credit_enabled",
        body.enabled ? "true" : "false"
      );
      if (success) {
        return Response.json({ success: true, enabled: body.enabled });
      } else {
        return Response.json(
          { success: false, message: "Failed to update" },
          { status: 500 }
        );
      }
    } catch (error) {
      return Response.json(
        {
          success: false,
          message: error instanceof Error ? error.message : "Unknown error"
        },
        { status: 500 }
      );
    }
  }
  return Response.json({ error: "Not found" }, { status: 404 });
}
__name(handleSettingsRequests, "handleSettingsRequests");

// src/api/webhook.ts
function removeTitlePrefix(name) {
  if (!name)
    return "";
  const prefixes = [
    "\u0E19\u0E32\u0E07\u0E2A\u0E32\u0E27",
    "\u0E14.\u0E0A.",
    "\u0E14.\u0E0D.",
    "\u0E19.\u0E2A.",
    "\u0E19\u0E32\u0E22",
    "\u0E19\u0E32\u0E07",
    "MISTRESS",
    "MASTER",
    "MISTER",
    "MISS",
    "MRS.",
    "MR.",
    "MS.",
    "Master",
    "Mister",
    "Miss",
    "Mrs.",
    "Mr.",
    "Ms."
  ];
  let cleanName = name.trim();
  for (const prefix of prefixes) {
    if (cleanName.startsWith(prefix + " ")) {
      cleanName = cleanName.substring(prefix.length + 1);
      break;
    } else if (cleanName.startsWith(prefix)) {
      cleanName = cleanName.substring(prefix.length);
      break;
    }
  }
  return cleanName.trim();
}
__name(removeTitlePrefix, "removeTitlePrefix");
async function replyMessage(replyToken, message, accessToken) {
  try {
    const response = await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        replyToken,
        messages: [
          {
            type: "text",
            text: message
          }
        ]
      })
    });
    if (!response.ok) {
      console.error("[replyMessage] Failed:", await response.text());
      return false;
    }
    return true;
  } catch (error) {
    console.error("[replyMessage] Error:", error);
    return false;
  }
}
__name(replyMessage, "replyMessage");
async function pushFlexMessage(userId, flexMessage, accessToken) {
  try {
    const response = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        to: userId,
        messages: [flexMessage]
      })
    });
    if (!response.ok) {
      console.error("[pushFlexMessage] Failed:", await response.text());
      return false;
    }
    return true;
  } catch (error) {
    console.error("[pushFlexMessage] Error:", error);
    return false;
  }
}
__name(pushFlexMessage, "pushFlexMessage");
function createCreditedFlexMessage(amount, memberCode, fullname, slipDate, settings) {
  const displayMemberCode = memberCode && memberCode.trim() !== "" ? memberCode.trim() : "(\u0E22\u0E39\u0E2A\u0E40\u0E0B\u0E2D\u0E23\u0E4C)";
  const displayFullname = fullname && fullname.trim() !== "" ? fullname.trim() : "\u0E1C\u0E39\u0E49\u0E43\u0E0A\u0E49";
  let timestamp;
  try {
    const slipDateTime = new Date(slipDate);
    timestamp = slipDateTime.toLocaleString("th-TH", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).replace(/\//g, "/");
  } catch (e) {
    timestamp = (/* @__PURE__ */ new Date()).toLocaleString("th-TH", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).replace(/\//g, "/");
  }
  const formattedAmount = amount.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const headerContents = [];
  if (settings.flexLogoUrl) {
    headerContents.push({
      type: "image",
      url: settings.flexLogoUrl,
      size: "4xl",
      aspectMode: "fit",
      margin: "none",
      align: "center",
      gravity: "top"
    });
  }
  headerContents.push({
    type: "text",
    text: "AUTO DEPOSIT SUCCESS",
    weight: "bold",
    color: settings.colorPrimary || "#D4AF37",
    size: "sm",
    align: "center",
    margin: settings.flexLogoUrl ? "md" : "none"
  });
  const bodyContents = [
    {
      type: "text",
      text: "\u0E1D\u0E32\u0E01\u0E40\u0E07\u0E34\u0E19\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08",
      weight: "bold",
      size: "xl",
      color: settings.colorSuccessText || "#33FF33",
      align: "center"
    },
    {
      type: "box",
      layout: "vertical",
      margin: "lg",
      spacing: "sm",
      contents: [
        {
          type: "box",
          layout: "horizontal",
          contents: [
            {
              type: "text",
              text: "\u0E22\u0E39\u0E2A\u0E40\u0E0B\u0E2D\u0E23\u0E4C:",
              size: "sm",
              color: settings.colorPrimary || "#D4AF37",
              flex: 2
            },
            {
              type: "text",
              text: displayMemberCode,
              size: "sm",
              color: settings.colorValueText || "#FFFFFF",
              align: "end",
              flex: 4,
              weight: "bold"
            }
          ]
        },
        {
          type: "separator",
          color: settings.colorSeparator || "#333333",
          margin: "md"
        },
        {
          type: "box",
          layout: "horizontal",
          margin: "md",
          contents: [
            {
              type: "text",
              text: "\u0E08\u0E33\u0E19\u0E27\u0E19\u0E40\u0E07\u0E34\u0E19",
              size: "sm",
              color: settings.colorPrimary || "#D4AF37"
            },
            {
              type: "text",
              text: `${formattedAmount} THB`,
              size: "lg",
              color: settings.colorValueText || "#FFFFFF",
              align: "end",
              weight: "bold"
            }
          ]
        },
        {
          type: "box",
          layout: "horizontal",
          contents: [
            {
              type: "text",
              text: "\u0E27\u0E31\u0E19\u0E17\u0E35\u0E48/\u0E40\u0E27\u0E25\u0E32",
              size: "sm",
              color: settings.colorMutedText || "#888888"
            },
            {
              type: "text",
              text: timestamp,
              size: "sm",
              color: settings.colorMutedText || "#888888",
              align: "end"
            }
          ]
        }
      ]
    }
  ];
  if (settings.gameUrl) {
    bodyContents.push({
      type: "box",
      layout: "vertical",
      margin: "xl",
      contents: [
        {
          type: "button",
          action: {
            type: "uri",
            label: "\u0E40\u0E02\u0E49\u0E32\u0E40\u0E25\u0E48\u0E19\u0E40\u0E01\u0E21",
            uri: settings.gameUrl
          },
          style: "primary",
          color: settings.colorPrimary || "#D4AF37",
          height: "sm"
        }
      ]
    });
  }
  return {
    type: "flex",
    altText: `\u2705 \u0E1D\u0E32\u0E01\u0E40\u0E07\u0E34\u0E19\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08 ${formattedAmount} THB`,
    contents: {
      type: "bubble",
      size: "mega",
      direction: "ltr",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: settings.colorHeaderFooterBg || "#000000",
        contents: headerContents
      },
      body: {
        type: "box",
        layout: "vertical",
        backgroundColor: settings.colorBodyBg || "#1A1A1A",
        contents: bodyContents
      },
      footer: {
        type: "box",
        layout: "vertical",
        backgroundColor: settings.colorHeaderFooterBg || "#000000",
        contents: [
          {
            type: "text",
            text: "\u0E02\u0E2D\u0E1A\u0E04\u0E38\u0E13\u0E17\u0E35\u0E48\u0E43\u0E0A\u0E49\u0E1A\u0E23\u0E34\u0E01\u0E32\u0E23\u0E04\u0E48\u0E30",
            size: "xxs",
            color: settings.colorMutedText || "#888888",
            align: "center"
          }
        ]
      }
    }
  };
}
__name(createCreditedFlexMessage, "createCreditedFlexMessage");
function createDuplicateFlexMessage(amount, memberCode, slipDate, settings) {
  let timestamp;
  try {
    const slipDateTime = new Date(slipDate);
    timestamp = slipDateTime.toLocaleString("th-TH", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).replace(/\//g, "/");
  } catch (e) {
    timestamp = (/* @__PURE__ */ new Date()).toLocaleString("th-TH", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).replace(/\//g, "/");
  }
  const formattedAmount = amount.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const headerContents = [];
  if (settings.flexLogoUrl) {
    headerContents.push({
      type: "image",
      url: settings.flexLogoUrl,
      size: "4xl",
      aspectMode: "fit",
      margin: "none",
      align: "center",
      gravity: "top"
    });
  }
  headerContents.push({
    type: "text",
    text: "DUPLICATE TRANSACTION",
    weight: "bold",
    color: "#FFA500",
    size: "sm",
    align: "center",
    margin: settings.flexLogoUrl ? "md" : "none"
  });
  return {
    type: "flex",
    altText: `\u26A0\uFE0F \u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E0B\u0E49\u0E33 ${formattedAmount} THB`,
    contents: {
      type: "bubble",
      size: "mega",
      direction: "ltr",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: settings.colorHeaderFooterBg || "#000000",
        contents: headerContents
      },
      body: {
        type: "box",
        layout: "vertical",
        backgroundColor: settings.colorBodyBg || "#1A1A1A",
        contents: [
          {
            type: "text",
            text: "\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E1D\u0E32\u0E01\u0E0B\u0E49\u0E33",
            weight: "bold",
            size: "xl",
            color: "#FFA500",
            align: "center"
          },
          {
            type: "box",
            layout: "vertical",
            margin: "lg",
            spacing: "sm",
            contents: [
              {
                type: "text",
                text: "\u0E1E\u0E1A\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E19\u0E35\u0E49\u0E43\u0E19\u0E23\u0E30\u0E1A\u0E1A\u0E41\u0E25\u0E49\u0E27",
                size: "sm",
                color: settings.colorMutedText || "#888888",
                align: "center",
                wrap: true
              },
              {
                type: "separator",
                color: settings.colorSeparator || "#333333",
                margin: "md"
              },
              {
                type: "box",
                layout: "horizontal",
                margin: "md",
                contents: [
                  {
                    type: "text",
                    text: "\u0E08\u0E33\u0E19\u0E27\u0E19\u0E40\u0E07\u0E34\u0E19",
                    size: "sm",
                    color: settings.colorPrimary || "#D4AF37"
                  },
                  {
                    type: "text",
                    text: `${formattedAmount} THB`,
                    size: "lg",
                    color: settings.colorValueText || "#FFFFFF",
                    align: "end",
                    weight: "bold"
                  }
                ]
              },
              {
                type: "box",
                layout: "horizontal",
                contents: [
                  {
                    type: "text",
                    text: "\u0E22\u0E39\u0E2A\u0E40\u0E0B\u0E2D\u0E23\u0E4C:",
                    size: "sm",
                    color: settings.colorPrimary || "#D4AF37",
                    flex: 2
                  },
                  {
                    type: "text",
                    text: memberCode,
                    size: "sm",
                    color: settings.colorValueText || "#FFFFFF",
                    align: "end",
                    flex: 4,
                    weight: "bold"
                  }
                ]
              },
              {
                type: "separator",
                color: settings.colorSeparator || "#333333",
                margin: "md"
              },
              {
                type: "box",
                layout: "horizontal",
                margin: "md",
                contents: [
                  {
                    type: "text",
                    text: "\u0E27\u0E31\u0E19\u0E17\u0E35\u0E48/\u0E40\u0E27\u0E25\u0E32",
                    size: "sm",
                    color: settings.colorMutedText || "#888888"
                  },
                  {
                    type: "text",
                    text: timestamp,
                    size: "sm",
                    color: settings.colorMutedText || "#888888",
                    align: "end"
                  }
                ]
              }
            ]
          },
          ...settings.gameUrl ? [{
            type: "box",
            layout: "vertical",
            margin: "xl",
            contents: [
              {
                type: "button",
                action: {
                  type: "uri",
                  label: "\u0E40\u0E02\u0E49\u0E32\u0E40\u0E25\u0E48\u0E19\u0E40\u0E01\u0E21",
                  uri: settings.gameUrl
                },
                style: "primary",
                color: settings.colorPrimary || "#D4AF37",
                height: "sm"
              }
            ]
          }] : []
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        backgroundColor: settings.colorHeaderFooterBg || "#000000",
        contents: [
          {
            type: "text",
            text: "\u0E02\u0E2D\u0E1A\u0E04\u0E38\u0E13\u0E17\u0E35\u0E48\u0E43\u0E0A\u0E49\u0E1A\u0E23\u0E34\u0E01\u0E32\u0E23\u0E04\u0E48\u0E30",
            size: "xxs",
            color: settings.colorMutedText || "#888888",
            align: "center"
          }
        ]
      }
    }
  };
}
__name(createDuplicateFlexMessage, "createDuplicateFlexMessage");
async function getImageContent(messageId, accessToken) {
  try {
    const response = await fetch(
      `https://api-data.line.me/v2/bot/message/${messageId}/content`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    );
    if (!response.ok) {
      console.error("[getImageContent] Failed:", response.status);
      return null;
    }
    return await response.arrayBuffer();
  } catch (error) {
    console.error("[getImageContent] Error:", error);
    return null;
  }
}
__name(getImageContent, "getImageContent");
async function processTransactionAsync(env, tenantId, transactionId, slipData, userId, replyToken, accessToken, messageSettings) {
  try {
    console.log(`[processTransactionAsync] \u{1F504} Starting background processing for transaction ID: ${transactionId}`);
    const receiverAccount = slipData.receiver?.account?.bank?.account || slipData.receiver?.account?.value || "unknown";
    const receiverName = slipData.receiver?.account?.name?.th || slipData.receiver?.account?.name?.en || "unknown";
    const senderNameTh = slipData.sender?.account?.name?.th || "";
    const senderNameEn = slipData.sender?.account?.name?.en || "";
    const senderNameRaw = senderNameTh || senderNameEn || "unknown";
    const senderName = removeTitlePrefix(senderNameRaw);
    const senderMaskedAccount = slipData.sender?.account?.bank?.account || "";
    const senderBankShort = slipData.sender?.bank?.short || "";
    const transRef = slipData.transRef || slipData.ref1 || null;
    console.log(`[processTransactionAsync] Sender name raw: ${senderNameRaw}, cleaned: ${senderName}, transRef: ${transRef}`);
    console.log(`[processTransactionAsync] Step 1: Matching receiver account: ${receiverAccount}`);
    const matchResult = await matchAccount(env, tenantId, receiverAccount, receiverName);
    if (!matchResult.matched || !matchResult.accountId) {
      console.log(`[processTransactionAsync] \u274C Account not matched - leaving as 'pending'`);
      return;
    }
    console.log(`[processTransactionAsync] \u2705 Account matched! Account ID: ${matchResult.accountId}`);
    console.log(`[processTransactionAsync] Step 2: Searching for user: ${senderName}`);
    const searchResult = await searchUser(env, tenantId, senderName, senderMaskedAccount, senderBankShort);
    if (!searchResult || !searchResult.user) {
      console.log(`[processTransactionAsync] \u26A0\uFE0F User not found - leaving as 'matched'`);
      return;
    }
    console.log(`[processTransactionAsync] \u2705 User found! Member code: ${searchResult.user.memberCode}, matchMethod: ${searchResult.matchMethod || "unknown"}`);
    if (senderMaskedAccount && searchResult.matchMethod !== "name-and-account-verified") {
      console.warn(`[processTransactionAsync] \u26A0\uFE0F User match not verified (matchMethod=${searchResult.matchMethod}); keeping status as 'pending'`);
      return;
    }
    await env.DB.prepare(`
      UPDATE pending_transactions 
      SET status = ?,
          sender_account = ?,
          user_data = ?
      WHERE id = ?
    `).bind(
      "matched",
      searchResult.user.fullname || searchResult.user.memberCode,
      JSON.stringify({
        lineUserId: userId,
        memberCode: searchResult.user.memberCode,
        fullname: searchResult.user.fullname,
        timestamp: Date.now()
      }),
      transactionId
    ).run();
    console.log(`[processTransactionAsync] \u2705 Updated status to 'matched' with user data`);
    console.log(`[processTransactionAsync] Step 2.5: Checking auto credit setting...`);
    const autoCreditEnabledValue = await getGlobalSetting(env, "auto_credit_enabled");
    const autoCreditEnabled = autoCreditEnabledValue !== "false" && autoCreditEnabledValue !== null;
    console.log(`[processTransactionAsync] Auto Credit Setting: ${autoCreditEnabledValue} (enabled: ${autoCreditEnabled})`);
    if (!autoCreditEnabled) {
      console.log(`[processTransactionAsync] \u{1F6A7} Auto credit is DISABLED - leaving as 'matched' for manual processing`);
      return;
    }
    console.log(`[processTransactionAsync] Step 3: Submitting credit...`);
    const creditResult = await submitCredit(env, tenantId, slipData, searchResult.user, matchResult.accountId);
    if (!creditResult.success) {
      console.warn(`[processTransactionAsync] \u26A0\uFE0F Credit submission failed: ${creditResult.message}`);
      return;
    }
    let memberCodeDisplay = "";
    const hasMemberCode = searchResult.user.memberCode && searchResult.user.memberCode.trim() !== "";
    if (!hasMemberCode) {
      console.log("[processTransactionAsync] \u{1F504} Non-member detected - fetching memberCode from API...");
      console.log("[processTransactionAsync] User ID:", searchResult.user.id, "Phone:", searchResult.user.phone, "Fullname:", searchResult.user.fullname);
      await new Promise((resolve) => setTimeout(resolve, 300));
      try {
        const tenantResult = await env.DB.prepare(
          `SELECT api_base_url FROM tenants WHERE tenant_id = ?`
        ).bind(tenantId).first();
        const sessionResult = await env.DB.prepare(
          `SELECT token FROM tenant_sessions WHERE tenant_id = ? AND status = 'ACTIVE'`
        ).bind(tenantId).first();
        if (tenantResult && sessionResult) {
          let users = [];
          if (searchResult.user.phone) {
            const params1 = new URLSearchParams({
              page: "1",
              limit: "10",
              userCategory: "member",
              search: searchResult.user.phone
            });
            console.log("[processTransactionAsync] \u{1F50D} Searching by phone:", searchResult.user.phone);
            const controller1 = new AbortController();
            const timeoutId1 = setTimeout(() => controller1.abort(), 3e3);
            try {
              const response1 = await fetch(
                `${tenantResult.api_base_url}/api/users/list?${params1.toString()}`,
                {
                  headers: { Authorization: `Bearer ${sessionResult.token}` },
                  signal: controller1.signal
                }
              );
              clearTimeout(timeoutId1);
              if (response1.ok) {
                const data1 = await response1.json();
                users = data1.list || [];
                console.log("[processTransactionAsync] \u{1F4DE} Search by phone result:", users.length, "users");
              }
            } catch (e) {
              clearTimeout(timeoutId1);
              console.warn("[processTransactionAsync] \u26A0\uFE0F Search by phone failed:", e);
            }
          }
          if (users.length === 0 && searchResult.user.fullname) {
            const params2 = new URLSearchParams({
              page: "1",
              limit: "10",
              userCategory: "member",
              search: searchResult.user.fullname
            });
            console.log("[processTransactionAsync] \u{1F50D} Searching by fullname:", searchResult.user.fullname);
            const controller2 = new AbortController();
            const timeoutId2 = setTimeout(() => controller2.abort(), 3e3);
            try {
              const response2 = await fetch(
                `${tenantResult.api_base_url}/api/users/list?${params2.toString()}`,
                {
                  headers: { Authorization: `Bearer ${sessionResult.token}` },
                  signal: controller2.signal
                }
              );
              clearTimeout(timeoutId2);
              if (response2.ok) {
                const data2 = await response2.json();
                users = data2.list || [];
                console.log("[processTransactionAsync] \u{1F464} Search by fullname result:", users.length, "users");
              }
            } catch (e) {
              clearTimeout(timeoutId2);
              console.warn("[processTransactionAsync] \u26A0\uFE0F Search by fullname failed:", e);
            }
          }
          if (users.length > 0 && users[0].memberCode) {
            memberCodeDisplay = users[0].memberCode.trim();
            console.log("[processTransactionAsync] \u2705 Fetched memberCode:", memberCodeDisplay);
          } else {
            console.warn("[processTransactionAsync] \u26A0\uFE0F No memberCode in API response, users found:", users.length);
            memberCodeDisplay = "(\u0E22\u0E39\u0E2A\u0E40\u0E0B\u0E2D\u0E23\u0E4C\u0E43\u0E2B\u0E21\u0E48)";
          }
        } else {
          console.warn("[processTransactionAsync] \u26A0\uFE0F Missing tenant or session data");
          memberCodeDisplay = "(\u0E22\u0E39\u0E2A\u0E40\u0E0B\u0E2D\u0E23\u0E4C\u0E43\u0E2B\u0E21\u0E48)";
        }
      } catch (fetchError) {
        console.error("[processTransactionAsync] \u274C Error fetching memberCode:", fetchError);
        memberCodeDisplay = "(\u0E22\u0E39\u0E2A\u0E40\u0E0B\u0E2D\u0E23\u0E4C\u0E43\u0E2B\u0E21\u0E48)";
      }
    } else {
      memberCodeDisplay = searchResult.user.memberCode.trim();
      console.log("[processTransactionAsync] \u{1F464} Member with existing memberCode:", memberCodeDisplay);
    }
    const finalStatus = creditResult.isDuplicate ? "duplicate" : "credited";
    const now = (/* @__PURE__ */ new Date()).toISOString();
    await env.DB.prepare(`
      UPDATE pending_transactions 
      SET status = ?, 
          credited_at = ?,
          sender_account = ?,
          user_data = ?
      WHERE id = ?
    `).bind(
      finalStatus,
      now,
      searchResult.user.fullname || memberCodeDisplay,
      // Use fullname from backend instead of slip name
      JSON.stringify({
        lineUserId: userId,
        memberCode: memberCodeDisplay,
        fullname: searchResult.user.fullname,
        timestamp: Date.now()
      }),
      transactionId
    ).run();
    console.log(`[processTransactionAsync] \u2705 Completed! Final status: '${finalStatus}'`);
    if (messageSettings.flexMessageEnabled && userId) {
      try {
        const amount = slipData.amount?.amount || 0;
        if (finalStatus === "credited") {
          const slipDate = slipData.date || (/* @__PURE__ */ new Date()).toISOString();
          const flexMessage = createCreditedFlexMessage(
            amount,
            memberCodeDisplay,
            searchResult.user.fullname || "\u0E1C\u0E39\u0E49\u0E43\u0E0A\u0E49",
            slipDate,
            messageSettings
          );
          await pushFlexMessage(userId, flexMessage, accessToken);
          console.log(`[processTransactionAsync] \u2705 Sent credited Flex Message`);
        } else if (finalStatus === "duplicate" && messageSettings.duplicateReplyEnabled) {
          const slipDate = slipData.date || (/* @__PURE__ */ new Date()).toISOString();
          const flexMessage = createDuplicateFlexMessage(amount, memberCodeDisplay, slipDate, messageSettings);
          await pushFlexMessage(userId, flexMessage, accessToken);
          console.log(`[processTransactionAsync] \u2705 Sent duplicate Flex Message`);
        }
      } catch (flexError) {
        console.error(`[processTransactionAsync] \u26A0\uFE0F Failed to send Flex Message:`, flexError);
      }
    }
  } catch (error) {
    console.error(`[processTransactionAsync] \u274C Error processing transaction ${transactionId}:`, error);
  }
}
__name(processTransactionAsync, "processTransactionAsync");
async function verifyAndProcessSlip(env, tenantId, transactionId, imageBuffer, userId, replyToken, accessToken, messageSettings) {
  try {
    console.log(`[verifyAndProcessSlip] \u{1F50D} Starting verification for transaction ID: ${transactionId}`);
    const verifyResult = await verifySlip(env, tenantId, imageBuffer);
    if (!verifyResult.success || !verifyResult.data) {
      console.error(`[verifyAndProcessSlip] \u274C Verification failed:`, verifyResult.message);
      await env.DB.prepare(`
        UPDATE pending_transactions 
        SET status = ?, slip_data = ? 
        WHERE id = ?
      `).bind(
        "failed",
        JSON.stringify({ error: verifyResult.message, failedAt: (/* @__PURE__ */ new Date()).toISOString() }),
        transactionId
      ).run();
      console.log(`[verifyAndProcessSlip] \u2705 Updated transaction ${transactionId} status to 'failed'`);
      return;
    }
    console.log(`[verifyAndProcessSlip] \u2705 Slip verified successfully`);
    const scanResult = verifyResult.data;
    const slipData = scanResult.data || scanResult;
    const slipAmount = slipData.amount?.amount || 0;
    const senderBank = slipData.sender?.bank?.short || slipData.sender?.bank?.name || "unknown";
    const senderNameTh = slipData.sender?.account?.name?.th || "";
    const senderNameEn = slipData.sender?.account?.name?.en || "";
    const senderNameRaw = senderNameTh || senderNameEn || "unknown";
    const senderName = removeTitlePrefix(senderNameRaw);
    const senderAccount = slipData.sender?.account?.name?.th || slipData.sender?.account?.name?.en || slipData.sender?.account?.value || "unknown";
    const receiverAccount = slipData.receiver?.account?.name?.th || slipData.receiver?.account?.name?.en || slipData.receiver?.account?.value || "unknown";
    const transRef = slipData.transRef || slipData.ref1 || null;
    console.log(`[verifyAndProcessSlip] Extracted data:`, {
      amount: slipAmount,
      senderBank,
      senderName,
      transRef
    });
    await env.DB.prepare(`
      UPDATE pending_transactions 
      SET slip_data = ?, 
          status = ?, 
          amount = ?, 
          sender_account = ?, 
          sender_bank = ?, 
          receiver_account = ?,
          slip_ref = ?
      WHERE id = ?
    `).bind(
      JSON.stringify(slipData),
      "pending",
      // Status will be updated by processTransactionAsync
      slipAmount,
      senderAccount,
      senderBank,
      receiverAccount,
      transRef,
      transactionId
    ).run();
    console.log(`[verifyAndProcessSlip] \u2705 Updated transaction ${transactionId} with verified data`);
    await processTransactionAsync(
      env,
      tenantId,
      transactionId,
      slipData,
      userId,
      replyToken,
      accessToken,
      messageSettings
    );
    console.log(`[verifyAndProcessSlip] \u2705 Processing completed for transaction ${transactionId}`);
  } catch (error) {
    console.error(`[verifyAndProcessSlip] \u274C Error:`, error);
    try {
      await env.DB.prepare(`
        UPDATE pending_transactions 
        SET status = ?
        WHERE id = ?
      `).bind("failed_processing", transactionId).run();
    } catch (updateError) {
      console.error(`[verifyAndProcessSlip] \u274C Failed to update error status:`, updateError);
    }
  }
}
__name(verifyAndProcessSlip, "verifyAndProcessSlip");
async function handleLineWebhook(request, env, ctx, tenantId, oaId) {
  try {
    console.log(`[handleLineWebhook] ==================== START ====================`);
    console.log(`[handleLineWebhook] Received webhook for tenant: ${tenantId}, OA: ${oaId}`);
    console.log(`[handleLineWebhook] Fetching LINE OA configuration...`);
    const lineOas = await getLineOas(env, tenantId);
    console.log(`[handleLineWebhook] Found ${lineOas.length} LINE OAs for tenant`);
    const lineOa = lineOas.find((oa) => oa.id === oaId);
    if (!lineOa) {
      console.error(`[handleLineWebhook] \u274C LINE OA not found with ID: ${oaId}`);
      return new Response("LINE OA not found", { status: 404 });
    }
    console.log(`[handleLineWebhook] \u2705 Found LINE OA: ${lineOa.name}`);
    console.log(`[handleLineWebhook] Parsing webhook body...`);
    const body = await request.json();
    console.log(`[handleLineWebhook] Events count: ${body.events?.length || 0}`);
    if (!body.events || body.events.length === 0) {
      console.log(`[handleLineWebhook] No events in webhook body`);
      return new Response("OK", { status: 200 });
    }
    console.log(`[handleLineWebhook] Fetching message settings...`);
    const messageSettings = await getMessageSettings(env, tenantId);
    console.log(`[handleLineWebhook] Message settings loaded. imageReplyEnabled: ${messageSettings.imageReplyEnabled}`);
    for (let i = 0; i < body.events.length; i++) {
      const event = body.events[i];
      console.log(`[handleLineWebhook] ----- Processing event ${i + 1}/${body.events.length} -----`);
      console.log(`[handleLineWebhook] Event type: ${event.type}, message type: ${event.message?.type}`);
      if (event.type === "message" && event.message?.type === "image") {
        console.log(`[handleLineWebhook] \u2705 Found image message`);
        const messageId = event.message.id;
        const replyToken = event.replyToken;
        const userId = event.source?.userId || "unknown";
        console.log(`[handleLineWebhook] Message ID: ${messageId}, User ID: ${userId}`);
        if (messageSettings.imageReplyEnabled && messageSettings.imageReplyMessage) {
          console.log(`[handleLineWebhook] Sending immediate reply...`);
          const replySuccess = await replyMessage(
            replyToken,
            messageSettings.imageReplyMessage,
            lineOa.accessToken
          );
          console.log(`[handleLineWebhook] Reply result: ${replySuccess ? "\u2705" : "\u274C"}`);
        }
        console.log(`[handleLineWebhook] Downloading image from LINE...`);
        const imageBuffer = await getImageContent(messageId, lineOa.accessToken);
        if (!imageBuffer) {
          console.error(`[handleLineWebhook] \u274C Failed to download image`);
          continue;
        }
        console.log(`[handleLineWebhook] \u2705 Downloaded image, size: ${imageBuffer.byteLength} bytes`);
        try {
          const now = (/* @__PURE__ */ new Date()).toISOString();
          console.log(`[handleLineWebhook] \u{1F4BE} Saving pending verification to DB...`);
          const tempId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          const saveResult = await env.DB.prepare(`
            INSERT INTO pending_transactions 
            (tenant_id, slip_data, user_data, status, amount, sender_account, sender_bank, receiver_account, created_at, slip_ref, credited_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            tenantId,
            JSON.stringify({ pending: "verification in progress" }),
            JSON.stringify({
              lineUserId: userId,
              messageId,
              timestamp: Date.now(),
              imageSize: imageBuffer.byteLength
            }),
            "pending_verification",
            // New status for unverified slips
            0,
            "Pending Verification",
            "unknown",
            "unknown",
            now,
            tempId,
            // Temporary unique ref
            null
          ).run();
          const transactionId = saveResult.meta.last_row_id;
          if (!transactionId) {
            console.error(`[handleLineWebhook] \u274C Failed to get transaction ID after insert`);
            continue;
          }
          console.log(`[handleLineWebhook] \u2705 Saved pending transaction ID: ${transactionId}`);
          console.log(`[handleLineWebhook] \u{1F525} Scheduling background verification for transaction ID: ${transactionId}`);
          ctx.waitUntil(
            verifyAndProcessSlip(
              env,
              tenantId,
              transactionId,
              imageBuffer,
              userId,
              replyToken,
              lineOa.accessToken,
              messageSettings
            )
          );
          console.log(`[handleLineWebhook] \u2705 Background verification scheduled`);
        } catch (saveError) {
          console.error(`[handleLineWebhook] \u274C Error saving pending transaction:`, saveError);
          if (saveError?.message?.includes("UNIQUE") || saveError?.message?.includes("duplicate")) {
            console.log(`[handleLineWebhook] \u26A0\uFE0F Duplicate detected via UNIQUE constraint`);
            continue;
          }
        }
        console.log(`[handleLineWebhook] \u2705 Slip saved, verification in progress`);
      } else {
        console.log(`[handleLineWebhook] \u23ED\uFE0F Skipping event (not an image message). Type: ${event.type}, MessageType: ${event.message?.type}`);
      }
    }
    console.log(`[handleLineWebhook] ==================== END ====================`);
    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error(`[handleLineWebhook] \u274C Error:`, error);
    if (error instanceof Error) {
      console.error(`[handleLineWebhook] Stack:`, error.stack);
    }
    return new Response("Internal Server Error", { status: 500 });
  }
}
__name(handleLineWebhook, "handleLineWebhook");
async function handleWebhookRequests(request, env, ctx, pathname) {
  console.log(`[handleWebhookRequests] ${request.method} ${pathname}`);
  const webhookMatch = pathname.match(/^\/webhook\/([^/\s]+)\/([^/\s]+)$/);
  if (request.method === "POST" && webhookMatch) {
    const tenantId = decodeURIComponent(webhookMatch[1]);
    const oaId = decodeURIComponent(webhookMatch[2]);
    console.log(`[handleWebhookRequests] POST /webhook/${tenantId}/${oaId}`);
    return await handleLineWebhook(request, env, ctx, tenantId, oaId);
  }
  const verifyMatch = pathname.match(/^\/webhook\/([^/\s]+)(\/)?(\s)?$/);
  if (verifyMatch) {
    const tenantId = decodeURIComponent(verifyMatch[1]);
    console.log(`[handleWebhookRequests] ${request.method} /webhook/${tenantId} - matched (verification or fallback)`);
    if (request.method === "GET") {
      console.log(`[handleWebhookRequests] GET request - returning 200 OK for verification`);
      return new Response("OK", { status: 200, headers: { "Content-Type": "text/plain" } });
    }
    if (request.method === "POST") {
      try {
        console.log(`[handleWebhookRequests] POST /webhook/${tenantId} - fetching LINE OAs`);
        const lineOas = await getLineOas(env, tenantId);
        if (lineOas && lineOas.length > 0) {
          const firstOa = lineOas[0];
          console.log(`[handleWebhookRequests] Using first LINE OA: ${firstOa?.id || "unknown"}`);
          return await handleLineWebhook(request, env, ctx, tenantId, firstOa?.id || "unknown");
        } else {
          console.warn(`[handleWebhookRequests] No LINE OA found for tenant ${tenantId} - returning 200 OK anyway`);
          return new Response("OK", { status: 200, headers: { "Content-Type": "text/plain" } });
        }
      } catch (error) {
        console.error(`[handleWebhookRequests] Error processing webhook for ${tenantId}:`, error);
        return new Response("OK", { status: 200, headers: { "Content-Type": "text/plain" } });
      }
    }
  }
  console.log(`[handleWebhookRequests] No match for ${request.method} ${pathname} - will return 404`);
  return null;
}
__name(handleWebhookRequests, "handleWebhookRequests");

// src/api/manual-scan.ts
function removeTitlePrefix2(name) {
  if (!name)
    return "";
  const prefixes = [
    "\u0E19\u0E32\u0E07\u0E2A\u0E32\u0E27",
    "\u0E14.\u0E0A.",
    "\u0E14.\u0E0D.",
    "\u0E19.\u0E2A.",
    "\u0E19\u0E32\u0E22",
    "\u0E19\u0E32\u0E07",
    "MASTER",
    "MISS",
    "MRS.",
    "MR.",
    "MS.",
    "Master",
    "Miss",
    "Mrs.",
    "Mr.",
    "Ms."
  ];
  let cleanName = name.trim();
  for (const prefix of prefixes) {
    if (cleanName.startsWith(prefix + " ")) {
      cleanName = cleanName.substring(prefix.length + 1);
      break;
    } else if (cleanName.startsWith(prefix)) {
      cleanName = cleanName.substring(prefix.length);
      break;
    }
  }
  return cleanName.trim();
}
__name(removeTitlePrefix2, "removeTitlePrefix");
async function verifySlip(env, tenantId, fileBuffer, imageUrl) {
  try {
    const token = await getEasySlipToken(env, tenantId);
    if (!token) {
      return {
        success: false,
        message: "EasySlip token not configured for this tenant"
      };
    }
    const baseUrl = "https://developer.easyslip.com/api/v1";
    let response;
    console.log(`[verifySlip] Starting verification for tenant: ${tenantId}`);
    console.log(`[verifySlip] Method: ${imageUrl ? "URL" : "FILE"}`);
    if (imageUrl) {
      console.log(`[verifySlip] Image URL: ${imageUrl}`);
    }
    if (fileBuffer) {
      console.log(`[verifySlip] File size: ${fileBuffer.byteLength} bytes`);
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.log(`[verifySlip] \u26A0\uFE0F Timeout reached, aborting request...`);
      controller.abort();
    }, 5e3);
    try {
      console.log(`[verifySlip] \u{1F504} Calling EasySlip API...`);
      if (imageUrl) {
        response = await fetch(`${baseUrl}/verify`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ url: imageUrl }),
          signal: controller.signal
        });
        console.log(`[verifySlip] \u2705 EasySlip API response status: ${response.status}`);
      } else if (fileBuffer) {
        const formData = new FormData();
        formData.append(
          "file",
          new Blob([fileBuffer], { type: "image/jpeg" }),
          "slip.jpg"
        );
        response = await fetch(`${baseUrl}/verify`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`
          },
          body: formData,
          signal: controller.signal
        });
        console.log(`[verifySlip] \u2705 EasySlip API response status: ${response.status}`);
      } else {
        clearTimeout(timeoutId);
        return {
          success: false,
          message: "No image provided"
        };
      }
    } catch (fetchError) {
      clearTimeout(timeoutId);
      console.error(`[verifySlip] \u274C Fetch failed or timeout:`, fetchError);
      const errorMsg = fetchError instanceof Error ? fetchError.message : "Unknown fetch error";
      console.error(`[verifySlip] Error details: ${errorMsg}`);
      return {
        success: false,
        message: `EasySlip API timeout/error: ${errorMsg}`
      };
    } finally {
      clearTimeout(timeoutId);
    }
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[verifySlip] \u274C EasySlip API error: ${response.status}`);
      console.error(`[verifySlip] Error response: ${errorText}`);
      return {
        success: false,
        message: `EasySlip API error: ${response.status} - ${errorText}`
      };
    }
    console.log(`[verifySlip] \u{1F504} Parsing JSON response...`);
    const data = await response.json();
    console.log(`[verifySlip] \u2705 Response parsed successfully`);
    console.log(`[verifySlip] Data structure check:`, {
      hasData: !!data,
      hasDataField: !!data?.data,
      hasSender: !!data?.data?.sender,
      hasReceiver: !!data?.data?.receiver,
      hasAmount: !!data?.data?.amount,
      transRef: data?.data?.transRef || data?.transRef || "N/A"
    });
    return {
      success: true,
      data
    };
  } catch (error) {
    console.error("Slip verification error:", error);
    return {
      success: false,
      message: error instanceof Error ? error.message : "Unknown error"
    };
  }
}
__name(verifySlip, "verifySlip");
async function matchAccount(env, tenantId, receiverAccount, receiverName, receiverRef3) {
  try {
    let accounts = [];
    console.log(`
[matchAccount] \u{1F50D} Starting account match...`);
    console.log(`[matchAccount] Tenant ID: ${tenantId}`);
    console.log(`[matchAccount] Receiver Account (masked): ${receiverAccount}`);
    console.log(`[matchAccount] Receiver Name (EN): ${receiverName || "N/A"}`);
    console.log(`[matchAccount] Receiver Name (TH - ref3): ${receiverRef3 || "N/A"}
`);
    const cacheKey = `tenant:${tenantId}:accounts`;
    const cached = await env.SESSION_KV.get(cacheKey);
    if (cached) {
      try {
        const cacheData = JSON.parse(cached);
        accounts = cacheData.accounts || [];
        console.log(`\u2705 Using cached accounts for matching (${accounts.length} accounts)`);
      } catch (e) {
        console.warn("\u26A0\uFE0F Invalid cache data, will fetch fresh");
      }
    }
    if (accounts.length === 0) {
      console.log(`\u{1F4E1} No cache, fetching from API...`);
      const tenantResult = await env.DB.prepare(
        `SELECT api_base_url, account_list_ttl_min FROM tenants WHERE tenant_id = ?`
      ).bind(tenantId).first();
      if (!tenantResult) {
        console.error(`\u274C Tenant not found in DB: ${tenantId}`);
        return { matched: false };
      }
      console.log(`\u2705 Tenant found: ${tenantResult.api_base_url}`);
      const sessionResult = await env.DB.prepare(
        `SELECT token FROM tenant_sessions WHERE tenant_id = ? AND status = 'ACTIVE'`
      ).bind(tenantId).first();
      if (!sessionResult) {
        console.error(`\u274C No active session for tenant: ${tenantId}`);
        return { matched: false };
      }
      console.log(`\u2705 Active session found for tenant`);
      console.log(`\u{1F310} Calling account-list API...`);
      const response = await fetch(
        `${tenantResult.api_base_url}/api/summary-report/account-list`,
        {
          headers: {
            Authorization: `Bearer ${sessionResult.token}`
          }
        }
      );
      console.log(`\u{1F4CA} API Response Status: ${response.status}`);
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`\u274C API Error: ${response.status} - ${errorText}`);
        return { matched: false };
      }
      const data = await response.json();
      accounts = Array.isArray(data) ? data : data.list || [];
      console.log(`\u2705 API returned ${accounts.length} accounts`);
      if (accounts.length === 0) {
        console.warn(`\u26A0\uFE0F No accounts returned from API!`);
      }
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const cacheTtl = tenantResult.account_list_ttl_min ? tenantResult.account_list_ttl_min * 60 : 300;
      await env.SESSION_KV.put(
        cacheKey,
        JSON.stringify({
          accounts,
          cachedAt: now
        }),
        { expirationTtl: cacheTtl }
      );
      console.log(`\u{1F4BE} Cached ${accounts.length} accounts`);
    }
    console.log(`
\u{1F4CB} AVAILABLE ACCOUNTS (${accounts.length} total):`);
    if (accounts.length === 0) {
      console.warn(`\u26A0\uFE0F NO ACCOUNTS AVAILABLE!`);
    } else {
      accounts.forEach((acc, idx) => {
        console.log(`   [${idx + 1}] ${acc.accountName || "N/A"} | ${acc.accountNumber} | ID: ${acc.id || acc.accountId}`);
      });
    }
    console.log(`
`);
    console.log(`[matchAccount] Strategy 1\uFE0F\u20E3: Exact match (full account number)`);
    console.log(`[matchAccount] Trying to match receiver account: ${receiverAccount}`);
    console.log(`[matchAccount] Receiver name: ${receiverName || "N/A"}`);
    let matchedAccount = accounts.find(
      (acc) => acc.accountNumber === receiverAccount || acc.accountNumber?.replace(/-/g, "") === receiverAccount?.replace(/-/g, "")
    );
    if (matchedAccount) {
      console.log(`[matchAccount] \u2713 Match found by EXACT account number! Account: ${matchedAccount.accountNumber}, ID: ${matchedAccount.id || matchedAccount.accountId}`);
      return {
        matched: true,
        accountId: matchedAccount.id || matchedAccount.accountId,
        matchMethod: "exact-account"
      };
    }
    console.log(`[matchAccount] Strategy 2\uFE0F\u20E3: Partial match (masked digits)`);
    if (receiverAccount && receiverAccount.includes("x")) {
      const visibleDigits = receiverAccount.replace(/[x-]/gi, "");
      console.log(`[matchAccount] Extracted visible digits from masked account: ${visibleDigits}`);
      if (visibleDigits.length >= 4) {
        matchedAccount = accounts.find((acc) => {
          const cleanAccountNumber = acc.accountNumber?.replace(/-/g, "") || "";
          return cleanAccountNumber.includes(visibleDigits);
        });
        if (matchedAccount) {
          console.log(`[matchAccount] \u2713 Match found by PARTIAL digits (${visibleDigits})! Account: ${matchedAccount.accountNumber}, ID: ${matchedAccount.id || matchedAccount.accountId}`);
          return {
            matched: true,
            accountId: matchedAccount.id || matchedAccount.accountId,
            matchMethod: "partial-digits"
          };
        }
      }
    }
    if (receiverName) {
      const normalizedReceiverName = receiverName.toUpperCase().trim();
      console.log(`[matchAccount] \u{1F524} Trying name match with: ${normalizedReceiverName}`);
      console.log(`[matchAccount] \u{1F5C2}\uFE0F Checking manual account name mappings...`);
      try {
        const manualMapping = await env.DB.prepare(
          `SELECT id, account_number, name_en, name_th FROM account_name_mappings 
           WHERE tenant_id = ? AND (name_en ILIKE ? OR name_th ILIKE ?)`
        ).bind(tenantId, `%${normalizedReceiverName}%`, `%${normalizedReceiverName}%`).first();
        if (manualMapping) {
          console.log(`[matchAccount] \u2713 Found manual mapping: ${manualMapping.account_number} -> ${manualMapping.name_en}`);
          const matchedByManualMapping = accounts.find(
            (acc) => acc.accountNumber?.replace(/-/g, "") === manualMapping.account_number?.replace(/-/g, "")
          );
          if (matchedByManualMapping) {
            console.log(`[matchAccount] \u2713 Match found by MANUAL ACCOUNT NAME! Account: ${matchedByManualMapping.accountNumber}, ID: ${matchedByManualMapping.id || matchedByManualMapping.accountId}`);
            return {
              matched: true,
              accountId: matchedByManualMapping.id || matchedByManualMapping.accountId,
              matchMethod: "manual-name-mapping"
            };
          }
        } else {
          console.log(`[matchAccount] \u2139\uFE0F No manual mapping found for: ${normalizedReceiverName}`);
        }
      } catch (error) {
        console.warn(`[matchAccount] \u26A0\uFE0F Error checking manual mappings:`, error);
      }
      const receiverKeywords = normalizedReceiverName.split(/\s+/).filter((word) => word && word.length > 0).map((word) => word.trim());
      console.log(`[matchAccount] \u{1F511} Receiver name keywords:`, receiverKeywords);
      console.log(`[matchAccount] \u{1F4CA} Checking ${accounts.length} accounts for name match...`);
      let matchedAccount2 = accounts.find((acc) => {
        const accountName = (acc.accountName || "").toUpperCase().trim();
        const accountKeywords = accountName.split(/\s+/).filter((word) => word && word.length > 0).map((word) => word.trim());
        const exactMatch = accountName === normalizedReceiverName;
        const accountContainsReceiver = accountName.includes(normalizedReceiverName);
        const receiverContainsAccount = normalizedReceiverName.includes(accountName);
        const keywordMatch = receiverKeywords.some(
          (rKeyword) => accountKeywords.some((aKeyword) => {
            const exactKeywordMatch = aKeyword === rKeyword;
            const prefixMatch = aKeyword.length >= 4 && rKeyword.length >= 4 && (aKeyword.startsWith(rKeyword) || rKeyword.startsWith(aKeyword));
            const containsMatch = aKeyword.length >= 3 && rKeyword.length >= 3 && (aKeyword.includes(rKeyword) || rKeyword.includes(aKeyword));
            return exactKeywordMatch || prefixMatch || containsMatch;
          })
        );
        const match = exactMatch || accountContainsReceiver || receiverContainsAccount || keywordMatch;
        if (match) {
          console.log(`[matchAccount]   \u2713 Name Match! Account: ${accountName}, Methods: [exact:${exactMatch}, contains:${accountContainsReceiver}, keyword:${keywordMatch}]`);
        }
        return match;
      });
      if (matchedAccount2) {
        console.log(`[matchAccount] \u2713 Match found by NAME! Account: ${matchedAccount2.accountNumber} (${matchedAccount2.accountName}), ID: ${matchedAccount2.id || matchedAccount2.accountId}`);
        return {
          matched: true,
          accountId: matchedAccount2.id || matchedAccount2.accountId,
          matchMethod: "name-match"
        };
      } else {
        console.log(`[matchAccount] \u274C No name match found. Available accounts:`);
        accounts.forEach((acc, idx) => {
          console.log(`   [${idx + 1}] ${acc.accountName} (${acc.accountNumber})`);
        });
      }
    }
    if (receiverRef3) {
      console.log(`
[matchAccount] Strategy 4\uFE0F\u20E3: Match Thai name from ref3 (Fallback - strategies 1-3 failed)`);
      console.log(`[matchAccount] ref3 RAW value: ${receiverRef3}`);
      let ref3Clean = receiverRef3.trim();
      ref3Clean = removeTitlePrefix2(ref3Clean);
      if (ref3Clean.includes(";")) {
        ref3Clean = ref3Clean.split(";")[0].trim();
      }
      const ref3Name = ref3Clean.toUpperCase();
      console.log(`[matchAccount] Cleaned Thai name: ${ref3Name}`);
      if (ref3Name && ref3Name.length > 0) {
        try {
          const thaiMapping = await env.DB.prepare(
            `SELECT id, account_number, name_en, name_th FROM account_name_mappings 
             WHERE tenant_id = ? AND name_th ILIKE ?`
          ).bind(tenantId, `%${ref3Name}%`).first();
          if (thaiMapping) {
            console.log(`[matchAccount] \u2713 Found Thai mapping in manual mappings: ${thaiMapping.account_number} -> ${thaiMapping.name_th}`);
            return {
              matched: true,
              accountId: thaiMapping.account_number,
              matchMethod: "thai-ref3-manual-mapping"
            };
          } else {
            console.log(`[matchAccount] \u2139\uFE0F No Thai mapping found - using cleaned ref3 name as pseudo-account`);
            return {
              matched: true,
              accountId: "#THAI_REF3#" + ref3Name.substring(0, 20),
              matchMethod: "thai-ref3-name"
            };
          }
        } catch (error) {
          console.warn(`[matchAccount] \u26A0\uFE0F Error checking Thai mappings: ${error}, falling back to pseudo-account`);
          return {
            matched: true,
            accountId: "#THAI_REF3#" + ref3Name.substring(0, 20),
            matchMethod: "thai-ref3-name-fallback"
          };
        }
      }
    }
    console.log(`[matchAccount] \u2717 No match found for receiver account: ${receiverAccount}`);
    return { matched: false };
  } catch (error) {
    console.error("Account matching error:", error);
    return { matched: false };
  }
}
__name(matchAccount, "matchAccount");
async function searchUser(env, tenantId, searchName, maskedAccount, bankName) {
  try {
    console.log(`[searchUser] Searching with name: ${searchName}, masked account: ${maskedAccount}`);
    const tenantResult = await env.DB.prepare(
      `SELECT api_base_url FROM tenants WHERE tenant_id = ?`
    ).bind(tenantId).first();
    if (!tenantResult) {
      return { user: null };
    }
    const sessionResult = await env.DB.prepare(
      `SELECT token FROM tenant_sessions WHERE tenant_id = ? AND status = 'ACTIVE'`
    ).bind(tenantId).first();
    if (!sessionResult) {
      return { user: null };
    }
    const userCategories = ["member", "non-member"];
    let users = [];
    for (const userCategory of userCategories) {
      console.log(`
[searchUser] \u{1F50D} Trying with userCategory="${userCategory}"...`);
      const params = new URLSearchParams({
        page: "1",
        limit: "50",
        userCategory
      });
      if (searchName) {
        params.append("search", searchName);
      }
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3e3);
      let response;
      try {
        response = await fetch(
          `${tenantResult.api_base_url}/api/users/list?${params.toString()}`,
          {
            headers: {
              Authorization: `Bearer ${sessionResult.token}`
            },
            signal: controller.signal
          }
        );
      } catch (fetchError) {
        clearTimeout(timeoutId);
        console.log(`[searchUser] Fetch failed or timeout for ${userCategory}:`, fetchError);
        continue;
      } finally {
        clearTimeout(timeoutId);
      }
      if (!response.ok) {
        console.log(`[searchUser] API failed for ${userCategory}: ${response.status}`);
        continue;
      }
      const data = await response.json();
      users = data.list || [];
      console.log(`[searchUser] Found ${users.length} users with userCategory="${userCategory}"`);
      if (users.length > 0) {
        console.log(`[searchUser] \u2705 Users found with ${userCategory}, stopping search`);
        break;
      }
    }
    if (users.length === 0) {
      console.log(`[searchUser] \u274C No users found in any category`);
      return { user: null };
    }
    if (maskedAccount) {
      const cleanMasked = maskedAccount.replace(/-/g, "");
      const segments = cleanMasked.split(/x+/i).filter((seg) => seg.length > 0);
      console.log(`[searchUser] Masked account: ${maskedAccount}`);
      console.log(`[searchUser] Clean masked: ${cleanMasked}`);
      console.log(`[searchUser] Extracted segments:`, segments);
      if (segments.length > 0) {
        let pattern = "";
        if (cleanMasked.startsWith(segments[0])) {
          pattern = "^" + segments[0];
        } else {
          pattern = segments[0];
        }
        for (let i = 1; i < segments.length; i++) {
          pattern += ".*" + segments[i];
        }
        if (cleanMasked.endsWith(segments[segments.length - 1])) {
          pattern += "$";
        }
        console.log(`[searchUser] Generated pattern: ${pattern}`);
        const regex = new RegExp(pattern);
        for (const user of users) {
          const userAccount = (user.bankAccount || "").replace(/-/g, "");
          if (regex.test(userAccount)) {
            console.log(`[searchUser] \u2705 Match found! User: ${user.fullname}, Account: ${user.bankAccount}`);
            console.log(`[searchUser] Pattern "${pattern}" matched "${userAccount}"`);
            return {
              user,
              matchMethod: "name-and-account-verified"
            };
          }
        }
        console.log(`[searchUser] \u26A0\uFE0F Name found but account pattern not matched`);
        return {
          user: users[0],
          matchMethod: "name-only-unverified"
        };
      }
    }
    console.log(`[searchUser] Returning first match (no account verification)`);
    return {
      user: users[0],
      matchMethod: "name-only"
    };
  } catch (error) {
    console.error("User search error:", error);
    return { user: null };
  }
}
__name(searchUser, "searchUser");
async function submitCredit(env, tenantId, slipData, user, toAccountId) {
  try {
    const tenantResult = await env.DB.prepare(
      `SELECT api_base_url FROM tenants WHERE tenant_id = ?`
    ).bind(tenantId).first();
    if (!tenantResult) {
      return { success: false, message: "Tenant not found" };
    }
    const sessionResult = await env.DB.prepare(
      `SELECT token FROM tenant_sessions WHERE tenant_id = ? AND status = 'ACTIVE'`
    ).bind(tenantId).first();
    if (!sessionResult) {
      return { success: false, message: "Session not active" };
    }
    const hasMemberCode = user.memberCode && user.memberCode.trim() !== "";
    let payload;
    let apiEndpoint;
    if (hasMemberCode) {
      console.log("[submitCredit] \u{1F464} Using memberCode for existing member:", user.memberCode);
      payload = {
        memberCode: user.memberCode,
        creditAmount: slipData.amount?.amount || 0,
        depositChannel: "Mobile Banking (\u0E21\u0E37\u0E2D\u0E16\u0E37\u0E2D)",
        toAccountId,
        transferAt: slipData.date || (/* @__PURE__ */ new Date()).toISOString(),
        auto: true,
        fromAccountNumber: user.bankAccount || ""
      };
      apiEndpoint = `${tenantResult.api_base_url}/api/banking/transactions/deposit-record`;
    } else {
      console.log("[submitCredit] \u{1F195} Non-member/new user - using first-time-deposit-record with userId:", user.id);
      payload = {
        userId: user.id,
        // Use userId instead of memberCode for first-time deposit
        creditAmount: slipData.amount?.amount || 0,
        depositChannel: "Mobile Banking (\u0E21\u0E37\u0E2D\u0E16\u0E37\u0E2D)",
        toAccountId,
        transferAt: slipData.date || (/* @__PURE__ */ new Date()).toISOString(),
        auto: true,
        fromAccountNumber: user.bankAccount || ""
      };
      apiEndpoint = `${tenantResult.api_base_url}/api/banking/transactions/first-time-deposit-record`;
    }
    console.log("[submitCredit] API Endpoint:", apiEndpoint);
    console.log("[submitCredit] Payload:", JSON.stringify(payload, null, 2));
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3e3);
    console.log("[submitCredit] \u{1F504} Calling backend API...");
    let response;
    try {
      response = await fetch(
        apiEndpoint,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${sessionResult.token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        }
      );
    } catch (fetchError) {
      clearTimeout(timeoutId);
      console.log(`[submitCredit] Fetch failed or timeout:`, fetchError);
      return {
        success: false,
        message: fetchError instanceof Error ? fetchError.message : "Fetch timeout or network error"
      };
    } finally {
      clearTimeout(timeoutId);
    }
    let result;
    try {
      result = await response.json();
    } catch (e) {
      console.error("[submitCredit] Failed to parse response:", e);
      return {
        success: false,
        message: `Credit failed: ${response.status} - Unable to parse response`
      };
    }
    console.log("[submitCredit] Response:", {
      status: response.status,
      ok: response.ok,
      message: result.message,
      hasData: !!result.data
    });
    const isDuplicateMessage = result.message === "DUPLICATE_WITH_ADMIN_RECORD";
    if (isDuplicateMessage) {
      console.log("[submitCredit] \u26A0\uFE0F Duplicate detected! Message:", result.message);
      return {
        success: true,
        isDuplicate: true,
        message: "\u26A0\uFE0F \u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E1D\u0E32\u0E01\u0E0B\u0E49\u0E33 - \u0E1E\u0E1A\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E19\u0E35\u0E49\u0E43\u0E19\u0E23\u0E30\u0E1A\u0E1A\u0E41\u0E25\u0E49\u0E27"
      };
    }
    if (!response.ok) {
      console.error("[submitCredit] Credit failed:", response.status, result.message);
      return {
        success: false,
        message: `Credit failed: ${response.status} - ${result.message || JSON.stringify(result)}`
      };
    }
    console.log("[submitCredit] \u2705 Credit submitted successfully");
    return { success: true };
  } catch (error) {
    console.error("Credit submission error:", error);
    return {
      success: false,
      message: error instanceof Error ? error.message : "Unknown error"
    };
  }
}
__name(submitCredit, "submitCredit");
async function withdrawCreditBack(env, tenantId, amount, memberCode, remark) {
  try {
    const tenantResult = await env.DB.prepare(
      `SELECT api_base_url FROM tenants WHERE tenant_id = ?`
    ).bind(tenantId).first();
    if (!tenantResult) {
      return { success: false, message: "Tenant not found" };
    }
    const sessionResult = await env.DB.prepare(
      `SELECT token FROM tenant_sessions WHERE tenant_id = ? AND status = 'ACTIVE'`
    ).bind(tenantId).first();
    if (!sessionResult) {
      return { success: false, message: "Session not active" };
    }
    const payload = {
      amount,
      remark,
      memberCode
    };
    console.log("[withdrawCreditBack] Calling API:", `${tenantResult.api_base_url}/api/banking/transactions/withdraw-credit-back`);
    console.log("[withdrawCreditBack] Payload:", payload);
    const response = await fetch(
      `${tenantResult.api_base_url}/api/banking/transactions/withdraw-credit-back`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sessionResult.token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      }
    );
    if (!response.ok) {
      const errorText = await response.text();
      console.error("[withdrawCreditBack] Failed:", errorText);
      return {
        success: false,
        message: `\u0E14\u0E36\u0E07\u0E40\u0E04\u0E23\u0E14\u0E34\u0E15\u0E01\u0E25\u0E31\u0E1A\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08: ${response.status} - ${errorText}`
      };
    }
    const result = await response.json();
    console.log("[withdrawCreditBack] Success:", result);
    return { success: true, message: result.message || "\u0E14\u0E36\u0E07\u0E40\u0E04\u0E23\u0E14\u0E34\u0E15\u0E01\u0E25\u0E31\u0E1A\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08" };
  } catch (error) {
    console.error("Withdraw credit back error:", error);
    return {
      success: false,
      message: error instanceof Error ? error.message : "Unknown error"
    };
  }
}
__name(withdrawCreditBack, "withdrawCreditBack");
async function findTenantForReceiver(env, receiverAccount, receiverName) {
  try {
    console.log(`
[findTenantForReceiver] \u{1F50D} Searching for tenant...`);
    console.log(`[findTenantForReceiver] Receiver Account: ${receiverAccount}`);
    console.log(`[findTenantForReceiver] Receiver Name: ${receiverName || "N/A"}`);
    const allTenants = await env.DB.prepare(
      `SELECT tenant_id, tenant_name FROM tenants ORDER BY tenant_name`
    ).all();
    if (!allTenants.results || allTenants.results.length === 0) {
      console.warn(`[findTenantForReceiver] \u26A0\uFE0F No tenants found in system`);
      return { found: false };
    }
    console.log(`[findTenantForReceiver] Found ${allTenants.results.length} tenants to check`);
    for (const tenant of allTenants.results) {
      console.log(`
[findTenantForReceiver] \u2713 Checking tenant: ${tenant.tenant_name} (${tenant.tenant_id})`);
      const cacheKey = `tenant:${tenant.tenant_id}:accounts`;
      let accounts = [];
      const cached = await env.SESSION_KV.get(cacheKey);
      if (cached) {
        try {
          const cacheData = JSON.parse(cached);
          accounts = cacheData.accounts || [];
          console.log(`[findTenantForReceiver]   \u2713 Using cached accounts (${accounts.length} accounts)`);
        } catch (e) {
          console.warn(`[findTenantForReceiver]   \u26A0\uFE0F Invalid cache, will skip this tenant`);
          continue;
        }
      } else {
        console.log(`[findTenantForReceiver]   \u26A0\uFE0F No cache, fetching from DB...`);
        try {
          const stmt = env.DB.prepare(
            "SELECT * FROM accounts WHERE tenant_id = ? AND is_deleted = 0 ORDER BY account_name ASC"
          );
          const result = await stmt.bind(tenant.tenant_id).all();
          accounts = result.results || [];
          console.log(`[findTenantForReceiver]   \u2713 Fetched ${accounts.length} accounts from DB`);
        } catch (dbError) {
          console.warn(`[findTenantForReceiver]   \u26A0\uFE0F Failed to fetch from DB for tenant ${tenant.tenant_id}:`, dbError);
          continue;
        }
      }
      let matchedAccount = accounts.find(
        (acc) => acc.accountNumber === receiverAccount || acc.accountNumber?.replace(/-/g, "") === receiverAccount?.replace(/-/g, "")
      );
      if (matchedAccount) {
        console.log(`[findTenantForReceiver]   \u2705 MATCHED by exact account number!`);
        return {
          found: true,
          tenantId: tenant.tenant_id,
          tenantName: tenant.tenant_name,
          accountId: matchedAccount.id || matchedAccount.accountId,
          matchMethod: "exact-account"
        };
      }
      if (receiverAccount && receiverAccount.includes("x")) {
        const visibleDigits = receiverAccount.replace(/[x-]/gi, "");
        if (visibleDigits.length >= 4) {
          matchedAccount = accounts.find((acc) => {
            const cleanAccountNumber = acc.accountNumber?.replace(/-/g, "") || "";
            return cleanAccountNumber.includes(visibleDigits);
          });
          if (matchedAccount) {
            console.log(`[findTenantForReceiver]   \u2705 MATCHED by partial digits (${visibleDigits})!`);
            return {
              found: true,
              tenantId: tenant.tenant_id,
              tenantName: tenant.tenant_name,
              accountId: matchedAccount.id || matchedAccount.accountId,
              matchMethod: "partial-digits"
            };
          }
        }
      }
      if (receiverName) {
        const normalizedReceiverName = receiverName.toUpperCase().trim();
        const receiverKeywords = normalizedReceiverName.split(/\s+/).filter((word) => word && word.length > 0);
        matchedAccount = accounts.find((acc) => {
          const accountName = (acc.accountName || "").toUpperCase().trim();
          const accountKeywords = accountName.split(/\s+/).filter((word) => word && word.length > 0);
          const exactMatch = accountName === normalizedReceiverName;
          const accountContainsReceiver = accountName.includes(normalizedReceiverName);
          const receiverContainsAccount = normalizedReceiverName.includes(accountName);
          const keywordMatch = receiverKeywords.some(
            (rKeyword) => accountKeywords.some((aKeyword) => {
              const exactKeywordMatch = aKeyword === rKeyword;
              const prefixMatch = aKeyword.length >= 4 && rKeyword.length >= 4 && (aKeyword.startsWith(rKeyword) || rKeyword.startsWith(aKeyword));
              const containsMatch = aKeyword.length >= 3 && rKeyword.length >= 3 && (aKeyword.includes(rKeyword) || rKeyword.includes(aKeyword));
              return exactKeywordMatch || prefixMatch || containsMatch;
            })
          );
          return exactMatch || accountContainsReceiver || receiverContainsAccount || keywordMatch;
        });
        if (matchedAccount) {
          console.log(`[findTenantForReceiver]   \u2705 MATCHED by name!`);
          return {
            found: true,
            tenantId: tenant.tenant_id,
            tenantName: tenant.tenant_name,
            accountId: matchedAccount.id || matchedAccount.accountId,
            matchMethod: "name"
          };
        }
      }
    }
    console.log(`[findTenantForReceiver] \u274C No tenant found with this receiver account`);
    return { found: false };
  } catch (error) {
    console.error(`[findTenantForReceiver] \u274C Error:`, error);
    return { found: false };
  }
}
__name(findTenantForReceiver, "findTenantForReceiver");
async function handleScanRequest(request, env, pathname) {
  if (pathname === "/api/scan/verify-slip" && request.method === "POST") {
    try {
      const formData = await request.formData();
      const tenantId = formData.get("tenantId");
      const file = formData.get("file");
      const url = formData.get("url");
      if (!tenantId) {
        return Response.json(
          { success: false, message: "Tenant ID required" },
          { status: 400 }
        );
      }
      let fileBuffer;
      if (file) {
        fileBuffer = await file.arrayBuffer();
      }
      const result = await verifySlip(env, tenantId, fileBuffer, url || void 0);
      return Response.json(result);
    } catch (error) {
      return Response.json(
        {
          success: false,
          message: error instanceof Error ? error.message : "Unknown error"
        },
        { status: 500 }
      );
    }
  }
  if (pathname === "/api/scan/match-account" && request.method === "POST") {
    try {
      const body = await request.json();
      const result = await matchAccount(
        env,
        body.tenantId,
        body.receiverAccount,
        body.receiverName,
        body.receiverRef3
      );
      return Response.json(result);
    } catch (error) {
      return Response.json(
        { matched: false, message: "Error matching account" },
        { status: 500 }
      );
    }
  }
  if (pathname === "/api/scan/search-user" && request.method === "POST") {
    try {
      const body = await request.json();
      const result = await searchUser(
        env,
        body.tenantId,
        body.searchName,
        body.maskedAccount,
        body.bankName
      );
      return Response.json(result);
    } catch (error) {
      return Response.json({ user: null }, { status: 500 });
    }
  }
  if (pathname === "/api/scan/submit-credit" && request.method === "POST") {
    try {
      const body = await request.json();
      console.log("[submit-credit] \u{1F4E5} Request received");
      console.log("[submit-credit] Tenant ID:", body.tenantId);
      console.log("[submit-credit] User:", body.user?.memberCode, body.user?.fullname);
      console.log("[submit-credit] Amount:", body.slipData?.amount?.amount);
      const transRef = body.slipData.transRef || body.slipData.ref1;
      console.log("[submit-credit] Transaction Reference:", transRef);
      if (transRef) {
        const existingTransaction = await env.DB.prepare(
          `SELECT id, status FROM pending_transactions WHERE tenant_id = ? AND slip_ref = ? LIMIT 1`
        ).bind(body.tenantId, transRef).first();
        if (existingTransaction) {
          const status = existingTransaction.status || "";
          const allowRetryStatuses = ["pending", "matched", "pending_verification"];
          if (allowRetryStatuses.includes(status)) {
            console.log("[submit-credit] \u2139\uFE0F Existing pending/matched record found - allowing retry");
            console.log("[submit-credit] Existing transaction ID:", existingTransaction.id);
            console.log("[submit-credit] Existing status:", status);
            console.log("[submit-credit] Slip ref:", transRef);
          } else {
            console.log("[submit-credit] \u26A0\uFE0F DUPLICATE DETECTED IN DB!");
            console.log("[submit-credit] Existing transaction ID:", existingTransaction.id);
            console.log("[submit-credit] Existing status:", status);
            console.log("[submit-credit] Slip ref:", transRef);
            return Response.json({
              success: false,
              isDuplicate: true,
              message: `\u26A0\uFE0F \u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E1D\u0E32\u0E01\u0E0B\u0E49\u0E33 - \u0E1E\u0E1A\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E19\u0E35\u0E49\u0E43\u0E19\u0E23\u0E30\u0E1A\u0E1A\u0E41\u0E25\u0E49\u0E27 (Status: ${status})`
            }, { status: 409 });
          }
        } else {
          console.log("[submit-credit] \u2705 No duplicate found in DB, proceeding to backend");
        }
      } else {
        console.warn("[submit-credit] \u26A0\uFE0F No transaction reference found - cannot check duplicate");
      }
      let toAccountId = body.toAccountId;
      if (!toAccountId) {
        const receiverAccount = body.slipData.receiver?.account?.bank?.account || body.slipData.receiver?.account?.value;
        const receiverName = body.slipData.receiver?.account?.name?.en || body.slipData.receiver?.account?.name?.th;
        const receiverRef3 = body.slipData.ref3 || "";
        console.log("[submit-credit] Receiver account to match:", receiverAccount);
        console.log("[submit-credit] Receiver name to match:", receiverName);
        console.log("[submit-credit] Receiver ref3 to match:", receiverRef3);
        const accountMatch = await matchAccount(
          env,
          body.tenantId,
          receiverAccount,
          receiverName,
          receiverRef3
        );
        console.log("[submit-credit] Account match result:", accountMatch);
        if (!accountMatch.matched || !accountMatch.accountId) {
          return Response.json(
            { success: false, message: "Account not matched" },
            { status: 400 }
          );
        }
        toAccountId = accountMatch.accountId;
      } else {
        console.log("[submit-credit] Using provided toAccountId:", toAccountId);
      }
      console.log("[submit-credit] Auto-credit enabled for manual-scan");
      const result = await submitCredit(
        env,
        body.tenantId,
        body.slipData,
        body.user,
        toAccountId
      );
      if (result.isDuplicate && transRef) {
        console.log("[submit-credit] Backend returned duplicate - saving to DB for tracking");
        try {
          const now = (/* @__PURE__ */ new Date()).toISOString();
          const existingDuplicate = await env.DB.prepare(
            `SELECT id, status FROM pending_transactions WHERE tenant_id = ? AND slip_ref = ? LIMIT 1`
          ).bind(body.tenantId, transRef).first();
          if (existingDuplicate) {
            await env.DB.prepare(`
              UPDATE pending_transactions
              SET status = ?, credited_at = ?
              WHERE id = ?
            `).bind("duplicate", now, existingDuplicate.id).run();
            console.log("[submit-credit] Duplicate transaction updated (existing row)");
          } else {
            const hasMemberCode = body.user.memberCode && body.user.memberCode.trim() !== "";
            const userLabel = hasMemberCode ? body.user.memberCode : "(\u0E22\u0E39\u0E2A\u0E40\u0E0B\u0E2D\u0E23\u0E4C\u0E43\u0E2B\u0E21\u0E48)";
            await env.DB.prepare(`
              INSERT INTO pending_transactions 
              (tenant_id, slip_data, user_data, status, amount, sender_account, sender_bank, receiver_account, created_at, slip_ref, credited_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
              body.tenantId,
              JSON.stringify(body.slipData),
              JSON.stringify({
                memberCode: userLabel,
                fullname: body.user.fullname,
                source: "manual-scan",
                timestamp: Date.now()
              }),
              "duplicate",
              body.slipData.amount?.amount || 0,
              body.user.fullname || body.user.username || "unknown",
              body.slipData.sender?.bank?.short || body.slipData.sender?.bank?.name || "unknown",
              body.slipData.receiver?.account?.bank?.account || body.slipData.receiver?.account?.value || "unknown",
              now,
              transRef,
              now
            ).run();
            console.log("[submit-credit] Duplicate transaction saved to DB");
          }
        } catch (dbError) {
          console.error("[submit-credit] Failed to save duplicate to DB:", dbError);
        }
        return Response.json({
          success: false,
          isDuplicate: true,
          message: result.message || "\u26A0\uFE0F \u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E1D\u0E32\u0E01\u0E0B\u0E49\u0E33 - \u0E1E\u0E1A\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E19\u0E35\u0E49\u0E43\u0E19\u0E23\u0E30\u0E1A\u0E1A\u0E41\u0E25\u0E49\u0E27"
        }, { status: 409 });
      }
      if (result.success && !result.isDuplicate && transRef) {
        let memberCodeDisplay = "";
        const hasMemberCode = body.user.memberCode && body.user.memberCode.trim() !== "";
        if (!hasMemberCode) {
          console.log("[submit-credit] \u{1F504} Non-member detected - fetching memberCode from API...");
          console.log("[submit-credit] User ID:", body.user.id, "Phone:", body.user.phone, "Fullname:", body.user.fullname);
          await new Promise((resolve) => setTimeout(resolve, 300));
          try {
            const tenantResult = await env.DB.prepare(
              `SELECT api_base_url FROM tenants WHERE tenant_id = ?`
            ).bind(body.tenantId).first();
            const sessionResult = await env.DB.prepare(
              `SELECT token FROM tenant_sessions WHERE tenant_id = ? AND status = 'ACTIVE'`
            ).bind(body.tenantId).first();
            if (tenantResult && sessionResult) {
              let users = [];
              if (body.user.phone) {
                const params1 = new URLSearchParams({
                  page: "1",
                  limit: "10",
                  userCategory: "member",
                  search: body.user.phone
                });
                console.log("[submit-credit] \u{1F50D} Searching by phone:", body.user.phone);
                const controller1 = new AbortController();
                const timeoutId1 = setTimeout(() => controller1.abort(), 3e3);
                try {
                  const response1 = await fetch(
                    `${tenantResult.api_base_url}/api/users/list?${params1.toString()}`,
                    {
                      headers: { Authorization: `Bearer ${sessionResult.token}` },
                      signal: controller1.signal
                    }
                  );
                  clearTimeout(timeoutId1);
                  if (response1.ok) {
                    const data1 = await response1.json();
                    users = data1.list || [];
                    console.log("[submit-credit] \u{1F4DE} Search by phone result:", users.length, "users");
                  }
                } catch (e) {
                  clearTimeout(timeoutId1);
                  console.warn("[submit-credit] \u26A0\uFE0F Search by phone failed:", e);
                }
              }
              if (users.length === 0 && body.user.fullname) {
                const params2 = new URLSearchParams({
                  page: "1",
                  limit: "10",
                  userCategory: "member",
                  search: body.user.fullname
                });
                console.log("[submit-credit] \u{1F50D} Searching by fullname:", body.user.fullname);
                const controller2 = new AbortController();
                const timeoutId2 = setTimeout(() => controller2.abort(), 3e3);
                try {
                  const response2 = await fetch(
                    `${tenantResult.api_base_url}/api/users/list?${params2.toString()}`,
                    {
                      headers: { Authorization: `Bearer ${sessionResult.token}` },
                      signal: controller2.signal
                    }
                  );
                  clearTimeout(timeoutId2);
                  if (response2.ok) {
                    const data2 = await response2.json();
                    users = data2.list || [];
                    console.log("[submit-credit] \u{1F464} Search by fullname result:", users.length, "users");
                  }
                } catch (e) {
                  clearTimeout(timeoutId2);
                  console.warn("[submit-credit] \u26A0\uFE0F Search by fullname failed:", e);
                }
              }
              if (users.length > 0 && users[0].memberCode) {
                memberCodeDisplay = users[0].memberCode.trim();
                console.log("[submit-credit] \u2705 Fetched memberCode:", memberCodeDisplay);
              } else {
                console.warn("[submit-credit] \u26A0\uFE0F No memberCode in API response, users found:", users.length);
                memberCodeDisplay = "(\u0E22\u0E39\u0E2A\u0E40\u0E0B\u0E2D\u0E23\u0E4C\u0E43\u0E2B\u0E21\u0E48)";
              }
            } else {
              console.warn("[submit-credit] \u26A0\uFE0F Missing tenant or session data");
              memberCodeDisplay = "(\u0E22\u0E39\u0E2A\u0E40\u0E0B\u0E2D\u0E23\u0E4C\u0E43\u0E2B\u0E21\u0E48)";
            }
          } catch (fetchError) {
            console.error("[submit-credit] \u274C Error fetching memberCode:", fetchError);
            memberCodeDisplay = "(\u0E22\u0E39\u0E2A\u0E40\u0E0B\u0E2D\u0E23\u0E4C\u0E43\u0E2B\u0E21\u0E48)";
          }
        } else {
          memberCodeDisplay = body.user.memberCode.trim();
          console.log("[submit-credit] \u{1F464} Member with existing memberCode:", memberCodeDisplay);
        }
        console.log("[submit-credit] Credit successful - updating DB status to credited");
        try {
          const now = (/* @__PURE__ */ new Date()).toISOString();
          const existingTransaction = await env.DB.prepare(
            `SELECT id FROM pending_transactions WHERE tenant_id = ? AND slip_ref = ? LIMIT 1`
          ).bind(body.tenantId, transRef).first();
          if (existingTransaction) {
            await env.DB.prepare(`
              UPDATE pending_transactions
              SET status = ?, credited_at = ?, user_data = ?
              WHERE id = ?
            `).bind(
              "credited",
              now,
              JSON.stringify({
                memberCode: memberCodeDisplay,
                fullname: body.user.fullname,
                source: "manual-scan",
                timestamp: Date.now()
              }),
              existingTransaction.id
            ).run();
            console.log("[submit-credit] \u2705 DB updated with memberCode:", memberCodeDisplay);
          } else {
            console.warn("[submit-credit] \u26A0\uFE0F Transaction not found in DB - cannot update status");
          }
        } catch (dbError) {
          console.error("[submit-credit] \u274C Failed to update DB status:", dbError);
        }
        if (body.user?.lineUserId) {
          console.log("[submit-credit] \u{1F4E9} Sending Flex Message to LINE user:", body.user.lineUserId);
          try {
            const lineOas = await getLineOas(env, body.tenantId);
            if (lineOas && lineOas.length > 0) {
              const lineOa = lineOas[0];
              const messageSettings = await getMessageSettings(env, body.tenantId);
              const flexMessage = createCreditedFlexMessage(
                body.slipData.amount?.amount || 0,
                memberCodeDisplay,
                body.user.fullname || "\u0E1C\u0E39\u0E49\u0E43\u0E0A\u0E49",
                body.slipData.date || (/* @__PURE__ */ new Date()).toISOString(),
                messageSettings
              );
              const sent = await pushFlexMessage(
                body.user.lineUserId,
                flexMessage,
                lineOa.accessToken
              );
              if (sent) {
                console.log("[submit-credit] \u2705 Flex Message sent successfully");
              } else {
                console.warn("[submit-credit] \u26A0\uFE0F Failed to send Flex Message");
              }
            } else {
              console.warn("[submit-credit] \u26A0\uFE0F No LINE OA configured - skipping Flex Message");
            }
          } catch (flexError) {
            console.error("[submit-credit] \u274C Error sending Flex Message:", flexError);
          }
        } else {
          console.log("[submit-credit] \u2139\uFE0F No LINE userId - skipping Flex Message");
        }
      }
      return Response.json(result);
    } catch (error) {
      return Response.json(
        {
          success: false,
          message: error instanceof Error ? error.message : "Unknown error"
        },
        { status: 500 }
      );
    }
  }
  if (pathname === "/api/scan/withdraw-credit-back" && request.method === "POST") {
    try {
      const body = await request.json();
      const result = await withdrawCreditBack(
        env,
        body.tenantId,
        body.amount,
        body.memberCode,
        body.remark
      );
      return Response.json(result);
    } catch (error) {
      return Response.json(
        { success: false, message: "Withdraw failed" },
        { status: 500 }
      );
    }
  }
  if (pathname === "/api/scan/check-duplicate" && request.method === "GET") {
    try {
      const url = new URL(request.url);
      const transRef = url.searchParams.get("ref");
      if (!transRef) {
        return Response.json({
          isDuplicate: false,
          message: "No transaction reference provided"
        });
      }
      const existingQuery = await env.DB.prepare(
        `SELECT COUNT(*) as count FROM pending_transactions WHERE slip_ref = ?`
      ).bind(transRef).first();
      const isDuplicate = (existingQuery?.count || 0) > 0;
      return Response.json({
        isDuplicate,
        transRef,
        message: isDuplicate ? "Transaction reference already used" : "Transaction reference is new"
      });
    } catch (error) {
      console.error("Check duplicate error:", error);
      return Response.json(
        { isDuplicate: false, error: "Failed to check duplicate" },
        { status: 500 }
      );
    }
  }
  if (pathname === "/api/scan/find-tenant" && request.method === "POST") {
    try {
      const body = await request.json();
      const result = await findTenantForReceiver(env, body.receiverAccount, body.receiverName);
      return Response.json(result);
    } catch (error) {
      console.error("Find tenant error:", error);
      return Response.json(
        { found: false, message: "Error finding tenant" },
        { status: 500 }
      );
    }
  }
  return Response.json({ error: "Not found" }, { status: 404 });
}
__name(handleScanRequest, "handleScanRequest");

// src/api/pending-transactions.ts
async function initPendingTransactionsTable(env) {
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS pending_transactions (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        line_user_id TEXT NOT NULL,
        amount REAL DEFAULT 0,
        bank_code TEXT DEFAULT '',
        slip_image TEXT,
        scan_result TEXT,
        status TEXT DEFAULT 'pending',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
      )
    `).run();
    console.log("[initPendingTransactionsTable] pending_transactions table ready");
  } catch (error) {
    console.error("[initPendingTransactionsTable] Error:", error);
  }
}
__name(initPendingTransactionsTable, "initPendingTransactionsTable");
async function getPendingTransactions2(env, tenantId, status) {
  try {
    await initPendingTransactionsTable(env);
    let query = `
      SELECT * FROM pending_transactions 
      WHERE tenant_id = ?
    `;
    const params = [tenantId];
    if (status) {
      query += ` AND status = ?`;
      params.push(status);
    }
    query += ` ORDER BY created_at DESC`;
    const results = await env.DB.prepare(query).bind(...params).all();
    return (results.results || []).map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      lineUserId: row.line_user_id,
      amount: row.amount || 0,
      bankCode: row.bank_code || "",
      slipImage: row.slip_image || "",
      scanResult: row.scan_result,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  } catch (error) {
    console.error("[getPendingTransactions] Error:", error);
    return [];
  }
}
__name(getPendingTransactions2, "getPendingTransactions");
async function getPendingTransaction(env, transactionId) {
  try {
    await initPendingTransactionsTable(env);
    const result = await env.DB.prepare(`
      SELECT * FROM pending_transactions WHERE id = ?
    `).bind(transactionId).first();
    if (!result)
      return null;
    return {
      id: result.id,
      tenantId: result.tenant_id,
      lineUserId: result.line_user_id,
      amount: result.amount || 0,
      bankCode: result.bank_code || "",
      slipImage: result.slip_image || "",
      scanResult: result.scan_result,
      status: result.status,
      createdAt: result.created_at,
      updatedAt: result.updated_at
    };
  } catch (error) {
    console.error("[getPendingTransaction] Error:", error);
    return null;
  }
}
__name(getPendingTransaction, "getPendingTransaction");
async function handlePendingTransactionsRequests(request, env, pathname) {
  const getMatch = pathname.match(/^\/api\/pending-transactions\/([^/]+)$/);
  if (request.method === "GET" && getMatch) {
    try {
      const tenantId = decodeURIComponent(getMatch[1]);
      const status = new URL(request.url).searchParams.get("status");
      const transactions = await getPendingTransactions2(env, tenantId, status || void 0);
      return new Response(JSON.stringify({ transactions }), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      });
    } catch (error) {
      console.error("[handlePendingTransactionsRequests] GET error:", error);
      return new Response(JSON.stringify({ error: "Failed to get transactions" }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }
  }
  const getOneMatch = pathname.match(/^\/api\/pending-transactions\/([^/]+)\/([^/]+)$/);
  if (request.method === "GET" && getOneMatch) {
    try {
      const transactionId = decodeURIComponent(getOneMatch[2]);
      const transaction = await getPendingTransaction(env, transactionId);
      if (!transaction) {
        return new Response(JSON.stringify({ error: "Transaction not found" }), {
          status: 404,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        });
      }
      return new Response(JSON.stringify({ transaction }), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      });
    } catch (error) {
      console.error("[handlePendingTransactionsRequests] GET one error:", error);
      return new Response(JSON.stringify({ error: "Failed to get transaction" }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }
  }
  return null;
}
__name(handlePendingTransactionsRequests, "handlePendingTransactionsRequests");

// src/api/account-names.ts
async function initAccountNameMappingsTable(env) {
  try {
    const result = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='account_name_mappings'`
    ).first();
    if (result) {
      console.log("[initAccountNameMappingsTable] Table already exists");
      return;
    }
    console.log("[initAccountNameMappingsTable] Creating account_name_mappings table...");
    await env.DB.exec(`
      CREATE TABLE IF NOT EXISTS account_name_mappings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        account_number TEXT NOT NULL,
        name_en TEXT NOT NULL,
        name_th TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, account_number),
        FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_account_name_mappings_tenant_id
      ON account_name_mappings(tenant_id);

      CREATE INDEX IF NOT EXISTS idx_account_name_mappings_account_number
      ON account_name_mappings(tenant_id, account_number);
    `);
    console.log("[initAccountNameMappingsTable] Table created successfully");
  } catch (error) {
    console.error("[initAccountNameMappingsTable] Error:", error);
  }
}
__name(initAccountNameMappingsTable, "initAccountNameMappingsTable");
async function handleAccountNamesRequest(request, env, pathname) {
  const method = request.method;
  const listMatch = pathname.match(/^\/api\/account-names\/tenant\/([^/]+)$/);
  if (method === "GET" && listMatch) {
    const tenantId = decodeURIComponent(listMatch[1]);
    return await listAccountNames(tenantId, env);
  }
  if (method === "POST" && pathname === "/api/account-names") {
    return await createAccountName(request, env);
  }
  const updateMatch = pathname.match(/^\/api\/account-names\/([0-9]+)$/);
  if (method === "PUT" && updateMatch) {
    const id = parseInt(updateMatch[1], 10);
    return await updateAccountName(id, request, env);
  }
  const deleteMatch = pathname.match(/^\/api\/account-names\/([0-9]+)$/);
  if (method === "DELETE" && deleteMatch) {
    const id = parseInt(deleteMatch[1], 10);
    return await deleteAccountName(id, env);
  }
  return new Response(
    JSON.stringify({
      error: "Not Found",
      message: `No handler for ${method} ${pathname}`
    }),
    { status: 404, headers: { "Content-Type": "application/json" } }
  );
}
__name(handleAccountNamesRequest, "handleAccountNamesRequest");
async function listAccountNames(tenantId, env) {
  try {
    const mappings = await env.DB.prepare(
      `SELECT id, tenant_id, account_number, name_en, name_th, created_at, updated_at
       FROM account_name_mappings
       WHERE tenant_id = ?
       ORDER BY created_at DESC`
    ).bind(tenantId).all();
    return new Response(
      JSON.stringify({
        success: true,
        data: mappings.results || [],
        count: (mappings.results || []).length
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error listing account names:", error);
    return new Response(
      JSON.stringify({
        error: "Internal Server Error",
        message: String(error)
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
__name(listAccountNames, "listAccountNames");
async function createAccountName(request, env) {
  try {
    const body = await request.json();
    if (!body.tenant_id || !body.account_number || !body.name_en) {
      return new Response(
        JSON.stringify({
          error: "Validation Error",
          message: "Missing required fields: tenant_id, account_number, name_en"
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    const cleanAccountNumber = body.account_number.replace(/-/g, "");
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const result = await env.DB.prepare(
      `INSERT INTO account_name_mappings (tenant_id, account_number, name_en, name_th, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id, account_number) DO UPDATE SET
       name_en = excluded.name_en,
       name_th = excluded.name_th,
       updated_at = excluded.updated_at`
    ).bind(body.tenant_id, cleanAccountNumber, body.name_en.trim(), body.name_th?.trim() || null, now, now).run();
    const mapping = await env.DB.prepare(
      `SELECT id, tenant_id, account_number, name_en, name_th, created_at, updated_at
       FROM account_name_mappings
       WHERE tenant_id = ? AND account_number = ?`
    ).bind(body.tenant_id, cleanAccountNumber).first();
    return new Response(
      JSON.stringify({
        success: true,
        data: mapping
      }),
      { status: 201, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error creating account name:", error);
    return new Response(
      JSON.stringify({
        error: "Internal Server Error",
        message: String(error)
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
__name(createAccountName, "createAccountName");
async function updateAccountName(id, request, env) {
  try {
    const body = await request.json();
    if (!body.name_en && !body.name_th) {
      return new Response(
        JSON.stringify({
          error: "Validation Error",
          message: "At least one field should be provided for update: name_en or name_th"
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const updates = [];
    const values = [];
    if (body.name_en) {
      updates.push("name_en = ?");
      values.push(body.name_en.trim());
    }
    if (body.name_th) {
      updates.push("name_th = ?");
      values.push(body.name_th.trim());
    }
    updates.push("updated_at = ?");
    values.push(now);
    values.push(id);
    const query = `UPDATE account_name_mappings SET ${updates.join(", ")} WHERE id = ?`;
    await env.DB.prepare(query).bind(...values).run();
    const mapping = await env.DB.prepare(
      `SELECT id, tenant_id, account_number, name_en, name_th, created_at, updated_at
       FROM account_name_mappings
       WHERE id = ?`
    ).bind(id).first();
    if (!mapping) {
      return new Response(
        JSON.stringify({
          error: "Not Found",
          message: "Account name mapping not found"
        }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(
      JSON.stringify({
        success: true,
        data: mapping
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error updating account name:", error);
    return new Response(
      JSON.stringify({
        error: "Internal Server Error",
        message: String(error)
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
__name(updateAccountName, "updateAccountName");
async function deleteAccountName(id, env) {
  try {
    const result = await env.DB.prepare(
      `DELETE FROM account_name_mappings WHERE id = ?`
    ).bind(id).run();
    if (result.meta?.changes === 0) {
      return new Response(
        JSON.stringify({
          error: "Not Found",
          message: "Account name mapping not found"
        }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(
      JSON.stringify({
        success: true,
        message: "Account name mapping deleted successfully"
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error deleting account name:", error);
    return new Response(
      JSON.stringify({
        error: "Internal Server Error",
        message: String(error)
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
__name(deleteAccountName, "deleteAccountName");

// src/index.ts
function addCorsHeaders(response) {
  const newResponse = new Response(response.body, response);
  newResponse.headers.set("Access-Control-Allow-Origin", "*");
  newResponse.headers.set(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS"
  );
  newResponse.headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
  newResponse.headers.set("Access-Control-Max-Age", "86400");
  return newResponse;
}
__name(addCorsHeaders, "addCorsHeaders");
function handleCorsPreFlight(request) {
  if (request.method === "OPTIONS") {
    return addCorsHeaders(
      new Response(null, {
        status: 204
      })
    );
  }
  return null;
}
__name(handleCorsPreFlight, "handleCorsPreFlight");
var src_default = {
  async fetch(request, env, ctx) {
    await initLineOaTable(env);
    await initPendingTransactionsTable(env);
    await initAccountNameMappingsTable(env);
    const corsResponse = handleCorsPreFlight(request);
    if (corsResponse)
      return corsResponse;
    const url = new URL(request.url);
    const pathname = url.pathname;
    let response;
    const adminLoginMatch = pathname.match(/^\/api\/tenants\/([^/]+)\/admin-login$/);
    if (request.method === "POST" && adminLoginMatch) {
      const tenantId = decodeURIComponent(adminLoginMatch[1]);
      response = await handleAdminLogin(request, env, tenantId);
    } else if (pathname.match(/^\/api\/tenants\/([^/]+)\/logout$/)) {
      const logoutMatch = pathname.match(/^\/api\/tenants\/([^/]+)\/logout$/);
      const tenantId = decodeURIComponent(logoutMatch[1]);
      response = await handleLogout(request, env, tenantId);
    } else if (pathname.startsWith("/api/scan/")) {
      if (pathname.startsWith("/api/scan/pending")) {
        response = await handlePendingRequests(request, env, pathname);
      } else {
        response = await handleScanRequest(request, env, pathname);
      }
    } else if (pathname.match(/^\/api\/tenants\/[^\/]+\/line-oas/)) {
      const lineOaResponse = await handleLineOaRequests(request, env, pathname);
      if (lineOaResponse) {
        response = lineOaResponse;
      } else {
        response = new Response("Not found", { status: 404 });
      }
    } else if (pathname.startsWith("/api/message-settings")) {
      const msgSettingsResponse = await handleMessageSettingsRequests(request, env, pathname);
      if (msgSettingsResponse) {
        response = msgSettingsResponse;
      } else {
        response = new Response("Not found", { status: 404 });
      }
    } else if (pathname.startsWith("/api/pending-transactions")) {
      const pendingResponse = await handlePendingTransactionsRequests(request, env, pathname);
      if (pendingResponse) {
        response = pendingResponse;
      } else {
        response = new Response("Not found", { status: 404 });
      }
    } else if (pathname.startsWith("/api/account-names")) {
      response = await handleAccountNamesRequest(request, env, pathname);
    } else if (pathname.startsWith("/api/settings/")) {
      response = await handleSettingsRequests(request, env, pathname);
    } else if (pathname === "/api/line-config") {
      response = await handleLineConfig(request, env);
    } else if (pathname === "/api/easyslip") {
      response = await handleEasySlipConfig(request, env);
    } else if (pathname.startsWith("/api/tenants")) {
      response = await handleTenantsRequest(request, env, pathname);
    } else if (pathname.startsWith("/webhook/")) {
      const webhookResponse = await handleWebhookRequests(request, env, ctx, pathname);
      if (webhookResponse) {
        response = webhookResponse;
      } else {
        response = new Response("Not found", { status: 404 });
      }
    } else if (pathname === "/health") {
      response = Response.json({ status: "ok", time: (/* @__PURE__ */ new Date()).toISOString() });
    } else {
      response = new Response("Auto Deposit Worker is running", { status: 200 });
    }
    return addCorsHeaders(response);
  },
  // Scheduled handler for cron jobs
  async scheduled(event, env, ctx) {
    console.log("[cron] Running scheduled cleanup at", (/* @__PURE__ */ new Date()).toISOString());
    try {
      const deletedCount = await cleanupOldPending(env);
      console.log(`[cron] Cleanup completed: Deleted ${deletedCount} old pending transactions`);
    } catch (error) {
      console.error("[cron] Cleanup failed:", error);
    }
  }
};
export {
  src_default as default
};
//# sourceMappingURL=index.js.map
