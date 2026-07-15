// ============================================================
// ATslip Side Panel — Match Modal
// ค้นหาผู้ใช้จาก Admin API แล้วจับคู่กับรายการสแกน
// payload อ้างอิงจาก selectUser() ใน frontend/js/app.js
// ============================================================
const MatchModal = {
  _txId: null,
  _tenantId: null,
  _results: [],

  init() {
    document.getElementById('matchModalClose').addEventListener('click', () => this.close());
    document.getElementById('matchModal').addEventListener('click', (e) => {
      if (e.target.id === 'matchModal') this.close();
    });
    document.getElementById('matchSearchBtn').addEventListener('click', () => this.search());
    document.getElementById('matchSearchInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.search();
    });
    // ค้นหาอัตโนมัติขณะพิมพ์ (debounce) — ไม่ต้องกดปุ่มค้นหา
    document.getElementById('matchSearchInput').addEventListener('input', () => {
      clearTimeout(this._searchTimer);
      const q = document.getElementById('matchSearchInput').value.trim();
      if (q.length < 2) return;
      this._searchTimer = setTimeout(() => this.search(), 350);
    });
    document.getElementById('matchResults').addEventListener('click', (e) => {
      const el = e.target.closest('.match-result-item');
      if (el) this.select(Number(el.dataset.index));
    });
  },

  open(txId, tenantId) {
    this._txId = txId;
    this._tenantId = tenantId;
    this._results = [];
    document.getElementById('matchSearchInput').value = '';
    document.getElementById('matchResults').innerHTML = '<div class="match-empty">พิมพ์คำค้นแล้วกดค้นหา</div>';
    document.getElementById('matchModal').classList.remove('hidden');
    setTimeout(() => document.getElementById('matchSearchInput').focus(), 50);
  },

  close() {
    document.getElementById('matchModal').classList.add('hidden');
  },

  async search() {
    const q = document.getElementById('matchSearchInput').value.trim();
    const box = document.getElementById('matchResults');
    if (!q) { box.innerHTML = '<div class="match-empty">กรุณาพิมพ์คำค้น</div>'; return; }
    box.innerHTML = '<div class="match-empty"><span class="spinner"></span> กำลังค้นหา...</div>';
    try {
      // ค้นหาทั้ง member และ non-member พร้อมกัน (เหมือน ATslip) แล้วติด category ให้แต่ละคน
      const [memberRes, nonMemberRes] = await Promise.all([
        Api.searchUsers(q, 'member', this._tenantId).catch(() => ({ data: { users: [] } })),
        Api.searchUsers(q, 'non-member', this._tenantId).catch(() => ({ data: { users: [] } })),
      ]);
      const members = (memberRes?.data?.users || memberRes?.users || []).map((u) => ({ ...u, category: 'member' }));
      const nonMembers = (nonMemberRes?.data?.users || nonMemberRes?.users || []).map((u) => ({ ...u, category: 'non-member' }));
      this._results = [...members, ...nonMembers];
      this.renderResults(members.length, nonMembers.length);
    } catch (e) {
      box.innerHTML = `<div class="match-empty">ค้นหาไม่สำเร็จ: ${ScanList.esc(e.message || e)}</div>`;
    }
  },

  renderResults(memberCount = 0, nonMemberCount = 0) {
    const box = document.getElementById('matchResults');
    if (!this._results.length) {
      box.innerHTML = '<div class="match-empty">ไม่พบผู้ใช้</div>';
      return;
    }
    const itemHtml = (u, i) => {
      const name = u.fullname || u.fullName || u.username || '-';
      const code = u.memberCode || u.username || u.id;
      const sub = [u.phone || u.username, u.bankName || u.bank, u.bankAccount || u.bank_account].filter(Boolean).join(' · ');
      const tag = u.category === 'non-member'
        ? '<span class="match-tag non-member">ไม่ใช่สมาชิก</span>'
        : '<span class="match-tag member">สมาชิก</span>';
      return `<div class="match-result-item" data-index="${i}">
        <div class="match-result-row"><span class="match-result-name">${ScanList.esc(name)}</span>${tag}</div>
        <div class="match-result-sub">รหัส: ${ScanList.esc(code)}${sub ? ' · ' + ScanList.esc(sub) : ''}</div>
      </div>`;
    };
    box.innerHTML = this._results.map((u, i) => itemHtml(u, i)).join('');
  },

  async select(index) {
    const user = this._results[index];
    if (!user) return;

    const fullname = String(user.fullname || user.fullName || user.username || '');
    const username = String(user.username || '');
    let memberCode = String(user.memberCode || '').trim();
    const adminUserId = user.id ? String(user.id) : '';
    const category = user.category || 'member';

    // ถ้ายังไม่มี memberCode (โดยเฉพาะ non-member) → gen ให้ก่อนเสมอ
    if (!memberCode && adminUserId) {
      App.toast('กำลังสร้างรหัสสมาชิก...', '');
      try {
        const gen = await Api.genMemberCode(adminUserId, this._tenantId);
        memberCode = gen?.data?.memberCode || '';
      } catch { /* ปล่อยผ่าน */ }
    }
    // fallback สุดท้าย: ใช้ username
    if (!memberCode && username) memberCode = username;

    const matchedUserId = memberCode || '';
    if (!matchedUserId) {
      App.toast('ไม่พบ/สร้าง memberCode สำหรับผู้ใช้นี้ไม่ได้', 'error');
      return;
    }

    try {
      await Api.matchPending(this._txId, {
        matched_user_id: matchedUserId,
        matched_username: fullname,
        tenant_id: this._tenantId,
        user: { id: adminUserId, memberCode, username, fullname, category },
      });
      App.toast(`จับคู่กับ ${fullname} (${matchedUserId}) สำเร็จ`, 'success');
      this.close();
      await ScanList.refresh();
      // ถ้า popup ยอดซ้ำเปิดอยู่ → อัปเดตในนั้นแทนที่จะปิด (ให้เติมเครดิตต่อได้)
      if (window.DuplicatePopup && DuplicatePopup.isOpen()) {
        DuplicatePopup.onMatched(matchedUserId, fullname);
      }
    } catch (e) {
      App.toast('จับคู่ไม่สำเร็จ: ' + (e.message || e), 'error');
    }
  },
};

window.MatchModal = MatchModal;
