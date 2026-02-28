/**
 * Manual Scan Page - Main Auto Deposit Interface
 */

// State
const state = {
  pendingList: [],
  filteredList: [],
  currentTenant: null,
  isAutoCredit: false
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initializePage();
});

/**
 * Initialize page
 */
function initializePage() {
  // Load tenant
  state.currentTenant = APIService.getSelectedTenant();
  
  // Load auto credit setting
  state.isAutoCredit = localStorage.getItem(CONFIG.STORAGE_KEYS.AUTO_CREDIT_ENABLED) === 'true';
  
  // Update UI
  updateTenantDisplay();
  updateAutoCreditToggle();
  
  // Load pending list
  loadPendingList();
  
  // Attach event listeners
  attachEventListeners();
}

/**
 * Attach event listeners
 */
function attachEventListeners() {
  // File upload
  const fileInput = document.getElementById('slip-file-input');
  const uploadBtn = document.getElementById('upload-btn');
  
  if (fileInput && uploadBtn) {
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelect);
  }
  
  // Drag and drop
  const dropZone = document.getElementById('drop-zone');
  if (dropZone) {
    dropZone.addEventListener('dragover', handleDragOver);
    dropZone.addEventListener('drop', handleDrop);
  }
  
  // Auto credit toggle
  const autoToggle = document.getElementById('auto-credit-toggle');
  if (autoToggle) {
    autoToggle.addEventListener('change', handleAutoCreditToggle);
  }
  
  // Tenant selector
  const tenantSelect = document.getElementById('tenant-select');
  if (tenantSelect) {
    tenantSelect.addEventListener('change', handleTenantChange);
  }
}

/**
 * Handle file selection
 */
async function handleFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  await processSlipFile(file);
}

/**
 * Handle drag over
 */
function handleDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
}

/**
 * Handle drop
 */
async function handleDrop(event) {
  event.preventDefault();
  
  const file = event.dataTransfer.files[0];
  if (!file) return;
  
  await processSlipFile(file);
}

/**
 * Process SLIP file
 */
async function processSlipFile(file) {
  try {
    // Validate file
    if (!Utils.isValidImageFile(file)) {
      Utils.showToast('กรุณาเลือกไฟล์รูปภาพ (JPG, PNG) ขนาดไม่เกิน 5MB', 'error');
      return;
    }
    
    Utils.showLoading(true);
    
    // Get EasySlip key from tenant config
    const easyslipKey = state.currentTenant.easyslipKey;
    
    if (!easyslipKey) {
      Utils.showToast('ไม่พบ EasySlip API Key', 'error');
      Utils.showLoading(false);
      return;
    }
    
    // Verify SLIP
    const slipResult = await APIService.verifySlip(file, easyslipKey);
    
    // Process result
    await APIService.processSlipAndCredit(null, slipResult.data, false);
    
    // Reload pending list
    await loadPendingList();
    
    Utils.showLoading(false);
    
  } catch (error) {
    console.error('Process SLIP file failed:', error);
    Utils.showToast('เกิดข้อผิดพลาดในการอ่านสลิป', 'error');
    Utils.showLoading(false);
  }
}

/**
 * Load pending transactions list
 */
async function loadPendingList() {
  try {
    // TODO: Load from D1 database
    // For now, use empty array
    state.pendingList = [];
    
    // Filter by tenant
    filterPendingByTenant();
    
    // Render list
    renderPendingList();
    
  } catch (error) {
    console.error('Load pending list failed:', error);
    Utils.showToast('เกิดข้อผิดพลาดในการโหลดรายการ', 'error');
  }
}

/**
 * Filter pending by tenant
 */
function filterPendingByTenant() {
  state.filteredList = state.pendingList.filter(item => 
    item.tenantId === state.currentTenant.id
  );
}

/**
 * Render pending list
 */
function renderPendingList() {
  const container = document.getElementById('pending-list');
  if (!container) return;
  
  if (state.filteredList.length === 0) {
    container.innerHTML = '<div class="empty-state">ไม่มีรายการรอจับคู่</div>';
    return;
  }
  
  const html = state.filteredList.map(item => `
    <div class="pending-item" data-id="${item.id}">
      <div class="pending-info">
        <div class="pending-amount">${Utils.formatCurrency(item.amount)}</div>
        <div class="pending-sender">
          <strong>${Utils.sanitizeHTML(item.senderName)}</strong>
          <span>${Utils.sanitizeHTML(item.senderAccount)}</span>
        </div>
        <div class="pending-time">${Utils.formatDate(item.createdAt)}</div>
        <div class="pending-status status-${item.status}">
          ${CONFIG.STATUS[item.status.toUpperCase()] || item.status}
        </div>
      </div>
      <div class="pending-actions">
        ${item.status === 'pending' ? `
          <button onclick="showSearchUserModal('${item.id}')" class="btn btn-primary">
            ค้นหาผู้ใช้
          </button>
        ` : ''}
        ${item.status === 'matched' ? `
          <button onclick="manualCredit('${item.id}')" class="btn btn-success">
            เติมเครดิต
          </button>
        ` : ''}
        ${item.status === 'credited' ? `
          <button onclick="withdrawCredit('${item.id}')" class="btn btn-warning">
            ถอนเครดิต
          </button>
        ` : ''}
        <button onclick="removePending('${item.id}')" class="btn btn-danger">
          ลบ
        </button>
      </div>
    </div>
  `).join('');
  
  container.innerHTML = html;
}

/**
 * Show search user modal
 */
async function showSearchUserModal(pendingId) {
  const pending = state.filteredList.find(p => p.id === pendingId);
  if (!pending) return;
  
  // TODO: Implement modal UI
  const query = prompt('ค้นหาผู้ใช้ (username, phone, name):');
  if (!query) return;
  
  try {
    Utils.showLoading(true);
    
    const result = await APIService.searchUserMultiField(query);
    
    if (!result.found) {
      Utils.showToast('ไม่พบผู้ใช้', 'warning');
      Utils.showLoading(false);
      return;
    }
    
    // Confirm
    const confirmed = await Utils.confirm(
      `พบผู้ใช้: ${result.user.fullname}\nเติมเครดิต ${Utils.formatCurrency(pending.amount)} ?`
    );
    
    if (!confirmed) {
      Utils.showLoading(false);
      return;
    }
    
    // Add credit
    await APIService.addCredit({
      userId: result.user.id,
      amount: pending.amount,
      slipRef: pending.slipRef,
      category: result.category
    });
    
    // Remove from pending
    // TODO: Update D1
    
    Utils.showToast('เติมเครดิตสำเร็จ', 'success');
    await loadPendingList();
    
    Utils.showLoading(false);
    
  } catch (error) {
    console.error('Search user failed:', error);
    Utils.showToast('เกิดข้อผิดพลาด', 'error');
    Utils.showLoading(false);
  }
}

/**
 * Manual credit for matched pending
 */
async function manualCredit(pendingId) {
  const pending = state.filteredList.find(p => p.id === pendingId);
  if (!pending || !pending.userId) return;
  
  try {
    const confirmed = await Utils.confirm(
      `เติมเครดิต ${Utils.formatCurrency(pending.amount)} ?`
    );
    
    if (!confirmed) return;
    
    Utils.showLoading(true);
    
    await APIService.addCredit({
      userId: pending.userId,
      amount: pending.amount,
      slipRef: pending.slipRef,
      category: pending.userCategory
    });
    
    // TODO: Update D1
    
    Utils.showToast('เติมเครดิตสำเร็จ', 'success');
    await loadPendingList();
    
    Utils.showLoading(false);
    
  } catch (error) {
    console.error('Manual credit failed:', error);
    Utils.showToast('เกิดข้อผิดพลาด', 'error');
    Utils.showLoading(false);
  }
}

/**
 * Withdraw credit
 */
async function withdrawCredit(pendingId) {
  const pending = state.filteredList.find(p => p.id === pendingId);
  if (!pending || !pending.userId) return;
  
  try {
    const confirmed = await Utils.confirm(
      `ถอนเครดิต ${Utils.formatCurrency(pending.amount)} ?`
    );
    
    if (!confirmed) return;
    
    Utils.showLoading(true);
    
    await APIService.withdrawCredit({
      userId: pending.userId,
      amount: pending.amount,
      slipRef: pending.slipRef,
      category: pending.userCategory
    });
    
    // TODO: Update D1
    
    Utils.showToast('ถอนเครดิตสำเร็จ', 'success');
    await loadPendingList();
    
    Utils.showLoading(false);
    
  } catch (error) {
    console.error('Withdraw credit failed:', error);
    Utils.showToast('เกิดข้อผิดพลาด', 'error');
    Utils.showLoading(false);
  }
}

/**
 * Remove pending item
 */
async function removePending(pendingId) {
  try {
    const confirmed = await Utils.confirm('ลบรายการนี้?');
    
    if (!confirmed) return;
    
    Utils.showLoading(true);
    
    // TODO: Delete from D1
    
    Utils.showToast('ลบรายการสำเร็จ', 'success');
    await loadPendingList();
    
    Utils.showLoading(false);
    
  } catch (error) {
    console.error('Remove pending failed:', error);
    Utils.showToast('เกิดข้อผิดพลาด', 'error');
    Utils.showLoading(false);
  }
}

/**
 * Handle auto credit toggle
 */
function handleAutoCreditToggle(event) {
  state.isAutoCredit = event.target.checked;
  localStorage.setItem(CONFIG.STORAGE_KEYS.AUTO_CREDIT_ENABLED, state.isAutoCredit);
  
  Utils.showToast(
    state.isAutoCredit ? 'เปิดการเติมเครดิตอัตโนมัติ' : 'ปิดการเติมเครดิตอัตโนมัติ',
    'info'
  );
}

/**
 * Handle tenant change
 */
function handleTenantChange(event) {
  const tenantId = event.target.value;
  localStorage.setItem(CONFIG.STORAGE_KEYS.SELECTED_TENANT, tenantId);
  
  state.currentTenant = CONFIG.TENANTS.find(t => t.id === tenantId);
  
  updateTenantDisplay();
  filterPendingByTenant();
  renderPendingList();
  
  Utils.showToast(`เปลี่ยนเป็น ${state.currentTenant.name}`, 'info');
}

/**
 * Update tenant display
 */
function updateTenantDisplay() {
  const display = document.getElementById('tenant-display');
  if (display) {
    display.textContent = state.currentTenant.name;
  }
  
  const select = document.getElementById('tenant-select');
  if (select) {
    select.value = state.currentTenant.id;
  }
}

/**
 * Update auto credit toggle
 */
function updateAutoCreditToggle() {
  const toggle = document.getElementById('auto-credit-toggle');
  if (toggle) {
    toggle.checked = state.isAutoCredit;
  }
}
