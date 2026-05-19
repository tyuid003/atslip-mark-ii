// ============================================================
// API CLIENT
// ============================================================

class API {
  constructor(baseURL) {
    this.baseURL = baseURL;
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    
    // เพิ่ม X-Team-ID header สำหรับ team filtering
    const teamSlug = window.currentTeamSlug || window.getTeamFromURL();
    
    const defaultOptions = {
      headers: {
        'Content-Type': 'application/json',
        'X-Team-Slug': teamSlug, // ส่ง team slug ไปกับทุก request
      },
    };

    const config = { ...defaultOptions, ...options };
    
    // Merge headers ถ้ามี custom headers
    if (options.headers) {
      config.headers = { ...defaultOptions.headers, ...options.headers };
    }

    try {
      console.log('[API] Fetching:', url);
      const response = await fetch(url, config);
      console.log('[API] Response:', response.status, response.headers.get('content-type'), 'CF-Cache:', response.headers.get('cf-cache-status'));
      const text = await response.text();
      if (text.startsWith('<')) {
        console.error('[API] Got HTML instead of JSON! First 300 chars:', text.substring(0, 300));
        throw new Error('Server returned HTML instead of JSON');
      }
      const data = JSON.parse(text);

      if (!response.ok) {
        throw new Error(data.error || 'Request failed');
      }

      return data;
    } catch (error) {
      console.error('API Error:', error);
      throw error;
    }
  }

  // ============================================================
  // TENANT APIs
  // ============================================================

  async getTenants() {
    return this.request('/api/tenants');
  }

  async getTenant(id) {
    return this.request(`/api/tenants/${id}`);
  }

  async createTenant(data) {
    return this.request('/api/tenants', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateTenant(id, data) {
    return this.request(`/api/tenants/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteTenant(id) {
    return this.request(`/api/tenants/${id}`, {
      method: 'DELETE',
    });
  }

  async connectAdmin(id) {
    return this.request(`/api/tenants/${id}/connect`, {
      method: 'POST',
    });
  }

  async getBankAccounts(id) {
    return this.request(`/api/tenants/${id}/accounts`);
  }

  async refreshBankAccounts(id) {
    return this.request(`/api/tenants/${id}/refresh-accounts`, {
      method: 'POST',
    });
  }

  async disconnectAdmin(id) {
    return this.request(`/api/tenants/${id}/disconnect`, {
      method: 'POST',
    });
  }

  async getCaptcha(tenantId) {
    return this.request(`/api/tenants/${tenantId}/captcha`);
  }

  async loginAdmin(tenantId, data) {
    return this.request(`/api/tenants/${tenantId}/login`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async toggleAutoDeposit(id, enabled) {
    return this.request(`/api/tenants/${id}/auto-deposit`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
  }

  // ============================================================
  // TEAM APIs
  // ============================================================

  async getTeamBySlug(slug) {
    return this.request(`/api/teams/${slug}`);
  }

  async getAllTeams() {
    return this.request('/api/teams');
  }

  // ============================================================
  // LINE OA APIs
  // ============================================================

  async getLineOAs(tenantId) {
    return this.request(`/api/tenants/${tenantId}/line-oas`);
  }

  async createLineOA(tenantId, data) {
    return this.request(`/api/tenants/${tenantId}/line-oas`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateLineOA(id, data) {
    return this.request(`/api/line-oas/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteLineOA(id) {
    return this.request(`/api/line-oas/${id}`, {
      method: 'DELETE',
    });
  }

  async getLineReplySettings(lineOAId) {
    return this.request(`/api/line-oas/${lineOAId}/reply-settings`);
  }

  async updateLineReplySettings(lineOAId, data) {
    return this.request(`/api/line-oas/${lineOAId}/reply-settings`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // ============================================================
  // SCAN APIs
  // ============================================================

  async uploadSlip(file, tenantId = null) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('source', 'manual');
    if (tenantId) {
      formData.append('tenant_id', tenantId);
    }

    const teamSlug = window.currentTeamSlug || window.getTeamFromURL();
    
    const response = await fetch(`${this.baseURL}/api/scan/upload`, {
      method: 'POST',
      headers: {
        'X-Team-Slug': teamSlug,
      },
      body: formData,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Upload failed');
    }

    return data;
  }

  // ============================================================
  // BANK ACCOUNTS APIs
  // ============================================================

  async syncBankAccounts(tenantId) {
    return this.request(`/api/tenants/${tenantId}/bank-accounts/sync`, {
      method: 'POST',
    });
  }

  async createBankAccountMetadata(tenantId, accountId) {
    return this.request(`/api/tenants/${tenantId}/bank-accounts/${accountId}/metadata`, {
      method: 'POST',
    });
  }

  async getBankAccountsMetadata(tenantId) {
    return this.request(`/api/tenants/${tenantId}/bank-accounts/metadata`);
  }

  async updateEnglishName(accountId, englishName) {
    return this.request(`/api/bank-accounts/${accountId}/english-name`, {
      method: 'PATCH',
      body: JSON.stringify({ english_name: englishName }),
    });
  }

  // ============================================================
  // PENDING TRANSACTIONS APIs
  // ============================================================

  async getPendingTransactions(limit = 50) {
    return this.request(`/api/pending-transactions?limit=${limit}`);
  }

  async searchPendingTransactions({ page = 1, limit = 50, tenantId = '', status = '', dateFrom = '', dateTo = '' } = {}) {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', String(limit));
    if (tenantId) params.set('tenantId', tenantId);
    if (status) params.set('status', status);
    if (dateFrom) params.set('dateFrom', String(dateFrom));
    if (dateTo) params.set('dateTo', String(dateTo));
    return this.request(`/api/pending-transactions/search?${params.toString()}`);
  }

  async deletePendingTransaction(transactionId) {
    return this.request(`/api/pending-transactions/${transactionId}`, {
      method: 'DELETE',
    });
  }

  async matchPendingTransaction(transactionId, userData) {
    return this.request(`/api/pending-transactions/${transactionId}/match`, {
      method: 'PATCH',
      body: JSON.stringify({
        matched_user_id: userData.matched_user_id,
        matched_username: userData.matched_username,
        tenant_id: userData.tenant_id,
        user: userData.user,
      }),
    });
  }

  async genMemberCode(tenantId, userId) {
    return this.request(
      `/api/users/gen-membercode?tenant_id=${encodeURIComponent(tenantId)}&user_id=${encodeURIComponent(userId)}`
    );
  }

  async creditPendingTransaction(transactionId, payload = {}) {
    return this.request(`/api/pending-transactions/${transactionId}/credit`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async withdrawPendingCredit(transactionId, payload = {}) {
    return this.request(`/api/pending-transactions/${transactionId}/withdraw`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // ============================================================
  // REPORT APIs
  // ============================================================
  async reportTransaction(payload) {
    return this.request('/api/report', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // ============================================================
  // USER SEARCH API
  // ============================================================
  async searchUsers(query, category = 'member', tenantId = '') {
    const params = new URLSearchParams({ q: query, category });
    if (tenantId) params.set('tenant_id', tenantId);
    return this.request(`/api/users/search?${params.toString()}`);
  }
}

// Create API instance
window.api = new API(API_CONFIG.BASE_URL);
