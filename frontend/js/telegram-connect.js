// ============================================================
// Telegram Connection Module (Phase B — v1.2)
// ============================================================
// กด "บันทึก & เชื่อมต่อ" → save connection → register webhook กับ Telegram
// (เรียก PUT แล้วตาม POST .../register-webhook ซึ่ง auto-enable ด้วย)
// ============================================================

(function () {
  // ============================================================
  // Kebab Menu (3-dot)
  // ============================================================
  window.toggleKebabMenu = function () {
    const dd = document.getElementById('kebabMenuDropdown');
    if (!dd) return;
    const open = dd.style.display !== 'none';
    dd.style.display = open ? 'none' : 'flex';
    if (!open && window.lucide) setTimeout(() => window.lucide.createIcons(), 10);
  };

  window.kebabOpenReply = function () {
    _closeKebab();
    if (typeof window.goToReplyMessagePage === 'function') {
      window.goToReplyMessagePage();
    }
  };

  window.kebabOpenNotifications = function () {
    _closeKebab();
    if (typeof window.toggleNotificationDropdown === 'function') {
      window.toggleNotificationDropdown();
    } else {
      const dd = document.getElementById('notificationDropdown');
      if (dd) dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
    }
  };

  window.kebabOpenTelegram = function () {
    _closeKebab();
    openTelegramConnModal();
  };

  window.kebabOpenAntidup = function () {
    _closeKebab();
    window.openAntidupModal();
  };

  window.kebabOpenTeamSettings = function () {
    // legacy alias
    window.kebabOpenApiKeys();
  };
  window.kebabOpenApiKeys = function () {
    _closeKebab();
    window.openApiKeysModal();
  };

  // SMS-Hook sub-project — เปิดหน้า /{teamslug} (ลบ function นี้ + เมนูใน index.html เพื่อถอดออก)
  window.kebabOpenSmsHook = function () {
    _closeKebab();
    const slug = window.currentTeamSlug || (typeof window.getTeamFromURL === 'function' ? window.getTeamFromURL() : '');
    if (!slug) { alert('ยังไม่ได้เลือกทีม'); return; }
    window.open('/' + encodeURIComponent(slug), '_blank');
  };

  function _closeKebab() {
    const dd = document.getElementById('kebabMenuDropdown');
    if (dd) dd.style.display = 'none';
  }

  document.addEventListener('click', (e) => {
    const btn = document.getElementById('kebabMenuBtn');
    const dd = document.getElementById('kebabMenuDropdown');
    if (!btn || !dd || dd.style.display === 'none') return;
    if (btn.contains(e.target) || dd.contains(e.target)) return;
    dd.style.display = 'none';
  });

  // ============================================================
  // Anti-Duplicate Settings Modal
  // ============================================================

  window.openAntidupModal = async function () {
    const modal = document.getElementById('antidupModal');
    if (!modal) return;
    if (!window.currentTeamId) {
      alert('ยังไม่ได้เลือกทีม');
      return;
    }
    modal.style.display = 'flex';
    if (window.lucide) setTimeout(() => window.lucide.createIcons(), 10);
    await _loadAntidupAccounts();
  };

  window.closeAntidupModal = function () {
    const modal = document.getElementById('antidupModal');
    if (modal) modal.style.display = 'none';
  };

  // state for cross-dup popup
  let _pendingCrossAccId = null;
  let _pendingCrossCheckbox = null;

  async function _loadAntidupAccounts() {
    const container = document.getElementById('antidupAccountList');
    if (!container) return;
    container.innerHTML = '<div class="loading" style="margin:auto;"></div>';

    try {
      // ดึง settings ทั้ง 2 switch พร้อมกัน
      const [settingsResp, crossResp] = await Promise.all([
        window.api.getAntidupSettings(),
        window.api.getAntidupCrossSettings(),
      ]);
      const enabledAccounts = new Set(settingsResp.enabled_accounts || []);
      const crossSettings = crossResp.cross_settings || {};

      // ดึงรายชื่อเว็บ
      const tenantsResp = await window.api.request(`/api/tenants?team_slug=${window.currentTeamSlug || ''}`);
      const tenants = tenantsResp.data || tenantsResp.tenants || tenantsResp || [];

      if (!Array.isArray(tenants) || !tenants.length) {
        container.innerHTML = '<p class="text-muted">ยังไม่มีเว็บ</p>';
        return;
      }

      let html = '';
      for (const tenant of tenants) {
        let accounts = [];
        try {
          const [kvResp, metaResp] = await Promise.allSettled([
            window.api.request(`/api/tenants/${tenant.id}/accounts`),
            window.api.request(`/api/tenants/${tenant.id}/bank-accounts/metadata`),
          ]);

          const kvList = kvResp.status === 'fulfilled'
            ? (kvResp.value?.data?.accounts || kvResp.value?.accounts || [])
            : [];

          if (Array.isArray(kvList) && kvList.length > 0) {
            accounts = kvList.map(a => ({
              id: String(a.id ?? a.accountId ?? a.account_id),
              accountNumber: a.accountNumber || a.account_number || '',
              accountName: a.accountName || a.account_name || a.bankName || a.bank_name || '',
              bankName: a.bankName || a.bank_name || '',
              bankIconUrl: a.bankIconUrl || '',
            }));
          } else {
            const metaList = metaResp.status === 'fulfilled'
              ? (metaResp.value?.data?.accounts || [])
              : [];
            accounts = (Array.isArray(metaList) ? metaList : []).map(a => ({
              id: String(a.account_id ?? a.id),
              accountNumber: a.account_number || '',
              accountName: a.account_name_th || a.account_name_en || a.bank_name || '',
              bankName: a.bank_name || '',
              bankIconUrl: '',
            }));
          }
        } catch { /* no session */ }

        html += `<div style="margin-bottom:18px;">
          <div style="font-size:0.78rem;color:var(--text-muted,#888);font-weight:600;letter-spacing:.04em;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid var(--border,#e5e7eb);">${_esc(tenant.name)}</div>`;

        if (!accounts.length) {
          html += `<p style="font-size:0.82rem;color:var(--text-muted,#888);margin:4px 0 0;">ไม่พบบัญชี (กรุณา Sync บัญชีก่อน)</p>`;
        } else {
          for (const acc of accounts) {
            const sw1 = enabledAccounts.has(acc.id) ? 'checked' : '';
            const crossCfg = crossSettings[acc.id] || {};
            const sw2 = crossCfg.enabled ? 'checked' : '';
            const iconHtml = acc.bankIconUrl
              ? `<img src="${_esc(acc.bankIconUrl)}" alt="${_esc(acc.bankName)}" style="width:30px;height:30px;border-radius:6px;flex-shrink:0;margin-right:8px;" onerror="this.style.display='none'">`
              : '';
            html += `<div style="padding:8px 0;border-bottom:1px solid var(--border-light,#f3f4f6);">
              <div style="display:flex;align-items:center;margin-bottom:8px;">
                ${iconHtml}
                <div style="font-size:0.88rem;flex:1;min-width:0;">
                  <div style="font-weight:500;">${_esc(acc.accountName)}</div>
                  ${acc.accountNumber ? `<div style="color:var(--text-muted,#888);font-size:0.8rem;">${_esc(acc.accountNumber)}</div>` : ''}
                </div>
              </div>
              <div style="display:flex;flex-direction:column;gap:4px;padding-left:38px;">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                  <span style="font-size:0.82rem;font-weight:500;color:var(--text,#1f2937);">เช็คซ้ำภายในยูสเซอร์</span>
                  <label class="toggle-switch" style="flex-shrink:0;">
                    <input type="checkbox" ${sw1} onchange="window._antidupToggle('${_esc(acc.id)}', this.checked)">
                    <span class="toggle-slider"></span>
                  </label>
                </div>
                <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                  <span style="font-size:0.82rem;font-weight:500;color:var(--text,#1f2937);">เช็คซ้ำกับรายการอื่น</span>
                  <label class="toggle-switch" style="flex-shrink:0;">
                    <input type="checkbox" ${sw2} onchange="window._antidupCrossToggle('${_esc(acc.id)}', this.checked, this)">
                    <span class="toggle-slider"></span>
                  </label>
                </div>
              </div>
            </div>`;
          }
        }
        html += `</div>`;
      }
      container.innerHTML = html;
    } catch (err) {
      container.innerHTML = `<p style="color:red;">โหลดไม่สำเร็จ: ${err.message}</p>`;
    }
  }

  window._antidupToggle = async function (accountId, enabled) {
    try {
      await window.api.setAntidupSetting(accountId, enabled);
    } catch (err) {
      alert('บันทึกไม่สำเร็จ: ' + err.message);
    }
  };

  window._antidupCrossToggle = function (accountId, enabled, checkboxEl) {
    if (!enabled) {
      // ปิด → บันทึกทันที
      window.api.setAntidupCrossSetting(accountId, false, 60).catch(function (err) {
        alert('บันทึกไม่สำเร็จ: ' + err.message);
        checkboxEl.checked = true; // revert
      });
    } else {
      // เปิด → แสดง popup ให้กำหนด window
      _pendingCrossAccId = accountId;
      _pendingCrossCheckbox = checkboxEl;
      _showCrossDupWindowPopup();
    }
  };

  function _showCrossDupWindowPopup() {
    // ลบ popup เก่า (ถ้ามี)
    const old = document.getElementById('crossDupWindowModal');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = 'crossDupWindowModal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
      <div style="background:var(--surface,#fff);border-radius:12px;padding:24px;width:320px;max-width:90vw;box-shadow:0 8px 32px rgba(0,0,0,0.18);">
        <h3 style="margin:0 0 8px;font-size:1rem;font-weight:600;">ตั้งค่าช่วงเวลาเช็คซ้ำ</h3>
        <p style="font-size:0.83rem;color:var(--text-muted,#888);margin:0 0 16px;line-height:1.5;">
          ระบบจะตรวจว่ามีสมาชิกอื่นฝากยอดเดียวกันภายในช่วงเวลานี้<br>
          (หน่วย: วินาที — ค่าแนะนำ: 60 วินาที)
        </p>
        <label style="font-size:0.85rem;font-weight:500;display:block;margin-bottom:6px;">ช่วงเวลา (วินาที)</label>
        <input id="crossDupWindowInput" type="number" min="1" max="3600" value="60"
          style="width:100%;padding:8px 10px;border:1px solid var(--border,#d1d5db);border-radius:8px;font-size:0.95rem;box-sizing:border-box;outline:none;">
        <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end;">
          <button onclick="window._cancelCrossDupModal()" style="padding:8px 16px;border:1px solid var(--border,#d1d5db);background:transparent;border-radius:8px;cursor:pointer;font-size:0.88rem;">ยกเลิก</button>
          <button onclick="window._confirmCrossDupModal()" style="padding:8px 16px;background:var(--primary,#3b82f6);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:0.88rem;font-weight:600;">ยืนยัน</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    setTimeout(() => document.getElementById('crossDupWindowInput')?.focus(), 50);
  }

  window._confirmCrossDupModal = async function () {
    const input = document.getElementById('crossDupWindowInput');
    const seconds = Math.max(1, parseInt(input?.value || '60', 10) || 60);
    const accountId = _pendingCrossAccId;
    const cb = _pendingCrossCheckbox;
    _pendingCrossAccId = null;
    _pendingCrossCheckbox = null;
    const overlay = document.getElementById('crossDupWindowModal');
    if (overlay) overlay.remove();
    try {
      await window.api.setAntidupCrossSetting(accountId, true, seconds);
    } catch (err) {
      alert('บันทึกไม่สำเร็จ: ' + err.message);
      if (cb) cb.checked = false;
    }
  };

  window._cancelCrossDupModal = function () {
    if (_pendingCrossCheckbox) _pendingCrossCheckbox.checked = false;
    _pendingCrossAccId = null;
    _pendingCrossCheckbox = null;
    const overlay = document.getElementById('crossDupWindowModal');
    if (overlay) overlay.remove();
  };

  function _esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ============================================================
  // Telegram Connection Modal
  // ============================================================
  let _currentConnection = null;

  window.openTelegramConnModal = async function () {
    const modal = document.getElementById('telegramConnModal');
    if (!modal) return;

    if (!window.currentTeamId) {
      alert('ยังไม่ได้เลือกทีม — กรุณาเข้าผ่าน URL ที่มี team slug');
      return;
    }

    modal.style.display = 'flex';
    if (window.lucide) setTimeout(() => window.lucide.createIcons(), 10);

    _resetTgForm();
    _setTgStatus('loading', 'กำลังโหลด...');

    try {
      const resp = await window.api.request(`/api/teams/${window.currentTeamId}/telegram-connection`);
      const data = resp && (resp.data || resp);
      if (data && data.id) {
        _currentConnection = data;
        _applyConnectionToForm(data);
      } else {
        _currentConnection = null;
        _setTgStatus('disconnected', '🔌 ยังไม่ได้เชื่อมต่อ — กรอก Group ID และ Bot Token แล้วกด "บันทึก & เชื่อมต่อ"');
        document.getElementById('tgDisconnectBtn').style.display = 'none';
        document.getElementById('tgEnableToggleBtn').style.display = 'none';
      }
    } catch (err) {
      _setTgStatus('disconnected', 'โหลดไม่สำเร็จ: ' + (err.message || err));
    }
  };

  window.closeTelegramConnModal = function () {
    const modal = document.getElementById('telegramConnModal');
    if (modal) modal.style.display = 'none';
  };

  function _resetTgForm() {
    document.getElementById('tgGroupId').value = '';
    document.getElementById('tgBotToken').value = '';
    document.getElementById('tgBotToken').type = 'password';
    document.getElementById('tgBotToken').dataset.masked = '';
    document.getElementById('tgTokenToggleLabel').textContent = 'แสดง token';
    document.getElementById('tgWebhookHint').style.display = 'none';
  }

  function _applyConnectionToForm(conn) {
    document.getElementById('tgGroupId').value = conn.telegram_group_id || '';
    // แสดง token แบบ masked
    const masked = conn.telegram_bot_token_masked || conn.bot_token_masked || '';
    document.getElementById('tgBotToken').value = masked;
    document.getElementById('tgBotToken').type = 'text';
    document.getElementById('tgBotToken').dataset.masked = '1';
    document.getElementById('tgTokenToggleLabel').textContent = 'แก้ไข token';

    // webhook URL
    const webhookUrl = `https://app.atslip.biz/api/telegram-webhook/${conn.telegram_group_id}`;
    document.getElementById('tgWebhookUrl').textContent = webhookUrl;
    document.getElementById('tgWebhookHint').style.display = 'block';

    document.getElementById('tgDisconnectBtn').style.display = 'inline-flex';
    const toggleBtn = document.getElementById('tgEnableToggleBtn');
    toggleBtn.style.display = 'inline-flex';

    if (conn.telegram_enabled) {
      _setTgStatus('connected', '🟢 เชื่อมต่อและรับสลิปอยู่ (group: ' + conn.telegram_group_id + ')');
      toggleBtn.textContent = 'ปิดใช้งาน';
      toggleBtn.className = 'btn btn-secondary';
    } else {
      _setTgStatus('disabled', '🟡 เชื่อมต่อแล้วแต่ยังไม่ได้เปิดใช้งาน');
      toggleBtn.textContent = 'เปิดใช้งาน';
      toggleBtn.className = 'btn btn-primary';
    }
  }

  function _setTgStatus(kind, text) {
    const el = document.getElementById('tgConnStatus');
    if (!el) return;
    el.textContent = text;
    el.className = 'tg-status tg-status-' + kind;
  }

  function _setSaveBtn(disabled, text) {
    const btn = document.getElementById('tgSaveBtn');
    if (!btn) return;
    btn.disabled = !!disabled;
    btn.innerHTML = disabled
      ? `<span class="loading" style="width:14px;height:14px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:6px;"></span>${text}`
      : `<i data-lucide="save"></i> ${text}`;
    if (window.lucide) setTimeout(() => window.lucide.createIcons(), 10);
  }

  window.toggleTgTokenVisibility = function () {
    const inp = document.getElementById('tgBotToken');
    const lbl = document.getElementById('tgTokenToggleLabel');
    // ถ้า masked อยู่และกด "แก้ไข token" → ล้างค่าเพื่อให้กรอกใหม่
    if (inp.dataset.masked === '1') {
      inp.value = '';
      inp.type = 'text';
      inp.dataset.masked = '';
      lbl.textContent = 'ซ่อน token';
      inp.focus();
    } else if (inp.type === 'password') {
      inp.type = 'text';
      lbl.textContent = 'ซ่อน token';
    } else {
      inp.type = 'password';
      lbl.textContent = 'แสดง token';
    }
  };

  window.copyTgWebhookUrl = function () {
    const url = document.getElementById('tgWebhookUrl').textContent;
    if (!url) return;
    navigator.clipboard.writeText(url).then(
      () => { if (typeof window.showToast === 'function') window.showToast('คัดลอกแล้ว', 'success'); },
      () => alert('คัดลอกไม่สำเร็จ'),
    );
  };

  // ============================================================
  // Save → Register Webhook (auto-enable inside backend)
  // ============================================================
  window.saveTelegramConn = async function () {
    const groupId = document.getElementById('tgGroupId').value.trim();
    const tokenEl = document.getElementById('tgBotToken');
    const isMasked = tokenEl.dataset.masked === '1';
    const token = tokenEl.value.trim();

    if (!groupId || !/^-?\d+$/.test(groupId)) {
      alert('Group ID ต้องเป็นตัวเลข (เช่น -1003483890050)');
      return;
    }

    // ถ้า token ยังเป็น masked = ไม่มีการเปลี่ยนแปลง token
    // ถ้าเป็น connection ใหม่หรือแก้ token → ต้องกรอก
    if (!isMasked) {
      if (!token) {
        alert('กรุณากรอก Bot Token');
        return;
      }
      if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) {
        alert('Bot Token รูปแบบไม่ถูกต้อง\nตัวอย่าง: 8287141565:AAFs45cBsxh1snbb4ewNCOs24K8XGyDhqaM');
        return;
      }
    } else if (!_currentConnection) {
      alert('กรุณากรอก Bot Token');
      return;
    }

    // ---------- Step 1: save connection ----------
    _setSaveBtn(true, 'กำลังบันทึก...');
    _setTgStatus('loading', 'กำลังบันทึกข้อมูล...');

    const body = { telegram_group_id: groupId };
    if (!isMasked) body.telegram_bot_token = token;

    let saveOk = false;
    try {
      await window.api.request(
        `/api/teams/${window.currentTeamId}/telegram-connection`,
        { method: 'PUT', body: JSON.stringify(body) },
      );
      saveOk = true;
    } catch (err) {
      _setSaveBtn(false, 'บันทึก & เชื่อมต่อ');
      _setTgStatus('disconnected', '❌ บันทึกไม่สำเร็จ: ' + (err.message || err));
      alert('บันทึกไม่สำเร็จ: ' + (err.message || err));
      return;
    }

    // ---------- Step 2: register webhook + auto-enable ----------
    _setSaveBtn(true, 'กำลังลงทะเบียน Webhook...');
    _setTgStatus('loading', 'กำลังลงทะเบียน Webhook กับ Telegram...');

    try {
      const regResp = await window.api.request(
        `/api/teams/${window.currentTeamId}/telegram-connection/register-webhook`,
        { method: 'POST' },
      );
      const webhookUrl = regResp?.data?.webhook_url || `https://app.atslip.biz/api/telegram-webhook/${groupId}`;
      document.getElementById('tgWebhookUrl').textContent = webhookUrl;
      document.getElementById('tgWebhookHint').style.display = 'block';

      _setSaveBtn(false, 'บันทึก & เชื่อมต่อ');
      if (typeof window.showToast === 'function') window.showToast('เชื่อมต่อ Telegram สำเร็จ 🎉', 'success');

      // refresh modal state
      await window.openTelegramConnModal();
    } catch (err) {
      _setSaveBtn(false, 'บันทึก & เชื่อมต่อ');
      _setTgStatus('disabled', '⚠️ บันทึกแล้ว แต่ลงทะเบียน Webhook ไม่สำเร็จ: ' + (err.message || err));
      // แสดง URL ให้ copy ไป register เอง
      const fallbackUrl = `https://app.atslip.biz/api/telegram-webhook/${groupId}`;
      document.getElementById('tgWebhookUrl').textContent = fallbackUrl;
      document.getElementById('tgWebhookHint').style.display = 'block';
      document.getElementById('tgDisconnectBtn').style.display = 'inline-flex';
      alert(
        'บันทึก connection แล้ว แต่ลงทะเบียน Webhook ไม่สำเร็จ\n\n' +
        'สาเหตุที่พบบ่อย:\n' +
        '1. Bot ยังไม่ได้ถูกเพิ่มเข้า Group\n' +
        '2. Bot Token ไม่ถูกต้อง\n\n' +
        'ข้อผิดพลาด: ' + (err.message || err),
      );
    }
  };

  // ============================================================
  // Disconnect
  // ============================================================
  window.disconnectTelegram = async function () {
    if (!confirm('ยืนยันลบการเชื่อมต่อ Telegram?')) return;
    _setTgStatus('loading', 'กำลังลบ...');
    try {
      await window.api.request(
        `/api/teams/${window.currentTeamId}/telegram-connection`,
        { method: 'DELETE' },
      );
      _currentConnection = null;
      if (typeof window.showToast === 'function') window.showToast('ลบการเชื่อมต่อแล้ว', 'success');
      _resetTgForm();
      _setTgStatus('disconnected', '🔌 ยังไม่ได้เชื่อมต่อ');
      document.getElementById('tgDisconnectBtn').style.display = 'none';
      document.getElementById('tgEnableToggleBtn').style.display = 'none';
    } catch (err) {
      alert('ลบไม่สำเร็จ: ' + (err.message || err));
      await window.openTelegramConnModal();
    }
  };

  // ============================================================
  // Enable / Disable toggle
  // ============================================================
  window.toggleTelegramEnabled = async function () {
    if (!_currentConnection) return;
    const enabling = !_currentConnection.telegram_enabled;
    const path = enabling ? 'enable' : 'disable';
    _setTgStatus('loading', (enabling ? 'กำลังเปิด' : 'กำลังปิด') + 'ใช้งาน...');
    try {
      await window.api.request(
        `/api/teams/${window.currentTeamId}/telegram-connection/${path}`,
        { method: 'POST' },
      );
      if (typeof window.showToast === 'function') {
        window.showToast(enabling ? 'เปิดใช้งานแล้ว' : 'ปิดใช้งานแล้ว', 'success');
      }
      await window.openTelegramConnModal();
    } catch (err) {
      alert('เปลี่ยนสถานะไม่สำเร็จ: ' + (err.message || err));
    }
  };

  // ============================================================
  // Team API Keys Modal (multi-provider EasySlip / Slip2Go)
  // ============================================================

  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function _maskKey(k) {
    if (!k) return '';
    if (k.length <= 8) return '***';
    return k.substring(0, 4) + '…' + k.substring(k.length - 4);
  }

  async function _renderApiKeysList() {
    const slug = window.currentTeamSlug || window.getTeamFromURL();
    const list = document.getElementById('apiKeysList');
    if (!list || !slug) return;

    list.innerHTML = '<div style="padding:16px;text-align:center;color:#888;">กำลังโหลด...</div>';
    try {
      const res = await window.api.listTeamApiKeys(slug);
      const keys = (res?.data?.keys) || res?.keys || [];

      if (keys.length === 0) {
        list.innerHTML = '<div style="padding:16px;text-align:center;color:#888;border:1px dashed #ddd;border-radius:6px;">ยังไม่มี API Key — เพิ่มได้จากฟอร์มด้านล่าง</div>';
        return;
      }

      const rows = keys.map((k, idx) => {
        const isPrimary = idx === 0;
        const badgeClass = k.service === 'slip2go' ? 'provider-badge-slip2go' : k.service === 'slipok' ? 'provider-badge-slipok' : k.service === 'slipverify' ? 'provider-badge-slipverify' : 'provider-badge-easyslip';
        const svcDisplayName = { easyslip: 'EasySlip', slip2go: 'Slip2Go', slipok: 'SlipOK', slipverify: 'RDCW' }[k.service] || k.service;
        const labelPart = k.label
          ? `<span class="api-key-label">${_esc(k.label)}</span>` : '';
        return `
          <div class="api-key-row" data-id="${_esc(k.id)}">
            <div class="api-key-row-main">
              ${isPrimary ? '<span class="api-key-primary-badge" title="Key หลัก">PRIMARY</span>' : ''}
              <span class="provider-badge ${badgeClass}">${svcDisplayName}</span>
              ${labelPart}
              <span class="api-key-token" title="คลิกเพื่อแสดง/ซ่อน Token" onclick="toggleApiKeyTokenView('${_esc(k.id)}')">
                <code data-full="${_esc(k.api_key)}" data-masked="${_esc(_maskKey(k.api_key))}" data-shown="0">${_esc(_maskKey(k.api_key))}</code>
              </span>
            </div>
            <div class="api-key-row-actions">
              <button class="btn-icon" title="เลื่อนขึ้น" onclick="moveApiKey('${_esc(k.id)}','up')" ${idx === 0 ? 'disabled' : ''}>
                <i data-lucide="chevron-up"></i>
              </button>
              <button class="btn-icon" title="เลื่อนลง" onclick="moveApiKey('${_esc(k.id)}','down')" ${idx === keys.length - 1 ? 'disabled' : ''}>
                <i data-lucide="chevron-down"></i>
              </button>
              <button class="btn-icon" title="ลบ" onclick="deleteApiKey('${_esc(k.id)}')">
                <i data-lucide="trash-2"></i>
              </button>
            </div>
          </div>
        `;
      }).join('');
      list.innerHTML = rows;
      if (window.lucide) window.lucide.createIcons();
    } catch (e) {
      list.innerHTML = `<div style="padding:16px;color:#c00;">โหลดไม่สำเร็จ: ${_esc(e.message || e)}</div>`;
    }

    // อัพเดท upload zone visibility ตาม keys ที่มีอยู่
    const _slug = window.currentTeamSlug || window.getTeamFromURL();
    if (_slug && typeof window.updateProviderZoneVisibility === 'function') {
      window.updateProviderZoneVisibility(_slug);
    }
  }

  window.openApiKeysModal = async function () {
    const modal = document.getElementById('apiKeysModal');
    if (!modal) return;
    const slug = window.currentTeamSlug || window.getTeamFromURL();
    if (!slug) { alert('ยังไม่ได้เลือกทีม'); return; }

    // reset form
    const sv = document.getElementById('newKeyService');
    const tk = document.getElementById('newKeyToken');
    const lb = document.getElementById('newKeyLabel');
    if (sv) sv.value = 'easyslip';
    if (tk) tk.value = '';
    if (lb) lb.value = '';

    modal.style.display = 'flex';
    if (window.lucide) setTimeout(() => window.lucide.createIcons(), 10);

    await _renderApiKeysList();
  };

  window.closeApiKeysModal = function () {
    const modal = document.getElementById('apiKeysModal');
    if (modal) modal.style.display = 'none';
  };

  window.onNewKeyServiceChange = function () {
    const svc = (document.getElementById('newKeyService') || {}).value || '';
    const hint = document.getElementById('newKeyTokenHint');
    const input = document.getElementById('newKeyToken');
    if (!hint) return;
    if (svc === 'slipverify') {
      hint.style.display = '';
      hint.innerHTML = 'RDCW: ใส่รูปแบบ <code>clientId|clientSecret</code> เช่น <code>abc123|xyz789</code>';
      if (input) input.placeholder = 'clientId|clientSecret';
    } else if (svc === 'slipok') {
      hint.style.display = '';
      hint.innerHTML = 'SlipOK: ใส่รูปแบบ <code>url|apiKey</code> เช่น <code>https://api.slipok.com/api/line/apikey/68281|SLIPOK12VCAG3</code>';
      if (input) input.placeholder = 'https://api.slipok.com/api/line/apikey/XXXXX|SLIPOKXXXXX';
    } else {
      hint.style.display = 'none';
      if (input) input.placeholder = 'วาง API Key ที่นี่';
    }
  };

  window.toggleApiKeyTokenView = function (id) {
    const row = document.querySelector(`.api-key-row[data-id="${id}"] .api-key-token code`);
    if (!row) return;
    const shown = row.dataset.shown === '1';
    if (shown) {
      row.textContent = row.dataset.masked;
      row.dataset.shown = '0';
    } else {
      row.textContent = row.dataset.full;
      row.dataset.shown = '1';
    }
  };

  window.addApiKey = async function () {
    const slug = window.currentTeamSlug || window.getTeamFromURL();
    if (!slug) return;
    const service = (document.getElementById('newKeyService') || {}).value;
    const apiKey = ((document.getElementById('newKeyToken') || {}).value || '').trim();
    const label = ((document.getElementById('newKeyLabel') || {}).value || '').trim() || null;

    if (!apiKey) { alert('กรุณาใส่ API Key'); return; }

    const btn = document.getElementById('addApiKeyBtn');
    if (btn) btn.disabled = true;
    try {
      await window.api.createTeamApiKey(slug, {
        service, api_key: apiKey, label,
        branch_id: null,
      });
      // clear form
      document.getElementById('newKeyToken').value = '';
      document.getElementById('newKeyLabel').value = '';
      await _renderApiKeysList();
      if (window.addNotification) addNotification('✅ เพิ่ม API Key สำเร็จ');
    } catch (e) {
      alert('เพิ่มไม่สำเร็จ: ' + (e.message || e));
    } finally {
      if (btn) btn.disabled = false;
    }
  };

  window.deleteApiKey = async function (id) {
    const slug = window.currentTeamSlug || window.getTeamFromURL();
    if (!slug) return;
    if (!confirm('ลบ API Key นี้ออกไหม?')) return;
    try {
      await window.api.deleteTeamApiKey(slug, id);
      await _renderApiKeysList();
    } catch (e) {
      alert('ลบไม่สำเร็จ: ' + (e.message || e));
    }
  };

  window.moveApiKey = async function (id, direction) {
    const slug = window.currentTeamSlug || window.getTeamFromURL();
    if (!slug) return;
    try {
      await window.api.moveTeamApiKey(slug, id, direction);
      await _renderApiKeysList();
    } catch (e) {
      alert('สลับตำแหน่งไม่สำเร็จ: ' + (e.message || e));
    }
  };

  // Legacy aliases (กัน code เก่าเรียก)
  window.openTeamSettingsModal = window.openApiKeysModal;
  window.closeTeamSettingsModal = window.closeApiKeysModal;
  window.saveTeamSettings = function () { /* deprecated */ };
})();
