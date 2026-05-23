// ============================================================
// API CONFIGURATION
// ============================================================

const API_CONFIG = {
  // BASE_URL ว่างเปล่า = ใช้ relative URL ผ่าน Pages Function proxy
  // ทำให้ทุกเครื่องใช้งานได้โดยไม่มีปัญหา DNS
  BASE_URL: '',
  // Fallback URL (ใช้เมื่อ run ตรงโดยไม่ผ่าน Cloudflare Pages)
  FALLBACK_URL: 'https://api.atslip.biz',
  // Webhook URL ต้องใช้ absolute URL เสมอ เพราะ LINE platform ต้องการ
  // (ไม่ใช้ relative URL เหมือน BASE_URL)
  WEBHOOK_BASE_URL: 'https://api.atslip.biz',

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
    const rawTeamSlug = (path[0] || 'default').toString().trim().toLowerCase();
    const teamSlug = rawTeamSlug.replace(/[^a-z0-9-]/g, '') || 'default';
    const page = (path[1] || 'dashboard').toString().trim().toLowerCase();
    return { teamSlug, page };
  }

  const params = new URLSearchParams(window.location.search);
  const rawTeamParam = (params.get('team') || 'default').toString().trim().toLowerCase();
  const teamParam = rawTeamParam.replace(/[^a-z0-9-]/g, '') || 'default';
  const pageParam = (params.get('page') || 'dashboard').toString().trim().toLowerCase();
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
