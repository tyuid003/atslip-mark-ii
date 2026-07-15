// ============================================================
// ATslip Side Panel — Main App
// ต่อทุกส่วนเข้าด้วยกัน: settings, scan box, search/filter, TOC nav,
// quick-scan bridge จาก chat.line.biz
// ============================================================
const App = {
  _toastTimer: null,

  async init() {
    await Settings.load();

    ScanList.init();
    MatchModal.init();
    Functions.init();
    DuplicatePopup.init();

    this.bindTOC();
    this.bindSettings();
    this.bindScanBox();
    this.bindSearchFilter();
    this.bindRefresh();
    this.bindQuickScanBridge();

    this.refreshConfigBanner();

    if (Settings.isConfigured()) {
      ScanList.refresh();
      ScanList.startPolling();
      Realtime.start();
    } else {
      this.openSettings();
    }
  },

  // ---------- TOC nav (scroll spy) ----------
  bindTOC() {
    document.querySelectorAll('.toc-link[data-target]').forEach((link) => {
      link.addEventListener('click', () => {
        const target = document.getElementById(link.dataset.target);
        target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // ตั้ง active ทันทีเพื่อไม่ให้ค้างที่ปุ่มเดิม
        this.setActiveToc(link.dataset.target);
      });
    });

    // scrollspy แบบคำนวณเอง (แม่นกว่า IntersectionObserver ในพื้นที่แคบ)
    const sections = ['section-scan', 'section-list', 'section-functions'];
    const onScroll = () => {
      const threshold = 90; // ใต้ header
      let activeId = sections[0];
      for (const id of sections) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (el.getBoundingClientRect().top - threshold <= 0) {
          activeId = id;
        }
      }
      this.setActiveToc(activeId);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('scroll', onScroll, { passive: true, capture: true });
    onScroll();
  },

  setActiveToc(activeId) {
    document.querySelectorAll('.toc-link[data-target]').forEach((l) => {
      l.classList.toggle('active', l.dataset.target === activeId);
    });
  },

  // ---------- Settings modal ----------
  bindSettings() {
    document.getElementById('btnSettings').addEventListener('click', () => this.openSettings());
    document.getElementById('settingsModalClose').addEventListener('click', () => this.closeSettings());
    document.getElementById('settingsModal').addEventListener('click', (e) => {
      if (e.target.id === 'settingsModal') this.closeSettings();
    });
    document.getElementById('btnReloadTenants').addEventListener('click', () => this.loadTenants());
    document.getElementById('btnSaveSettings').addEventListener('click', () => this.saveSettings());
  },

  openSettings() {
    const s = Settings.get();
    document.getElementById('setTeamSlug').value = s.teamSlug || '';
    document.getElementById('settingsModal').classList.remove('hidden');
    if (s.teamSlug) this.loadTenants();
  },

  closeSettings() {
    document.getElementById('settingsModal').classList.add('hidden');
  },

  async loadTenants() {
    const teamSlug = document.getElementById('setTeamSlug').value.trim();
    const sel = document.getElementById('setTenant');
    if (!teamSlug) {
      this.setSettingsStatus('กรอก Team Slug ก่อน', 'error');
      return;
    }
    // เก็บ team slug ชั่วคราวเพื่อดึงรายชื่อร้าน
    await Settings.save({ teamSlug });
    sel.innerHTML = '<option value="">กำลังโหลด...</option>';
    try {
      const res = await Api.getTenants();
      const tenants = res?.data?.tenants || res?.data || res?.tenants || [];
      this._tenants = tenants;
      // จับ team_id (ทุก tenant อยู่ทีมเดียวกัน) สำหรับ realtime
      const teamId = tenants.find((t) => t.team_id)?.team_id || '';
      if (teamId) await Settings.save({ teamId });
      const current = Settings.get().tenantId;
      sel.innerHTML = '<option value="">— เลือกร้าน —</option>' +
        tenants.map((t) => `<option value="${ScanList.esc(t.id)}" data-admin="${ScanList.esc(t.admin_api_url || '')}" ${String(t.id) === String(current) ? 'selected' : ''}>${ScanList.esc(t.name || t.id)}</option>`).join('');
      this.setSettingsStatus(`พบ ${tenants.length} ร้าน`, 'success');
    } catch (e) {
      sel.innerHTML = '<option value="">โหลดไม่สำเร็จ</option>';
      this.setSettingsStatus('โหลดรายชื่อร้านไม่สำเร็จ: ' + (e.message || e), 'error');
    }
  },

  async saveSettings() {
    const teamSlug = document.getElementById('setTeamSlug').value.trim();
    const tenantSel = document.getElementById('setTenant');
    const tenantId = tenantSel.value;
    const opt = tenantSel.options[tenantSel.selectedIndex];
    const tenantName = opt?.text || '';
    const tenantAdminApiUrl = opt?.getAttribute('data-admin') || '';

    if (!teamSlug) {
      this.setSettingsStatus('กรุณากรอก Team Slug', 'error');
      return;
    }
    await Settings.save({ teamSlug, tenantId, tenantName, tenantAdminApiUrl });
    this.setSettingsStatus('บันทึกแล้ว', 'success');
    this.refreshConfigBanner();
    Functions._banksLoaded = false; // โหลดธนาคารใหม่เมื่อเปลี่ยนร้าน
    Functions.renderTenantBadges(this._tenants); // อัปเดต badge ร้านในหน้าสมาชิก
    if (Settings.isConfigured()) {
      ScanList.refresh();
      ScanList.startPolling();
      Realtime.stop();
      Realtime.start();
      setTimeout(() => this.closeSettings(), 600);
    }
  },

  setSettingsStatus(msg, kind) {
    const el = document.getElementById('settingsStatus');
    el.textContent = msg;
    el.className = 'func-status ' + (kind || '');
    el.classList.remove('hidden');
  },

  refreshConfigBanner() {
    document.getElementById('configBanner').classList.toggle('hidden', Settings.isConfigured());
  },

  // ---------- Scan box ----------
  bindScanBox() {
    const dz = document.getElementById('scanDropzone');

    // คลิกช่องสแกน = ไม่เปิดไฟล์ (แค่โฟกัสเพื่อให้วางภาพ Ctrl+V ได้)
    dz.addEventListener('click', () => dz.focus());

    ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => {
      e.preventDefault(); dz.classList.add('dragover');
    }));
    ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => {
      e.preventDefault(); dz.classList.remove('dragover');
    }));
    dz.addEventListener('drop', (e) => {
      const file = e.dataTransfer?.files?.[0];
      if (file) this.scanFile(file);
    });

    // วางจาก clipboard (Ctrl+V)
    document.addEventListener('paste', (e) => {
      const items = e.clipboardData?.items || [];
      for (const it of items) {
        if (it.type.startsWith('image/')) {
          const blob = it.getAsFile();
          if (blob) this.scanFile(blob);
          break;
        }
      }
    });
  },

  showScanPreview(imgDataUrl) {
    const idle = document.getElementById('scanIdle');
    const preview = document.getElementById('scanPreview');
    const img = document.getElementById('scanPreviewImg');
    if (imgDataUrl) img.src = imgDataUrl;
    idle.classList.add('hidden');
    preview.classList.remove('hidden');
  },
  hideScanPreview() {
    document.getElementById('scanPreview').classList.add('hidden');
    document.getElementById('scanIdle').classList.remove('hidden');
  },

  async scanFile(fileOrBlob, filename) {
    if (!Settings.isConfigured()) {
      this.setScanStatus('กรุณาตั้งค่าทีม/ร้านก่อน', 'error');
      this.openSettings();
      return;
    }
    this.setScanStatus('<span class="spinner"></span> กำลังสแกน...', 'info');
    // เตรียมรูปไว้สำหรับ popup ยอดซ้ำ + แสดงพรีวิวในช่องสแกน
    const imgDataUrl = await this.blobToDataUrl(fileOrBlob).catch(() => null);
    this.showScanPreview(imgDataUrl);
    const finishPreview = () => this.hideScanPreview();

    // ── กันสแกนซ้ำสลิปเดิม ──
    // provider (EASYSLIP) มักปฏิเสธการ verify สลิปเดิมซ้ำ (โดยเฉพาะเมื่อระบบสลับไปคีย์อื่น)
    // จึง cache ผลสแกนของรูปนี้ (ตาม hash) ไว้ ถ้าสแกนรูปเดิมอีก → แสดง record เดิมทันที
    const hash = await this.hashBlob(fileOrBlob).catch(() => null);
    if (hash) {
      const cached = await this.scanCacheGet(hash);
      if (cached && cached.transaction_id) {
        const fresh = (ScanList._all || []).find((t) => String(t.id) === String(cached.transaction_id));
        const dup = fresh ? this.itemToDup(fresh) : cached;
        finishPreview();
        this.setScanStatus('สลิปนี้สแกนไปแล้ว', 'error');
        DuplicatePopup.show(dup, imgDataUrl);
        await ScanList.refresh();
        return;
      }
    }

    try {
      const name = filename || fileOrBlob.name || 'slip.jpg';
      const res = await Api.uploadSlip(fileOrBlob, { filename: name, source: 'manual' });
      const data = res?.data || {};
      finishPreview();
      if (hash && data.transaction_id) await this.scanCacheSet(hash, this.dataToDup(data));
      if (data.status === 'duplicate') {
        this.setScanStatus('พบสลิปซ้ำ', 'error');
        DuplicatePopup.show(data, imgDataUrl);
      } else {
        const amount = data.slip?.amount != null
          ? Number(data.slip.amount).toLocaleString('th-TH') + ' บาท'
          : (data.amount ? Number(data.amount).toLocaleString('th-TH') + ' บาท' : '');
        const labels = { credited: 'เติมเครดิตสำเร็จ', matched: 'จับคู่แล้ว', pending: 'สแกนสำเร็จ (รอจับคู่)' };
        this.setScanStatus((labels[data.status] || 'สแกนสำเร็จ') + (amount ? ' ' + amount : ''), 'success');
      }
      await ScanList.refresh();
    } catch (e) {
      finishPreview();
      const dupData = e.responseData?.data;
      if (dupData?.status === 'duplicate') {
        if (hash && dupData.transaction_id) await this.scanCacheSet(hash, this.dataToDup(dupData));
        this.setScanStatus('พบสลิปซ้ำ', 'error');
        DuplicatePopup.show(dupData, imgDataUrl);
        await ScanList.refresh();
        return;
      }
      this.setScanStatus('สแกนไม่สำเร็จ: ' + this.translateScanError(e.message || String(e)), 'error');
    }
  },

  // ---------- Scan de-dup cache (ตาม hash ของรูป, per tenant) ----------
  async hashBlob(blob) {
    const buf = await blob.arrayBuffer();
    const h = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
  },
  _scanCacheKey(hash) {
    return `${Settings.get().tenantId}:${hash}`;
  },
  async scanCacheGet(hash) {
    try {
      const r = await chrome.storage.session.get('scanCache');
      return (r.scanCache || {})[this._scanCacheKey(hash)] || null;
    } catch { return null; }
  },
  async scanCacheSet(hash, entry) {
    try {
      const r = await chrome.storage.session.get('scanCache');
      const map = r.scanCache || {};
      map[this._scanCacheKey(hash)] = entry;
      await chrome.storage.session.set({ scanCache: map });
    } catch { /* ignore */ }
  },
  dataToDup(data) {
    return {
      transaction_id: data.transaction_id,
      tenant: data.tenant,
      sender: data.sender,
      slip: data.slip,
      current_status: data.status || data.current_status,
      matched_username: data.matched_username,
      matched_user_id: data.matched_user_id,
    };
  },
  itemToDup(item) {
    return {
      transaction_id: item.id,
      tenant: { id: item.tenant_id, name: item.tenant_name },
      sender: { name: item.sender_name },
      slip: { amount: item.amount },
      current_status: item.status,
      matched_username: item.matched_username,
      matched_user_id: item.matched_user_id,
    };
  },

  // แปลง error จาก provider ให้อ่านง่ายขึ้น
  translateScanError(msg) {
    const m = String(msg || '');
    if (/qrcode_not_found|not_found|slip not found|200404/i.test(m)) {
      return 'อ่าน QR ในสลิปไม่ได้ / ไม่พบสลิปนี้ (สลิปเดิมอาจเคยสแกนไปแล้ว หรือรูปไม่ชัด)';
    }
    if (/insufficient token|401005|quota|limit/i.test(m)) {
      return 'โควต้าคีย์สแกนของร้านนี้หมด — ตรวจสอบ/เติม token ของ provider';
    }
    if (/timeout/i.test(m)) return 'หมดเวลาสแกน ลองใหม่อีกครั้ง';
    // ตัดข้อความซ้ำ ๆ ที่ provider ส่งกลับมาให้สั้นลง
    return m.split('|')[0].trim() || m;
  },

  blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = (e) => resolve(e.target.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  },

  setScanStatus(html, kind) {
    const el = document.getElementById('scanStatus');
    el.innerHTML = html;
    el.className = 'scan-status ' + (kind || 'info');
    el.classList.remove('hidden');
  },

  // ---------- Search + filter ----------
  bindSearchFilter() {
    const searchInput = document.getElementById('searchInput');
    let t = null;
    searchInput.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => ScanList.applySearchAndRender(), 200);
    });

    document.getElementById('btnFilter').addEventListener('click', () => {
      document.getElementById('filterPanel').classList.toggle('hidden');
      document.getElementById('btnFilter').classList.toggle('active');
    });
    document.getElementById('btnApplyFilter').addEventListener('click', () => ScanList.refresh());
    document.getElementById('btnClearFilter').addEventListener('click', () => {
      document.getElementById('filterStatus').value = '';
      document.getElementById('filterDateFrom').value = '';
      document.getElementById('filterDateTo').value = '';
      ScanList.refresh();
    });
  },

  getSearchQuery() {
    return document.getElementById('searchInput').value;
  },

  getFilters() {
    return {
      status: document.getElementById('filterStatus').value,
      dateFrom: document.getElementById('filterDateFrom').value,
      dateTo: document.getElementById('filterDateTo').value,
    };
  },

  bindRefresh() {
    document.getElementById('btnRefresh').addEventListener('click', () => ScanList.refresh());
  },

  // ---------- Quick scan bridge (chat.line.biz) ----------
  bindQuickScanBridge() {
    // รับผ่าน storage.session (background เก็บ pendingQuickScan พร้อม ts)
    const tryHandle = (payload) => {
      if (!payload || !payload.dataUrl) return;
      if (payload.ts && payload.ts === this._lastQuickTs) return; // กันซ้ำ
      this._lastQuickTs = payload.ts || Date.now();
      chrome.storage.session.remove('pendingQuickScan').catch(() => {});
      this.handleQuickScan(payload);
    };

    chrome.storage.session.get('pendingQuickScan')
      .then((r) => { if (r.pendingQuickScan) tryHandle(r.pendingQuickScan); })
      .catch(() => {});

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'session' && changes.pendingQuickScan?.newValue) {
        tryHandle(changes.pendingQuickScan.newValue);
      }
    });

    // เผื่อ background ส่ง message ตรง (backward-compat)
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === 'ATSLIP_QUICK_SCAN_FORWARD') tryHandle(msg.payload);
    });
  },

  async handleQuickScan(payload) {
    if (!payload || !payload.dataUrl) return;
    try {
      document.getElementById('section-scan')?.scrollIntoView({ behavior: 'smooth' });
      const blob = await (await fetch(payload.dataUrl)).blob();
      await this.scanFile(blob, payload.filename || 'line-slip.jpg');
    } catch (e) {
      this.setScanStatus('Quick scan ล้มเหลว: ' + (e.message || e), 'error');
    }
  },

  // ---------- Toast ----------
  toast(msg, kind) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast ' + (kind || '');
    el.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
  },

  // ---------- Custom confirm (browser confirm() ใช้ไม่ได้ใน side panel) ----------
  confirm(message, { okText = 'ยืนยัน', cancelText = 'ยกเลิก', danger = false } = {}) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay confirm-overlay';
      overlay.innerHTML = `
        <div class="modal confirm-modal" role="dialog" aria-modal="true">
          <div class="modal-body">
            <p class="confirm-msg">${ScanList.esc(message)}</p>
          </div>
          <div class="modal-foot confirm-foot">
            <button class="btn-secondary" data-act="cancel">${ScanList.esc(cancelText)}</button>
            <button class="${danger ? 'pending-credit-btn pending-credit-btn-withdraw' : 'btn-primary'}" data-act="ok">${ScanList.esc(okText)}</button>
          </div>
        </div>`;
      const cleanup = (val) => { overlay.remove(); resolve(val); };
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) return cleanup(false);
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'ok') cleanup(true);
        else if (act === 'cancel') cleanup(false);
      });
      document.body.appendChild(overlay);
    });
  },
};

window.App = App;
document.addEventListener('DOMContentLoaded', () => App.init());
