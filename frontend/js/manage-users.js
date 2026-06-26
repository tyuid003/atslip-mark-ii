// ============================================================
// MANAGE USERS — จัดการผู้ใช้งานในทีม (Kick / Ban)
// ============================================================

function kebabOpenManageUsers() {
  // ปิด kebab menu
  const dd = document.getElementById('kebabMenuDropdown');
  if (dd) dd.style.display = 'none';

  openManageUsersModal();
}

async function openManageUsersModal() {
  const modal = document.getElementById('manageUsersModal');
  const listEl = document.getElementById('manageUsersList');
  if (!modal || !listEl) return;

  modal.style.display = 'flex';
  listEl.innerHTML = '<div style="padding:24px;text-align:center;color:#888;">กำลังโหลด...</div>';

  const slug = window.currentTeamSlug;
  if (!slug || slug === 'default') {
    listEl.innerHTML = '<div style="padding:24px;text-align:center;color:#888;">ไม่พบทีม</div>';
    return;
  }

  try {
    const res = await api.listMembers(slug);
    renderMemberList(res.members || [], slug);
  } catch (e) {
    listEl.innerHTML = `<div style="padding:24px;text-align:center;color:#ef4444;">โหลดข้อมูลล้มเหลว: ${e?.message || e}</div>`;
  }
}

function renderMemberList(members, slug) {
  const listEl = document.getElementById('manageUsersList');
  if (!members.length) {
    listEl.innerHTML = '<div style="padding:24px;text-align:center;color:#888;">ยังไม่มีสมาชิก</div>';
    return;
  }

  const myTelegramId = window.atslipAuth?.user?.telegram_id;

  listEl.innerHTML = members.map(m => {
    const isMe = String(m.telegram_id) === String(myTelegramId);
    const avatarHtml = m.photo
      ? `<img src="${m.photo}" class="mu-avatar" alt="avatar">`
      : `<div class="mu-avatar mu-avatar-init">${(m.display_name || '?').charAt(0).toUpperCase()}</div>`;

    const nameHtml = m.display_name !== m.telegram_name && m.telegram_name
      ? `<div class="mu-name">${escHtml(m.display_name)}</div>
         <div class="mu-tg-name">${escHtml(m.telegram_name)}</div>`
      : `<div class="mu-name">${escHtml(m.display_name)}</div>`;

    const bannedBadge = m.is_banned ? '<span class="mu-badge-banned">ระงับ</span>' : '';
    const meBadge = isMe ? '<span class="mu-badge-me">ฉัน</span>' : '';

    const actionBtns = isMe ? '' : `
      <div class="mu-actions">
        ${m.is_banned
          ? `<button class="mu-btn mu-btn-unban" onclick="memberUnban('${escHtml(slug)}','${m.telegram_id}')">ยกเลิกระงับ</button>`
          : `<button class="mu-btn mu-btn-ban" onclick="memberBan('${escHtml(slug)}','${m.telegram_id}')">ระงับ</button>`
        }
        <button class="mu-btn mu-btn-kick" onclick="memberKick('${escHtml(slug)}','${m.telegram_id}')">เตะ</button>
      </div>`;

    return `
      <div class="mu-row" data-tid="${m.telegram_id}">
        <div class="mu-avatar-wrap">${avatarHtml}</div>
        <div class="mu-info">
          ${nameHtml}
          <div class="mu-badges">${meBadge}${bannedBadge}</div>
        </div>
        ${actionBtns}
      </div>`;
  }).join('');
}

function escHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

async function memberKick(slug, telegramId) {
  if (!confirm('เตะผู้ใช้งานออกจากทีม? (session จะถูกล้างด้วย)')) return;
  try {
    await api.kickMember(slug, telegramId);
    // ลบ row ออกจาก UI
    document.querySelector(`.mu-row[data-tid="${telegramId}"]`)?.remove();
    const listEl = document.getElementById('manageUsersList');
    if (!listEl.querySelector('.mu-row')) {
      listEl.innerHTML = '<div style="padding:24px;text-align:center;color:#888;">ยังไม่มีสมาชิก</div>';
    }
  } catch (e) {
    alert('เกิดข้อผิดพลาด: ' + (e?.message || e));
  }
}

async function memberBan(slug, telegramId) {
  const reason = prompt('เหตุผลการระงับ (ไม่บังคับ):', '');
  if (reason === null) return; // cancelled
  try {
    await api.banMember(slug, telegramId, reason || '');
    // อัปเดต badge
    const row = document.querySelector(`.mu-row[data-tid="${telegramId}"]`);
    if (row) {
      const badges = row.querySelector('.mu-badges');
      if (badges && !badges.querySelector('.mu-badge-banned')) {
        badges.insertAdjacentHTML('beforeend', '<span class="mu-badge-banned">ระงับ</span>');
      }
      const actions = row.querySelector('.mu-actions');
      if (actions) {
        actions.innerHTML = `<button class="mu-btn mu-btn-unban" onclick="memberUnban('${escHtml(slug)}','${telegramId}')">ยกเลิกระงับ</button>
          <button class="mu-btn mu-btn-kick" onclick="memberKick('${escHtml(slug)}','${telegramId}')">เตะ</button>`;
      }
    }
  } catch (e) {
    alert('เกิดข้อผิดพลาด: ' + (e?.message || e));
  }
}

async function memberUnban(slug, telegramId) {
  try {
    await api.unbanMember(slug, telegramId);
    const row = document.querySelector(`.mu-row[data-tid="${telegramId}"]`);
    if (row) {
      row.querySelector('.mu-badge-banned')?.remove();
      const actions = row.querySelector('.mu-actions');
      if (actions) {
        actions.innerHTML = `<button class="mu-btn mu-btn-ban" onclick="memberBan('${escHtml(slug)}','${telegramId}')">ระงับ</button>
          <button class="mu-btn mu-btn-kick" onclick="memberKick('${escHtml(slug)}','${telegramId}')">เตะ</button>`;
      }
    }
  } catch (e) {
    alert('เกิดข้อผิดพลาด: ' + (e?.message || e));
  }
}

function closeManageUsersModal() {
  const modal = document.getElementById('manageUsersModal');
  if (modal) modal.style.display = 'none';
}

// ── รับ member_kicked event จาก WebSocket ─────────────────
window.addEventListener('memberKicked', (e) => {
  const myId = String(window.atslipAuth?.user?.telegram_id || '');
  const kickedId = String(e.detail?.telegram_id || '');
  if (myId && myId === kickedId) {
    // เราถูกเตะ — ล้าง local session แล้ว redirect
    localStorage.removeItem('atslip_session');
    localStorage.removeItem('atslip_user');
    localStorage.removeItem('atslip_photo');
    window.location.replace('/login.html');
  }
});
