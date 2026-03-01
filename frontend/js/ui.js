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
      setTimeout(() => toast.remove(), 200);
    }, 500);
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
    // ตรวจสอบว่ามีสถานะ pending หรือไม่ ถ้ามีให้ใช้สถานะนั้น
    const hasPendingState = window.pendingToggleStates && window.pendingToggleStates.has(tenant.id);
    const autoDepositEnabled = hasPendingState 
      ? window.pendingToggleStates.get(tenant.id)
      : tenant.auto_deposit_enabled === 1;
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
            </div>
          </div>
          <div class="tenant-card-actions">
            <label class="toggle-switch toggle-switch-compact">
              <input type="checkbox" id="toggle-${tenant.id}" ${autoDepositEnabled ? 'checked' : ''} onchange="toggleAutoDeposit('${tenant.id}', this.checked)">
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
      list.innerHTML = '<div class="pending-empty">ยังไม่มีรายการ...</div>';
      return;
    }

    const displayItems = items.slice(0, 50);
    list.innerHTML = displayItems
      .map((item) => {
        const amount = Number(item.amount || 0).toLocaleString('th-TH');
        
        // ใช้วันที่จากสลิป (slip_data.date) แทน created_at
        let slipDate = '-';
        try {
          if (item.slip_data) {
            let slipData;
            
            // Parse JSON ถ้าเป็น string
            if (typeof item.slip_data === 'string') {
              try {
                slipData = JSON.parse(item.slip_data);
              } catch (parseError) {
                console.error('[Pending] Error parsing slip_data JSON:', parseError);
                slipData = null;
              }
            } else {
              slipData = item.slip_data;
            }
            
            // ดึงวันที่จาก slip_data.date
            if (slipData && slipData.date) {
              const date = new Date(slipData.date);
              if (!isNaN(date.getTime())) {
                slipDate = date.toLocaleString('th-TH', {
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit'
                });
              }
            }
          }
          
          // Fallback to created_at if slip_data parsing failed
          if (slipDate === '-' && item.created_at) {
            slipDate = new Date(item.created_at * 1000).toLocaleString('th-TH');
          }
        } catch (e) {
          slipDate = item.created_at 
            ? new Date(item.created_at * 1000).toLocaleString('th-TH')
            : '-';
        }

        // สร้างข้อความแสดงผู้ใช้ที่จับคู่ได้ (ถ้ามี)
        let matchedUserText = '';
        if (item.matched_username && item.matched_user_id) {
          matchedUserText = `${item.matched_username} (${item.matched_user_id})`;
          console.log('[Pending] Matched user text:', matchedUserText);
        } else if (item.matched_username) {
          matchedUserText = item.matched_username;
          console.log('[Pending] Matched username only:', matchedUserText);
        } else if (item.matched_user_id) {
          matchedUserText = `(${item.matched_user_id})`;
          console.log('[Pending] Matched user ID only:', matchedUserText);
        }

        // กำหนดสีตาม status
        const statusConfig = {
          pending: { color: 'yellow', label: 'รอจับคู่' },
          matched: { color: 'blue', label: 'จับคู่แล้ว' },
          completed: { color: 'green', label: 'เติมแล้ว' },
          duplicate: { color: 'red', label: 'ยอดซ้ำ' },
        };
        const status = statusConfig[item.status] || statusConfig.pending;

        return `
          <div class="pending-item" data-item-id="${item.id}" data-tenant-id="${item.tenant_id}">
            <div class="pending-item-top">
              <span class="status-badge status-${status.color}">${status.label}</span>
              <div class="matched-user-info">
                ${matchedUserText ? `<span class="matched-user-text">${matchedUserText}</span>` : ''}
                <button class="pending-search-btn" onclick="openUserSearch('${item.id}', '${item.tenant_id}')" title="ค้นหาและจับคู่ผู้ใช้">
                  <i data-lucide="search"></i>
                </button>
                <button class="pending-delete-btn" onclick="deletePendingItem('${item.id}')" title="ลบรายการ">
                  <i data-lucide="x"></i>
                </button>
              </div>
            </div>
            <div class="pending-item-bottom">
              <div class="pending-info">
                <div class="transfer-info">
                  <span class="sender-name">${item.sender_name || 'ไม่ระบุชื่อ'}</span>
                  ${item.receiver_name ? `<i data-lucide="arrow-right" size="14" style="color: var(--color-gray-400); flex-shrink: 0;"></i><span class="receiver-name">${item.receiver_name}</span>` : ''}
                </div>
                <div>
                  <span class="slip-date">${slipDate}</span>${item.tenant_name ? `<span class="tenant-name">${item.tenant_name}</span>` : ''}
                </div>
              </div>
              <span class="amount">${amount} บาท</span>
            </div>
          </div>
        `;
      })
      .join('');
    
    lucide.createIcons();
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
    const button = document.querySelector(`[onclick="toggleTenantMenu('${tenantId}')"]`);
    const isVisible = menu.style.display === 'block';

    // ปิดเมนูอื่นๆ ทั้งหมด
    document.querySelectorAll('.tenant-menu-dropdown').forEach((m) => {
      m.style.display = 'none';
    });

    if (!isVisible && button) {
      // คำนวณตำแหน่ง
      const rect = button.getBoundingClientRect();
      menu.style.top = `${rect.bottom + 4}px`;
      menu.style.left = `${rect.right - 200}px`; // 200px = min-width ของ menu
      menu.style.display = 'block';
    }
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
