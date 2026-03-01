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
      const response = await fetch(url, config);
      const data = await response.json();

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

  // ============================================================
  // SCAN APIs
  // ============================================================

  async uploadSlip(file, tenantId = null) {
    const formData = new FormData();
    formData.append('file', file);
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
        matched_username: userData.matched_username
      }),
    });
  }

  // ============================================================
  // USER SEARCH APIs
  // ============================================================

  async searchUsers(query, category = 'member') {
    return this.request(`/api/users/search?q=${encodeURIComponent(query)}&category=${category}`);
  }
}

// Create API instance
window.api = new API(API_CONFIG.BASE_URL);
