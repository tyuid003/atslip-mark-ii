// ============================================================
// INFO PAGE + HASH ROUTER — ATslip Mark-II
// จัดการ hash routing:
//   #/              → แสดงหน้า info (กรุณาเข้าผ่าน URL องค์กร)
//   #/info          → แสดงหน้า info
//   #/team-slug     → main app (ต้อง login)
//   #/team-slug/login → redirect ไป login.html?team=...
// ============================================================

(function initHashRouter() {
  'use strict';

  // รัน router ทันทีเมื่อ DOM พร้อม
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', routeOnLoad);
  } else {
    routeOnLoad();
  }

  // รัน router ทุกครั้งที่ hash เปลี่ยน
  window.addEventListener('hashchange', routeOnLoad);

  function routeOnLoad() {
    const route = window.getRouteInfoFromURL ? window.getRouteInfoFromURL() : parseRouteManual();

    if (route.isInfo) {
      showInfoPage();
      return;
    }

    if (route.isLogin || route.page === 'login') {
      const nextHash = `#/${route.teamSlug}`;
      const loginUrl = `/login.html?team=${encodeURIComponent(route.teamSlug)}&next=${encodeURIComponent(nextHash)}`;
      window.location.replace(loginUrl);
      return;
    }

    // Normal app route — ซ่อน info page
    hideInfoPage();
  }

  function parseRouteManual() {
    const hash = window.location.hash || '';
    if (!hash || hash === '#' || hash === '#/') {
      return { isInfo: true, isTeamSelector: false, isLogin: false, teamSlug: '', page: 'info' };
    }
    if (hash.startsWith('#/')) {
      const parts = hash.substring(2).split('/').filter(Boolean);
      const first = (parts[0] || '').replace(/[^a-z0-9-]/g, '');
      if (!first || first === 'info') {
        return { isInfo: true, isTeamSelector: false, isLogin: false, teamSlug: '', page: 'info' };
      }
      const page = parts[1] || 'dashboard';
      return { isInfo: false, isTeamSelector: false, isLogin: page === 'login', teamSlug: first, page };
    }
    return { isInfo: true, isTeamSelector: false, isLogin: false, teamSlug: '', page: 'info' };
  }

  // ============================================================
  // SHOW / HIDE
  // ============================================================
  function showInfoPage() {
    const page = document.getElementById('infoPage');
    if (page) page.classList.add('visible');
    const container = document.querySelector('.container');
    if (container) container.style.visibility = 'hidden';
    const header = document.querySelector('.header');
    if (header) header.style.visibility = 'hidden';
  }

  function hideInfoPage() {
    const page = document.getElementById('infoPage');
    if (page) page.classList.remove('visible');
    const container = document.querySelector('.container');
    if (container) container.style.visibility = '';
    const header = document.querySelector('.header');
    if (header) header.style.visibility = '';
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

})();

// จัดการ hash routing:
//   #/              → แสดง team selector
//   #/team-slug     → main app (ต้อง login)
//   #/team-slug/login → redirect ไป login.html?team=...
// ============================================================

(function initHashRouter() {
  'use strict';

  // รัน router ทันทีเมื่อ DOM พร้อม
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', routeOnLoad);
  } else {
    routeOnLoad();
  }

  // รัน router ทุกครั้งที่ hash เปลี่ยน
  window.addEventListener('hashchange', routeOnLoad);

  function routeOnLoad() {
    const route = window.getRouteInfoFromURL ? window.getRouteInfoFromURL() : parseRouteManual();

    if (route.isTeamSelector) {
      showTeamSelector();
      return;
    }

    if (route.isLogin || route.page === 'login') {
      // redirect ไปที่ login.html พร้อม team และ next URL
      const nextHash = `#/${route.teamSlug}`;
      const loginUrl = `/login.html?team=${encodeURIComponent(route.teamSlug)}&next=${encodeURIComponent(nextHash)}`;
      window.location.replace(loginUrl);
      return;
    }

    // Normal app route — ซ่อน team selector
    hideTeamSelector();
  }

  function parseRouteManual() {
    const hash = window.location.hash || '';
    if (!hash || hash === '#' || hash === '#/') {
      return { isTeamSelector: true, isLogin: false, teamSlug: '', page: 'team-selector' };
    }
    if (hash.startsWith('#/')) {
      const parts = hash.substring(2).split('/').filter(Boolean);
      const teamSlug = (parts[0] || '').replace(/[^a-z0-9-]/g, '');
      const page     = parts[1] || 'dashboard';
      const isTeamSelector = !teamSlug || page === 'team-selector';
      return { isTeamSelector, isLogin: page === 'login', teamSlug, page };
    }
    return { isTeamSelector: true, isLogin: false, teamSlug: '', page: 'team-selector' };
  }

  // ============================================================
  // SHOW / HIDE
  // ============================================================
  function showTeamSelector() {
    const page = document.getElementById('teamSelectorPage');
    if (page) page.classList.add('visible');
    // blur the main content so it can't be interacted with
    const container = document.querySelector('.container');
    if (container) container.style.visibility = 'hidden';
    const header = document.querySelector('.header');
    if (header) header.style.visibility = 'hidden';
    loadTeams();
  }

  function hideTeamSelector() {
    const page = document.getElementById('teamSelectorPage');
    if (page) page.classList.remove('visible');
    const container = document.querySelector('.container');
    if (container) container.style.visibility = '';
    const header = document.querySelector('.header');
    if (header) header.style.visibility = '';
  }

  // ============================================================
  // LOAD & RENDER TEAMS
  // ============================================================
  let teamsLoaded = false;

  async function loadTeams() {
    if (teamsLoaded) return;

    const grid = document.getElementById('tsGrid');
    if (!grid) return;

    grid.innerHTML = `
      <div class="ts-loading" style="grid-column:1/-1">
        <div class="ts-spinner"></div>
        <span>กำลังโหลดรายชื่อทีม...</span>
      </div>`;

    try {
      // ใช้ fetch ตรงๆ (api อาจยังไม่ถูก init)
      const backendBase = window.AUTH_CONFIG?.BACKEND_URL ?? '';
      const res  = await fetch(`${backendBase}/api/teams`);
      const data = await res.json();
      const teams = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);

      if (teams.length === 0) {
        grid.innerHTML = `
          <div class="ts-empty" style="grid-column:1/-1">
            <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <p>ยังไม่มีทีมในระบบ</p>
          </div>`;
        return;
      }

      teamsLoaded = true;
      grid.innerHTML = teams.map(team => renderTeamCard(team)).join('');

      // init lucide icons ถ้ามี
      if (window.lucide?.createIcons) window.lucide.createIcons();
    } catch (e) {
      grid.innerHTML = `
        <div class="ts-empty" style="grid-column:1/-1">
          <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <p>โหลดรายชื่อทีมไม่ได้ (${escHtml(e.message)})</p>
          <button onclick="teamsLoaded=false;loadTeams()" style="margin-top:8px;padding:6px 16px;border:1px solid #d1d5db;border-radius:8px;background:white;cursor:pointer;font-family:inherit;font-size:0.8rem">ลองใหม่</button>
        </div>`;
    }
  }

  // expose for retry button
  window.loadTeams = loadTeams;

  function renderTeamCard(team) {
    const name  = escHtml(team.name || team.slug || 'ทีม');
    const slug  = escHtml(team.slug || '');
    const initials = getInitials(team.name || team.slug || '?');
    const gradient = slugToGradient(team.slug || '');

    return `
      <div class="ts-card" onclick="selectTeam('${slug}')">
        <div class="ts-avatar" style="background:${gradient}">${initials}</div>
        <div class="ts-card-name">${name}</div>
        <div class="ts-card-slug">${slug}</div>
      </div>`;
  }

  window.selectTeam = function(slug) {
    if (!slug) return;
    // Navigate to team hash — auth.js will check if logged in and redirect to login if not
    window.location.hash = `#/${slug}`;
  };

  // ============================================================
  // HELPERS
  // ============================================================
  function getInitials(name) {
    const words = name.trim().split(/\s+/);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    if (name.length >= 2)  return name.substring(0, 2).toUpperCase();
    return name[0]?.toUpperCase() || '?';
  }

  /** แปลง slug เป็น gradient สีที่ unique ต่อทีม */
  function slugToGradient(slug) {
    let hash = 0;
    for (let i = 0; i < slug.length; i++) {
      hash = ((hash << 5) - hash) + slug.charCodeAt(i);
      hash |= 0;
    }
    const palettes = [
      ['#3b82f6', '#6366f1'],   // blue → indigo
      ['#10b981', '#06b6d4'],   // green → cyan
      ['#f59e0b', '#ef4444'],   // amber → red
      ['#8b5cf6', '#ec4899'],   // violet → pink
      ['#14b8a6', '#3b82f6'],   // teal → blue
      ['#f97316', '#eab308'],   // orange → yellow
      ['#06b6d4', '#8b5cf6'],   // cyan → violet
      ['#10b981', '#3b82f6'],   // emerald → blue
    ];
    const idx = Math.abs(hash) % palettes.length;
    return `linear-gradient(135deg, ${palettes[idx][0]}, ${palettes[idx][1]})`;
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

})();
