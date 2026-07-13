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
    const [membersRes, pendingRes] = await Promise.all([
      api.listMembers(slug),
      api.getPendingJoinRequests(slug).catch(() => ({ requests: [] })),
    ]);
    renderManageUsers(membersRes.members || [], pendingRes.requests || [], slug);
  } catch (e) {
    listEl.innerHTML = `<div style="padding:24px;text-align:center;color:#ef4444;">โหลดข้อมูลล้มเหลว: ${e?.message || e}</div>`;
  }
}

// รวม render ของ pending requests + members
function renderManageUsers(members, pending, slug) {
  const listEl = document.getElementById('manageUsersList');
  if (!listEl) return;
  listEl.innerHTML = renderPendingSection(pending, slug) + renderMemberSection(members, slug);
}

// ── ส่วนคำขอเข้าร่วม (รออนุมัติ) ──────────────────────────
function renderPendingSection(pending, slug) {
  if (!pending || !pending.length) return '';
  const rows = pending.map(r => {
    const avatarHtml = r.photo
      ? `<img src="${r.photo}" class="mu-avatar" alt="avatar">`
      : `<div class="mu-avatar mu-avatar-init">${(r.display_name || '?').charAt(0).toUpperCase()}</div>`;
    return `
      <div class="mu-row" data-req="${escHtml(r.id)}">
        <div class="mu-avatar-wrap">${avatarHtml}</div>
        <div class="mu-info">
          <div class="mu-name">${escHtml(r.display_name || 'ผู้ใช้ใหม่')}</div>
          <div class="mu-tg-name">ID: ${escHtml(String(r.telegram_id))}</div>
        </div>
        <div class="mu-actions">
          <button class="mu-btn mu-btn-approve" onclick="joinApprove('${escHtml(slug)}','${escHtml(r.id)}')">อนุมัติ</button>
          <button class="mu-btn mu-btn-reject" onclick="joinReject('${escHtml(slug)}','${escHtml(r.id)}')">ปฏิเสธ</button>
        </div>
      </div>`;
  }).join('');
  return `
    <div class="mu-section-title">คำขอเข้าร่วม (${pending.length})</div>
    ${rows}
    <div class="mu-section-title" style="margin-top:16px;">สมาชิก</div>`;
}

function renderMemberSection(members, slug) {
  if (!members.length) {
    return '<div style="padding:24px;text-align:center;color:#888;">ยังไม่มีสมาชิก</div>';
  }

  const myTelegramId = window.atslipAuth?.user?.telegram_id;

  return members.map(m => {
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

// ── อนุมัติ / ปฏิเสธ คำขอเข้าร่วม ─────────────────────────
async function joinApprove(slug, requestId) {
  const row = document.querySelector(`.mu-row[data-req="${requestId}"]`);
  const btns = row?.querySelector('.mu-actions');
  if (btns) btns.innerHTML = '<span style="color:#888;font-size:0.8rem;">กำลังอนุมัติ...</span>';
  try {
    await api.approveJoinRequest(slug, requestId);
    // reload ทั้งรายการเพื่ออัปเดตทั้ง pending + members
    await openManageUsersModal();
  } catch (e) {
    alert('อนุมัติไม่สำเร็จ: ' + (e?.message || e));
    await openManageUsersModal();
  }
}

async function joinReject(slug, requestId) {
  if (!confirm('ปฏิเสธคำขอเข้าร่วมนี้?')) return;
  const row = document.querySelector(`.mu-row[data-req="${requestId}"]`);
  const btns = row?.querySelector('.mu-actions');
  if (btns) btns.innerHTML = '<span style="color:#888;font-size:0.8rem;">กำลังปฏิเสธ...</span>';
  try {
    await api.rejectJoinRequest(slug, requestId);
    row?.remove();
  } catch (e) {
    alert('ปฏิเสธไม่สำเร็จ: ' + (e?.message || e));
    await openManageUsersModal();
  }
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

// รีเฟรชรายการเมื่อมีคำขอเข้าร่วมใหม่ระหว่างเปิด modal อยู่
window.addEventListener('joinRequestArrived', () => {
  const modal = document.getElementById('manageUsersModal');
  if (modal && modal.style.display !== 'none') {
    openManageUsersModal();
  }
});

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
