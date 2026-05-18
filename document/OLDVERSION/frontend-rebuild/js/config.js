/**
 * Auto Deposit System - Configuration
 * กำหนดค่าการตั้งค่าพื้นฐานของระบบ
 */

const CONFIG = {
  // Tenant configurations
  TENANTS: [
    {
      id: 'betax2',
      name: 'BETAX2',
      apiBaseUrl: 'https://betax2.com/api',
      adminUsername: 'admin',
      lineChannelId: '',
      lineChannelSecret: '',
      lineAccessToken: '',
      sessionMode: 'cookie',
      accountListTtl: 86400,
      adminAuthStatus: false,
      easyslipStatus: false
    },
    {
      id: 'winsure24',
      name: 'WINSURE24',
      apiBaseUrl: 'https://winsure24.com/api',
      adminUsername: 'admin',
      lineChannelId: '',
      lineChannelSecret: '',
      lineAccessToken: '',
      sessionMode: 'cookie',
      accountListTtl: 86400,
      adminAuthStatus: false,
      easyslipStatus: false
    },
    {
      id: 'hengdragon66',
      name: 'HENGDRAGON66',
      apiBaseUrl: 'https://hengdragon66.com/api',
      adminUsername: 'admin',
      lineChannelId: '',
      lineChannelSecret: '',
      lineAccessToken: '',
      sessionMode: 'cookie',
      accountListTtl: 86400,
      adminAuthStatus: false,
      easyslipStatus: false
    },
    {
      id: 'tkwin24',
      name: 'TKWIN24',
      apiBaseUrl: 'https://tkwin24.com/api',
      adminUsername: 'admin',
      lineChannelId: '',
      lineChannelSecret: '',
      lineAccessToken: '',
      sessionMode: 'cookie',
      accountListTtl: 86400,
      adminAuthStatus: false,
      easyslipStatus: false
    }
  ],

  // API endpoints
  API: {
    // Backend API
    USER_LIST: '/api/users/list',
    CREDIT_ADD: '/api/credits/add',
    CREDIT_WITHDRAW: '/api/credits/withdraw',
    ADMIN_LOGIN: '/api/admin/login',
    
    // EasySlip API
    EASYSLIP_BASE: 'https://developer.easyslip.com/api/v1',
    EASYSLIP_VERIFY: '/verify',
    
    // LINE Messaging API
    LINE_REPLY: 'https://api.line.me/v2/bot/message/reply',
    LINE_PUSH: 'https://api.line.me/v2/bot/message/push'
  },

  // Status types
  STATUS: {
    PENDING: 'pending',
    MATCHED: 'matched',
    CREDITED: 'credited',
    DUPLICATE: 'duplicate'
  },

  // Local storage keys
  STORAGE_KEYS: {
    SELECTED_TENANT: 'selected_tenant',
    AUTO_CREDIT_ENABLED: 'auto_credit_enabled',
    TENANT_FILTER: 'tenant_filter',
    ADMIN_SESSION: 'admin_session',
    BEARER_TOKEN: 'bearer_token'
  },

  // Thai title prefixes to remove for matching
  THAI_PREFIXES: ['นาย', 'นาง', 'นางสาว', 'น.ส.', 'เด็กชาย', 'เด็กหญิง', 'ด.ช.', 'ด.ญ.'],

  // User categories
  USER_CATEGORIES: {
    MEMBER: 'member',
    NON_MEMBER: 'non-member'
  },

  // Matching rules
  MATCHING: {
    MIN_NAME_CHARS: 4,
    MIN_ACCOUNT_DIGITS: 3
  },

  // Pagination
  PAGINATION: {
    DEFAULT_PAGE: 1,
    DEFAULT_LIMIT: 100
  },

  // Message types for LINE OA
  MESSAGE_TYPES: {
    ON_SLIP_RECEIVED: 'on_slip_received',
    ON_CREDITED_SUCCESS: 'on_credited_success',
    ON_CREDITED_DUPLICATE: 'on_credited_duplicate'
  }
};

// Freeze configuration to prevent modifications
Object.freeze(CONFIG);
