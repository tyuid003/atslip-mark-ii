// ============================================================
// AUTH MODULE — ATslip Mark-II
// จัดการ session ของผู้ใช้ที่ login ด้วย Telegram
// ============================================================

(function initAuth() {
  'use strict';

  const BACKEND = window.AUTH_CONFIG?.BACKEND_URL ?? '';

  // ── Local storage keys ───────────────────────────────────
  const KEY_SESSION = 'atslip_session';
  const KEY_USER    = 'atslip_user';
  const KEY_PHOTO   = 'atslip_photo';
  const KEY_DEVICE  = 'atslip_device_token';

  // ── State ─────────────────────────────────────────────────
  window.atslipAuth = {
    user:    null,   // { telegram_id, telegram_first_name, ... , display_name }
    photo:   null,   // base64 data URI
    session: null,   // app_session_token
    ready:   false,  // true after init() resolves
  };

  // ── Helpers ──────────────────────────────────────────────
  function getSession()  { return localStorage.getItem(KEY_SESSION); }
  function getUser()     {
    try { return JSON.parse(localStorage.getItem(KEY_USER) || 'null'); } catch { return null; }
  }
  function getPhoto()    { return localStorage.getItem(KEY_PHOTO) || null; }

  /** ชื่อที่แสดง: display_name ถ้ามี ไม่งั้นใช้ first_name [last_name] */
  function getDisplayName(user) {
    if (!user) return '';
    if (user.display_name) return user.display_name;
    const name = [user.telegram_first_name, user.telegram_last_name].filter(Boolean).join(' ');
    return name || user.telegram_username || 'ผู้ใช้';
  }
  window.atslipGetDisplayName = getDisplayName;

  // ── Auth guard ────────────────────────────────────────────
  async function checkAuth() {
    const token = getSession();
    if (!token) return null;

    try {
      const res = await fetch(`${BACKEND}/api/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.ok) {
        // อัพเดท user info (อาจมีการเปลี่ยนชื่อจากที่อื่น)
        localStorage.setItem(KEY_USER, JSON.stringify(data.user));
        if (data.user.photo) {
          localStorage.setItem(KEY_PHOTO, data.user.photo);
        }
        return data.user;
      }
    } catch (_) { /* network error — fall through */ }

    // Session invalid
    clearLocalAuth();
    return null;
  }

  function clearLocalAuth() {
    localStorage.removeItem(KEY_SESSION);
    localStorage.removeItem(KEY_USER);
    localStorage.removeItem(KEY_PHOTO);
  }

  // ── Blur overlay ──────────────────────────────────────────
  function getTeamLoginUrl() {
    const slug = (typeof getRouteInfoFromURL === 'function')
      ? (getRouteInfoFromURL().teamSlug || '')
      : '';
    if (slug) return `/login.html?team=${encodeURIComponent(slug)}`;
    return `/login.html?next=${encodeURIComponent(location.hash || '/')}`;
  }

  function showBlurOverlay() {
    let overlay = document.getElementById('authBlurOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'authBlurOverlay';
      overlay.innerHTML = `
        <div class="auth-blur-box">
          <div class="auth-blur-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>
          </div>
          <h3>กรุณาเข้าสู่ระบบ</h3>
          <p>คุณต้องเข้าสู่ระบบด้วย Telegram เพื่อใช้งาน ATslip</p>
          <a href="${getTeamLoginUrl()}" class="auth-login-btn">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            เข้าสู่ระบบด้วย Telegram
          </a>
        </div>
      `;
      document.body.appendChild(overlay);
    }
    overlay.style.display = 'flex';
    document.body.classList.add('auth-blurred');
  }

  function hideBlurOverlay() {
    const overlay = document.getElementById('authBlurOverlay');
    if (overlay) overlay.style.display = 'none';
    document.body.classList.remove('auth-blurred');
  }

  // ── Profile UI in topbar ──────────────────────────────────
  function renderTopbarProfile(user, photo) {
    let profileWrap = document.getElementById('topbarProfileWrap');
    if (!profileWrap) return; // element not yet added to DOM

    const displayName = getDisplayName(user);
    const avatarHTML  = photo
      ? `<img src="${photo}" alt="avatar" class="topbar-avatar-img">`
      : `<span class="topbar-avatar-initials">${(displayName[0] || '?').toUpperCase()}</span>`;

    profileWrap.innerHTML = `
      <button class="topbar-profile-btn" id="topbarProfileBtn" onclick="toggleProfileDropdown(event)" aria-label="โปรไฟล์">
        <div class="topbar-avatar">${avatarHTML}</div>
        <span class="topbar-username">${escapeHtml(displayName)}</span>
        <svg class="topbar-chevron" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div id="profileDropdown" class="profile-dropdown" style="display:none">
        <div class="profile-dropdown-header">
          <div class="profile-dropdown-avatar">${avatarHTML}</div>
          <div>
            <div class="profile-dropdown-name">${escapeHtml(displayName)}</div>
            <div class="profile-dropdown-sub">@${escapeHtml(user.telegram_username || user.telegram_id)}</div>
          </div>
        </div>
        <div class="profile-dropdown-divider"></div>
        <button class="profile-dropdown-item" onclick="openRenameModal()">
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          เปลี่ยนชื่อที่แสดง
        </button>
        <button class="profile-dropdown-item danger" onclick="confirmLogout()">
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          ออกจากระบบ
        </button>
      </div>
    `;
  }

  function renderTopbarLoginBtn() {
    let profileWrap = document.getElementById('topbarProfileWrap');
    if (!profileWrap) return;
    profileWrap.innerHTML = `
      <a href="${getTeamLoginUrl()}" class="topbar-login-btn">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        เข้าสู่ระบบ
      </a>
    `;
  }

  // ── Dropdown toggle ───────────────────────────────────────
  window.toggleProfileDropdown = function(e) {
    e.stopPropagation();
    const dd = document.getElementById('profileDropdown');
    if (!dd) return;
    const isVisible = dd.style.display !== 'none';
    dd.style.display = isVisible ? 'none' : 'block';
  };

  document.addEventListener('click', () => {
    const dd = document.getElementById('profileDropdown');
    if (dd) dd.style.display = 'none';
  });

  // ── Rename modal ──────────────────────────────────────────
  window.openRenameModal = function() {
    const dd = document.getElementById('profileDropdown');
    if (dd) dd.style.display = 'none';

    const user = window.atslipAuth.user;
    const current = user?.display_name || '';

    let modal = document.getElementById('renameModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'renameModal';
      modal.className = 'auth-modal-overlay';
      modal.onclick = (e) => { if (e.target === modal) closeRenameModal(); };
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div class="auth-modal">
        <div class="auth-modal-header">
          <h3>เปลี่ยนชื่อที่แสดง</h3>
          <button class="auth-modal-close" onclick="closeRenameModal()">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="auth-modal-body">
          <p style="font-size:0.82rem;color:var(--color-gray-500);margin-bottom:0.75rem">
            ชื่อที่แสดงในระบบ — ล้างว่างเพื่อใช้ชื่อ Telegram เดิม
          </p>
          <input type="text" id="renameInput" class="auth-modal-input"
            placeholder="${escapeHtml(atslipGetDisplayName(user))}"
            value="${escapeHtml(current)}" maxlength="100"
            onkeydown="if(event.key==='Enter')saveDisplayName()">
        </div>
        <div class="auth-modal-footer">
          <button class="auth-modal-btn-cancel" onclick="closeRenameModal()">ยกเลิก</button>
          <button class="auth-modal-btn-save" id="renameSaveBtn" onclick="saveDisplayName()">บันทึก</button>
        </div>
      </div>
    `;

    modal.style.display = 'flex';
    setTimeout(() => document.getElementById('renameInput')?.focus(), 80);
  };

  window.closeRenameModal = function() {
    const modal = document.getElementById('renameModal');
    if (modal) modal.style.display = 'none';
  };

  window.saveDisplayName = async function() {
    const input = document.getElementById('renameInput');
    if (!input) return;

    const newName = input.value.trim();
    const btn = document.getElementById('renameSaveBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'กำลังบันทึก...'; }

    try {
      const res  = await fetch(`${BACKEND}/api/auth/me/display-name`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getSession()}`,
        },
        body: JSON.stringify({ display_name: newName || null }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? 'บันทึกล้มเหลว');

      // Update local state
      const user = getUser();
      if (user) {
        user.display_name = data.display_name;
        localStorage.setItem(KEY_USER, JSON.stringify(user));
        window.atslipAuth.user = user;
        renderTopbarProfile(user, getPhoto());
      }
      closeRenameModal();
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = 'บันทึก'; }
      alert('ไม่สามารถบันทึกชื่อ: ' + e.message);
    }
  };

  // ── Logout ────────────────────────────────────────────────
  window.confirmLogout = function() {
    const dd = document.getElementById('profileDropdown');
    if (dd) dd.style.display = 'none';

    if (!confirm('คุณต้องการออกจากระบบใช่หรือไม่?\nSession Telegram จะถูกยกเลิกด้วย')) return;
    doLogout();
  };

  async function doLogout() {
    const token = getSession();
    // 1. Revoke app session on backend
    if (token) {
      try {
        await fetch(`${BACKEND}/api/auth/logout`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
        });
      } catch (_) { /* ignore network errors */ }
    }

    // 2. Revoke Telegram session via auth-service
    const tgSession = getUser()?._session_string; // not stored for security
    // (Telegram session string is not stored in localStorage — just let it expire naturally)

    clearLocalAuth();
    window.atslipAuth.user    = null;
    window.atslipAuth.photo   = null;
    window.atslipAuth.session = null;

    // 3. Redirect to login
    const slug = (typeof getRouteInfoFromURL === 'function')
      ? (getRouteInfoFromURL().teamSlug || '')
      : '';
    location.href = slug ? `/login.html?team=${encodeURIComponent(slug)}` : '/';
  }

  // ── Util ──────────────────────────────────────────────────
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Presence (online users) ──────────────────────────────
  let presenceTimer = null;

  function startPresence() {
    stopPresence();
    sendPresenceHeartbeat();
    fetchOnlineUsers();
    presenceTimer = setInterval(() => {
      sendPresenceHeartbeat();
      fetchOnlineUsers();
    }, 30000);
  }

  function stopPresence() {
    if (presenceTimer) { clearInterval(presenceTimer); presenceTimer = null; }
    const wrap = document.getElementById('topbarOnlineUsers');
    if (wrap) wrap.innerHTML = '';
  }

  async function sendPresenceHeartbeat() {
    const teamId = window.currentTeamId;
    const session = getSession();
    if (!teamId || !session) return;
    try {
      const photo = getPhoto();
      const isGhost = new URLSearchParams(location.search).get('ghost') === '1';
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session}`,
        ...(isGhost ? { 'X-Ghost-Mode': '1' } : {}),
      };
      await fetch(`${BACKEND}/api/presence`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ team_id: teamId, photo: photo || undefined }),
      });
    } catch (_) {}
  }

  async function fetchOnlineUsers() {
    const teamId = window.currentTeamId;
    const session = getSession();
    if (!teamId || !session) return;
    try {
      const res = await fetch(`${BACKEND}/api/presence?team_id=${encodeURIComponent(teamId)}`, {
        headers: { 'Authorization': `Bearer ${session}` },
      });
      const data = await res.json();
      if (data.ok) renderOnlineUsers(data.users || []);
    } catch (_) {}
  }

  function renderOnlineUsers(users) {
    const wrap = document.getElementById('topbarOnlineUsers');
    if (!wrap) return;
    const me = window.atslipAuth?.user;
    const others = users.filter(u => String(u.user_id) !== String(me?.telegram_id));
    if (others.length === 0) { wrap.innerHTML = ''; return; }
    wrap.innerHTML = others.map(u => {
      const name = escapeHtml(u.display_name || String(u.user_id));
      const initial = (u.display_name || String(u.user_id)).charAt(0).toUpperCase();
      const avatarHtml = u.photo
        ? `<img src="${u.photo}" class="topbar-online-avatar-img" alt="">`
        : `<span class="topbar-online-avatar-init" data-uid="${u.user_id}">${escapeHtml(initial)}</span>`;
      return `<div class="topbar-online-avatar">
        ${avatarHtml}
        <span class="topbar-online-tooltip">${name}</span>
      </div>`;
    }).join('');

    // Async load photos for users that didn't have photo in presence (just logged in before photo was stored)
    others.filter(u => !u.photo).forEach(u => {
      const span = wrap.querySelector(`[data-uid="${u.user_id}"]`);
      if (!span) return;
      fetch(`${BACKEND}/api/auth/photo/${encodeURIComponent(u.user_id)}`, {
        headers: { 'Authorization': `Bearer ${getSession()}` },
      }).then(r => r.json()).then(d => {
        if (d.ok && d.photo && span.parentElement) {
          const img = document.createElement('img');
          img.src = d.photo;
          img.className = 'topbar-online-avatar-img';
          img.alt = '';
          span.parentElement.replaceChild(img, span);
        }
      }).catch(() => {});
    });
  }

  // Start presence after auth + wait for currentTeamId
  window.addEventListener('atslipAuthReady', () => {
    if (!window.atslipAuth.user) return;
    let tries = 0;
    const tryStart = () => {
      if (window.currentTeamId) {
        startPresence();
      } else if (tries++ < 20) {
        setTimeout(tryStart, 500);
      }
    };
    tryStart();
  });

  // Restart presence when team changes
  window.addEventListener('teamLoaded', () => {
    if (window.atslipAuth.user && window.currentTeamId) startPresence();
  });

  // ── INIT ──────────────────────────────────────────────────
  async function init() {
    // Try fast path from localStorage first
    const cachedUser  = getUser();
    const cachedPhoto = getPhoto();
    const cachedToken = getSession();

    if (cachedUser && cachedToken) {
      // Show profile immediately from cache
      window.atslipAuth.user    = cachedUser;
      window.atslipAuth.photo   = cachedPhoto;
      window.atslipAuth.session = cachedToken;
      renderTopbarProfile(cachedUser, cachedPhoto);
      hideBlurOverlay();
    }

    // Then verify server-side (non-blocking if cached)
    const user = await checkAuth();
    window.atslipAuth.ready = true;

    if (user) {
      window.atslipAuth.user    = user;
      window.atslipAuth.photo   = getPhoto();
      window.atslipAuth.session = getSession();
      renderTopbarProfile(user, getPhoto());
      hideBlurOverlay();
    } else {
      window.atslipAuth.user    = null;
      window.atslipAuth.photo   = null;
      window.atslipAuth.session = null;
      renderTopbarLoginBtn();
      showBlurOverlay();
    }

    // Fire event for other modules to hook into
    window.dispatchEvent(new CustomEvent('atslipAuthReady', { detail: { user: window.atslipAuth.user } }));
  }

  // Wait for DOM then init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
