import type { Env } from '../types';
import {
  successResponse,
  errorResponse,
  parseRequestBody,
  validateRequired,
} from '../utils/helpers';
import * as LineOAService from '../services/lineoa.service';

// ============================================================
// GET /api/tenants/:tenantId/line-oas - รายการ LINE OA ของ tenant
// ============================================================

export async function handleGetLineOAs(
  env: Env,
  tenantId: string
): Promise<Response> {
  try {
    const lineOAs = await LineOAService.getLineOAsByTenant(env, tenantId);
    return successResponse(lineOAs);
  } catch (error: any) {
    return errorResponse(error.message, 500);
  }
}

// ============================================================
// GET /api/line-oas/:id - ข้อมูล LINE OA ตาม ID
// ============================================================

export async function handleGetLineOA(
  env: Env,
  lineOAId: string
): Promise<Response> {
  try {
    const lineOA = await LineOAService.getLineOAById(env, lineOAId);

    if (!lineOA) {
      return errorResponse('LINE OA not found', 404);
    }

    return successResponse(lineOA);
  } catch (error: any) {
    return errorResponse(error.message, 500);
  }
}

// ============================================================
// POST /api/tenants/:tenantId/line-oas - สร้าง LINE OA ใหม่
// ============================================================

export async function handleCreateLineOA(
  request: Request,
  env: Env,
  tenantId: string
): Promise<Response> {
  try {
    const body = await parseRequestBody<any>(request);

    validateRequired(body, [
      'name',
      'channel_id',
      'channel_secret',
      'channel_access_token',
    ]);

    const lineOA = await LineOAService.createLineOA(env, {
      tenant_id: tenantId,
      name: body.name,
      channel_id: body.channel_id,
      channel_secret: body.channel_secret,
      channel_access_token: body.channel_access_token,
    });

    return successResponse(lineOA, 'LINE OA created successfully');
  } catch (error: any) {
    return errorResponse(error.message, 400);
  }
}

// ============================================================
// PUT /api/line-oas/:id - อัพเดท LINE OA
// ============================================================

export async function handleUpdateLineOA(
  request: Request,
  env: Env,
  lineOAId: string
): Promise<Response> {
  try {
    const body = await parseRequestBody<any>(request);

    const lineOA = await LineOAService.updateLineOA(env, lineOAId, {
      name: body.name,
      channel_id: body.channel_id,
      channel_secret: body.channel_secret,
      channel_access_token: body.channel_access_token,
      webhook_enabled: body.webhook_enabled,
      status: body.status,
    });

    if (!lineOA) {
      return errorResponse('LINE OA not found', 404);
    }

    return successResponse(lineOA, 'LINE OA updated successfully');
  } catch (error: any) {
    return errorResponse(error.message, 400);
  }
}

// ============================================================
// DELETE /api/line-oas/:id - ลบ LINE OA
// ============================================================

export async function handleDeleteLineOA(
  env: Env,
  lineOAId: string
): Promise<Response> {
  try {
    await LineOAService.deleteLineOA(env, lineOAId);
    return successResponse(null, 'LINE OA deleted successfully');
  } catch (error: any) {
    return errorResponse(error.message, 500);
  }
}
