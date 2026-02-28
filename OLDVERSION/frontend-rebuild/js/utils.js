/**
 * Auto Deposit System - Utility Functions
 * ฟังก์ชันช่วยเหลือทั่วไป
 */

const Utils = {
  /**
   * Format amount to Thai Baht
   */
  formatCurrency(amount) {
    return new Intl.NumberFormat('th-TH', {
      style: 'currency',
      currency: 'THB'
    }).format(amount);
  },

  /**
   * Format date to localized string
   */
  formatDate(dateString) {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('th-TH', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  },

  /**
   * Remove Thai title prefixes from name
   * @param {string} name - Full name with prefix
   * @returns {string} - Name without prefix
   */
  removeTitlePrefix(name) {
    if (!name) return '';
    
    let cleanName = name.trim();
    for (const prefix of CONFIG.THAI_PREFIXES) {
      if (cleanName.startsWith(prefix)) {
        cleanName = cleanName.substring(prefix.length).trim();
        break;
      }
    }
    return cleanName;
  },

  /**
   * Check if name matches (4+ characters)
   * @param {string} name1 - First name (from slip)
   * @param {string} name2 - Second name (from database)
   * @returns {boolean} - True if names match
   */
  matchName(name1, name2) {
    if (!name1 || !name2) return false;
    
    const clean1 = this.removeTitlePrefix(name1).toLowerCase();
    const clean2 = this.removeTitlePrefix(name2).toLowerCase();
    
    // Find 4+ consecutive matching characters
    const minChars = CONFIG.MATCHING.MIN_NAME_CHARS;
    
    for (let i = 0; i <= clean1.length - minChars; i++) {
      const substring = clean1.substring(i, i + minChars);
      if (clean2.includes(substring)) {
        return true;
      }
    }
    
    return false;
  },

  /**
   * Check if account numbers match (3+ digits)
   * @param {string} account1 - First account number
   * @param {string} account2 - Second account number
   * @returns {boolean} - True if accounts match
   */
  matchAccount(account1, account2) {
    if (!account1 || !account2) return false;
    
    const digits1 = account1.replace(/\D/g, '');
    const digits2 = account2.replace(/\D/g, '');
    const minDigits = CONFIG.MATCHING.MIN_ACCOUNT_DIGITS;
    
    // Check if either has 3+ matching consecutive digits
    for (let i = 0; i <= digits1.length - minDigits; i++) {
      const substring = digits1.substring(i, i + minDigits);
      if (digits2.includes(substring)) {
        return true;
      }
    }
    
    return false;
  },

  /**
   * Show toast notification
   */
  showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    if (!toast) {
      console.warn('Toast element not found');
      console.log(`[${type}] ${message}`);
      return;
    }
    
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    
    setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
  },

  /**
   * Show loading indicator
   */
  showLoading(show = true) {
    const loader = document.getElementById('loading');
    if (loader) {
      loader.style.display = show ? 'flex' : 'none';
    }
  },

  /**
   * Show confirm dialog
   */
  async confirm(message) {
    return new Promise((resolve) => {
      const result = window.confirm(message);
      resolve(result);
    });
  },

  /**
   * Debounce function
   */
  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  },

  /**
   * Generate unique ID
   */
  generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  },

  /**
   * Validate Thai phone number
   */
  isValidPhoneNumber(phone) {
    const phoneRegex = /^0[0-9]{9}$/;
    return phoneRegex.test(phone);
  },

  /**
   * Sanitize HTML to prevent XSS
   */
  sanitizeHTML(html) {
    const div = document.createElement('div');
    div.textContent = html;
    return div.innerHTML;
  },

  /**
   * Convert image file to base64
   */
  async fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },

  /**
   * Validate image file
   */
  isValidImageFile(file) {
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png'];
    const maxSize = 5 * 1024 * 1024; // 5MB
    
    if (!validTypes.includes(file.type)) {
      this.showToast('กรุณาเลือกไฟล์รูปภาพ (JPG, PNG)', 'error');
      return false;
    }
    
    if (file.size > maxSize) {
      this.showToast('ขนาดไฟล์ต้องไม่เกิน 5MB', 'error');
      return false;
    }
    
    return true;
  },

  /**
   * Parse query string from URL
   */
  parseQueryString(url) {
    const params = new URLSearchParams(url.split('?')[1] || '');
    const result = {};
    for (const [key, value] of params) {
      result[key] = value;
    }
    return result;
  },

  /**
   * Build query string from object
   */
  buildQueryString(params) {
    return Object.keys(params)
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
      .join('&');
  },

  /**
   * Get current date/time in Bangkok timezone
   */
  getCurrentTimestamp() {
    return new Date().toISOString();
  },

  /**
   * Check if slip_ref is duplicate
   */
  isDuplicateSlipRef(slipRef, pendingList) {
    return pendingList.some(item => item.slipRef === slipRef);
  }
};
