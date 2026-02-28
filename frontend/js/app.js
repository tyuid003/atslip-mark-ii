// ============================================================
// APPLICATION STATE
// ============================================================

let currentTenants = [];
let currentTenantId = null;
let currentLineOAs = [];
let notifications = [];
let unreadCount = 0;

// ============================================================
// INITIALIZATION
// ============================================================

async function init() {
  bindUploadEvents();
  await loadTenants();
  await loadPendingTransactions();
  initializeNotifications();
}

// ============================================================
// TENANT MANAGEMENT
// ============================================================

async function loadTenants() {
  try {
    UI.showLoading();
    const response = await api.getTenants();
    currentTenants = response.data || [];
    UI.renderTenants(currentTenants);
  } catch (error) {
    addNotification('❌ ไม่สามารถโหลดข้อมูล: ' + error.message);
  } finally {
    UI.hideLoading();
  }
}

function openCreateTenantModal() {
  currentTenantId = null;
  document.getElementById('tenantModalTitle').textContent = 'เพิ่มเว็บใหม่';
  document.getElementById('tenantForm').reset();
  document.getElementById('tenantId').value = '';
  document.getElementById('tenantModal').style.display = 'flex';
  lucide.createIcons();
}

async function openEditTenantModal(tenantId) {
  try {
    currentTenantId = tenantId;
    const response = await api.getTenant(tenantId);
    const tenant = response.data;

    document.getElementById('tenantModalTitle').textContent = 'แก้ไขเว็บ';
    document.getElementById('tenantId').value = tenant.id;
    document.getElementById('tenantName').value = tenant.name;
    document.getElementById('adminApiUrl').value = tenant.admin_api_url;
    document.getElementById('adminUsername').value = tenant.admin_username;
    document.getElementById('adminPassword').value = tenant.admin_password;
    document.getElementById('easyslipToken').value = tenant.easyslip_token;

    document.getElementById('tenantModal').style.display = 'flex';
    lucide.createIcons();
  } catch (error) {
    addNotification('❌ ไม่สามารถโหลดข้อมูล: ' + error.message);
  }
}

function closeTenantModal() {
  document.getElementById('tenantModal').style.display = 'none';
}

async function saveTenant() {
  const tenantId = document.getElementById('tenantId').value;
  const name = document.getElementById('tenantName').value;
  const admin_api_url = document.getElementById('adminApiUrl').value;
  const admin_username = document.getElementById('adminUsername').value;
  const admin_password = document.getElementById('adminPassword').value;
  const easyslip_token = document.getElementById('easyslipToken').value;

  if (!name || !admin_api_url || !admin_username || !admin_password || !easyslip_token) {
    addNotification('⚠️ กรุณากรอกข้อมูลให้ครบถ้วน');
    return;
  }

  const data = {
    name,
    admin_api_url,
    admin_username,
    admin_password,
    easyslip_token,
  };

  try {
    const saveBtn = document.getElementById('saveTenantBtn');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<div class="loading"></div> กำลังบันทึก...';

    if (tenantId) {
      await api.updateTenant(tenantId, data);
      addNotification('✅ อัพเดท tenant สำเร็จ');
    } else {
      await api.createTenant(data);
      addNotification(`✅ มี tenant ใหม่: ${name}`);
    }

    closeTenantModal();
    await loadTenants();
  } catch (error) {
    addNotification('❌ เกิดข้อผิดพลาด: ' + error.message);
  } finally {
    const saveBtn = document.getElementById('saveTenantBtn');
    saveBtn.disabled = false;
    saveBtn.innerHTML = '<i data-lucide="save"></i> บันทึก';
    lucide.createIcons();
  }
}

async function deleteTenant(tenantId, tenantName) {
  if (!confirm(`คุณต้องการลบเว็บ "${tenantName}" หรือไม่?\n\nการดำเนินการนี้จะลบข้อมูลทั้งหมดรวมถึง LINE OA และไม่สามารถกู้คืนได้`)) {
    return;
  }

  try {
    await api.deleteTenant(tenantId);
    addNotification(`✅ ลบ tenant: ${tenantName}`);
    await loadTenants();
  } catch (error) {
    addNotification('❌ เกิดข้อผิดพลาด: ' + error.message);
  }
}

// ============================================================
// TENANT SLIDER
// ============================================================

function scrollTenants(direction) {
  const container = document.getElementById('tenantGrid');
  const distance = 320;
  if (!container) {
    return;
  }

  if (direction === 'left') {
    container.scrollBy({ left: -distance, behavior: 'smooth' });
  } else {
    container.scrollBy({ left: distance, behavior: 'smooth' });
  }
}

// ============================================================
// ADMIN CONNECTION
// ============================================================

async function connectAdmin(tenantId) {
  const tenant = currentTenants.find((t) => t.id === tenantId);

  if (!confirm(`คุณต้องการเชื่อมต่อกับ Admin Backend ของ "${tenant.name}" หรือไม่?\n\nระบบจะทำการ Login และดึงรายชื่อบัญชีธนาคารมาเก็บไว้`)) {
    return;
  }

  try {
    addNotification('⏳ กำลังเชื่อมต่อ...');
    const response = await api.connectAdmin(tenantId);
    addNotification(`✅ เชื่อมต่อสำเร็จ! พบบัญชีธนาคาร ${response.data.account_count} บัญชี`);
    await loadTenants();
  } catch (error) {
    addNotification('❌ เชื่อมต่อล้มเหลว: ' + error.message);
  }
}

async function disconnectAdmin(tenantId) {
  const tenant = currentTenants.find((t) => t.id === tenantId);

  if (!confirm(`คุณต้องการยกเลิกการเชื่อมต่อกับ Admin Backend ของ "${tenant.name}" หรือไม่?\n\nข้อมูลบัญชีธนาคารจะถูกลบออก`)) {
    return;
  }

  try {
    await api.disconnectAdmin(tenantId);
    addNotification(`✅ ยกเลิกการเชื่อมต่อ: ${tenant.name}`);
    await loadTenants();
  } catch (error) {
    addNotification('❌ เกิดข้อผิดพลาด: ' + error.message);
  }
}

// ============================================================
// BANK ACCOUNTS
// ============================================================

async function viewBankAccounts(tenantId) {
  try {
    const response = await api.getBankAccounts(tenantId);
    const accounts = response.data || [];

    let html = '';

    if (accounts.length === 0) {
      html = '<div class="text-center text-muted">ไม่พบบัญชีธนาคาร<br>กรุณาเชื่อมต่อ Admin Backend ก่อน</div>';
    } else {
      html = '<div style="display: flex; flex-direction: column; gap: var(--space-md);">';
      accounts.forEach((account) => {
        html += `
          <div class="card">
            <div class="card-body">
              <div style="display: flex; align-items: center; gap: var(--space-md);">
                <div style="
                  width: 48px;
                  height: 48px;
                  background: var(--color-primary-light);
                  color: var(--color-primary);
                  border-radius: var(--radius-md);
                  display: flex;
                  align-items: center;
                  justify-content: center;
                ">
                  <i data-lucide="building" size="24"></i>
                </div>
                <div style="flex: 1;">
                  <div style="font-weight: 600; margin-bottom: 4px;">${account.accountName}</div>
                  <div style="font-family: var(--font-mono); color: var(--color-gray-600);">${account.accountNumber}</div>
                  ${account.bankName ? `<div style="font-size: 0.875rem; color: var(--color-gray-500);">${account.bankName}</div>` : ''}
                </div>
              </div>
            </div>
          </div>
        `;
      });
      html += '</div>';
    }

    document.getElementById('bankAccountsList').innerHTML = html;
    document.getElementById('bankAccountsModal').style.display = 'flex';
    lucide.createIcons();
  } catch (error) {
    addNotification('❌ ไม่สามารถโหลดข้อมูล: ' + error.message);
  }
}

function closeBankAccountsModal() {
  document.getElementById('bankAccountsModal').style.display = 'none';
}

// ============================================================
// LINE OA MANAGEMENT
// ============================================================

async function manageLineOAs(tenantId) {
  currentTenantId = tenantId;

  try {
    const response = await api.getLineOAs(tenantId);
    currentLineOAs = response.data || [];

    renderLineOAList();
    document.getElementById('lineOAModal').style.display = 'flex';
    lucide.createIcons();
  } catch (error) {
    addNotification('❌ ไม่สามารถโหลดข้อมูล: ' + error.message);
  }
}

function renderLineOAList() {
  let html = '';

  if (currentLineOAs.length === 0) {
    html = '<div class="text-center text-muted">ยังไม่มี LINE OA</div>';
  } else {
    html = '<div style="display: flex; flex-direction: column; gap: var(--space-md);">';
    currentLineOAs.forEach((lineOA) => {
      const statusBadge = lineOA.status === 'active'
        ? '<span class="badge badge-success">ใช้งาน</span>'
        : '<span class="badge badge-gray">ปิดใช้งาน</span>';

      const webhookBadge = lineOA.webhook_enabled
        ? '<span class="badge badge-info">Webhook ON</span>'
        : '<span class="badge badge-gray">Webhook OFF</span>';

      html += `
        <div class="card">
          <div class="card-body">
            <div style="display: flex; justify-content: space-between; align-items: start;">
              <div style="flex: 1;">
                <div style="font-weight: 600; margin-bottom: 4px; display: flex; align-items: center; gap: var(--space-sm);">
                  <i data-lucide="message-circle" size="16"></i>
                  ${lineOA.name}
                </div>
                <div style="font-family: var(--font-mono); color: var(--color-gray-600); font-size: 0.875rem; margin-bottom: var(--space-sm);">
                  ${lineOA.channel_id}
                </div>
                <div style="display: flex; gap: var(--space-sm);">
                  ${statusBadge}
                  ${webhookBadge}
                </div>
              </div>
              <button class="btn btn-danger btn-sm" onclick="deleteLineOA('${lineOA.id}', '${lineOA.name}')">
                <i data-lucide="trash-2" size="14"></i>
              </button>
            </div>
          </div>
        </div>
      `;
    });
    html += '</div>';
  }

  document.getElementById('lineOAList').innerHTML = html;
  lucide.createIcons();
}

function closeLineOAModal() {
  document.getElementById('lineOAModal').style.display = 'none';
}

function openAddLineOAModal() {
  const name = prompt('ชื่อ LINE OA:');
  if (!name) return;

  const channel_id = prompt('Channel ID:');
  if (!channel_id) return;

  const channel_secret = prompt('Channel Secret:');
  if (!channel_secret) return;

  const channel_access_token = prompt('Channel Access Token:');
  if (!channel_access_token) return;

  createLineOA({ name, channel_id, channel_secret, channel_access_token });
}

async function createLineOA(data) {
  try {
    await api.createLineOA(currentTenantId, data);
    addNotification('✅ เพิ่ม LINE OA สำเร็จ');
    await manageLineOAs(currentTenantId);
    await loadTenants();
  } catch (error) {
    addNotification('❌ เกิดข้อผิดพลาด: ' + error.message);
  }
}

async function deleteLineOA(lineOAId, lineOAName) {
  if (!confirm(`คุณต้องการลบ LINE OA "${lineOAName}" หรือไม่?`)) {
    return;
  }

  try {
    await api.deleteLineOA(lineOAId);
    addNotification(`✅ ลบ LINE OA: ${lineOAName}`);
    await manageLineOAs(currentTenantId);
    await loadTenants();
  } catch (error) {
    addNotification('❌ เกิดข้อผิดพลาด: ' + error.message);
  }
}

// ============================================================
// PENDING TRANSACTIONS
// ============================================================

async function loadPendingTransactions() {
  try {
    const response = await api.getPendingTransactions(50);
    const list = response.data || [];
    UI.renderPendingTransactions(list.slice(0, 50));
  } catch (error) {
    UI.renderPendingTransactions([]);
  }
}

// ============================================================
// SLIP UPLOAD (UI ONLY)
// ============================================================

function bindUploadEvents() {
  const dropzone = document.getElementById('slipDropzone');
  const input = document.getElementById('slipUploadInput');

  if (!dropzone || !input) {
    return;
  }

  dropzone.addEventListener('click', () => input.click());

  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    handleSelectedSlip(file);
  });

  dropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
  });

  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files && event.dataTransfer.files[0];
    handleSelectedSlip(file);
  });
}

function openSlipPicker() {
  document.getElementById('slipUploadInput')?.click();
}

function handleSelectedSlip(file) {
  if (!file) {
    return;
  }

  // แสดงชื่อไฟล์
  const hint = document.getElementById('slipUploadHint');
  if (hint) {
    hint.textContent = `ไฟล์ที่เลือก: ${file.name}`;
  }

  // แสดง preview รูปภาพ
  const dropzone = document.getElementById('slipDropzone');
  if (file.type.startsWith('image/') && dropzone) {
    const reader = new FileReader();
    reader.onload = (e) => {
      dropzone.innerHTML = `
        <div class="upload-preview">
          <img src="${e.target.result}" alt="Preview" class="upload-preview-image">
          <div class="upload-preview-info">
            <p class="upload-file-name">${file.name}</p>
            <button class="btn btn-sm btn-secondary" onclick="resetSlipUpload()">
              <i data-lucide="x"></i> ลบ
            </button>
          </div>
        </div>
      `;
      lucide.createIcons();
    };
    reader.readAsDataURL(file);
  }

  addNotification(`📄 อัพโหลดสลิป: ${file.name}`);
}

function resetSlipUpload() {
  const dropzone = document.getElementById('slipDropzone');
  const input = document.getElementById('slipUploadInput');
  
  if (input) {
    input.value = '';
  }
  
  if (dropzone) {
    dropzone.innerHTML = `
      <i data-lucide="upload-cloud"></i>
      <p>ลากไฟล์สลิปมาวาง หรือคลิกเพื่อเลือกไฟล์</p>
    `;
    lucide.createIcons();
    bindUploadEvents();
  }
}

// ============================================================
// NOTIFICATIONS
// ============================================================

function initializeNotifications() {
  // โหลด notifications จาก localStorage
  const saved = localStorage.getItem('atslip_notifications');
  if (saved) {
    try {
      notifications = JSON.parse(saved);
      // จำกัดสูงสุด 99 รายการ
      if (notifications.length > 99) {
        notifications = notifications.slice(0, 99);
      }
    } catch (e) {
      notifications = [];
    }
  } else {
    notifications = [];
  }
  
  unreadCount = 0;
  UI.renderNotifications(notifications);
  updateNotificationBadge();
}

function addNotification(title) {
  const time = new Date().toLocaleString('th-TH');
  notifications.unshift({ title, time });
  
  // จำกัดสูงสุด 99 รายการ
  if (notifications.length > 99) {
    notifications = notifications.slice(0, 99);
  }

  // บันทึกลง localStorage
  try {
    localStorage.setItem('atslip_notifications', JSON.stringify(notifications));
  } catch (e) {
    console.warn('ไม่สามารถบันทึก notifications ลง localStorage:', e);
  }

  unreadCount = Math.min(unreadCount + 1, 99);
  UI.renderNotifications(notifications);
  updateNotificationBadge();
}

function updateNotificationBadge() {
  const badge = document.getElementById('notificationBadge');
  if (!badge) {
    return;
  }

  if (unreadCount <= 0) {
    badge.style.display = 'none';
    return;
  }

  badge.textContent = String(unreadCount);
  badge.style.display = 'flex';
}

function toggleNotificationDropdown() {
  const dropdown = document.getElementById('notificationDropdown');
  if (!dropdown) {
    return;
  }

  const isOpen = dropdown.style.display === 'block';
  dropdown.style.display = isOpen ? 'none' : 'block';

  if (!isOpen) {
    unreadCount = 0;
    updateNotificationBadge();
  }
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function toggleTenantMenu(tenantId) {
  UI.toggleTenantMenu(tenantId);
}

// Track pending toggle states
const pendingToggleStates = new Map();
// Export to global for UI access
window.pendingToggleStates = pendingToggleStates;

async function toggleAutoDeposit(tenantId, enabled) {
  const toggle = document.getElementById(`toggle-${tenantId}`);
  
  try {
    // จำสถานะที่ user เพิ่งกด
    pendingToggleStates.set(tenantId, enabled);
    
    // Optimistic update - แสดงผลทันที
    const response = await api.toggleAutoDeposit(tenantId, enabled);
    addNotification(`${enabled ? '✅ เปิด' : '❌ ปิด'} Auto Deposit สำหรับ tenant`);
    
    // Reload ในเบื้องหลังเพื่ออัพเดท UI ทั้งหมด
    await loadTenants();
    
    // ลบสถานะที่จำไว้หลัง reload สำเร็จ
    pendingToggleStates.delete(tenantId);
  } catch (error) {
    // ลบสถานะที่จำไว้
    pendingToggleStates.delete(tenantId);
    
    // Revert toggle ถ้า API error
    if (toggle) {
      toggle.checked = !enabled;
    }
    addNotification('❌ ไม่สามารถเปลี่ยนสถานะ Auto Deposit: ' + error.message);
  }
}

function openPendingFilter() {
  const tenantName = prompt('ค้นหาชื่อเว็บ (เว้นว่างเพื่อไม่กรอง):');
  let filtered = [];
  
  try {
    const response = api.getPendingTransactions(50);
    if (tenantName && tenantName.trim()) {
      // Filter by tenant name or website name
      console.log('Filtering by:', tenantName);
    }
    // TODO: Implement actual filtering when backend supports it
    addNotification('filters: ' + (tenantName || 'ทั้งหมด'));
  } catch (error) {
    addNotification('❌ ไม่สามารถโหลดข้อมูล');
  }
}

// ============================================================
// START APPLICATION
// ============================================================

document.addEventListener('DOMContentLoaded', init);
