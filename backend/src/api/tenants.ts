import type { Env } from '../types';
import {
  successResponse,
  errorResponse,
  parseRequestBody,
  validateRequired,
} from '../utils/helpers';
import * as TenantService from '../services/tenant.service';

// ============================================================
// GET /api/tenants - รายการ tenant ทั้งหมด
// ============================================================

export async function handleGetTenants(env: Env): Promise<Response> {
  try {
    const tenants = await TenantService.getAllTenants(env);
    return successResponse(tenants);
  } catch (error: any) {
    return errorResponse(error.message, 500);
  }
}

// ============================================================
// GET /api/tenants/:id - ข้อมูล tenant ตาม ID
// ============================================================

export async function handleGetTenant(
  env: Env,
  tenantId: string
): Promise<Response> {
  try {
    const tenant = await TenantService.getTenantById(env, tenantId);

    if (!tenant) {
      return errorResponse('Tenant not found', 404);
    }

    return successResponse(tenant);
  } catch (error: any) {
    return errorResponse(error.message, 500);
  }
}

// ============================================================
// POST /api/tenants - สร้าง tenant ใหม่
// ============================================================

export async function handleCreateTenant(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const body = await parseRequestBody<any>(request);

    validateRequired(body, [
      'name',
      'admin_api_url',
      'admin_username',
      'admin_password',
      'easyslip_token',
    ]);

    const tenant = await TenantService.createTenant(env, {
      name: body.name,
      admin_api_url: body.admin_api_url,
      admin_username: body.admin_username,
      admin_password: body.admin_password,
      easyslip_token: body.easyslip_token,
    });

    return successResponse(tenant, 'Tenant created successfully');
  } catch (error: any) {
    return errorResponse(error.message, 400);
  }
}

// ============================================================
// PUT /api/tenants/:id - อัพเดท tenant
// ============================================================

export async function handleUpdateTenant(
  request: Request,
  env: Env,
  tenantId: string
): Promise<Response> {
  try {
    const body = await parseRequestBody<any>(request);

    const tenant = await TenantService.updateTenant(env, tenantId, {
      name: body.name,
      admin_api_url: body.admin_api_url,
      admin_username: body.admin_username,
      admin_password: body.admin_password,
      easyslip_token: body.easyslip_token,
      status: body.status,
    });

    if (!tenant) {
      return errorResponse('Tenant not found', 404);
    }

    return successResponse(tenant, 'Tenant updated successfully');
  } catch (error: any) {
    return errorResponse(error.message, 400);
  }
}

// ============================================================
// DELETE /api/tenants/:id - ลบ tenant
// ============================================================

export async function handleDeleteTenant(
  env: Env,
  tenantId: string
): Promise<Response> {
  try {
    await TenantService.deleteTenant(env, tenantId);
    return successResponse(null, 'Tenant deleted successfully');
  } catch (error: any) {
    return errorResponse(error.message, 500);
  }
}

// ============================================================
// POST /api/tenants/:id/connect - เชื่อมต่อ admin และดึงบัญชีธนาคาร
// ============================================================

export async function handleConnectAdmin(
  env: Env,
  tenantId: string
): Promise<Response> {
  try {
    const result = await TenantService.connectAdmin(env, tenantId);

    if (!result.success) {
      return errorResponse(result.error || 'Connection failed', 400);
    }

    return successResponse(
      {
        connected: true,
        accounts: result.accounts,
        account_count: result.accounts?.length || 0,
      },
      'Connected to admin successfully'
    );
  } catch (error: any) {
    return errorResponse(error.message, 500);
  }
}

// ============================================================
// GET /api/tenants/:id/accounts - ดูรายชื่อบัญชีธนาคาร
// ============================================================

export async function handleGetBankAccounts(
  env: Env,
  tenantId: string
): Promise<Response> {
  try {
    const accounts = await TenantService.getBankAccounts(env, tenantId);

    if (!accounts) {
      return errorResponse(
        'No bank accounts found. Please connect to admin first.',
        404
      );
    }

    return successResponse(accounts);
  } catch (error: any) {
    return errorResponse(error.message, 500);
  }
}

// ============================================================
// POST /api/tenants/:id/disconnect - ยกเลิกการเชื่อมต่อ admin
// ============================================================

export async function handleDisconnectAdmin(
  env: Env,
  tenantId: string
): Promise<Response> {
  try {
    await TenantService.disconnectAdmin(env, tenantId);
    return successResponse(null, 'Disconnected from admin successfully');
  } catch (error: any) {
    return errorResponse(error.message, 500);
  }
}
