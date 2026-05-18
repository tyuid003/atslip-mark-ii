// Logout API - Handle admin logout

export async function handleLogout(
  request: Request,
  env: any,
  tenantId: string
): Promise<Response> {
  try {
    console.log(`[logout] Starting logout for tenant: ${tenantId}`);

    // Get session info
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
        message: "ไม่พบ session ที่ต้อง logout"
      }, { status: 404 });
    }

    const token = sessionQuery.token;
    const apiBaseUrl = sessionQuery.api_base_url;

    // Call logout API on target system
    try {
      console.log(`[logout] Calling logout API: ${apiBaseUrl}/th/wait-signout`);
      await fetch(`${apiBaseUrl}/th/wait-signout`, {
        method: "GET",
        headers: {
          "Cookie": `access-token=${token}`
        }
      });
    } catch (error) {
      console.warn("[logout] Target system logout failed, continuing local cleanup:", error);
    }

    // Delete from database
    await env.DB.prepare("DELETE FROM tenant_sessions WHERE tenant_id = ?").bind(tenantId).run();
    console.log(`[logout] Deleted session from database`);

    // Delete from KV cache
    await env.SESSION_KV.delete(`session:${tenantId}`);
    await env.SESSION_KV.delete(`tenant:${tenantId}:accounts`);
    console.log(`[logout] Deleted KV cache entries`);

    return Response.json({
      success: true,
      message: "Logout สำเร็จ",
      tenantId
    });
  } catch (error) {
    console.error("[logout] Error:", error);
    return Response.json({
      success: false,
      message: error instanceof Error ? error.message : "Logout failed"
    }, { status: 500 });
  }
}
