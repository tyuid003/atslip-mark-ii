// Admin Login API - Handle admin authentication

import { getTenant } from '../database/tenant-repository';

export async function handleAdminLogin(
  request: Request,
  env: any,
  tenantId: string
): Promise<Response> {
  try {
    const body = await request.json() as any;

    if (!body.username || !body.password || !body.captchaId || !body.captchaCode) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Missing required fields"
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Login to backend system
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
        } catch (te) {}
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

    let loginData: any;
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

    // Verify token by getting admin info
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
      } catch (e) {}

      return new Response(
        JSON.stringify({
          success: false,
          message: `Token verification failed: ${errorDetail} (URL: ${meUrl})`
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    let meData: any;
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
    const now = new Date().toISOString();

    // Save token to database
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

    // Save to KV cache
    await env.SESSION_KV.put(
      `tenant:${tenantId}:session`,
      JSON.stringify({
        token,
        username,
        status: "ACTIVE",
        lastValidatedAt: now
      })
    );

    // Prefetch account list
    try {
      const accountListUrl = `${body.apiBaseUrl}/api/summary-report/account-list`;
      console.log(`Prefetching account list for tenant ${tenantId}`);
      
      const accountResponse = await fetch(accountListUrl, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (accountResponse.ok) {
        const accountData = await accountResponse.json();
        const accounts = Array.isArray(accountData) ? accountData : accountData.list || [];
        
        const cacheTtl = 300;
        await env.SESSION_KV.put(
          `tenant:${tenantId}:accounts`,
          JSON.stringify({
            accounts,
            cachedAt: now
          }),
          { expirationTtl: cacheTtl }
        );
      }
    } catch (prefetchError) {
      console.error("Account list prefetch error:", prefetchError);
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
