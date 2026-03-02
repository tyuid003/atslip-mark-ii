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
function getRouteInfoFromURL() {
  const hash = window.location.hash || '';
  if (hash.startsWith('#/')) {
    const path = hash.substring(2).split('/').filter(Boolean);
    const teamSlug = path[0] || 'default';
    const page = path[1] || 'dashboard';
    return { teamSlug, page };
  }

  const params = new URLSearchParams(window.location.search);
  const teamParam = params.get('team') || 'default';
  const pageParam = params.get('page') || 'dashboard';
  return { teamSlug: teamParam, page: pageParam };
}

function getTeamFromURL() {
  return getRouteInfoFromURL().teamSlug;
}

function getPageFromURL() {
  return getRouteInfoFromURL().page;
}

// Export for use in other files
window.API_CONFIG = API_CONFIG;
window.getTeamFromURL = getTeamFromURL;
window.getPageFromURL = getPageFromURL;
window.getRouteInfoFromURL = getRouteInfoFromURL;
