// ============================================================
// API CONFIGURATION
// ============================================================

const API_CONFIG = {
  BASE_URL: 'https://atslip-backend.tyuid003.workers.dev',
  
  ENDPOINTS: {
    TENANTS: '/api/tenants',
    TEAMS: '/api/teams',
    LINE_OAS: '/api/line-oas',
    PENDING: '/api/pending',
    SCAN: '/api/scan/upload',
    REALTIME: '/api/realtime',
  }
};

// Export for use in other files
if (typeof window !== 'undefined') {
  window.API_CONFIG = API_CONFIG;
}
