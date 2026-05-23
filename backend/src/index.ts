import type { Env } from './types';
import { handleOptions, errorResponse } from './utils/helpers';
import * as TenantsAPI from './api/tenants';
import * as LineOAsAPI from './api/lineoas';
import * as PendingAPI from './api/pending';
import * as TeamsAPI from './api/teams';
import { TeamApiKeysAPI } from './api/team-api-keys';
import { AutoDepositAPI } from './api/auto-deposit';
import { AdminLoginAPI } from './api/admin-login';
import { BankRefreshService } from './services/bank-refresh.service';
import { ScanAPI } from './api/scan';
import { BankAccountsAPI } from './api/bank-accounts';
import { handleUserSearch, handleGenMemberCode } from './api/user-search';
import { handleMatchPendingTransaction } from './api/match-pending';
import {
  handleCreditPendingTransaction,
  handleWithdrawPendingCredit,
} from './api/pending-credit';
import { PendingNotificationsDO } from './durable-objects/pending-notifications';
import { RealtimeAPI } from './api/realtime';
import {
  handleGetLineMessageSettings,
  handleUpdateLineMessageSettings,
} from './api/line-message-settings';
import { handleLineWebhook } from './api/line-webhook';
import { handleTelegramWebhook } from './api/telegram-webhook';
import * as TelegramConnectionsAPI from './api/telegram-connections';
import { processQueueOnce } from './services/scan-queue.service';
import * as ReportAPI from './api/report';
import * as ReportLogsAPI from './api/report-logs';
import { AntidupSettingsAPI } from './api/antidup-settings';

// ============================================================
// MAIN ROUTER
// ============================================================

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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
    // PATCH /api/teams/:slug/settings - อัพเดท team-level easyslip_token
    const getTeamMatch = pathname.match(/^\/api\/teams\/([^\/]+)$/);
    if (getTeamMatch) {
      const slug = decodeURIComponent(getTeamMatch[1]);
      if (method === 'GET') return await TeamsAPI.handleGetTeamBySlug(env, slug);
    }

    const patchTeamMatch = pathname.match(/^\/api\/teams\/([^\/]+)\/settings$/);
    if (method === 'PATCH' && patchTeamMatch) {
      const slug = decodeURIComponent(patchTeamMatch[1]);
      return await TeamsAPI.handleUpdateTeamSettings(request, env, slug);
    }

    // ============================================================
    // TEAM API KEYS (multi-provider EasySlip / Slip2Go)
    // ============================================================
    const apiKeysListMatch = pathname.match(/^\/api\/teams\/([^\/]+)\/api-keys$/);
    if (apiKeysListMatch) {
      const slug = decodeURIComponent(apiKeysListMatch[1]);
      if (method === 'GET')  return await TeamApiKeysAPI.list(request, env, slug);
      if (method === 'POST') return await TeamApiKeysAPI.create(request, env, slug);
    }
    const apiKeysReorderMatch = pathname.match(/^\/api\/teams\/([^\/]+)\/api-keys\/reorder$/);
    if (method === 'POST' && apiKeysReorderMatch) {
      const slug = decodeURIComponent(apiKeysReorderMatch[1]);
      return await TeamApiKeysAPI.reorder(request, env, slug);
    }
    const apiKeysMoveMatch = pathname.match(/^\/api\/teams\/([^\/]+)\/api-keys\/([^\/]+)\/move$/);
    if (method === 'POST' && apiKeysMoveMatch) {
      const slug = decodeURIComponent(apiKeysMoveMatch[1]);
      const keyId = decodeURIComponent(apiKeysMoveMatch[2]);
      return await TeamApiKeysAPI.move(request, env, slug, keyId);
    }
    const apiKeysItemMatch = pathname.match(/^\/api\/teams\/([^\/]+)\/api-keys\/([^\/]+)$/);
    if (apiKeysItemMatch) {
      const slug = decodeURIComponent(apiKeysItemMatch[1]);
      const keyId = decodeURIComponent(apiKeysItemMatch[2]);
      if (method === 'PATCH')  return await TeamApiKeysAPI.update(request, env, slug, keyId);
      if (method === 'DELETE') return await TeamApiKeysAPI.remove(request, env, slug, keyId);
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

    // GET /api/line-oas/:id/reply-settings - ดูค่า settings ตอบกลับ LINE
    const getLineReplySettingsMatch = pathname.match(/^\/api\/line-oas\/([^\/]+)\/reply-settings$/);
    if (method === 'GET' && getLineReplySettingsMatch) {
      const lineOAId = decodeURIComponent(getLineReplySettingsMatch[1]);
      return await handleGetLineMessageSettings(env, lineOAId);
    }

    // PUT /api/line-oas/:id/reply-settings - แก้ไขค่า settings ตอบกลับ LINE
    const updateLineReplySettingsMatch = pathname.match(/^\/api\/line-oas\/([^\/]+)\/reply-settings$/);
    if (method === 'PUT' && updateLineReplySettingsMatch) {
      const lineOAId = decodeURIComponent(updateLineReplySettingsMatch[1]);
      return await handleUpdateLineMessageSettings(request, env, lineOAId);
    }

    // POST /webhook/:tenantId/:lineOAId - รับ LINE OA webhook
    const lineWebhookMatch = pathname.match(/^\/webhook\/([^\/]+)\/([^\/]+)$/);
    if (method === 'POST' && lineWebhookMatch) {
      const tenantId = decodeURIComponent(lineWebhookMatch[1]);
      const lineOAId = decodeURIComponent(lineWebhookMatch[2]);
      return await handleLineWebhook(request, env, ctx, tenantId, lineOAId);
    }

    // ============================================================
    // TELEGRAM ROUTES (Phase A — connection mgmt + webhook skeleton)
    // ============================================================

    // POST /api/telegram-webhook/:groupId - รับ webhook จาก Telegram bot
    const tgWebhookMatch = pathname.match(/^\/api\/telegram-webhook\/([^\/]+)$/);
    if (method === 'POST' && tgWebhookMatch) {
      const groupId = decodeURIComponent(tgWebhookMatch[1]);
      return await handleTelegramWebhook(request, env, ctx, groupId);
    }

    // GET    /api/teams/:teamId/telegram-connection
    // PUT    /api/teams/:teamId/telegram-connection
    // DELETE /api/teams/:teamId/telegram-connection
    const tgConnMatch = pathname.match(/^\/api\/teams\/([^\/]+)\/telegram-connection$/);
    if (tgConnMatch) {
      const teamId = decodeURIComponent(tgConnMatch[1]);
      if (method === 'GET') return await TelegramConnectionsAPI.handleGetTelegramConnection(env, teamId);
      if (method === 'PUT') return await TelegramConnectionsAPI.handleUpsertTelegramConnection(request, env, teamId);
      if (method === 'DELETE') return await TelegramConnectionsAPI.handleDeleteTelegramConnection(env, teamId);
    }

    // POST /api/teams/:teamId/telegram-connection/enable | disable | register-webhook | sync-commands
    const tgEnableMatch = pathname.match(/^\/api\/teams\/([^\/]+)\/telegram-connection\/(enable|disable|register-webhook|sync-commands)$/);
    if (method === 'POST' && tgEnableMatch) {
      const teamId = decodeURIComponent(tgEnableMatch[1]);
      const action = tgEnableMatch[2];
      if (action === 'enable') return await TelegramConnectionsAPI.handleEnableTelegram(env, teamId);
      if (action === 'disable') return await TelegramConnectionsAPI.handleDisableTelegram(env, teamId);
      if (action === 'register-webhook') return await TelegramConnectionsAPI.handleRegisterWebhook(request, env, teamId);
      if (action === 'sync-commands') return await TelegramConnectionsAPI.handleSyncCommands(env, teamId);
    }

    // ============================================================
    // USER SEARCH ROUTES
    // ============================================================

    // GET /api/users/search?q=<term>&category=<member|non-member> - ค้นหาผู้ใช้
    if (method === 'GET' && pathname === '/api/users/search') {
      return await handleUserSearch(env, request);
    }

    // GET /api/users/gen-membercode?tenant_id=&user_id= - gen/fetch memberCode สำหรับ non-member
    if (method === 'GET' && pathname === '/api/users/gen-membercode') {
      return await handleGenMemberCode(env, request);
    }

    // ============================================================
    // PENDING ROUTES
    // ============================================================

    const pendingMatch = pathname.match(/^\/api\/pending-transactions\/?$/);
    if (method === 'GET' && pendingMatch) {
      return await PendingAPI.handleGetPendingTransactions(env, request);
    }

    // GET /api/pending-transactions/search - ค้นหา/กรอง/แบ่งหน้า
    if (method === 'GET' && pathname === '/api/pending-transactions/search') {
      return await PendingAPI.handleSearchPendingTransactions(env, request);
    }

    // DELETE /api/pending-transactions/:id - ลบรายการ pending
    const deletePendingMatch = pathname.match(/^\/api\/pending-transactions\/([^\/]+)$/);
    if (method === 'DELETE' && deletePendingMatch) {
      const transactionId = decodeURIComponent(deletePendingMatch[1]);
      return await PendingAPI.handleDeletePendingTransaction(env, transactionId);
    }

    // PATCH /api/pending-transactions/:id/match - จับคู่รายการแบบ manual
    const matchPendingMatch = pathname.match(/^\/api\/pending-transactions\/([^\/]+)\/match\/?$/);
    if (method === 'PATCH' && matchPendingMatch) {
      const transactionId = decodeURIComponent(matchPendingMatch[1]);
      return await handleMatchPendingTransaction(env, transactionId, request);
    }

    // POST /api/pending-transactions/:id/credit - เติมเครดิตแบบ manual
    const creditPendingMatch = pathname.match(/^\/api\/pending-transactions\/([^\/]+)\/credit\/?$/);
    if (method === 'POST' && creditPendingMatch) {
      const transactionId = decodeURIComponent(creditPendingMatch[1]);
      return await handleCreditPendingTransaction(env, transactionId, request);
    }

    // POST /api/pending-transactions/:id/withdraw - ดึงเครดิตกลับ
    const withdrawPendingMatch = pathname.match(/^\/api\/pending-transactions\/([^\/]+)\/withdraw\/?$/);
    if (method === 'POST' && withdrawPendingMatch) {
      const transactionId = decodeURIComponent(withdrawPendingMatch[1]);
      return await handleWithdrawPendingCredit(env, transactionId, request);
    }

    // ============================================================
    // SCAN ROUTES
    // ============================================================

    // POST /api/scan/upload - อัพโหลดและสแกนสลิป
    if (method === 'POST' && pathname === '/api/scan/upload') {
      return await ScanAPI.handleUploadSlip(request, env);
    }

    // ============================================================
    // REALTIME ROUTES
    // ============================================================

    // GET /api/realtime/ws - WebSocket upgrade endpoint
    if (pathname === '/api/realtime/ws') {
      return await RealtimeAPI.handleWebSocketUpgrade(request, env);
    }

    // GET /api/realtime/health - Health check endpoint
    if (method === 'GET' && pathname === '/api/realtime/health') {
      return await RealtimeAPI.handleHealthCheck(request, env);
    }

    // ============================================================
    // REPORT ROUTES
    // ============================================================
    if (method === 'POST' && pathname === '/api/report') {
      return await ReportAPI.onRequestPost({ request, env, ctx });
    }

    // ============================================================
    // REPORT LOGS ROUTES
    // ============================================================
    if (method === 'GET' && pathname === '/api/report-logs') {
      return await ReportLogsAPI.onRequestGet({ request, env, ctx });
    }
    if (method === 'DELETE' && pathname.startsWith('/api/report-logs/')) {
      const id = pathname.substring('/api/report-logs/'.length);
      return await ReportLogsAPI.onRequestDelete({ request, env, ctx }, id);
    }

    // ============================================================
    // ANTI-DUP SETTINGS ROUTES
    // ============================================================
    if (method === 'GET' && pathname === '/api/settings/antidup') {
      return await AntidupSettingsAPI.handleGet(request, env);
    }
    if (method === 'POST' && pathname === '/api/settings/antidup') {
      return await AntidupSettingsAPI.handlePost(request, env);
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

    // เก็บงานคิวที่ค้าง (retry / orphan / scheduled jobs)
    ctx.waitUntil(
      processQueueOnce(env, { limit: 20 })
        .then((r) => console.log('[Scheduled] Queue worker processed:', r.processed))
        .catch((err) => console.error('[Scheduled] Queue worker error:', err))
    );
  },
};

// ============================================================
// DURABLE OBJECTS EXPORTS
// ============================================================
export { PendingNotificationsDO };

