/**
 * AT SLIP - Auto Deposit System
 * Cloudflare Workers Application
 * 
 * This is the main entry point for the Auto Deposit Worker.
 * It handles all incoming HTTP requests and routes them to appropriate handlers.
 */

import { handleAdminLogin } from './api/admin-login';
import { handleLogout } from './api/logout';
import { handleLineWebhook } from './webhooks/line';
import { getTenant, listTenants, upsertTenant, deleteTenant, Tenant, TenantSettings } from './database/tenant-repository';

/**
 * Main fetch handler - processes all HTTP requests
 */
async function handleFetch(request: Request, env: any, ctx: any): Promise<Response> {
  // Initialize tables
  await initializeTables(env);

  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return addCorsHeaders(
      new Response(null, { status: 204 })
    );
  }

  const url = new URL(request.url);
  const pathname = url.pathname;

  let response: Response;

  // Route requests
  if (pathname.startsWith("/api/tenants")) {
    response = await handleTenantsRequest(request, env, pathname);
  } else if (pathname.match(/^\/api\/tenants\/[^/]+\/admin-login$/)) {
    const match = pathname.match(/^\/api\/tenants\/([^/]+)\/admin-login$/);
    if (match && request.method === "POST") {
      const tenantId = decodeURIComponent(match[1]);
      response = await handleAdminLogin(request, env, tenantId);
    } else {
      response = new Response("Not found", { status: 404 });
    }
  } else if (pathname.match(/^\/api\/tenants\/[^/]+\/logout$/)) {
    const match = pathname.match(/^\/api\/tenants\/([^/]+)\/logout$/);
    if (match) {
      const tenantId = decodeURIComponent(match[1]);
      response = await handleLogout(request, env, tenantId);
    } else {
      response = new Response("Not found", { status: 404 });
    }
  } else if (pathname.startsWith("/webhook/")) {
    const webhookMatch = pathname.match(/^\/webhook\/([^/\s]+)\/([^/\s]+)$/);
    if (webhookMatch && request.method === "POST") {
      const tenantId = decodeURIComponent(webhookMatch[1]);
      const oaId = decodeURIComponent(webhookMatch[2]);
      response = await handleLineWebhook(request, env, ctx, tenantId, oaId);
    } else {
      response = new Response("OK", { status: 200 });
    }
  } else if (pathname === "/health") {
    response = new Response(
      JSON.stringify({ status: "ok", time: new Date().toISOString() }),
      { headers: { "Content-Type": "application/json" } }
    );
  } else {
    response = new Response("Auto Deposit Worker is running", { status: 200 });
  }

  return addCorsHeaders(response);
}

/**
 * Initialize database tables
 */
async function initializeTables(env: any): Promise<void> {
  // This would contain table initialization logic
  // Stub for now
}

/**
 * Handle tenant CRUD operations
 */
async function handleTenantsRequest(
  request: Request,
  env: any,
  pathname: string
): Promise<Response> {
  if (request.method === "POST" && pathname === "/api/tenants") {
    return await createOrUpdateTenant(request, env);
  } else if (request.method === "GET" && pathname === "/api/tenants") {
    return await getAllTenants(env);
  }

  const idMatch = pathname.match(/^\/api\/tenants\/([^/]+)$/);
  if (idMatch) {
    const tenantId = decodeURIComponent(idMatch[1]);
    if (request.method === "GET") {
      return await getTenantById(tenantId, env);
    } else if (request.method === "DELETE") {
      return await deleteTenantById(tenantId, env);
    }
  }

  return new Response(
    JSON.stringify({ error: "Not Found" }),
    { status: 404, headers: { "Content-Type": "application/json" } }
  );
}

/**
 * Create or update tenant
 */
async function createOrUpdateTenant(request: Request, env: any): Promise<Response> {
  try {
    const body = await request.json() as any;

    if (!body.tenantId || !body.tenantName || !body.apiBaseUrl) {
      return new Response(
        JSON.stringify({
          error: "Validation Error",
          message: "Missing required fields: tenantId, tenantName, apiBaseUrl"
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const settings: TenantSettings = {
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

/**
 * Get all tenants
 */
async function getAllTenants(env: any): Promise<Response> {
  try {
    const tenants = await listTenants(env);
    return new Response(
      JSON.stringify({ tenants, total: tenants.length }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      }
    );
  } catch (error) {
    console.error("Error in getAllTenants:", error);
    return new Response(
      JSON.stringify({
        error: "Internal Server Error",
        message: error instanceof Error ? error.message : "Unknown error"
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
}

/**
 * Get single tenant by ID
 */
async function getTenantById(tenantId: string, env: any): Promise<Response> {
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

    return new Response(
      JSON.stringify(tenant),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
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

/**
 * Delete tenant by ID
 */
async function deleteTenantById(tenantId: string, env: any): Promise<Response> {
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

/**
 * Add CORS headers to response
 */
function addCorsHeaders(response: Response): Response {
  const newResponse = new Response(response.body, response);
  newResponse.headers.set("Access-Control-Allow-Origin", "*");
  newResponse.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  newResponse.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  newResponse.headers.set("Access-Control-Max-Age", "86400");
  return newResponse;
}

/**
 * Scheduled task handler for cleanup
 */
async function handleScheduled(event: any, env: any, ctx: any): Promise<void> {
  console.log("[cron] Running scheduled cleanup at", new Date().toISOString());
  try {
    // Run cleanup tasks
    const deletedCount = await cleanupOldPending(env);
    console.log(`[cron] Cleanup completed: Deleted ${deletedCount} old pending transactions`);
  } catch (error) {
    console.error("[cron] Cleanup failed:", error);
  }
}

/**
 * Clean up old pending transactions
 */
async function cleanupOldPending(env: any): Promise<number> {
  try {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const result = await env.DB.prepare(`
      DELETE FROM pending_transactions 
      WHERE created_at < ? AND status != 'credited'
    `).bind(oneDayAgo).run();

    return result.meta?.changes || 0;
  } catch (error) {
    console.error("Error cleaning up old pending:", error);
    return 0;
  }
}

// Export handlers
export default {
  fetch: handleFetch,
  scheduled: handleScheduled
};
