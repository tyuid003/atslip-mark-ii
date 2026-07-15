// ============================================================
// ATslip Side Panel — Duplicate Slip Popup
// แสดงป็อปอัพเมื่อสแกนสลิปซ้ำ + ใช้เป็นพื้นที่ทำงานต่อเนื่อง
// (จับคู่ → เติมเครดิต → ดึงกลับ → จับคู่ใหม่ → เติม) โดยไม่ปิด popup
// dupData: { transaction_id, tenant:{id,name}, sender:{name}, slip:{amount},
//            current_status, matched_username, matched_user_id }
// ============================================================
const DuplicatePopup = {
  _dup: null,
  _img: null,
  _overlay: null,

  init() {
    const overlay = document.createElement('div');
    overlay.id = 'dupOverlay';
    overlay.className = 'modal-overlay hidden';
    document.body.appendChild(overlay);
    this._overlay = overlay;

    // event delegation (innerHTML ถูก render ใหม่ได้เรื่อย ๆ)
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) return this.close();
      const el = e.target.closest('[data-act]');
      if (!el) return;
      const act = el.dataset.act;
      if (act === 'close') this.close();
      else if (act === 'search') this.openSearch();
      else if (act === 'credit') this.credit(el);
      else if (act === 'withdraw') this.withdraw();
      else if (act === 'delete') this.del();
    });
  },

  isOpen() {
    return this._overlay && !this._overlay.classList.contains('hidden');
  },
  get _txId() { return this._dup?.transaction_id || null; },
  get _tenantId() { return this._dup?.tenant?.id || this._dup?.tenant_id || null; },

  show(dup, imgDataUrl) {
    this._dup = { ...dup };
    this._img = imgDataUrl || null;
    this._overlay.classList.remove('hidden');
    this.render();
  },

  render() {
    const dup = this._dup || {};
    const e = ScanList.esc;
    const statusLabels = { credited: 'เติมแล้ว', duplicate: 'ยอดซ้ำ', matched: 'จับคู่แล้ว', pending: 'รอจับคู่' };
    const statusColors = { credited: 'green', duplicate: 'red', matched: 'blue', pending: 'yellow' };
    const status = dup.current_status || 'duplicate';
    const statusLabel = statusLabels[status] || status;
    const statusColor = statusColors[status] || 'red';

    const amount = dup.slip?.amount != null
      ? Number(dup.slip.amount).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : (dup.amount ?? '—');

    let matchedUser = '—';
    if (dup.matched_username && dup.matched_user_id) matchedUser = `${dup.matched_username} (${dup.matched_user_id})`;
    else if (dup.matched_username) matchedUser = dup.matched_username;
    else if (dup.matched_user_id) matchedUser = `(${dup.matched_user_id})`;

    const hasUser = !!dup.matched_user_id;
    const isCredited = status === 'credited';
    const canCredit = hasUser && !isCredited;

    this._overlay.innerHTML = `
      <div class="modal dup-modal" role="dialog" aria-modal="true">
        <div class="modal-head dup-head">
          <h3>
            <svg viewBox="0 0 24 24" class="ic" style="color:#dc2626"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01"/></svg>
            สลิปซ้ำในระบบ
          </h3>
          <button class="modal-close" data-act="close">&times;</button>
        </div>
        <div class="modal-body dup-body">
          ${this._img ? `<div class="dup-img-wrap"><img src="${this._img}" class="dup-img" alt="สลิป"></div>` : ''}
          <div class="dup-details">
            <div class="dup-row"><span class="dup-label">สถานะ</span><span class="status-badge status-${statusColor}">${e(statusLabel)}</span></div>
            <div class="dup-row"><span class="dup-label">ยอดเงิน</span><span class="dup-amount">${e(amount)} บาท</span></div>
            <div class="dup-row"><span class="dup-label">ชื่อผู้โอน</span><span class="dup-val">${e(dup.sender?.name || '—')}</span></div>
            <div class="dup-row"><span class="dup-label">เว็บ</span><span class="dup-val">${e(dup.tenant?.name || dup.tenant?.id || '—')}</span></div>
            <div class="dup-row"><span class="dup-label">ยูสเซอร์</span>
              <span class="dup-val dup-user">
                <span>${e(matchedUser)}</span>
                <button class="icon-btn" data-act="search" title="ค้นหา/จับคู่ยูสเซอร์">
                  <svg viewBox="0 0 24 24" class="ic"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                </button>
              </span>
            </div>
          </div>
        </div>
        <div class="modal-foot dup-foot">
          ${this._txId ? `<button class="btn-ghost dup-del" data-act="delete">ลบรายการ</button>` : ''}
          <div class="dup-foot-actions">
            <button class="pending-credit-btn" data-act="credit" ${canCredit ? '' : 'disabled'} title="เติมเครดิต">เติมเครดิต</button>
            <button class="pending-credit-btn pending-credit-btn-withdraw" data-act="withdraw" ${isCredited ? '' : 'disabled'} title="ดึงเครดิตกลับ">ดึงเครดิตกลับ</button>
          </div>
        </div>
      </div>`;
  },

  // เรียกจาก MatchModal เมื่อจับคู่สำเร็จ (popup ยังเปิดอยู่)
  onMatched(matchedUserId, matchedUsername) {
    if (!this._dup) return;
    this._dup.matched_user_id = matchedUserId;
    this._dup.matched_username = matchedUsername;
    if (this._dup.current_status !== 'credited') this._dup.current_status = 'matched';
    this.render();
  },

  openSearch() {
    // ไม่ปิด popup — เปิด MatchModal ทับด้านบน จับคู่เสร็จจะ refresh กลับมา
    MatchModal.open(this._txId, this._tenantId);
  },

  async credit(btn) {
    if (!this._txId) return;
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }
    try {
      await Api.creditPending(this._txId);
      App.toast('เติมเครดิตสำเร็จ', 'success');
      await ScanList.refresh();
      this.close(); // เติมเครดิตสำเร็จ = จบงาน → ปิด popup
    } catch (e) {
      App.toast('เติมไม่สำเร็จ: ' + (e.message || e), 'error');
      this.render();
    }
  },

  async withdraw() {
    if (!this._txId) return;
    const ok = await App.confirm('ต้องการดึงเครดิตกลับรายการนี้ใช่หรือไม่?', { okText: 'ดึงเครดิตกลับ', danger: true });
    if (!ok) return;
    const btn = this._overlay.querySelector('[data-act="withdraw"]');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }
    try {
      await Api.withdrawPending(this._txId);
      App.toast('ดึงเครดิตกลับสำเร็จ', 'success');
      this._dup.current_status = this._dup.matched_user_id ? 'matched' : 'pending';
      await ScanList.refresh();
      this.render(); // ไม่ปิด — ให้จับคู่ใหม่/เติมใหม่ได้
    } catch (e) {
      App.toast('ดึงไม่สำเร็จ: ' + (e.message || e), 'error');
      this.render();
    }
  },

  async del() {
    if (!this._txId) return;
    const ok = await App.confirm('ยืนยันลบรายการนี้?', { okText: 'ลบ', danger: true });
    if (!ok) return;
    try {
      await Api.deletePending(this._txId);
      App.toast('ลบรายการแล้ว', 'success');
      this.close();
      ScanList.refresh();
    } catch (e) {
      App.toast('ลบไม่สำเร็จ: ' + (e.message || e), 'error');
    }
  },

  close() {
    this._overlay.classList.add('hidden');
    this._overlay.innerHTML = '';
    this._dup = null;
    this._img = null;
  },
};

window.DuplicatePopup = DuplicatePopup;
