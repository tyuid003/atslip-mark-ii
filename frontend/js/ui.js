// ============================================================
// UI HELPERS
// ============================================================

const UI = {
  /**
   * แสดง Toast Notification
   */
  showToast(message, type = 'info') {
    // สร้าง toast element
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <div class="toast-content">
        <i data-lucide="${this.getToastIcon(type)}"></i>
        <span>${message}</span>
      </div>
    `;
    
    // เพิ่มเข้า DOM
    document.body.appendChild(toast);
    
    // Initialize icon
    lucide.createIcons();
    
    // แสดง toast
    setTimeout(() => {
      toast.classList.add('show');
    }, 10);
    
    // ซ่อน toast หลัง 3 วินาที
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => {
        toast.remove();
      }, 300);
    }, 3000);
  },

  getToastIcon(type) {
    const icons = {
      success: 'check-circle',
      error: 'alert-circle',
      warning: 'alert-triangle',
      info: 'info',
    };
    return icons[type] || 'info';
  },

  /**
   * แสดง/ซ่อน Loading State
   */
  showLoading() {
    document.getElementById('loadingState').style.display = 'block';
    document.getElementById('emptyState').style.display = 'none';
    document.getElementById('tenantGrid').style.display = 'none';
  },

  hideLoading() {
    document.getElementById('loadingState').style.display = 'none';
  },

  /**
   * แสดง Empty State
   */
  showEmptyState() {
    document.getElementById('emptyState').style.display = 'block';
    document.getElementById('tenantGrid').style.display = 'none';
  },

  /**
   * แสดง Tenant Grid
   */
  showTenantGrid() {
    document.getElementById('emptyState').style.display = 'none';
    document.getElementById('tenantGrid').style.display = 'grid';
  },

  /**
   * สร้าง Tenant Card HTML
   */
  createTenantCard(tenant) {
    const isConnected = tenant.admin_connected;
    const statusBadge = isConnected
      ? '<span class="badge badge-success"><i data-lucide="check-circle" size="12"></i> เชื่อมต่อแล้ว</span>'
      : '<span class="badge badge-gray"><i data-lucide="alert-circle" size="12"></i> ยังไม่เชื่อมต่อ</span>';

    return `
      <div class="tenant-card" data-tenant-id="${tenant.id}">
        <div class="tenant-card-header">
          <div class="tenant-card-info">
            <h3 class="tenant-card-name">
              <i data-lucide="building-2" size="20"></i>
              ${tenant.name}
            </h3>
            <div class="tenant-card-url">${tenant.admin_api_url}</div>
            <div class="tenant-card-status">
              ${statusBadge}
              ${tenant.status === 'active' 
                ? '<span class="badge badge-success">ใช้งาน</span>' 
                : '<span class="badge badge-gray">ปิดใช้งาน</span>'
              }
            </div>
          </div>
          <div class="tenant-card-menu">
            <button class="tenant-menu-btn" onclick="toggleTenantMenu('${tenant.id}')">
              <i data-lucide="more-vertical"></i>
            </button>
            <div id="menu-${tenant.id}" class="tenant-menu-dropdown" style="display: none;">
              <button class="tenant-menu-item" onclick="openEditTenantModal('${tenant.id}')">
                <i data-lucide="edit" size="16"></i>
                แก้ไข
              </button>
              <button class="tenant-menu-item" onclick="viewBankAccounts('${tenant.id}')">
                <i data-lucide="building" size="16"></i>
                ดูบัญชีธนาคาร
              </button>
              <button class="tenant-menu-item" onclick="${isConnected ? `disconnectAdmin('${tenant.id}')` : `connectAdmin('${tenant.id}')`}">
                <i data-lucide="${isConnected ? 'unplug' : 'plug'}" size="16"></i>
                ${isConnected ? 'ยกเลิกการเชื่อมต่อ' : 'เชื่อมต่อ Admin'}
              </button>
              <button class="tenant-menu-item" onclick="manageLineOAs('${tenant.id}')">
                <i data-lucide="message-circle" size="16"></i>
                จัดการ LINE OA
              </button>
              <div class="tenant-menu-divider"></div>
              <button class="tenant-menu-item danger" onclick="deleteTenant('${tenant.id}', '${tenant.name}')">
                <i data-lucide="trash-2" size="16"></i>
                ลบ
              </button>
            </div>
          </div>
        </div>
        <div class="tenant-card-body">
          <div class="tenant-stats">
            <div class="tenant-stat">
              <div class="tenant-stat-icon primary">
                <i data-lucide="message-circle" size="20"></i>
              </div>
              <div class="tenant-stat-content">
                <div class="tenant-stat-label">LINE OA</div>
                <div class="tenant-stat-value">${tenant.line_oa_count || 0}</div>
              </div>
            </div>
            <div class="tenant-stat">
              <div class="tenant-stat-icon success">
                <i data-lucide="building" size="20"></i>
              </div>
              <div class="tenant-stat-content">
                <div class="tenant-stat-label">บัญชีธนาคาร</div>
                <div class="tenant-stat-value">${tenant.bank_account_count || 0}</div>
              </div>
            </div>
            <div class="tenant-stat">
              <div class="tenant-stat-icon">
                <i data-lucide="clock" size="20"></i>
              </div>
              <div class="tenant-stat-content">
                <div class="tenant-stat-label">รอดำเนินการ</div>
                <div class="tenant-stat-value">${tenant.pending_count || 0}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  /**
   * Render Tenant Grid
   */
  renderTenants(tenants) {
    const grid = document.getElementById('tenantGrid');
    
    if (tenants.length === 0) {
      this.showEmptyState();
      return;
    }

    this.showTenantGrid();
    grid.innerHTML = tenants.map(tenant => this.createTenantCard(tenant)).join('');
    
    // Re-initialize Lucide icons
    lucide.createIcons();
  },

  /**
   * Toggle Tenant Menu
   */
  toggleTenantMenu(tenantId) {
    const menu = document.getElementById(`menu-${tenantId}`);
    const isVisible = menu.style.display === 'block';
    
    // Close all menus
    document.querySelectorAll('.tenant-menu-dropdown').forEach(m => {
      m.style.display = 'none';
    });
    
    // Toggle current menu
    menu.style.display = isVisible ? 'none' : 'block';
  },
};

// Close menus when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.tenant-card-menu')) {
    document.querySelectorAll('.tenant-menu-dropdown').forEach(m => {
      m.style.display = 'none';
    });
  }
});

// Export
window.UI = UI;
