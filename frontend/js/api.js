// ============================================================
// API CLIENT
// ============================================================

class API {
  constructor(baseURL) {
    this.baseURL = baseURL;
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    
    const defaultOptions = {
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const config = { ...defaultOptions, ...options };

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

  async disconnectAdmin(id) {
    return this.request(`/api/tenants/${id}/disconnect`, {
      method: 'POST',
    });
  }

  async toggleAutoDeposit(id, enabled) {
    return this.request(`/api/tenants/${id}/auto-deposit`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
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
  // PENDING TRANSACTIONS APIs
  // ============================================================

  async getPendingTransactions(limit = 50) {
    return this.request(`/api/pending-transactions?limit=${limit}`);
  }
}

// Create API instance
window.api = new API(API_CONFIG.BASE_URL);
