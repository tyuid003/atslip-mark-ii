// ============================================================
// ATslip Side Panel — Settings Storage
// อ่าน/เขียนการตั้งค่าใน chrome.storage.local
// (ไม่มีระบบ login — ทุกอย่างพึ่ง team slug + tenant ที่ตั้งค่าไว้)
// ============================================================
const Settings = {
  _cache: null,

  defaults() {
    return {
      backendUrl: window.ATSLIP_CONFIG.DEFAULT_BACKEND_URL, // ตายตัว ไม่ต้องให้ผู้ใช้กรอก
      teamSlug: '',
      teamId: '',             // ใช้สำหรับ realtime WebSocket (จับจาก tenant list)
      tenantId: '',
      tenantName: '',
      tenantAdminApiUrl: '',  // admin_api_url ของ tenant ที่ใช้สแกน (เช่น https://api.lalaplay.me)
      // ร้านสำหรับฟังก์ชันสมาชิก (สมัคร/เปลี่ยนรหัสผ่าน) — เลือกด้วย badge, ค้างในอุปกรณ์
      memberTenantId: '',
      memberTenantName: '',
      memberTenantAdminApiUrl: '',
    };
  },

  async load() {
    const key = window.ATSLIP_CONFIG.STORAGE_KEY;
    const stored = await chrome.storage.local.get(key);
    this._cache = { ...this.defaults(), ...(stored[key] || {}) };
    return this._cache;
  },

  get() {
    return this._cache || this.defaults();
  },

  async save(partial) {
    const key = window.ATSLIP_CONFIG.STORAGE_KEY;
    this._cache = { ...this.get(), ...partial };
    await chrome.storage.local.set({ [key]: this._cache });
    return this._cache;
  },

  isConfigured() {
    const s = this.get();
    return !!(s.backendUrl && s.teamSlug && s.tenantId);
  },
};

window.Settings = Settings;
