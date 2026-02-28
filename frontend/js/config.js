// ============================================================
// API CONFIGURATION
// ============================================================

const API_CONFIG = {
  // เปลี่ยน URL นี้เป็น URL ของ Backend ที่ deploy บน Cloudflare
  BASE_URL: 'https://atslip-backend.tyuid003.workers.dev',
  
  ENDPOINTS: {
    TENANTS: '/api/tenants',
    LINE_OAS: '/api/line-oas',
  }
};

// Export for use in other files
window.API_CONFIG = API_CONFIG;
