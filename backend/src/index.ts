import type { Env } from './types';
import { handleOptions, errorResponse } from './utils/helpers';
import * as TenantsAPI from './api/tenants';
import * as LineOAsAPI from './api/lineoas';

// ============================================================
// MAIN ROUTER
// ============================================================

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return handleOptions();
    }

    // ============================================================
    // TENANTS ROUTES
    // ============================================================

    // GET /api/tenants - ดูรายการ tenant ทั้งหมด
    if (method === 'GET' && pathname === '/api/tenants') {
      return await TenantsAPI.handleGetTenants(env);
    }

    // POST /api/tenants - สร้าง tenant ใหม่
    if (method === 'POST' && pathname === '/api/tenants') {
      return await TenantsAPI.handleCreateTenant(request, env);
    }

    // GET /api/tenants/:id - ดูข้อมูล tenant
    const getTenantMatch = pathname.match(/^\/api\/tenants\/([^\/]+)$/);
    if (method === 'GET' && getTenantMatch) {
      const tenantId = decodeURIComponent(getTenantMatch[1]);
      return await TenantsAPI.handleGetTenant(env, tenantId);
    }

    // PUT /api/tenants/:id - แก้ไข tenant
    const updateTenantMatch = pathname.match(/^\/api\/tenants\/([^\/]+)$/);
    if (method === 'PUT' && updateTenantMatch) {
      const tenantId = decodeURIComponent(updateTenantMatch[1]);
      return await TenantsAPI.handleUpdateTenant(request, env, tenantId);
    }

    // DELETE /api/tenants/:id - ลบ tenant
    const deleteTenantMatch = pathname.match(/^\/api\/tenants\/([^\/]+)$/);
    if (method === 'DELETE' && deleteTenantMatch) {
      const tenantId = decodeURIComponent(deleteTenantMatch[1]);
      return await TenantsAPI.handleDeleteTenant(env, tenantId);
    }

    // POST /api/tenants/:id/connect - เชื่อมต่อ admin
    const connectMatch = pathname.match(/^\/api\/tenants\/([^\/]+)\/connect$/);
    if (method === 'POST' && connectMatch) {
      const tenantId = decodeURIComponent(connectMatch[1]);
      return await TenantsAPI.handleConnectAdmin(env, tenantId);
    }

    // GET /api/tenants/:id/accounts - ดูบัญชีธนาคาร
    const accountsMatch = pathname.match(
      /^\/api\/tenants\/([^\/]+)\/accounts$/
    );
    if (method === 'GET' && accountsMatch) {
      const tenantId = decodeURIComponent(accountsMatch[1]);
      return await TenantsAPI.handleGetBankAccounts(env, tenantId);
    }

    // POST /api/tenants/:id/disconnect - ยกเลิกการเชื่อมต่อ
    const disconnectMatch = pathname.match(
      /^\/api\/tenants\/([^\/]+)\/disconnect$/
    );
    if (method === 'POST' && disconnectMatch) {
      const tenantId = decodeURIComponent(disconnectMatch[1]);
      return await TenantsAPI.handleDisconnectAdmin(env, tenantId);
    }

    // ============================================================
    // LINE OA ROUTES
    // ============================================================

    // GET /api/tenants/:tenantId/line-oas - ดูรายการ LINE OA
    const getLineOAsMatch = pathname.match(
      /^\/api\/tenants\/([^\/]+)\/line-oas$/
    );
    if (method === 'GET' && getLineOAsMatch) {
      const tenantId = decodeURIComponent(getLineOAsMatch[1]);
      return await LineOAsAPI.handleGetLineOAs(env, tenantId);
    }

    // POST /api/tenants/:tenantId/line-oas - สร้าง LINE OA
    const createLineOAMatch = pathname.match(
      /^\/api\/tenants\/([^\/]+)\/line-oas$/
    );
    if (method === 'POST' && createLineOAMatch) {
      const tenantId = decodeURIComponent(createLineOAMatch[1]);
      return await LineOAsAPI.handleCreateLineOA(request, env, tenantId);
    }

    // GET /api/line-oas/:id - ดูข้อมูล LINE OA
    const getLineOAMatch = pathname.match(/^\/api\/line-oas\/([^\/]+)$/);
    if (method === 'GET' && getLineOAMatch) {
      const lineOAId = decodeURIComponent(getLineOAMatch[1]);
      return await LineOAsAPI.handleGetLineOA(env, lineOAId);
    }

    // PUT /api/line-oas/:id - แก้ไข LINE OA
    const updateLineOAMatch = pathname.match(/^\/api\/line-oas\/([^\/]+)$/);
    if (method === 'PUT' && updateLineOAMatch) {
      const lineOAId = decodeURIComponent(updateLineOAMatch[1]);
      return await LineOAsAPI.handleUpdateLineOA(request, env, lineOAId);
    }

    // DELETE /api/line-oas/:id - ลบ LINE OA
    const deleteLineOAMatch = pathname.match(/^\/api\/line-oas\/([^\/]+)$/);
    if (method === 'DELETE' && deleteLineOAMatch) {
      const lineOAId = decodeURIComponent(deleteLineOAMatch[1]);
      return await LineOAsAPI.handleDeleteLineOA(env, lineOAId);
    }

    // ============================================================
    // 404 NOT FOUND
    // ============================================================

    return errorResponse('Not found', 404);
  },
};
