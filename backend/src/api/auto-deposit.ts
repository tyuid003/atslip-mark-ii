// API: Toggle Auto Deposit Enabled
// PATCH /api/tenants/:id/auto-deposit

interface Env {
  DB: D1Database;
}

export const AutoDepositAPI = {
  async handleToggleAutoDeposit(env: Env, request: Request, tenantId: string): Promise<Response> {
    try {
      const body = await request.json() as { enabled: boolean };
      const enabled = body.enabled ? 1 : 0;
      const now = Math.floor(Date.now() / 1000);

      // Update auto_deposit_enabled
      const result = await env.DB.prepare(
        'UPDATE tenants SET auto_deposit_enabled = ?, updated_at = ? WHERE id = ?'
      )
        .bind(enabled, now, tenantId)
        .run();

      if (!result.success) {
        return Response.json(
          { success: false, error: 'Failed to update auto deposit setting' },
          { status: 500 }
        );
      }

      // Get updated tenant
      const tenant = await env.DB.prepare(
        'SELECT id, name, auto_deposit_enabled FROM tenants WHERE id = ?'
      )
        .bind(tenantId)
        .first();

      return Response.json({
        success: true,
        data: {
          tenant_id: tenantId,
          auto_deposit_enabled: tenant?.auto_deposit_enabled === 1,
        },
      });
    } catch (error: any) {
      return Response.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }
  },
};
