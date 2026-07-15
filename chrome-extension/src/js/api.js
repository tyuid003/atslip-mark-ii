// ============================================================
// ATslip Side Panel — API Client
// เรียก backend เดียวกับ ATslip โดยส่ง X-Team-Slug (ไม่มี Bearer token)
// endpoint ทั้งหมดอ้างอิงจาก frontend/js/api.js ของโปรเจกต์หลัก
// ============================================================
const Api = {
  base() {
    const s = Settings.get();
    return (s.backendUrl || window.ATSLIP_CONFIG.DEFAULT_BACKEND_URL).replace(/\/+$/, '');
  },

  teamSlug() {
    return Settings.get().teamSlug || '';
  },

  // admin_api_url ของ tenant ที่เลือก (เช่น https://api.lalaplay.me)
  adminApiUrl() {
    return (Settings.get().tenantAdminApiUrl || '').replace(/\/+$/, '');
  },

  // เว็บสาธารณะของ tenant (ตัด "api." ออกจาก admin_api_url เช่น https://lalaplay.me)
  publicSiteUrl() {
    const admin = this.adminApiUrl();
    if (!admin) return '';
    return admin.replace(/:\/\/api\./, '://');
  },

  async request(endpoint, options = {}) {
    const url = `${this.base()}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      'X-Team-Slug': this.teamSlug(),
      ...(options.headers || {}),
    };
    const resp = await fetch(url, { ...options, headers });
    const text = await resp.text();
    if (text.startsWith('<')) {
      throw new Error('Server returned HTML instead of JSON (ตรวจสอบ Backend URL)');
    }
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`Invalid JSON (${resp.status}): ${(text || '').slice(0, 120)}`);
    }
    if (!resp.ok) {
      const err = new Error((data && (data.error || data.message)) || `Request failed (${resp.status})`);
      err.responseData = data;
      err.status = resp.status;
      throw err;
    }
    return data;
  },

  // ---------- Tenants ----------
  getTenants() {
    return this.request('/api/tenants');
  },

  // ---------- Scan ----------
  async uploadSlip(fileOrBlob, { filename = 'slip.jpg', source = 'manual' } = {}) {
    const s = Settings.get();
    const formData = new FormData();
    formData.append('file', fileOrBlob, filename);
    formData.append('source', source);
    if (s.tenantId) formData.append('tenant_id', s.tenantId);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);
    try {
      const resp = await fetch(`${this.base()}/api/scan/upload`, {
        method: 'POST',
        headers: { 'X-Team-Slug': this.teamSlug() },
        body: formData,
        signal: controller.signal,
      });
      const text = await resp.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch {
        if (!resp.ok) throw new Error(`Upstream error (${resp.status}): ${(text || '').slice(0, 120)}`);
        throw new Error(`Upload response invalid JSON (${resp.status})`);
      }
      if (!resp.ok) {
        const err = new Error((data && (data.error || data.message)) || `Upload failed (${resp.status})`);
        err.responseData = data;
        throw err;
      }
      return data;
    } catch (e) {
      if (e?.name === 'AbortError') throw new Error('หมดเวลาสแกน (เกิน 45 วินาที)');
      throw e;
    } finally {
      clearTimeout(timeoutId);
    }
  },

  // ---------- Pending transactions ----------
  searchPending({ page = 1, limit = 50, status = '', dateFrom = '', dateTo = '' } = {}) {
    const s = Settings.get();
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', String(limit));
    if (s.tenantId) params.set('tenantId', s.tenantId);
    if (status) params.set('status', status);
    if (dateFrom) params.set('dateFrom', String(dateFrom));
    if (dateTo) params.set('dateTo', String(dateTo));
    return this.request(`/api/pending-transactions/search?${params.toString()}`);
  },

  getPending(limit = 50) {
    return this.request(`/api/pending-transactions?limit=${limit}`);
  },

  deletePending(id) {
    return this.request(`/api/pending-transactions/${id}`, { method: 'DELETE' });
  },

  matchPending(id, payload) {
    return this.request(`/api/pending-transactions/${id}/match`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  creditPending(id, payload = {}) {
    return this.request(`/api/pending-transactions/${id}/credit`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  withdrawPending(id, payload = {}) {
    return this.request(`/api/pending-transactions/${id}/withdraw`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // ---------- User search / match ----------
  searchUsers(query, category = 'member', tenantId = null) {
    const s = Settings.get();
    const tid = tenantId || s.tenantId;
    const params = new URLSearchParams({ q: query, category });
    if (tid) params.set('tenant_id', tid);
    return this.request(`/api/users/search?${params.toString()}`);
  },

  // ค้นหาทั้ง member และ non-member พร้อมกัน (ใช้ตอนเปลี่ยนรหัสผ่าน/หาลูกค้า)
  async searchUsersBoth(query, tenantId = null) {
    const results = await Promise.allSettled([
      this.searchUsers(query, 'member', tenantId),
      this.searchUsers(query, 'non-member', tenantId),
    ]);
    const users = [];
    const seen = new Set();
    for (const r of results) {
      if (r.status === 'fulfilled') {
        const list = r.value?.data?.users || r.value?.users || [];
        for (const u of list) {
          // ตัดรายการซ้ำ (v2 คืน member เดียวกันทั้งสอง category → กันซ้ำด้วย id/memberCode)
          const key = String(u.id ?? u.memberCode ?? u.username ?? JSON.stringify(u));
          if (seen.has(key)) continue;
          seen.add(key);
          users.push(u);
        }
      }
    }
    return users;
  },

  genMemberCode(userId, tenantId = null) {
    const s = Settings.get();
    const tid = tenantId || s.tenantId;
    return this.request(
      `/api/users/gen-membercode?tenant_id=${encodeURIComponent(tid)}&user_id=${encodeURIComponent(userId)}`
    );
  },

  // เปลี่ยนข้อมูลลูกค้า (เช่น รหัสผ่าน) ผ่าน backend ATslip
  // backend จะใช้ admin bearer จากฐานข้อมูลเอง (ไม่ต้องส่ง token จากส่วนขยาย)
  updateUser(userId, fields, tenantId = null) {
    const s = Settings.get();
    const tid = tenantId || s.tenantId;
    return this.request(`/api/users/update/${encodeURIComponent(userId)}`, {
      method: 'PUT',
      body: JSON.stringify({ tenant_id: tid, fields }),
    });
  },

  // สมัครสมาชิกใหม่ผ่าน backend ATslip (ใช้ admin bearer ฝั่ง backend) — สำหรับ tenant V2
  createMember(fields, tenantId = null) {
    const s = Settings.get();
    const tid = tenantId || s.tenantId;
    return this.request('/api/users/create', {
      method: 'POST',
      body: JSON.stringify({ tenant_id: tid, fields }),
    });
  },

  // รายการธนาคารสำหรับฟอร์มสมัคร (V2) ผ่าน backend
  listBanks(tenantId = null) {
    const s = Settings.get();
    const tid = tenantId || s.tenantId;
    return this.request(`/api/users/banks?tenant_id=${encodeURIComponent(tid)}`);
  },

  // WebSocket URL สำหรับ realtime (แปลง http→ws)
  wsUrl() {
    const base = this.base().replace(/^http/, 'ws');
    const teamId = Settings.get().teamId;
    return `${base}/api/realtime/ws${teamId ? `?team_id=${encodeURIComponent(teamId)}` : ''}`;
  },
};
