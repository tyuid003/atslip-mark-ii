// ============================================================
// UI HELPERS
// ============================================================

const UI = {
  showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <div class="toast-content">
        <i data-lucide="${this.getToastIcon(type)}"></i>
        <span>${message}</span>
      </div>
    `;

    document.body.appendChild(toast);
    lucide.createIcons();

    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
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

  showLoading() {
    document.getElementById('loadingState').style.display = 'block';
    document.getElementById('emptyState').style.display = 'none';
    document.getElementById('tenantGrid').style.display = 'none';
  },

  hideLoading() {
    document.getElementById('loadingState').style.display = 'none';
  },

  showEmptyState() {
    document.getElementById('emptyState').style.display = 'block';
    document.getElementById('tenantGrid').style.display = 'none';
  },

  showTenantGrid() {
    document.getElementById('emptyState').style.display = 'none';
    document.getElementById('tenantGrid').style.display = 'flex';
  },

  createTenantCard(tenant) {
    const isConnected = tenant.admin_connected;
    const autoDepositEnabled = tenant.auto_deposit_enabled === 1;
    const statusBadge = isConnected
      ? '<span class="badge badge-success"><i data-lucide="check-circle" size="12"></i> เชื่อมต่อแล้ว</span>'
      : '<span class="badge badge-disconnected"><i data-lucide="x-circle" size="12"></i> ไม่เชื่อมต่อ</span>';

    return `
      <div class="tenant-card" data-tenant-id="${tenant.id}">
        <div class="tenant-card-header">
          <div class="tenant-card-info">
            <h3 class="tenant-card-name">
              <i data-lucide="building-2" size="16"></i>
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
          <div class="tenant-card-actions">
            <label class="toggle-switch toggle-switch-compact">
              <input type="checkbox" ${autoDepositEnabled ? 'checked' : ''} onchange="toggleAutoDeposit('${tenant.id}', this.checked)" data-tenant-id="${tenant.id}">
              <span class="toggle-slider"></span>
            </label>
            <div class="tenant-card-menu">
              <button class="tenant-menu-btn" onclick="toggleTenantMenu('${tenant.id}')">
                <i data-lucide="more-vertical" size="16"></i>
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
                <i data-lucide="message-circle" size="16"></i>
              </div>
              <div class="tenant-stat-content">
                <div class="tenant-stat-label">LINE OA</div>
                <div class="tenant-stat-value">${tenant.line_oa_count || 0}</div>
              </div>
            </div>
            <div class="tenant-stat">
              <div class="tenant-stat-icon success">
                <i data-lucide="building" size="16"></i>
              </div>
              <div class="tenant-stat-content">
                <div class="tenant-stat-label">บัญชี</div>
                <div class="tenant-stat-value">${tenant.bank_account_count || 0}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  createAddTenantCard() {
    return `
      <div class="tenant-card tenant-card-add" onclick="openCreateTenantModal()">
        <div class="tenant-card-add-content">
          <i data-lucide="plus-circle" size="48"></i>
          <h3>เพิ่มเว็บใหม่</h3>
          <p>คลิกเพื่อเพิ่มเว็บใหม่</p>
        </div>
      </div>
    `;
  },

  renderTenants(tenants) {
    const grid = document.getElementById('tenantGrid');

    if (tenants.length === 0) {
      this.showEmptyState();
      return;
    }

    this.showTenantGrid();
    const tenantCards = tenants.map((tenant) => this.createTenantCard(tenant)).join('');
    const addCard = this.createAddTenantCard();
    grid.innerHTML = tenantCards + addCard;
    lucide.createIcons();
  },

  renderPendingTransactions(items) {
    const list = document.getElementById('pendingList');

    if (!items || items.length === 0) {
      list.innerHTML = '<div class="pending-empty">ยังไม่มีรายการ pending</div>';
      return;
    }

    const displayItems = items.slice(0, 50);
    list.innerHTML = displayItems
      .map((item) => {
        const amount = Number(item.amount || 0).toLocaleString('th-TH');
        const created = item.created_at
          ? new Date(item.created_at * 1000).toLocaleString('th-TH')
          : '-';

        return `
          <div class="pending-item">
            <div class="pending-item-top">
              <strong>${item.sender_name || 'ไม่ระบุชื่อ'}</strong>
              <span>${amount} บาท</span>
            </div>
            <div class="pending-item-bottom">
              Ref: ${item.slip_ref || '-'} • ${created}
            </div>
          </div>
        `;
      })
      .join('');
  },

  renderNotifications(notifications) {
    const list = document.getElementById('notificationList');
    const data = notifications.slice(0, 99);

    if (data.length === 0) {
      list.innerHTML = '<div class="notification-item"><div class="notification-item-time">ยังไม่มีแจ้งเตือน</div></div>';
      return;
    }

    list.innerHTML = data
      .map((notification) => `
        <div class="notification-item">
          <div class="notification-item-title">${notification.title}</div>
          <div class="notification-item-time">${notification.time}</div>
        </div>
      `)
      .join('');
  },

  toggleTenantMenu(tenantId) {
    const menu = document.getElementById(`menu-${tenantId}`);
    const isVisible = menu.style.display === 'block';

    document.querySelectorAll('.tenant-menu-dropdown').forEach((m) => {
      m.style.display = 'none';
    });

    menu.style.display = isVisible ? 'none' : 'block';
  },
};

document.addEventListener('click', (e) => {
  if (!e.target.closest('.tenant-card-menu')) {
    document.querySelectorAll('.tenant-menu-dropdown').forEach((m) => {
      m.style.display = 'none';
    });
  }

  if (!e.target.closest('.header-actions')) {
    const dropdown = document.getElementById('notificationDropdown');
    if (dropdown) {
      dropdown.style.display = 'none';
    }
  }
});

window.UI = UI;
