// ============================================================
// API CLIENT
// ============================================================

class API {
  constructor(baseURL) {
    this.baseURL = baseURL;
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    
    const teamSlug = await this.getCurrentTeamSlug();
    
    const defaultOptions = {
      headers: {
        'Content-Type': 'application/json',
        'X-Team-Slug': teamSlug,
      },
    };

    const config = { ...defaultOptions, ...options };
    
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

  async getCurrentTeamSlug() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['currentTeamSlug'], (result) => {
        resolve(result.currentTeamSlug || 'default');
      });
    });
  }

  async setCurrentTeamSlug(slug) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ currentTeamSlug: slug }, resolve);
    });
  }

  // ============================================================
  // TEAM APIs
  // ============================================================

  async getTeams() {
    return this.request('/api/teams');
  }

  async getTeamBySlug(slug) {
    return this.request(`/api/teams/${slug}`);
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

  async updateTenant(id, data) {
    return this.request(`/api/tenants/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async connectAdmin(id) {
    return this.request(`/api/tenants/${id}/connect`, {
      method: 'POST',
    });
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

  // ============================================================
  // PENDING TRANSACTIONS APIs
  // ============================================================

  async getPendingTransactions(params = {}) {
    const queryParams = new URLSearchParams();
    if (params.status) queryParams.append('status', params.status);
    if (params.tenant_id) queryParams.append('tenant_id', params.tenant_id);
    if (params.search) queryParams.append('search', params.search);
    if (params.sort_by) queryParams.append('sort_by', params.sort_by);
    if (params.sort_order) queryParams.append('sort_order', params.sort_order);

    const queryString = queryParams.toString();
    const endpoint = queryString ? `/api/pending-transactions?${queryString}` : '/api/pending-transactions';
    
    return this.request(endpoint);
  }

  async matchPendingTransaction(id, data) {
    return this.request(`/api/pending-transactions/${id}/match`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deletePendingTransaction(id) {
    return this.request(`/api/pending-transactions/${id}`, {
      method: 'DELETE',
    });
  }

  async creditPendingTransaction(id) {
    return this.request(`/api/pending-transactions/${id}/credit`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  async searchUsers(query, category = 'member', tenantId) {
    const queryParams = new URLSearchParams();
    queryParams.append('q', query);
    queryParams.append('category', category);
    queryParams.append('tenant_id', String(tenantId));
    return this.request(`/api/users/search?${queryParams.toString()}`);
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

    const teamSlug = await this.getCurrentTeamSlug();
    
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
  // LINE OA APIs
  // ============================================================

  async getLineOAs() {
    return this.request('/api/line-oas');
  }

  async getLineOA(id) {
    return this.request(`/api/line-oas/${id}`);
  }

  async updateLineOASettings(id, settings) {
    return this.request(`/api/line-oas/${id}/reply-settings`, {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  }

  async getLineOASettings(id) {
    return this.request(`/api/line-oas/${id}/reply-settings`);
  }
}

// Create global API instance
const api = new API(API_CONFIG.BASE_URL);

if (typeof window !== 'undefined') {
  window.api = api;
}
