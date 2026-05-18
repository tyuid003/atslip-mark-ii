/**
 * Auto Deposit System - API Service Layer
 * จัดการการเรียก API ทั้งหมด
 */

const APIService = {
  /**
   * Get selected tenant from localStorage
   */
  getSelectedTenant() {
    const tenantId = localStorage.getItem(CONFIG.STORAGE_KEYS.SELECTED_TENANT);
    return CONFIG.TENANTS.find(t => t.id === tenantId) || CONFIG.TENANTS[0];
  },

  /**
   * Get bearer token from localStorage
   */
  getBearerToken() {
    return localStorage.getItem(CONFIG.STORAGE_KEYS.BEARER_TOKEN) || '';
  },

  /**
   * Set bearer token to localStorage
   */
  setBearerToken(token) {
    localStorage.setItem(CONFIG.STORAGE_KEYS.BEARER_TOKEN, token);
  },

  /**
   * Make API request to backend
   */
  async request(endpoint, options = {}) {
    const tenant = this.getSelectedTenant();
    const url = `${tenant.apiBaseUrl}${endpoint}`;
    const token = this.getBearerToken();
    
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : '',
          ...options.headers
        }
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('API Request failed:', error);
      throw error;
    }
  },

  /**
   * Admin login to get bearer token
   */
  async adminLogin(username, password) {
    try {
      const response = await this.request(CONFIG.API.ADMIN_LOGIN, {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });
      
      if (response.token) {
        this.setBearerToken(response.token);
      }
      
      return response;
    } catch (error) {
      console.error('Admin login failed:', error);
      throw error;
    }
  },

  /**
   * Verify bank slip using EasySlip API
   */
  async verifySlip(imageData, easyslipKey) {
    try {
      const formData = new FormData();
      
      // If imageData is a file
      if (imageData instanceof File) {
        formData.append('file', imageData);
      } else {
        // If imageData is base64 or URL
        formData.append('data', imageData);
      }
      
      const response = await fetch(
        `${CONFIG.API.EASYSLIP_BASE}${CONFIG.API.EASYSLIP_VERIFY}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${easyslipKey}`
          },
          body: formData
        }
      );

      if (!response.ok) {
        throw new Error(`EasySlip API Error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Slip verification failed:', error);
      throw error;
    }
  },

  /**
   * Search for users (member or non-member)
   */
  async searchUsers(query, category = 'member', page = 1, limit = 100) {
    try {
      const params = Utils.buildQueryString({
        page,
        limit,
        search: query,
        userCategory: category
      });
      
      const response = await this.request(`${CONFIG.API.USER_LIST}?${params}`, {
        method: 'GET'
      });
      
      return response;
    } catch (error) {
      console.error('User search failed:', error);
      throw error;
    }
  },

  /**
   * Search user by username first, then phone, then name
   */
  async searchUserMultiField(query) {
    try {
      // Try member first
      let result = await this.searchUsers(query, CONFIG.USER_CATEGORIES.MEMBER);
      
      if (result.list && result.list.length > 0) {
        return { found: true, user: result.list[0], category: 'member' };
      }
      
      // Try non-member
      result = await this.searchUsers(query, CONFIG.USER_CATEGORIES.NON_MEMBER);
      
      if (result.list && result.list.length > 0) {
        return { found: true, user: result.list[0], category: 'non-member' };
      }
      
      return { found: false, user: null, category: null };
    } catch (error) {
      console.error('Multi-field search failed:', error);
      throw error;
    }
  },

  /**
   * Add credit to user
   */
  async addCredit(data) {
    try {
      const response = await this.request(CONFIG.API.CREDIT_ADD, {
        method: 'POST',
        body: JSON.stringify(data)
      });
      
      return response;
    } catch (error) {
      console.error('Add credit failed:', error);
      throw error;
    }
  },

  /**
   * Withdraw credit from user
   */
  async withdrawCredit(data) {
    try {
      const response = await this.request(CONFIG.API.CREDIT_WITHDRAW, {
        method: 'POST',
        body: JSON.stringify(data)
      });
      
      return response;
    } catch (error) {
      console.error('Withdraw credit failed:', error);
      throw error;
    }
  },

  /**
   * Send LINE message (reply or push)
   */
  async sendLineMessage(type, data, accessToken) {
    try {
      const endpoint = type === 'reply' ? CONFIG.API.LINE_REPLY : CONFIG.API.LINE_PUSH;
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify(data)
      });

      if (!response.ok) {
        throw new Error(`LINE API Error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Send LINE message failed:', error);
      throw error;
    }
  },

  /**
   * Process slip and auto credit
   * Main function that handles the entire flow
   */
  async processSlipAndCredit(slipData, slipResult, isFromLine = false) {
    try {
      const tenant = this.getSelectedTenant();
      const autoCredit = localStorage.getItem(CONFIG.STORAGE_KEYS.AUTO_CREDIT_ENABLED) === 'true';
      
      // Step 1: Match recipient (tenant)
      const recipientMatch = this.matchRecipient(slipResult.receiver, tenant);
      
      if (!recipientMatch) {
        Utils.showToast('ไม่พบบัญชีผู้รับที่ตรงกัน', 'error');
        return { success: false, reason: 'recipient_mismatch' };
      }
      
      // Step 2: Match sender (user)
      const senderName = slipResult.sender.displayName || slipResult.sender.name;
      const senderAccount = slipResult.sender.account;
      
      const userMatch = await this.matchUser(senderName, senderAccount);
      
      // Step 3: Check for duplicate slip_ref
      const isDuplicate = await this.checkDuplicateSlip(slipResult.transRef);
      
      if (isDuplicate) {
        Utils.showToast('สลิปนี้ถูกใช้งานแล้ว', 'warning');
        
        if (isFromLine) {
          await this.sendDuplicateMessage(tenant, slipData);
        }
        
        return { success: false, reason: 'duplicate' };
      }
      
      // Step 4: If auto credit and user matched, add credit
      if (autoCredit && userMatch.found) {
        const creditResult = await this.addCredit({
          userId: userMatch.user.id,
          amount: slipResult.amount,
          slipRef: slipResult.transRef,
          category: userMatch.category
        });
        
        // Check if it's duplicate from backend
        if (creditResult.status === 'DUPLICATED') {
          if (isFromLine) {
            await this.sendDuplicateMessage(tenant, slipData);
          }
          
          return { success: false, reason: 'duplicate_backend', creditResult };
        }
        
        // Success - send LINE message if from LINE
        if (isFromLine) {
          await this.sendSuccessMessage(tenant, slipData, creditResult);
        }
        
        Utils.showToast('เติมเครดิตสำเร็จ', 'success');
        return { success: true, creditResult, userMatch };
      }
      
      // Step 5: If not auto credit or user not matched, save as pending
      await this.savePending({
        tenantId: tenant.id,
        amount: slipResult.amount,
        senderName,
        senderAccount,
        slipRef: slipResult.transRef,
        slipData: slipResult,
        userId: userMatch.found ? userMatch.user.id : null,
        status: userMatch.found ? 'matched' : 'pending'
      });
      
      Utils.showToast('บันทึกรายการรอจับคู่', 'info');
      return { success: true, pending: true, userMatch };
      
    } catch (error) {
      console.error('Process slip and credit failed:', error);
      Utils.showToast('เกิดข้อผิดพลาด: ' + error.message, 'error');
      throw error;
    }
  },

  /**
   * Match recipient with tenant
   */
  matchRecipient(receiver, tenant) {
    if (!receiver || !receiver.account) return false;
    
    // Match with tenant account from KV or D1
    // This is a simplified version - you may need to implement actual KV/D1 lookup
    return true; // Placeholder
  },

  /**
   * Match user by name and account
   */
  async matchUser(name, account) {
    try {
      // First, try to match by username (member code)
      const usernameSearch = await this.searchUserMultiField(account);
      
      if (usernameSearch.found) {
        // Verify name match
        if (Utils.matchName(name, usernameSearch.user.fullname)) {
          return usernameSearch;
        }
      }
      
      // Try phone number
      if (Utils.isValidPhoneNumber(account)) {
        const phoneSearch = await this.searchUserMultiField(account);
        if (phoneSearch.found && Utils.matchName(name, phoneSearch.user.fullname)) {
          return phoneSearch;
        }
      }
      
      // Try name match
      const cleanName = Utils.removeTitlePrefix(name);
      const nameSearch = await this.searchUserMultiField(cleanName);
      
      if (nameSearch.found) {
        const user = nameSearch.user;
        const nameMatches = Utils.matchName(name, user.fullname);
        const accountMatches = Utils.matchAccount(account, user.bankAccount);
        
        if (nameMatches && accountMatches) {
          return nameSearch;
        }
      }
      
      return { found: false, user: null, category: null };
      
    } catch (error) {
      console.error('Match user failed:', error);
      return { found: false, user: null, category: null };
    }
  },

  /**
   * Check if slip_ref is duplicate in D1
   */
  async checkDuplicateSlip(slipRef) {
    // TODO: Implement D1 query to check pending_transactions
    // For now, return false (not duplicate)
    return false;
  },

  /**
   * Save pending transaction to D1
   */
  async savePending(data) {
    // TODO: Implement D1 insert to pending_transactions
    console.log('Saving pending:', data);
    return true;
  },

  /**
   * Send success message via LINE
   */
  async sendSuccessMessage(tenant, slipData, creditResult) {
    // TODO: Implement LINE message sending
    console.log('Sending success message:', { tenant, slipData, creditResult });
  },

  /**
   * Send duplicate message via LINE
   */
  async sendDuplicateMessage(tenant, slipData) {
    // TODO: Implement LINE message sending
    console.log('Sending duplicate message:', { tenant, slipData });
  }
};
