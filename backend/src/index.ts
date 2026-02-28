import type { Env } from './types';
import { handleOptions, errorResponse } from './utils/helpers';
import * as TenantsAPI from './api/tenants';
import * as LineOAsAPI from './api/lineoas';
import * as PendingAPI from './api/pending';
import * as TeamsAPI from './api/teams';
import { AutoDepositAPI } from './api/auto-deposit';
import { AdminLoginAPI } from './api/admin-login';
import { BankRefreshService } from './services/bank-refresh.service';
import { ScanAPI } from './api/scan';
import { BankAccountsAPI } from './api/bank-accounts';

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
    // TEAMS ROUTES
    // ============================================================

    // GET /api/teams - ดูรายการ team ทั้งหมด
    if (method === 'GET' && pathname === '/api/teams') {
      return await TeamsAPI.handleGetAllTeams(env);
    }

    // GET /api/teams/:slug - ดูข้อมูล team ตาม slug
    const getTeamMatch = pathname.match(/^\/api\/teams\/([^\/]+)$/);
    if (method === 'GET' && getTeamMatch) {
      const slug = decodeURIComponent(getTeamMatch[1]);
      return await TeamsAPI.handleGetTeamBySlug(env, slug);
    }

    // ============================================================
    // TENANTS ROUTES
    // ============================================================

    // GET /api/tenants - ดูรายการ tenant ทั้งหมด
    if (method === 'GET' && pathname === '/api/tenants') {
      return await TenantsAPI.handleGetTenants(request, env);
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

    // GET /api/tenants/:id/bank-accounts/metadata - ดูข้อมูล metadata ของบัญชีธนาคาร
    const metadataMatch = pathname.match(
      /^\/api\/tenants\/([^\/]+)\/bank-accounts\/metadata$/
    );
    if (method === 'GET' && metadataMatch) {
      const tenantId = decodeURIComponent(metadataMatch[1]);
      return await BankAccountsAPI.handleGetBankAccountsMetadata(env, tenantId);
    }

    // POST /api/tenants/:id/bank-accounts/sync - Sync bank accounts
    const syncMatch = pathname.match(
      /^\/api\/tenants\/([^\/]+)\/bank-accounts\/sync$/
    );
    if (method === 'POST' && syncMatch) {
      const tenantId = decodeURIComponent(syncMatch[1]);
      return await BankAccountsAPI.handleSyncBankAccounts(env, tenantId);
    }

    // POST /api/tenants/:tenantId/bank-accounts/:accountId/metadata - สร้าง metadata สำหรับบัญชีเดียว
    const createMetadataMatch = pathname.match(
      /^\/api\/tenants\/([^\/]+)\/bank-accounts\/([^\/]+)\/metadata$/
    );
    if (method === 'POST' && createMetadataMatch) {
      const tenantId = decodeURIComponent(createMetadataMatch[1]);
      const accountId = decodeURIComponent(createMetadataMatch[2]);
      return await BankAccountsAPI.handleCreateMetadata(env, tenantId, accountId);
    }

    // PATCH /api/bank-accounts/:id/english-name - แก้ไขชื่อภาษาอังกฤษ
    const updateEnNameMatch = pathname.match(
      /^\/api\/bank-accounts\/([^\/]+)\/english-name$/
    );
    if (method === 'PATCH' && updateEnNameMatch) {
      const accountId = decodeURIComponent(updateEnNameMatch[1]);
      return await BankAccountsAPI.handleUpdateEnglishName(request, env, accountId);
    }

    // POST /api/tenants/:id/disconnect - ยกเลิกการเชื่อมต่อ
    const disconnectMatch = pathname.match(
      /^\/api\/tenants\/([^\/]+)\/disconnect$/
    );
    if (method === 'POST' && disconnectMatch) {
      const tenantId = decodeURIComponent(disconnectMatch[1]);
      return await TenantsAPI.handleDisconnectAdmin(env, tenantId);
    }

    // PATCH /api/tenants/:id/auto-deposit - Toggle auto deposit
    const autoDepositMatch = pathname.match(
      /^\/api\/tenants\/([^\/]+)\/auto-deposit$/
    );
    if (method === 'PATCH' && autoDepositMatch) {
      const tenantId = decodeURIComponent(autoDepositMatch[1]);
      return await AutoDepositAPI.handleToggleAutoDeposit(env, request, tenantId);
    }

    // GET /api/tenants/:id/captcha - ดึง captcha จาก admin API
    const captchaMatch = pathname.match(
      /^\/api\/tenants\/([^\/]+)\/captcha$/
    );
    if (method === 'GET' && captchaMatch) {
      const tenantId = decodeURIComponent(captchaMatch[1]);
      return await AdminLoginAPI.handleGetCaptcha(env, tenantId);
    }

    // POST /api/tenants/:id/login - Login พร้อม captcha
    const loginMatch = pathname.match(
      /^\/api\/tenants\/([^\/]+)\/login$/
    );
    if (method === 'POST' && loginMatch) {
      const tenantId = decodeURIComponent(loginMatch[1]);
      return await AdminLoginAPI.handleLogin(env, request, tenantId);
    }

    // POST /api/tenants/:id/refresh-accounts - รีเฟรชบัญชีธนาคาร
    const refreshAccountsMatch = pathname.match(
      /^\/api\/tenants\/([^\/]+)\/refresh-accounts$/
    );
    if (method === 'POST' && refreshAccountsMatch) {
      const tenantId = decodeURIComponent(refreshAccountsMatch[1]);
      return await AdminLoginAPI.handleRefreshAccounts(env, tenantId);
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
    // PENDING ROUTES
    // ============================================================

    const pendingMatch = pathname.match(/^\/api\/pending-transactions\/?$/);
    if (method === 'GET' && pendingMatch) {
      return await PendingAPI.handleGetPendingTransactions(env, request);
    }

    // DELETE /api/pending-transactions/:id - ลบรายการ pending
    const deletePendingMatch = pathname.match(/^\/api\/pending-transactions\/([^\/]+)$/);
    if (method === 'DELETE' && deletePendingMatch) {
      const transactionId = decodeURIComponent(deletePendingMatch[1]);
      return await PendingAPI.handleDeletePendingTransaction(env, transactionId);
    }

    // ============================================================
    // SCAN ROUTES
    // ============================================================

    // POST /api/scan/upload - อัพโหลดและสแกนสลิป
    if (method === 'POST' && pathname === '/api/scan/upload') {
      return await ScanAPI.handleUploadSlip(request, env);
    }

    // ============================================================
    // 404 NOT FOUND
    // ============================================================

    return errorResponse('Not found', 404);
  },

  // ============================================================
  // SCHEDULED WORKER (Cron Jobs)
  // ============================================================
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log('[Scheduled] Starting cron job at', new Date(event.scheduledTime).toISOString());
    
    // ดึงบัญชีธนาคารสำหรับทุก tenant ที่มี active session
    ctx.waitUntil(
      BankRefreshService.refreshAllTenantBankAccounts(env)
        .then(() => console.log('[Scheduled] Bank refresh completed'))
        .catch((err) => console.error('[Scheduled] Bank refresh error:', err))
    );
  },
};
