// ============================================================
// ATslip Side Panel — Scan List
// ดึงและ render รายการสแกน (pending transactions) + จัดการ credit/withdraw/delete
// ปรับ layout ให้พอดีกับ side panel ที่แคบ
// ============================================================
const ScanList = {
  _all: [],
  _pollTimer: null,
  _realtimeActive: false,

  init() {
    // ปุ่ม action ใช้ event delegation เพราะ item ถูก render ใหม่บ่อย
    document.getElementById('pendingList').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const item = btn.closest('.pending-item');
      const id = item?.dataset.itemId;
      if (!id) return;
      const action = btn.dataset.action;
      if (action === 'credit') this.credit(id, btn);
      else if (action === 'withdraw') this.withdraw(id, btn);
      else if (action === 'delete') this.remove(id);
      else if (action === 'search') MatchModal.open(id, item.dataset.tenantId);
      else if (action === 'copy-user') this.copyUser(btn);
    });
  },

  // คลิกชื่อผู้ใช้ที่จับคู่ → คัดลอกข้อความเต็ม (เช่น "ภาณุพงศ์ จุลเศียร (zta70fd1003805)")
  copyUser(el) {
    const text = (el.textContent || '').trim();
    if (!text) return;
    const done = () => App.toast('คัดลอกแล้ว: ' + text, 'success');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => this._fallbackCopy(text, done));
    } else {
      this._fallbackCopy(text, done);
    }
  },

  _fallbackCopy(text, done) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      done && done();
    } catch (_) {
      App.toast('คัดลอกไม่สำเร็จ', 'error');
    }
  },

  startPolling() {
    this.stopPolling();
    const interval = this._realtimeActive
      ? 30000 // realtime ทำงานอยู่ → poll เป็น safety net นาน ๆ ครั้ง
      : window.ATSLIP_CONFIG.POLL_INTERVAL_MS;
    this._pollTimer = setInterval(() => this.refresh(true), interval);
  },
  stopPolling() {
    if (this._pollTimer) clearInterval(this._pollTimer);
    this._pollTimer = null;
  },

  // เรียกจาก Realtime เมื่อ WebSocket ต่อได้/หลุด
  setRealtimeActive(active) {
    if (this._realtimeActive === active) return;
    this._realtimeActive = active;
    if (this._pollTimer) this.startPolling(); // ปรับ interval ใหม่
  },

  async refresh(silent = false) {
    if (!Settings.isConfigured()) return;
    try {
      const filters = App.getFilters();
      const res = await Api.searchPending({ limit: window.ATSLIP_CONFIG.PENDING_LIMIT, ...filters });
      // รูปแบบ backend: { success, data: { data: [...], total, page, limit } }
      const d = res?.data;
      const items = Array.isArray(d?.data) ? d.data
        : Array.isArray(d?.transactions) ? d.transactions
        : Array.isArray(d?.items) ? d.items
        : Array.isArray(d) ? d
        : Array.isArray(res?.transactions) ? res.transactions
        : [];
      this._all = items;
      this.applySearchAndRender();
    } catch (e) {
      if (!silent) App.toast('โหลดรายการไม่สำเร็จ: ' + (e.message || e), 'error');
    }
  },

  applySearchAndRender() {
    const q = (App.getSearchQuery() || '').toLowerCase().trim();
    let list = this._all;
    if (q) {
      list = list.filter((item) => {
        const sender = (item.sender_name || '').toLowerCase();
        const receiver = (item.receiver_name || '').toLowerCase();
        const matched = (item.matched_username || '').toLowerCase();
        const amount = String(item.amount || '');
        return sender.includes(q) || receiver.includes(q) || matched.includes(q) || amount.includes(q);
      });
    }
    this.render(list.slice(0, window.ATSLIP_CONFIG.PENDING_LIMIT));
  },

  render(items) {
    const list = document.getElementById('pendingList');
    if (!items || items.length === 0) {
      list.innerHTML = '<div class="pending-empty">ยังไม่มีรายการ...</div>';
      return;
    }
    list.innerHTML = items.map((item) => this.itemHtml(item)).join('');
  },

  itemHtml(item) {
    const amount = Number(item.amount || 0).toLocaleString('th-TH');
    const slipDate = this.formatSlipDate(item);

    let matchedUserText = '';
    if (item.matched_username && item.matched_user_id) matchedUserText = `${item.matched_username} (${item.matched_user_id})`;
    else if (item.matched_username) matchedUserText = item.matched_username;
    else if (item.matched_user_id) matchedUserText = `(${item.matched_user_id})`;

    const statusConfig = {
      pending: { color: 'yellow', label: 'รอจับคู่' },
      matched: { color: 'blue', label: 'จับคู่แล้ว' },
      credited: { color: 'green', label: 'เติมแล้ว' },
      duplicate: { color: 'red', label: 'ยอดซ้ำ' },
    };
    const status = statusConfig[item.status] || statusConfig.pending;
    const canWithdraw = item.status === 'credited';
    const canCredit = !!item.matched_user_id && item.status !== 'credited' && item.status !== 'duplicate';

    const creditActionHtml = canWithdraw
      ? `<button class="pending-credit-btn pending-credit-btn-withdraw" data-action="withdraw" title="ดึงเครดิตกลับ">ดึงเครดิตกลับ</button>`
      : (canCredit
          ? `<button class="pending-credit-btn" data-action="credit" title="เติมเครดิต">เติมเครดิต</button>`
          : '');

    const scannedByHtml = this.scannedByHtml(item);

    return `
      <div class="pending-item" data-item-id="${this.esc(item.id)}" data-tenant-id="${this.esc(item.tenant_id)}">
        <div class="pending-item-top">
          <span class="status-badge status-${status.color}">${status.label}</span>
          <div class="matched-user-info">
            ${matchedUserText ? `<span class="matched-user-text" data-action="copy-user" title="คลิกเพื่อคัดลอก">${this.esc(matchedUserText)}</span>` : ''}
            <button class="icon-btn" data-action="search" title="ค้นหาและจับคู่ผู้ใช้">
              <svg viewBox="0 0 24 24" class="ic"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            </button>
            <button class="icon-btn danger" data-action="delete" title="ลบรายการ">
              <svg viewBox="0 0 24 24" class="ic"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </div>
        <div class="pending-item-bottom">
          <div class="pending-info">
            <div class="transfer-info">
              <span class="sender-name">${this.esc(item.sender_name || 'ไม่ระบุชื่อ')}</span>
              ${item.receiver_name ? `<svg viewBox="0 0 24 24" class="ic" style="width:12px;height:12px;color:var(--c-text-dim)"><path d="M5 12h14M12 5l7 7-7 7"/></svg><span class="receiver-name">${this.esc(item.receiver_name)}</span>` : ''}
            </div>
            <div class="pending-meta">
              <span class="slip-date">${slipDate}${item.tenant_name ? ' · ' + this.esc(item.tenant_name) : ''}</span>
              ${scannedByHtml}
            </div>
          </div>
          <div class="pending-amount-actions">
            ${creditActionHtml}
            <span class="amount">${amount} บาท</span>
          </div>
        </div>
      </div>`;
  },

  // badge ผู้สแกน (source + ชื่อ/รูป)
  scannedByHtml(item) {
    const src = item.source || 'manual';
    const name = item.scanned_by_name || '';
    const photo = item.scanned_by_photo || '';
    const avatar = photo
      ? `<img src="${this.esc(photo)}" class="scanned-by-avatar" alt="">`
      : (name ? `<span class="scanned-by-avatar init">${this.esc(name.charAt(0).toUpperCase())}</span>` : '');
    if (name) {
      return `<span class="scanned-by-badge">${avatar}<span class="scanned-by-name">${this.esc(name)}</span></span>`;
    }
    const srcLabels = { telegram: 'telegram', line: 'auto', auto: 'auto', upload: 'auto', webhook: 'auto', manual: '' };
    const label = srcLabels[src];
    if (!label) return '';
    return `<span class="scanned-by-badge"><span class="scanned-by-name">${label}</span></span>`;
  },

  formatSlipDate(item) {
    try {
      if (item.slip_data) {
        let sd = typeof item.slip_data === 'string' ? JSON.parse(item.slip_data) : item.slip_data;
        if (sd && sd.date) {
          const d = new Date(sd.date);
          if (!isNaN(d.getTime())) {
            return d.toLocaleString('th-TH', {
              year: 'numeric', month: '2-digit', day: '2-digit',
              hour: '2-digit', minute: '2-digit', second: '2-digit',
            });
          }
        }
      }
    } catch { /* ignore */ }
    if (item.created_at) return new Date(item.created_at * 1000).toLocaleString('th-TH');
    return '-';
  },

  async credit(id, btn) {
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }
    try {
      await Api.creditPending(id);
      App.toast('เติมเครดิตสำเร็จ', 'success');
      await this.refresh();
    } catch (e) {
      App.toast('เติมเครดิตไม่สำเร็จ: ' + (e.message || e), 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'เติมเครดิต'; }
    }
  },

  async withdraw(id, btn) {
    const ok = await App.confirm('ต้องการดึงเครดิตกลับรายการนี้ใช่หรือไม่?', { okText: 'ดึงเครดิตกลับ', danger: true });
    if (!ok) return;
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }
    try {
      await Api.withdrawPending(id);
      App.toast('ดึงเครดิตกลับสำเร็จ', 'success');
      await this.refresh();
    } catch (e) {
      App.toast('ดึงเครดิตกลับไม่สำเร็จ: ' + (e.message || e), 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'ดึงเครดิตกลับ'; }
    }
  },

  async remove(id) {
    const ok = await App.confirm('ยืนยันลบรายการนี้?', { okText: 'ลบ', danger: true });
    if (!ok) return;
    try {
      await Api.deletePending(id);
      App.toast('ลบรายการแล้ว', 'success');
      await this.refresh();
    } catch (e) {
      App.toast('ลบไม่สำเร็จ: ' + (e.message || e), 'error');
    }
  },

  esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  },
};

window.ScanList = ScanList;
