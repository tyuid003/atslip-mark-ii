// ============================================================
// ATslip Side Panel — ฟังก์ชันเสริม
// สมัครสมาชิก / เปลี่ยนรหัสผ่านลูกค้า (แยกตาม tenant)
//
// endpoint อ้างอิงจาก AI_PLAN_APIDOC.md (ตัวอย่างเว็บ lalaplay / hengdragon):
//   สมัคร  → เว็บสาธารณะ {site}/api/proxy/users/*   (ไม่ต้องใช้ bearer)
//   เปลี่ยนรหัสผ่าน → admin api {adminApiUrl}/api/users/update/{id} (ใช้ admin bearer)
//   ค้นหาลูกค้า → ผ่าน backend ATslip (/api/users/search) ที่ inject bearer ให้เอง
//
// site / adminApiUrl มาจาก tenant ที่เลือก (admin_api_url ใน ATslip DB)
//   publicSite = admin_api_url ที่ตัด "api." ออก
// affiliate ref: ไม่ใช้เมื่อสมัครผ่านส่วนขยายนี้ (refBy = "")
// ============================================================
const Functions = {
  _banksLoaded: false,
  _cpResults: [],
  _cpUser: null, // ลูกค้าที่เลือกไว้สำหรับเปลี่ยนรหัสผ่าน
  _tenants: [],

  init() {
    document.querySelectorAll('.func-header[data-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const body = document.getElementById(btn.dataset.toggle);
        const opening = body && !body.classList.contains('open');
        body?.classList.toggle('open');
        if (opening && btn.dataset.toggle === 'funcRegister') this.loadBanks();
      });
    });

    document.getElementById('btnDoRegister').addEventListener('click', () => this.register());
    document.getElementById('btnCpSearch').addEventListener('click', () => this.searchCustomer());
    document.getElementById('cpSearch').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.searchCustomer(); }
    });
    document.getElementById('cpResults').addEventListener('click', (e) => {
      const el = e.target.closest('.cp-result-item');
      if (el) this.selectCustomer(Number(el.dataset.index));
    });
    document.getElementById('btnDoChangePw').addEventListener('click', () => this.changePassword());

    // badge เลือกร้านสำหรับสมาชิก
    document.getElementById('memberTenantBadges').addEventListener('click', (e) => {
      const b = e.target.closest('.tenant-badge');
      if (b) this.selectMemberTenant(b.dataset.id, b.dataset.admin, b.textContent, b.dataset.version);
    });
    this.loadTenantsBadges();
  },

  // ---------- ร้านสำหรับสมาชิก (badge) ----------
  async loadTenantsBadges() {
    if (!Settings.get().teamSlug) return;
    try {
      const res = await Api.getTenants();
      const tenants = res?.data?.tenants || res?.data || res?.tenants || [];
      this.renderTenantBadges(tenants);
    } catch (_) { /* เงียบ */ }
  },

  renderTenantBadges(tenants) {
    if (Array.isArray(tenants) && tenants.length) this._tenants = tenants;
    const box = document.getElementById('memberTenantBadges');
    if (!box) return;
    const list = this._tenants || [];
    if (!list.length) {
      box.innerHTML = '<div class="tenant-badges-hint">ยังไม่มีร้าน — ตั้งค่า Team Slug ก่อน</div>';
      return;
    }
    const s = Settings.get();
    const activeId = s.memberTenantId || s.tenantId || '';
    box.innerHTML = list.map((t) =>
      `<button class="tenant-badge ${String(t.id) === String(activeId) ? 'active' : ''}" data-id="${this.esc(t.id)}" data-admin="${this.esc(t.admin_api_url || '')}" data-version="${this.esc(t.api_version || 'v1')}">${this.esc(t.name || t.id)}</button>`
    ).join('');
  },

  async selectMemberTenant(id, adminApiUrl, name, apiVersion) {
    await Settings.save({
      memberTenantId: id,
      memberTenantName: name || '',
      memberTenantAdminApiUrl: adminApiUrl || '',
      memberTenantApiVersion: apiVersion || 'v1',
    });
    this._banksLoaded = false; // โหลดธนาคารใหม่ตามร้านที่เลือก
    this.renderTenantBadges();
    // โหลดธนาคารใหม่ถ้าการ์ดสมัครเปิดอยู่
    if (document.getElementById('funcRegister')?.classList.contains('open')) this.loadBanks();
  },

  // ร้านที่ใช้กับฟังก์ชันสมาชิก (fallback → ร้านที่ใช้สแกน)
  memberTenantId() {
    return Settings.get().memberTenantId || Settings.get().tenantId || '';
  },

  // เวอร์ชัน API ของร้านที่เลือกสำหรับฟังก์ชันสมาชิก (v1 | v2)
  memberApiVersion() {
    return String(Settings.get().memberTenantApiVersion || 'v1').toLowerCase();
  },
  memberAdminApiUrl() {
    return (Settings.get().memberTenantAdminApiUrl || Settings.get().tenantAdminApiUrl || '').replace(/\/+$/, '');
  },
  memberSite() {
    const admin = this.memberAdminApiUrl();
    return admin ? admin.replace(/:\/\/api\./, '://') : '';
  },

  // ---------- helper ----------
  requireTenantSite() {
    const site = this.memberSite();
    if (!site) throw new Error('ยังไม่ได้เลือกร้าน — กดเลือกร้านด้านบน');
    return site;
  },

  setStatus(elId, msg, kind) {
    const el = document.getElementById(elId);
    el.innerHTML = msg;
    el.className = 'func-status ' + (kind || '');
    el.classList.remove('hidden');
  },

  // ---------- สมัครสมาชิก ----------
  async loadBanks() {
    if (this._banksLoaded) return;
    const sel = document.getElementById('regBank');

    // V2: ดึงรายการธนาคารผ่าน backend (admin banks/list)
    if (this.memberApiVersion() === 'v2') {
      try {
        const res = await Api.listBanks(this.memberTenantId());
        const list = res?.data?.banks || res?.banks || [];
        sel.innerHTML = '<option value="">— เลือกธนาคาร —</option>' +
          list.map((b) => `<option value="${b.id}">${this.esc(b.name)}</option>`).join('');
        this._banksLoaded = true;
      } catch (e) {
        sel.innerHTML = '<option value="">โหลดธนาคารไม่สำเร็จ</option>';
      }
      return;
    }

    // V1: ดึงจากเว็บสาธารณะ (bank-setting)
    let site;
    try { site = this.requireTenantSite(); } catch { return; }
    try {
      const resp = await fetch(`${site}/api/proxy/web/bank-setting`);
      const banks = await resp.json();
      const list = Array.isArray(banks) ? banks : (banks?.result || []);
      sel.innerHTML = '<option value="">— เลือกธนาคาร —</option>' +
        list.filter((b) => b.isShowRegister !== false)
          .map((b) => `<option value="${b.id}">${this.esc(b.name)}</option>`).join('');
      this._banksLoaded = true;
    } catch (e) {
      sel.innerHTML = '<option value="">โหลดธนาคารไม่สำเร็จ</option>';
    }
  },

  async register() {
    const fullname = val('regFullname');
    const phone = val('regPhone');
    const password = val('regPassword');
    const bankId = Number(document.getElementById('regBank').value || 0);
    const bankAccount = val('regBankAccount');

    if (!phone || !password || !bankId || !bankAccount || !fullname) {
      this.setStatus('regStatus', 'กรุณากรอกข้อมูลให้ครบ (ชื่อ / เบอร์ / รหัสผ่าน / ธนาคาร / เลขบัญชี)', 'error');
      return;
    }

    // ── V2: สมัครผ่าน backend (admin members endpoint, ใช้ bearer ฝั่ง backend) ──
    if (this.memberApiVersion() === 'v2') {
      const btn2 = document.getElementById('btnDoRegister');
      btn2.disabled = true;
      this.setStatus('regStatus', '<span class="spinner"></span> กำลังสมัคร...', '');
      try {
        await Api.createMember({
          username: phone,
          password,
          fullName: fullname,
          bankId,
          accountNumber: bankAccount,
          knownChannel: '',
          status: 'active',
        }, this.memberTenantId());
        this.setStatus('regStatus', 'สมัครสมาชิกสำเร็จ ✓', 'success');
        ['regFullname', 'regPhone', 'regPassword', 'regBankAccount'].forEach((id) => { document.getElementById(id).value = ''; });
        document.getElementById('regBank').value = '';
      } catch (e) {
        this.setStatus('regStatus', 'สมัครไม่สำเร็จ: ' + (e.message || e), 'error');
      } finally {
        btn2.disabled = false;
      }
      return;
    }

    let site;
    try { site = this.requireTenantSite(); } catch (e) {
      this.setStatus('regStatus', e.message, 'error'); return;
    }

    const btn = document.getElementById('btnDoRegister');
    btn.disabled = true;
    this.setStatus('regStatus', '<span class="spinner"></span> กำลังสมัคร...', '');
    try {
      // 1) captcha (เอาแค่ id)
      let captchaId = '';
      try {
        const capResp = await fetch(`${site}/api/proxy/users/captcha`);
        const cap = await capResp.json();
        captchaId = cap?.id || '';
      } catch { /* ปล่อยผ่าน */ }

      // 2) เช็คเบอร์ว่าสมัครได้ไหม
      try {
        const chkResp = await fetch(`${site}/api/proxy/users/check-phone`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone, captchaId }),
        });
        if (!chkResp.ok) {
          const j = await chkResp.json().catch(() => ({}));
          throw new Error(j?.message || 'เบอร์นี้สมัครไม่ได้ (อาจมีอยู่แล้ว)');
        }
      } catch (e) {
        this.setStatus('regStatus', 'เช็คเบอร์ไม่ผ่าน: ' + (e.message || e), 'error');
        btn.disabled = false;
        return;
      }

      // 3) IP เครื่องสมัคร
      let ip = '';
      try {
        const ipResp = await fetch('https://api.ipify.org/?format=json');
        ip = (await ipResp.json())?.ip || '';
      } catch { /* ปล่อยผ่าน */ }

      // 4) สมัคร (ไม่ใช้ affiliate ref)
      const resp = await fetch(`${site}/api/proxy/users/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password,
          bankId,
          bankAccount,
          fullname,
          phone,
          refBy: '',
          refCode: '',
          saleCode: '',
          ipRegistered: ip,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.message || `สมัครไม่สำเร็จ (${resp.status})`);

      this.setStatus('regStatus', 'สมัครสมาชิกสำเร็จ ✓', 'success');
      ['regFullname', 'regPhone', 'regPassword', 'regBankAccount'].forEach((id) => { document.getElementById(id).value = ''; });
      document.getElementById('regBank').value = '';
    } catch (e) {
      this.setStatus('regStatus', 'สมัครไม่สำเร็จ: ' + (e.message || e), 'error');
    } finally {
      btn.disabled = false;
    }
  },

  // ---------- เปลี่ยนรหัสผ่าน ----------
  async searchCustomer() {
    const q = val('cpSearch');
    if (!q) { this.setStatus('cpStatus', 'กรุณากรอกคำค้น', 'error'); return; }
    const box = document.getElementById('cpResults');
    box.classList.remove('hidden');
    box.innerHTML = '<div class="cp-empty"><span class="spinner"></span> กำลังค้นหา...</div>';
    document.getElementById('cpSelected').classList.add('hidden');
    this._cpUser = null;
    document.getElementById('btnDoChangePw').disabled = true;
    try {
      const users = await Api.searchUsersBoth(q, this.memberTenantId());
      this._cpResults = users;
      if (!users.length) { box.innerHTML = '<div class="cp-empty">ไม่พบลูกค้า</div>'; return; }
      box.innerHTML = users.map((u, i) => {
        const name = u.fullname || u.fullName || '-';
        const sub = [u.phone, u.bankName || u.bank, u.bankAccount || u.bank_account].filter(Boolean).join(' · ');
        return `<div class="cp-result-item" data-index="${i}">
          <div class="match-result-name">${this.esc(name)}</div>
          ${sub ? `<div class="match-result-sub">${this.esc(sub)}</div>` : ''}
        </div>`;
      }).join('');
    } catch (e) {
      box.innerHTML = `<div class="cp-empty">ค้นหาไม่สำเร็จ: ${this.esc(e.message || e)}</div>`;
    }
  },

  selectCustomer(index) {
    const u = this._cpResults?.[index];
    if (!u) return;
    this._cpUser = u;
    document.getElementById('cpResults').classList.add('hidden');
    const name = u.fullname || u.fullName || '-';
    const sub = [u.phone, u.bankName || u.bank, u.bankAccount || u.bank_account].filter(Boolean).join(' · ');
    const box = document.getElementById('cpSelected');
    box.classList.remove('hidden');
    box.innerHTML = `<div class="cp-selected-name">เลือก: ${this.esc(name)}</div>
      <div class="match-result-sub">${this.esc(sub)}</div>
      <button class="btn-ghost cp-clear" id="cpClearBtn">เปลี่ยน</button>`;
    document.getElementById('cpClearBtn').addEventListener('click', () => {
      this._cpUser = null;
      box.classList.add('hidden');
      document.getElementById('cpResults').classList.remove('hidden');
      document.getElementById('btnDoChangePw').disabled = true;
    });
    document.getElementById('btnDoChangePw').disabled = false;

    // กรอกรหัสผ่านใหม่อัตโนมัติ = 4 ตัวท้ายของเบอร์โทร (แก้ไขได้)
    const digits = String(u.phone || '').replace(/\D/g, '');
    if (digits.length >= 4) {
      document.getElementById('cpPassword').value = digits.slice(-4);
    }
  },

  async changePassword() {
    const u = this._cpUser;
    const password = val('cpPassword');
    if (!u) { this.setStatus('cpStatus', 'กรุณาค้นหาและเลือกลูกค้าก่อน', 'error'); return; }
    if (!password) { this.setStatus('cpStatus', 'กรุณากรอกรหัสผ่านใหม่', 'error'); return; }

    const btn = document.getElementById('btnDoChangePw');
    btn.disabled = true;
    this.setStatus('cpStatus', '<span class="spinner"></span> กำลังเปลี่ยนรหัสผ่าน...', '');
    try {
      // ส่งผ่าน backend ATslip — backend ใช้ admin bearer จากฐานข้อมูลเอง
      // รักษาข้อมูลเดิมไว้ เปลี่ยนเฉพาะ password
      const fields = {
        phone: u.phone || '',
        password,
        fullname: u.fullname || u.fullName || '',
        channelId: u.channelId ?? 0,
        refMemberCode: '',
        bankId: u.bankId ?? 0,
        bankAccount: u.bankAccount || u.bank_account || '',
        promptpayNumber: u.promptpayNumber || '',
        note: u.note || '',
        id: u.id,
      };
      await Api.updateUser(u.id, fields, this.memberTenantId());
      this.setStatus('cpStatus', 'เปลี่ยนรหัสผ่านสำเร็จ ✓', 'success');
      document.getElementById('cpPassword').value = '';
    } catch (e) {
      let msg = e.message || String(e);
      if (/not found/i.test(msg)) {
        msg = 'ยังไม่พบ endpoint บน backend — ต้อง deploy ATslip backend ใหม่ (route PUT /api/users/update/:id)';
      }
      this.setStatus('cpStatus', 'เปลี่ยนรหัสผ่านไม่สำเร็จ: ' + msg, 'error');
    } finally {
      btn.disabled = false;
    }
  },

  esc(v) { return ScanList.esc(v); },
};

function val(id) {
  return (document.getElementById(id)?.value || '').trim();
}

window.Functions = Functions;
