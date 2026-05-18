import type { Env } from '../types';
import { errorResponse, parseRequestBody, successResponse } from '../utils/helpers';
import {
  getOrCreateLineMessageSettings,
  updateLineMessageSettings,
} from '../services/line-message-settings.service';

export async function handleGetLineMessageSettings(
  env: Env,
  lineOAId: string
): Promise<Response> {
  try {
    const lineOA = await env.DB.prepare(
      `SELECT id, tenant_id FROM line_oas WHERE id = ? LIMIT 1`
    )
      .bind(lineOAId)
      .first<{ id: string; tenant_id: string }>();

    if (!lineOA) {
      return errorResponse('LINE OA not found', 404);
    }

    const settings = await getOrCreateLineMessageSettings(env, lineOAId, lineOA.tenant_id);
    return successResponse(settings);
  } catch (error: any) {
    return errorResponse(error.message || 'Failed to load LINE message settings', 500);
  }
}

export async function handleUpdateLineMessageSettings(
  request: Request,
  env: Env,
  lineOAId: string
): Promise<Response> {
  try {
    const lineOA = await env.DB.prepare(
      `SELECT id, tenant_id FROM line_oas WHERE id = ? LIMIT 1`
    )
      .bind(lineOAId)
      .first<{ id: string; tenant_id: string }>();

    if (!lineOA) {
      return errorResponse('LINE OA not found', 404);
    }

    const payload = await parseRequestBody<any>(request);
    const settings = await updateLineMessageSettings(env, lineOAId, lineOA.tenant_id, payload);
    return successResponse(settings, 'LINE message settings updated');
  } catch (error: any) {
    return errorResponse(error.message || 'Failed to update LINE message settings', 400);
  }
}
