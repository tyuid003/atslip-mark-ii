// API: Toggle Auto Deposit Enabled
// PATCH /api/tenants/:id/auto-deposit

import { jsonResponse, errorResponse } from '../utils/helpers';

interface Env {
  DB: D1Database;
}

export const AutoDepositAPI = {
  async handleToggleAutoDeposit(env: Env, request: Request, tenantId: string): Promise<Response> {
    try {
      const body = await request.json() as { enabled?: boolean };
      if (typeof body.enabled !== 'boolean') {
        return errorResponse('enabled must be a boolean', 400);
      }

      const existingTenant = await env.DB.prepare(
        'SELECT id FROM tenants WHERE id = ? LIMIT 1'
      )
        .bind(tenantId)
        .first();

      if (!existingTenant) {
        return errorResponse('Tenant not found', 404);
      }

      const enabled = body.enabled ? 1 : 0;
      const now = Math.floor(Date.now() / 1000);

      // Update auto_deposit_enabled
      const result = await env.DB.prepare(
        'UPDATE tenants SET auto_deposit_enabled = ?, updated_at = ? WHERE id = ?'
      )
        .bind(enabled, now, tenantId)
        .run();

      if (!result.success) {
        return errorResponse('Failed to update auto deposit setting', 500);
      }

      // Get updated tenant
      const tenant = await env.DB.prepare(
        'SELECT id, name, auto_deposit_enabled FROM tenants WHERE id = ?'
      )
        .bind(tenantId)
        .first();

      return jsonResponse({
        success: true,
        data: {
          tenant_id: tenantId,
          auto_deposit_enabled: Number(tenant?.auto_deposit_enabled || 0) === 1,
        },
      });
    } catch (error: any) {
      return errorResponse(error.message, 500);
    }
  },
};
