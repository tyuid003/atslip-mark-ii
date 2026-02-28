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

// ============================================================
// TEAM ROUTING
// ============================================================

/**
 * ดึง team slug จาก URL
 * รองรับ 3 รูปแบบ:
 * 1. Hash: index.html#/hengdragon-ruayruay
 * 2. Query: index.html?team=hengdragon-ruayruay
 * 3. Default: ใช้ 'default-team'
 */
function getTeamFromURL() {
  // ลองดึงจาก hash ก่อน (#/team-slug)
  const hash = window.location.hash;
  if (hash && hash.startsWith('#/')) {
    const teamSlug = hash.substring(2); // ตัด #/ ออก
    if (teamSlug) {
      return teamSlug;
    }
  }
  
  // ลองดึงจาก query parameter (?team=xxx)
  const params = new URLSearchParams(window.location.search);
  const teamParam = params.get('team');
  if (teamParam) {
    return teamParam;
  }
  
  // ถ้าไม่มีใช้ default
  return 'default';
}

// Export for use in other files
window.API_CONFIG = API_CONFIG;
window.getTeamFromURL = getTeamFromURL;
