// ============================================================
// MANAGE USERS — จัดการผู้ใช้งานในทีม
// ============================================================

function kebabOpenManageUsers() {
  const dd = document.getElementById('kebabMenuDropdown');
  if (dd) dd.style.display = 'none';
  openManageUsersModal();
}

async function openManageUsersModal() {
  const modal = document.getElementById('manageUsersModal');
  const listEl = document.getElementById('manageUsersList');
  if (!modal || !listEl) return;

  modal.style.display = 'flex';
  const addPanel = document.getElementById('muAddUserPanel');
  if (addPanel) addPanel.style.display = 'none';

  listEl.innerHTML = '<div style="padding:24px;text-align:center;color:#888;">กำลังโหลด...</div>';

  const slug = window.currentTeamSlug;
  if (!slug || slug === 'default') {
    listEl.innerHTML = '<div style="padding:24px;text-align:center;color:#888;">ไม่พบทีม</div>';
    return;
  }

  try {
    const [membersRes, pendingRes] = await Promise.all([
      api.listMembers(slug),
      api.getPendingJoinRequests(slug).catch(() => ({ requests: [] })),
    ]);
    renderManageUsers(membersRes.members || [], pendingRes.requests || [], slug);
  } catch (e) {
    listEl.innerHTML = `<div style="padding:24px;text-align:center;color:#ef4444;">โหลดข้อมูลล้มเหลว: ${e?.message || e}</div>`;
  }
}

function renderManageUsers(members, pending, slug) {
  const listEl = document.getElementById('manageUsersList');
  if (!listEl) return;
  listEl.innerHTML = renderPendingSection(pending, slug) + renderMemberSection(members, slug);
}

function renderPendingSection(pending, slug) {
  if (!pending || !pending.length) return '';
  const rows = pending.map(r => {
    const av = r.photo
      ? `<img src="${r.photo}" class="mu-avatar" alt="avatar">`
      : `<div class="mu-avatar mu-avatar-init">${(r.display_name || '?').charAt(0).toUpperCase()}</div>`;
    return `<div class="mu-row" data-req="${escHtml(r.id)}">
        <div class="mu-avatar-wrap">${av}</div>
        <div class="mu-info"><div class="mu-name">${escHtml(r.display_name || 'ผู้ใช้ใหม่')}</div><div class="mu-tg-name">ID: ${escHtml(String(r.telegram_id))}</div></div>
        <div class="mu-actions">
          <button class="mu-btn mu-btn-approve" onclick="joinApprove('${escHtml(slug)}','${escHtml(r.id)}')">อนุมัติ</button>
          <button class="mu-btn mu-btn-reject" onclick="joinReject('${escHtml(slug)}','${escHtml(r.id)}')">ปฏิเสธ</button>
        </div></div>`;
  }).join('');
  return `<div class="mu-section-title">คำขอเข้าร่วม (${pending.length})</div>${rows}<div class="mu-section-title" style="margin-top:16px;">สมาชิก</div>`;
}

function renderMemberSection(members, slug) {
  if (!members.length) return '<div style="padding:24px;text-align:center;color:#888;">ยังไม่มีสมาชิก</div>';

  const myTelegramId = window.atslipAuth?.user?.telegram_id;
  const myMember = members.find(m => String(m.telegram_id) === String(myTelegramId));
  const iAmAdmin = window.atslipAuth?.user?.is_master || myMember?.role === 'admin';

  return members.map((m, i) => {
    const isMe = String(m.telegram_id) === String(myTelegramId);
    const av = m.photo
      ? `<img src="${m.photo}" class="mu-avatar" alt="avatar">`
      : `<div class="mu-avatar mu-avatar-init">${(m.display_name || '?').charAt(0).toUpperCase()}</div>`;

    const nameHtml = (m.display_name !== m.telegram_name && m.telegram_name)
      ? `<div class="mu-name">${escHtml(m.display_name)}</div><div class="mu-tg-name">${escHtml(m.telegram_name)}</div>`
      : `<div class="mu-name">${escHtml(m.display_name)}</div>`;

    const roleBadge   = m.role === 'admin' ? '<span class="mu-badge-role mu-badge-admin">Admin</span>' : '<span class="mu-badge-role mu-badge-member">Member</span>';
    const bannedBadge = m.is_banned ? '<span class="mu-badge-banned">ระงับ</span>' : '';
    const meBadge     = isMe ? '<span class="mu-badge-me">ฉัน</span>' : '';

    let menuHtml = '';
    if (!isMe && iAmAdmin) {
      const mid = `mu-dd-${i}`;
      const tid = escHtml(String(m.telegram_id));
      const sl  = escHtml(slug);
      const roleItem = m.role === 'admin'
        ? `<button class="mu-drop-item" onclick="muSetRole('${sl}','${tid}','member');muCloseMenu('${mid}')">⬇️ ลดเป็น Member</button>`
        : `<button class="mu-drop-item" onclick="muSetRole('${sl}','${tid}','admin');muCloseMenu('${mid}')">👑 เลื่อนเป็น Admin</button>`;
      const banItem = m.is_banned
        ? `<button class="mu-drop-item" onclick="muUnban('${sl}','${tid}');muCloseMenu('${mid}')">✅ ยกเลิกระงับ</button>`
        : `<button class="mu-drop-item mu-drop-warn" onclick="muBan('${sl}','${tid}');muCloseMenu('${mid}')">🚫 ระงับ</button>`;
      menuHtml = `<div class="mu-menu-wrap">
          <button class="mu-menu-btn" onclick="event.stopPropagation();muToggleMenu('${mid}')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/></svg></button>
          <div id="${mid}" class="mu-dropdown">
            ${roleItem}
            <button class="mu-drop-item" onclick="muOpenChangePassword('${sl}','${tid}');muCloseMenu('${mid}')">🔑 เปลี่ยนรหัสผ่าน</button>
            <div class="mu-drop-divider"></div>
            <button class="mu-drop-item mu-drop-warn" onclick="muKick('${sl}','${tid}');muCloseMenu('${mid}')">🚪 เตะออกจากทีม</button>
            ${banItem}
          </div>
        </div>`;
    }

    return `<div class="mu-row" data-tid="${m.telegram_id}">
        <div class="mu-avatar-wrap">${av}</div>
        <div class="mu-info">${nameHtml}<div class="mu-badges">${meBadge}${roleBadge}${bannedBadge}</div></div>
        ${menuHtml}
      </div>`;
  }).join('');
}

// ── Three-dot menu ────────────────────────────────────────
function muToggleMenu(mid) {
  const m = document.getElementById(mid);
  const wasOpen = m?.classList.contains('open');
  document.querySelectorAll('.mu-dropdown.open').forEach(d => d.classList.remove('open'));
  if (!wasOpen && m) m.classList.add('open');
}
function muCloseMenu(mid) { document.getElementById(mid)?.classList.remove('open'); }
document.addEventListener('click', e => {
  if (!e.target.closest('.mu-menu-wrap'))
    document.querySelectorAll('.mu-dropdown.open').forEach(d => d.classList.remove('open'));
});

// ── Kick / Ban / Unban / Role ─────────────────────────────
async function muKick(slug, telegramId) {
  if (!confirm('เตะผู้ใช้งานออกจากทีม? (session จะถูกล้างด้วย)')) return;
  try { await api.kickMember(slug, telegramId); document.querySelector(`.mu-row[data-tid="${telegramId}"]`)?.remove(); }
  catch (e) { alert('เกิดข้อผิดพลาด: ' + (e?.message || e)); }
}
async function muBan(slug, telegramId) {
  const reason = prompt('เหตุผลการระงับ (ไม่บังคับ):', '');
  if (reason === null) return;
  try { await api.banMember(slug, telegramId, reason || ''); await openManageUsersModal(); }
  catch (e) { alert('เกิดข้อผิดพลาด: ' + (e?.message || e)); }
}
async function muUnban(slug, telegramId) {
  try { await api.unbanMember(slug, telegramId); await openManageUsersModal(); }
  catch (e) { alert('เกิดข้อผิดพลาด: ' + (e?.message || e)); }
}
async function muSetRole(slug, telegramId, newRole) {
  const label = newRole === 'admin' ? 'เลื่อนเป็น Admin' : 'ลดเป็น Member';
  if (!confirm(`${label} ผู้ใช้นี้?`)) return;
  try { await api.setMemberRole(slug, telegramId, newRole); await openManageUsersModal(); }
  catch (e) { alert('เกิดข้อผิดพลาด: ' + (e?.message || e)); }
}

// ── เปลี่ยนรหัสผ่าน ──────────────────────────────────────
let _cpSlug = '', _cpTid = '';
function muOpenChangePassword(slug, telegramId) {
  _cpSlug = slug; _cpTid = telegramId;
  const overlay = document.getElementById('muCpOverlay');
  if (!overlay) return;
  document.getElementById('muCpNew').value = '';
  document.getElementById('muCpConfirm').value = '';
  const st = document.getElementById('muCpStatus'); st.textContent = ''; st.style.display = 'none';
  overlay.style.display = 'flex';
  setTimeout(() => document.getElementById('muCpNew').focus(), 80);
}
function muCloseCp() { const el = document.getElementById('muCpOverlay'); if (el) el.style.display = 'none'; }
async function muSubmitCp() {
  const np = document.getElementById('muCpNew').value;
  const cp = document.getElementById('muCpConfirm').value;
  const st = document.getElementById('muCpStatus');
  if (!np || np.length < 6) { st.textContent = 'รหัสผ่านต้องมีอย่างน้อย 6 ตัว'; st.style.color = '#ef4444'; st.style.display = 'block'; return; }
  if (np !== cp) { st.textContent = 'รหัสผ่านไม่ตรงกัน'; st.style.color = '#ef4444'; st.style.display = 'block'; return; }
  const btn = document.getElementById('muCpSubmit');
  btn.disabled = true; btn.textContent = 'กำลังบันทึก...';
  try {
    await api.teamChangePassword(_cpSlug, _cpTid, np);
    st.textContent = 'เปลี่ยนรหัสผ่านสำเร็จ'; st.style.color = '#16a34a'; st.style.display = 'block';
    setTimeout(muCloseCp, 1200);
  } catch (e) { st.textContent = e?.message || 'เกิดข้อผิดพลาด'; st.style.color = '#ef4444'; st.style.display = 'block'; }
  finally { btn.disabled = false; btn.textContent = 'บันทึก'; }
}

// ── เพิ่มผู้ใช้เข้าทีม ──────────────────────────────────
function muToggleAddUser() {
  const panel = document.getElementById('muAddUserPanel');
  if (!panel) return;
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) {
    document.getElementById('muAddUserSearch').value = '';
    document.getElementById('muAddUserResults').innerHTML = '';
    const st = document.getElementById('muAddUserStatus'); st.style.display = 'none';
    setTimeout(() => document.getElementById('muAddUserSearch').focus(), 80);
  }
}
let _muTimer = null;
function muOnSearchInput(q) {
  clearTimeout(_muTimer);
  const el = document.getElementById('muAddUserResults');
  if (!q || q.length < 2) { el.innerHTML = ''; return; }
  el.innerHTML = '<div style="padding:8px;color:#9ca3af;font-size:0.8rem;">กำลังค้นหา...</div>';
  _muTimer = setTimeout(async () => {
    try {
      const r = await api.searchAvailableUsers(window.currentTeamSlug, q);
      const users = r.users || [];
      if (!users.length) { el.innerHTML = '<div style="padding:8px;color:#9ca3af;font-size:0.8rem;">ไม่พบผู้ใช้</div>'; return; }
      el.innerHTML = users.map(u => `<div class="mu-search-row" onclick="muAddUser('${escHtml(u.telegram_id)}','${escHtml(u.display_name)}')">
          <div class="mu-search-av">${escHtml(u.display_name.charAt(0).toUpperCase())}</div>
          <div><div style="font-weight:600;font-size:0.84rem;">${escHtml(u.display_name)}</div>${u.username ? `<div style="font-size:0.72rem;color:#9ca3af;">@${escHtml(u.username)}</div>` : ''}</div>
        </div>`).join('');
    } catch (e) { el.innerHTML = `<div style="padding:8px;color:#ef4444;font-size:0.8rem;">${escHtml(e?.message || 'เกิดข้อผิดพลาด')}</div>`; }
  }, 350);
}
async function muAddUser(telegramId, displayName) {
  const slug = window.currentTeamSlug;
  const st = document.getElementById('muAddUserStatus');
  try {
    await api.addMember(slug, telegramId);
    st.textContent = `เพิ่ม ${displayName} สำเร็จ`; st.style.color = '#16a34a'; st.style.display = 'block';
    document.getElementById('muAddUserSearch').value = '';
    document.getElementById('muAddUserResults').innerHTML = '';
    setTimeout(() => { st.style.display = 'none'; }, 1500);
    await openManageUsersModal();
  } catch (e) { st.textContent = e?.message || 'เกิดข้อผิดพลาด'; st.style.color = '#ef4444'; st.style.display = 'block'; }
}

// ── คำขอเข้าร่วม ─────────────────────────────────────────
async function joinApprove(slug, requestId) {
  const row = document.querySelector(`.mu-row[data-req="${requestId}"]`);
  const btns = row?.querySelector('.mu-actions');
  if (btns) btns.innerHTML = '<span style="color:#888;font-size:0.8rem;">กำลังอนุมัติ...</span>';
  try { await api.approveJoinRequest(slug, requestId); await openManageUsersModal(); }
  catch (e) { alert('อนุมัติไม่สำเร็จ: ' + (e?.message || e)); await openManageUsersModal(); }
}
async function joinReject(slug, requestId) {
  if (!confirm('ปฏิเสธคำขอเข้าร่วมนี้?')) return;
  const row = document.querySelector(`.mu-row[data-req="${requestId}"]`);
  const btns = row?.querySelector('.mu-actions');
  if (btns) btns.innerHTML = '<span style="color:#888;font-size:0.8rem;">กำลังปฏิเสธ...</span>';
  try { await api.rejectJoinRequest(slug, requestId); row?.remove(); }
  catch (e) { alert('ปฏิเสธไม่สำเร็จ: ' + (e?.message || e)); await openManageUsersModal(); }
}

function escHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// compat aliases
const memberKick    = (s, t) => muKick(s, t);
const memberBan     = (s, t) => muBan(s, t);
const memberUnban   = (s, t) => muUnban(s, t);
const memberSetRole = (s, t, r) => muSetRole(s, t, r);

window.addEventListener('joinRequestArrived', () => {
  const modal = document.getElementById('manageUsersModal');
  if (modal && modal.style.display !== 'none') openManageUsersModal();
});
window.addEventListener('memberKicked', (e) => {
  const myId = String(window.atslipAuth?.user?.telegram_id || '');
  if (myId && myId === String(e.detail?.telegram_id || '')) {
    ['atslip_session','atslip_user','atslip_photo'].forEach(k => localStorage.removeItem(k));
    window.location.replace('/login.html');
  }
});

function closeManageUsersModal() {
  const modal = document.getElementById('manageUsersModal');
  if (modal) modal.style.display = 'none';
}

