// ============================================================
// APPLICATION STATE
// ============================================================

let currentTenants = [];
let currentTenantId = null;
let currentLineOAs = [];

// ============================================================
// INITIALIZATION
// ============================================================

async function init() {
  await loadTenants();
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
    UI.showToast('ไม่สามารถโหลดข้อมูลได้: ' + error.message, 'error');
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
    UI.showToast('ไม่สามารถโหลดข้อมูลได้: ' + error.message, 'error');
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
    UI.showToast('กรุณากรอกข้อมูลให้ครบถ้วน', 'warning');
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
      UI.showToast('อัพเดทสำเร็จ', 'success');
    } else {
      await api.createTenant(data);
      UI.showToast('เพิ่มเว็บใหม่สำเร็จ', 'success');
    }

    closeTenantModal();
    await loadTenants();
  } catch (error) {
    UI.showToast('เกิดข้อผิดพลาด: ' + error.message, 'error');
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
    UI.showToast('ลบสำเร็จ', 'success');
    await loadTenants();
  } catch (error) {
    UI.showToast('เกิดข้อผิดพลาด: ' + error.message, 'error');
  }
}

// ============================================================
// ADMIN CONNECTION
// ============================================================

async function connectAdmin(tenantId) {
  const tenant = currentTenants.find(t => t.id === tenantId);
  
  if (!confirm(`คุณต้องการเชื่อมต่อกับ Admin Backend ของ "${tenant.name}" หรือไม่?\n\nระบบจะทำการ Login และดึงรายชื่อบัญชีธนาคารมาเก็บไว้`)) {
    return;
  }

  try {
    UI.showToast('กำลังเชื่อมต่อ...', 'info');
    const response = await api.connectAdmin(tenantId);
    UI.showToast(`เชื่อมต่อสำเร็จ! พบบัญชีธนาคาร ${response.data.account_count} บัญชี`, 'success');
    await loadTenants();
  } catch (error) {
    UI.showToast('เชื่อมต่อล้มเหลว: ' + error.message, 'error');
  }
}

async function disconnectAdmin(tenantId) {
  const tenant = currentTenants.find(t => t.id === tenantId);
  
  if (!confirm(`คุณต้องการยกเลิกการเชื่อมต่อกับ Admin Backend ของ "${tenant.name}" หรือไม่?\n\nข้อมูลบัญชีธนาคารจะถูกลบออก`)) {
    return;
  }

  try {
    await api.disconnectAdmin(tenantId);
    UI.showToast('ยกเลิกการเชื่อมต่อสำเร็จ', 'success');
    await loadTenants();
  } catch (error) {
    UI.showToast('เกิดข้อผิดพลาด: ' + error.message, 'error');
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
      accounts.forEach(account => {
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
    UI.showToast('ไม่สามารถโหลดข้อมูลได้: ' + error.message, 'error');
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
    UI.showToast('ไม่สามารถโหลดข้อมูลได้: ' + error.message, 'error');
  }
}

function renderLineOAList() {
  let html = '';
  
  if (currentLineOAs.length === 0) {
    html = '<div class="text-center text-muted">ยังไม่มี LINE OA</div>';
  } else {
    html = '<div style="display: flex; flex-direction: column; gap: var(--space-md);">';
    currentLineOAs.forEach(lineOA => {
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
    UI.showToast('เพิ่ม LINE OA สำเร็จ', 'success');
    await manageLineOAs(currentTenantId);
    await loadTenants();
  } catch (error) {
    UI.showToast('เกิดข้อผิดพลาด: ' + error.message, 'error');
  }
}

async function deleteLineOA(lineOAId, lineOAName) {
  if (!confirm(`คุณต้องการลบ LINE OA "${lineOAName}" หรือไม่?`)) {
    return;
  }
  
  try {
    await api.deleteLineOA(lineOAId);
    UI.showToast('ลบสำเร็จ', 'success');
    await manageLineOAs(currentTenantId);
    await loadTenants();
  } catch (error) {
    UI.showToast('เกิดข้อผิดพลาด: ' + error.message, 'error');
  }
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function toggleTenantMenu(tenantId) {
  UI.toggleTenantMenu(tenantId);
}

// ============================================================
// START APPLICATION
// ============================================================

document.addEventListener('DOMContentLoaded', init);
