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
import { handleUserSearch, handleGenMemberCode, handleUpdateUser, handleCreateMember, handleListBanks } from './api/user-search';
import { handleMatchPendingTransaction } from './api/match-pending';
import {
  handleCreditPendingTransaction,
  handleWithdrawPendingCredit,
} from './api/pending-credit';
import { PendingNotificationsDO } from './durable-objects/pending-notifications';
import { TelegramAuthDO } from './durable-objects/telegram-auth-do';
import { RealtimeAPI } from './api/realtime';
import {
  handleGetLineMessageSettings,
  handleUpdateLineMessageSettings,
} from './api/line-message-settings';
import { handleLineWebhook } from './api/line-webhook';
import {
  handleGetUshopConnection,
  handleSaveUshopConnection,
  handleUshopListTenants,
  handleUshopInbound,
} from './api/ushop';
import { handleTelegramWebhook } from './api/telegram-webhook';
import * as TelegramConnectionsAPI from './api/telegram-connections';
import { processQueueOnce, processScanJob, cleanupOldScanJobs } from './services/scan-queue.service';
import * as ReportAPI from './api/report';
import * as ReportLogsAPI from './api/report-logs';
import { AntidupSettingsAPI } from './api/antidup-settings';
import { handlePresenceHeartbeat, handleGetPresence } from './api/presence';
import {
  handleRegister as handleAuthRegister,
  handleGetMe,
  handleUpdateDisplayName,
  handleLogout as handleAuthLogout,
  handleGetPhoto,
} from './api/telegram-auth';
import {
  handleTgSendCode,
  handleTgVerifyCode,
  handleTgVerify2FA,
  handleTgQRStart,
  handleTgQRStatus,
  handleTgLogout,
  handleTgHealth,
} from './api/telegram-auth-flow';

import {
  handleCreateJoinRequest,
  handleGetPendingRequests,
  handleResolveJoinRequest,
} from './api/join-requests';

import {
  handleListMembers,
  handleKickMember,
  handleBanMember,
  handleUnbanMember,
} from './api/members';

import {
  handleMasterListTeams,
  handleMasterCreateTeam,
  handleMasterUpdateTeam,
  handleMasterDeleteTeam,
  handleMasterListUsers,
  handleMasterAddToTeam,
  handleMasterKick,
  handleMasterBan,
} from './api/master';

// ============================================================
// MAIN ROUTER
// ============================================================

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return handleOptions();
    }

    // ============================================================
    // TELEGRAM AUTH ROUTES
    // ============================================================

    // POST /api/auth/register — ลงทะเบียน / login หลังยืนยัน Telegram
    if (method === 'POST' && pathname === '/api/auth/register') {
      return await handleAuthRegister(request, env);
    }
    // GET /api/auth/me — ดูข้อมูลผู้ใช้ปัจจุบัน
    if (method === 'GET' && pathname === '/api/auth/me') {
      return await handleGetMe(request, env);
    }
    // PATCH /api/auth/me/display-name — เปลี่ยนชื่อที่แสดง
    if (method === 'PATCH' && pathname === '/api/auth/me/display-name') {
      return await handleUpdateDisplayName(request, env);
    }
    // POST /api/auth/logout — ออกจากระบบ
    if (method === 'POST' && pathname === '/api/auth/logout') {
      return await handleAuthLogout(request, env);
    }
    // GET /api/auth/photo/:telegram_id — ดึงรูปโปรไฟล์
    const photoMatch = pathname.match(/^\/api\/auth\/photo\/(\d+)$/);
    if (method === 'GET' && photoMatch) {
      return await handleGetPhoto(env, photoMatch[1]);
    }

    // ============================================================
    // TELEGRAM AUTH FLOW ROUTES (GramJS via Durable Objects)
    // ============================================================

    if (method === 'GET' && pathname === '/api/tg-auth/health') {
      return handleTgHealth();
    }
    if (method === 'POST' && pathname === '/api/tg-auth/send-code') {
      return await handleTgSendCode(request, env);
    }
    if (method === 'POST' && pathname === '/api/tg-auth/verify-code') {
      return await handleTgVerifyCode(request, env);
    }
    if (method === 'POST' && pathname === '/api/tg-auth/verify-2fa') {
      return await handleTgVerify2FA(request, env);
    }
    if (method === 'POST' && pathname === '/api/tg-auth/qr-start') {
      return await handleTgQRStart(request, env);
    }
    const qrStatusMatch = pathname.match(/^\/api\/tg-auth\/qr-status\/(.+)$/);
    if (method === 'GET' && qrStatusMatch) {
      return await handleTgQRStatus(request, env, qrStatusMatch[1]);
    }
    if (method === 'POST' && pathname === '/api/tg-auth/logout') {
      return await handleTgLogout(request, env);
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

    // JOIN REQUESTS
    const joinRequestMatch = pathname.match(/^\/api\/teams\/([^\/]+)\/join-request$/);
    if (joinRequestMatch) {
      const slug = decodeURIComponent(joinRequestMatch[1]);
      if (method === 'POST') return await handleCreateJoinRequest(request, env, slug);
    }
    const joinRequestsPendingMatch = pathname.match(/^\/api\/teams\/([^\/]+)\/join-requests\/pending$/);
    if (method === 'GET' && joinRequestsPendingMatch) {
      const slug = decodeURIComponent(joinRequestsPendingMatch[1]);
      return await handleGetPendingRequests(request, env, slug);
    }
    const joinRequestResolveMatch = pathname.match(/^\/api\/teams\/([^\/]+)\/join-request\/([^\/]+)\/(approve|reject)$/);
    if (method === 'POST' && joinRequestResolveMatch) {
      const slug    = decodeURIComponent(joinRequestResolveMatch[1]);
      const reqId   = decodeURIComponent(joinRequestResolveMatch[2]);
      const action  = joinRequestResolveMatch[3] as 'approve' | 'reject';
      return await handleResolveJoinRequest(request, env, slug, reqId, action);
    }

    // MEMBER MANAGEMENT
    const membersMatch = pathname.match(/^\/api\/teams\/([^\/]+)\/members$/);
    if (method === 'GET' && membersMatch) {
      return await handleListMembers(request, env, decodeURIComponent(membersMatch[1]));
    }
    const memberActionMatch = pathname.match(/^\/api\/teams\/([^\/]+)\/members\/([^\/]+)\/(kick|ban|unban)$/);
    if (method === 'POST' && memberActionMatch) {
      const slug = decodeURIComponent(memberActionMatch[1]);
      const tid  = decodeURIComponent(memberActionMatch[2]);
      const act  = memberActionMatch[3];
      if (act === 'kick')  return await handleKickMember(request, env, slug, tid);
      if (act === 'ban')   return await handleBanMember(request, env, slug, tid);
    }
    if (method === 'DELETE' && pathname.match(/^\/api\/teams\/([^\/]+)\/members\/([^\/]+)\/ban$/)) {
      const m = pathname.match(/^\/api\/teams\/([^\/]+)\/members\/([^\/]+)\/ban$/)!;
      return await handleUnbanMember(request, env, decodeURIComponent(m[1]), decodeURIComponent(m[2]));
    }

    // MASTER ADMIN ROUTES
    if (pathname === '/api/master/teams') {
      if (method === 'GET')  return await handleMasterListTeams(request, env);
      if (method === 'POST') return await handleMasterCreateTeam(request, env);
    }
    const masterTeamSlugMatch = pathname.match(/^\/api\/master\/teams\/([^\/]+)$/);
    if (masterTeamSlugMatch) {
      const slug = decodeURIComponent(masterTeamSlugMatch[1]);
      if (method === 'PATCH')  return await handleMasterUpdateTeam(request, env, slug);
      if (method === 'DELETE') return await handleMasterDeleteTeam(request, env, slug);
    }
    if (method === 'GET' && pathname === '/api/master/users') {
      return await handleMasterListUsers(request, env);
    }
    const masterUserMatch = pathname.match(/^\/api\/master\/users\/([^\/]+)\/(add-to-team|kick|ban)$/);
    if (method === 'POST' && masterUserMatch) {
      const tid = decodeURIComponent(masterUserMatch[1]);
      const act = masterUserMatch[2];
      if (act === 'add-to-team') return await handleMasterAddToTeam(request, env, tid);
      if (act === 'kick')        return await handleMasterKick(request, env, tid);
      if (act === 'ban')         return await handleMasterBan(request, env, tid);
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
    // U-SHOP INTEGRATION ROUTES (univers_shop)
    // ============================================================
    const ushopBaseUrl = `${url.protocol}//${url.host}`;

    // GET /api/ushop/tenants - univers_shop ขอรายชื่อ tenant (auth: X-Ushop-Key)
    if (method === 'GET' && pathname === '/api/ushop/tenants') {
      return await handleUshopListTenants(request, env);
    }

    // POST /api/ushop/inbound - univers_shop ส่งสลิปเข้ามา (auth: X-Ushop-Key)
    if (method === 'POST' && pathname === '/api/ushop/inbound') {
      return await handleUshopInbound(request, env, ctx);
    }

    // GET /api/tenants/:tenantId/ushop-connection - ดูค่าการเชื่อมต่อ U-shop
    const getUshopConnMatch = pathname.match(/^\/api\/tenants\/([^\/]+)\/ushop-connection$/);
    if (method === 'GET' && getUshopConnMatch) {
      const tenantId = decodeURIComponent(getUshopConnMatch[1]);
      return await handleGetUshopConnection(env, tenantId, ushopBaseUrl);
    }

    // PUT /api/tenants/:tenantId/ushop-connection - บันทึกค่าการเชื่อมต่อ U-shop
    const saveUshopConnMatch = pathname.match(/^\/api\/tenants\/([^\/]+)\/ushop-connection$/);
    if (method === 'PUT' && saveUshopConnMatch) {
      const tenantId = decodeURIComponent(saveUshopConnMatch[1]);
      return await handleSaveUshopConnection(request, env, tenantId, ushopBaseUrl);
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

    // GET /api/users/banks?tenant_id= - รายการธนาคารสำหรับฟอร์มสมัครสมาชิก (V2)
    if (method === 'GET' && pathname === '/api/users/banks') {
      return await handleListBanks(env, request);
    }

    // POST /api/users/create - สมัครสมาชิกใหม่ผ่าน admin bearer (V2)
    if (method === 'POST' && pathname === '/api/users/create') {
      return await handleCreateMember(env, request);
    }

    // PUT /api/users/update/:id - อัปเดตข้อมูลลูกค้า (เช่น เปลี่ยนรหัสผ่าน) ผ่าน admin bearer ในฐานข้อมูล
    const updateUserMatch = pathname.match(/^\/api\/users\/update\/([^\/]+)$/);
    if (method === 'PUT' && updateUserMatch) {
      const userId = decodeURIComponent(updateUserMatch[1]);
      return await handleUpdateUser(env, userId, request);
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
    if (method === 'GET' && pathname === '/api/settings/antidup-cross') {
      return await AntidupSettingsAPI.handleGetCross(request, env);
    }
    if (method === 'POST' && pathname === '/api/settings/antidup-cross') {
      return await AntidupSettingsAPI.handlePostCross(request, env);
    }
    if (method === 'GET' && pathname === '/api/settings/account-modes') {
      return await AntidupSettingsAPI.handleGetAccountModes(request, env);
    }
    if (method === 'POST' && pathname === '/api/settings/account-modes') {
      return await AntidupSettingsAPI.handlePostAccountMode(request, env);
    }

    // ============================================================
    // PRESENCE ROUTES
    // ============================================================
    if (pathname === '/api/presence') {
      if (method === 'POST') return await handlePresenceHeartbeat(request, env);
      if (method === 'GET')  return await handleGetPresence(request, env);
    }

    // ============================================================
    // 404 NOT FOUND  (API paths only)
    // For non-API paths accessed via workers.dev → proxy to frontend
    // ============================================================

    // ถ้า path ขึ้นต้นด้วย /api → 404 จริง
    if (pathname.startsWith('/api/') || pathname.startsWith('/webhook/')) {
      return errorResponse('Not found', 404);
    }

    // Non-API path → proxy frontend จาก Cloudflare Pages
    // ใช้ทำ fallback URL สำหรับ user ที่ ISP บล็อก app.atslip.biz
    // (Worker รันบน Cloudflare network → เข้าถึง Pages ได้ปกติ)
    try {
      const frontendOrigin = 'https://app.atslip.biz';
      const proxyUrl = `${frontendOrigin}${pathname}${url.search}`;
      const proxyResp = await fetch(proxyUrl, {
        method: request.method,
        headers: {
          'Accept': request.headers.get('Accept') || '*/*',
          'Accept-Encoding': request.headers.get('Accept-Encoding') || '',
          'User-Agent': request.headers.get('User-Agent') || '',
        },
        redirect: 'follow',
      });
      // Clone response และเพิ่ม header บอก fallback
      const headers = new Headers(proxyResp.headers);
      headers.set('X-Served-Via', 'workers-fallback');
      return new Response(proxyResp.body, {
        status: proxyResp.status,
        headers,
      });
    } catch {
      return errorResponse('Not found', 404);
    }
    } catch (err: any) {
      console.error('[Worker] Unhandled exception:', err?.message, err?.stack);
      return new Response(JSON.stringify({ error: 'Internal server error', message: err?.message || String(err) }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
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
      processQueueOnce(env, { limit: 40 })
        .then((r) => console.log('[Scheduled] Queue worker processed:', r.processed))
        .catch((err) => console.error('[Scheduled] Queue worker error:', err))
    );

    // Auto-retention: ลบงาน scan_jobs เก่า (success/dead_letter > 2 วัน) กันตารางบวม
    ctx.waitUntil(
      cleanupOldScanJobs(env, { retentionDays: 2, limit: 5000 })
        .then((r) => { if (r.deleted) console.log('[Scheduled] scan_jobs cleanup deleted:', r.deleted); })
        .catch((err) => console.error('[Scheduled] scan_jobs cleanup error:', err))
    );
  },

  // ============================================================
  // QUEUE CONSUMER — ประมวลผล scan job แบบเชื่อถือได้ (Cloudflare การันตีเรียก + retry + DLQ)
  // แทน ctx.waitUntil เดิมที่ถูกยกเลิกกลางคันช่วงพีค → 1 message = 1 job / 1 invocation budget
  // ============================================================
  async queue(batch: MessageBatch<{ jobId: string }>, env: Env, _ctx: ExecutionContext): Promise<void> {
    for (const msg of batch.messages) {
      const jobId = msg.body?.jobId;
      if (!jobId) { msg.ack(); continue; }
      try {
        await processScanJob(env, jobId, { ignoreConcurrency: true });
        msg.ack();
      } catch (err: any) {
        console.error('[Queue] job errored, will retry:', jobId, err?.message);
        msg.retry();
      }
    }
  },
};

// ============================================================
// DURABLE OBJECTS EXPORTS
// ============================================================
export { PendingNotificationsDO, TelegramAuthDO };

