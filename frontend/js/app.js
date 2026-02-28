// ============================================================
// APPLICATION STATE
// ============================================================

let currentTeamSlug = null; // team slug จาก URL
let currentTenants = [];
let currentTenantId = null;
let currentLineOAs = [];
let notifications = [];
let unreadCount = 0;

// ============================================================
// INITIALIZATION
// ============================================================

async function init() {
  // ดึง team slug จาก URL
  currentTeamSlug = window.getTeamFromURL();
  window.currentTeamSlug = currentTeamSlug; // export เป็น global variable
  console.log('Current Team Slug:', currentTeamSlug);
  
  // อัพเดท page title และ badge ถ้าไม่ใช่ default team
  if (currentTeamSlug !== 'default') {
    try {
      // ดึงข้อมูล team จาก API
      const response = await api.getTeamBySlug(currentTeamSlug);
      const teamData = response.data;
      
      // อัพเดท page title ด้วยชื่อทีม
      document.title = `${teamData.name} - ATslip Auto Deposit`;
      
      // แสดง team badge ด้วยชื่อทีม
      const teamBadge = document.getElementById('teamBadge');
      if (teamBadge) {
        teamBadge.textContent = teamData.name;
        teamBadge.style.display = 'inline-block';
      }
    } catch (error) {
      console.error('Error loading team data:', error);
      // ถ้า error ใช้ slug แทน
      document.title = `${currentTeamSlug.toUpperCase()} - ATslip Auto Deposit`;
      const teamBadge = document.getElementById('teamBadge');
      if (teamBadge) {
        teamBadge.textContent = currentTeamSlug;
        teamBadge.style.display = 'inline-block';
      }
    }
  }
  
  bindUploadEvents();
  await loadTenants();
  await loadPendingTransactions();
  initializeNotifications();
}

// รีเฟรชเมื่อ hash เปลี่ยน (สำหรับ team switching)
window.addEventListener('hashchange', () => {
  const newTeamSlug = window.getTeamFromURL();
  if (newTeamSlug !== currentTeamSlug) {
    currentTeamSlug = newTeamSlug;
    window.currentTeamSlug = currentTeamSlug;
    console.log('Team changed to:', currentTeamSlug);
    window.location.reload(); // reload หน้าใหม่เมื่อเปลี่ยน team
  }
});

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

let currentLoginTenant = null;
let currentCaptchaKey = null;

async function connectAdmin(tenantId) {
  const tenant = currentTenants.find((t) => t.id === tenantId);
  if (!tenant) return;

  currentLoginTenant = tenant;
  
  // เปิด login modal
  const modal = document.getElementById('adminLoginModal');
  const tenantNameEl = document.getElementById('loginTenantName');
  const usernameEl = document.getElementById('loginUsername');
  const passwordEl = document.getElementById('loginPassword');
  const captchaInputEl = document.getElementById('captchaInput');
  
  tenantNameEl.textContent = `เชื่อมต่อ: ${tenant.name}`;
  usernameEl.value = tenant.admin_username || '';
  passwordEl.value = tenant.admin_password || '';
  captchaInputEl.value = '';
  
  // เพิ่ม Enter key handler สำหรับ captcha input
  captchaInputEl.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitAdminLogin();
    }
  };
  
  modal.style.display = 'flex';
  lucide.createIcons();
  
  // โหลด captcha
  await loadCaptcha(tenant);
}

function closeAdminLoginModal() {
  const modal = document.getElementById('adminLoginModal');
  modal.style.display = 'none';
  currentLoginTenant = null;
  currentCaptchaKey = null;
}

async function loadCaptcha(tenant) {
  const container = document.getElementById('captchaImageContainer');
  
  // แสดง loading
  container.innerHTML = `
    <div class="captcha-loading">
      <i data-lucide="loader" class="spin-icon"></i>
      <p>กำลังโหลด captcha...</p>
    </div>
  `;
  lucide.createIcons();
  
  try {
    // เรียก captcha จาก admin API
    const response = await api.getCaptcha(tenant.id);
    
    if (response.success && response.data) {
      currentCaptchaKey = response.data.captcha_key;
      
      // แสดงรูป captcha
      container.innerHTML = `
        <img src="${response.data.captcha_image}" alt="Captcha" />
      `;
    } else {
      throw new Error('โหลด captcha ล้มเหลว');
    }
  } catch (error) {
    container.innerHTML = `
      <div class="captcha-loading">
        <i data-lucide="alert-circle"></i>
        <p>ไม่สามารถโหลด captcha ได้</p>
      </div>
    `;
    lucide.createIcons();
    addNotification('❌ ไม่สามารถโหลด captcha: ' + error.message);
  }
}

async function refreshCaptcha() {
  if (!currentLoginTenant) return;
  await loadCaptcha(currentLoginTenant);
  const input = document.getElementById('captchaInput');
  input.value = '';
  input.focus();
}

async function submitAdminLogin() {
  if (!currentLoginTenant || !currentCaptchaKey) {
    addNotification('❌ ข้อมูลไม่ครบถ้วน');
    return;
  }
  
  const captchaInput = document.getElementById('captchaInput').value.trim();
  
  if (!captchaInput) {
    addNotification('❌ กรุณากรอกรหัส captcha');
    return;
  }
  
  const submitBtn = document.getElementById('loginSubmitBtn');
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i data-lucide="loader" class="spin-icon"></i> กำลังเข้าสู่ระบบ...';
  lucide.createIcons();
  
  try {
    const response = await api.loginAdmin(currentLoginTenant.id, {
      captcha_key: currentCaptchaKey,
      captcha_code: captchaInput,
    });
    
    if (response.success) {
      addNotification(`✅ เชื่อมต่อสำเร็จ! พบบัญชีธนาคาร ${response.data.account_count || 0} บัญชี`);
      closeAdminLoginModal();
      await loadTenants();
    } else {
      throw new Error(response.error || 'เข้าสู่ระบบล้มเหลว');
    }
  } catch (error) {
    addNotification('❌ เข้าสู่ระบบล้มเหลว: ' + error.message);
    // โหลด captcha ใหม่
    await refreshCaptcha();
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i data-lucide="log-in"></i> เข้าสู่ระบบ';
    lucide.createIcons();
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
  currentTenantId = tenantId;
  
  // ปิด dropdown menu ก่อนเปิด popup
  document.querySelectorAll('.tenant-menu-dropdown').forEach((m) => {
    m.style.display = 'none';
  });
  
  try {
    const response = await api.getBankAccounts(tenantId);
    const bankData = response.data || {};
    const accounts = bankData.accounts || [];

    // ดึง metadata จาก D1 ด้วย
    let metadata = [];
    try {
      const metadataResponse = await api.getBankAccountsMetadata(tenantId);
      metadata = (metadataResponse.data || {}).accounts || [];
    } catch (err) {
      console.log('No metadata found');
    }

    renderBankAccountsList(accounts, metadata);
    document.getElementById('bankAccountsModal').style.display = 'flex';
    lucide.createIcons();
  } catch (error) {
    addNotification('❌ ไม่สามารถโหลดข้อมูล: ' + error.message);
  }
}

function renderBankAccountsList(accounts, metadata = []) {
  let html = '';

  if (accounts.length === 0) {
    html = '<div class="bank-accounts-empty"><i data-lucide="inbox" size="48" style="color: var(--color-gray-400); margin-bottom: var(--space-md);"></i><p>ไม่พบบัญชีธนาคาร</p><p style="font-size: 0.875rem; color: var(--color-gray-500);">กรุณาเชื่อมต่อ Admin Backend ก่อน</p></div>';
  } else {
    accounts.forEach((account) => {
      // ใช้ accountNumber เป็น unique identifier (เพราะ id คือ bank id ไม่ใช่ account id)
      const accountId = String(account.accountNumber || account.id || '');
      console.log('[renderBankAccountsList] Account:', {
        id: account.id,
        accountId: account.accountId,
        accountNumber: account.accountNumber,
        using: accountId,
      });
      const meta = metadata.find(m => m.account_id === accountId);
      const englishName = meta?.account_name_en || '';
      const metaId = meta?.id || '';

      html += `
        <div class="bank-account-item">
          <div style="display: flex; align-items: center; gap: var(--space-sm); width: 100%;">
            <img src="${account.bankIconUrl || ''}" alt="${account.bankName || 'Bank'}" class="bank-icon" onerror="this.style.display='none'">
            <div class="bank-info" style="flex: 1;">
              <div class="bank-name">${account.accountName || 'ไม่ระบุชื่อ'}</div>
              <div class="bank-number">${account.accountNumber || '-'}</div>
              ${account.bankName ? `<div style="font-size: 0.875rem; color: var(--color-gray-500); margin-top: 2px;">${account.bankName}</div>` : ''}
              ${metaId ? `
              <div style="margin-top: var(--space-xs);">
                <label style="font-size: 0.75rem; color: var(--color-gray-600); display: block; margin-bottom: 4px;">ชื่อภาษาอังกฤษ</label>
                <div style="display: flex; gap: var(--space-xs);">
                  <input 
                    type="text" 
                    value="${englishName}" 
                    placeholder="Enter English name" 
                    id="en-name-${metaId}"
                    style="flex: 1; padding: 6px var(--space-sm); border: 1px solid var(--color-border); border-radius: var(--radius-sm); font-size: 0.875rem;"
                  >
                  <button 
                    class="btn btn-sm btn-primary" 
                    onclick="updateEnglishName('${metaId}')"
                    style="padding: 6px var(--space-sm);"
                  >
                    <i data-lucide="check" size="14"></i> บันทึก
                  </button>
                </div>
              </div>
              ` : ''}
            </div>
            ${!metaId ? `
            <button 
              class="btn btn-sm" 
              onclick="addEnglishName('${accountId}')" 
              style="padding: 6px var(--space-sm); background: var(--color-gray-100); border: 1px solid var(--color-border); white-space: nowrap;"
              title="เพิ่มชื่ออังกฤษสำหรับบัญชีนี้"
            >
              <i data-lucide="plus" size="14"></i> เพิ่มชื่ออังกฤษ
            </button>
            ` : ''}
          </div>
        </div>
      `;
    });
  }

  document.getElementById('bankAccountsList').innerHTML = html;
  lucide.createIcons();
}

async function refreshBankAccountsNow() {
  if (!currentTenantId) return;

  const refreshIcon = document.getElementById('refreshBankIcon');
  const listContainer = document.getElementById('bankAccountsList');

  try {
    // แสดง loading animation
    refreshIcon.classList.add('spin-icon');
    listContainer.innerHTML = '<div class="bank-accounts-loading"><i data-lucide="loader" size="32" class="spin-icon"></i><p style="margin-top: var(--space-md);">กำลังรีเฟรชข้อมูล...</p></div>';
    lucide.createIcons();

    const response = await api.refreshBankAccounts(currentTenantId);
    const bankData = response.data || {};
    
    // แสดงข้อความสำเร็จ
    addNotification(`✅ รีเฟรชบัญชีธนาคารสำเร็จ (${bankData.account_count} บัญชี)`);

    // โหลดข้อมูลใหม่
    const accountsResponse = await api.getBankAccounts(currentTenantId);
    const accounts = (accountsResponse.data || {}).accounts || [];
    
    // ดึง metadata ด้วย
    let metadata = [];
    try {
      const metadataResponse = await api.getBankAccountsMetadata(currentTenantId);
      metadata = (metadataResponse.data || {}).accounts || [];
    } catch (err) {
      console.log('No metadata');
    }
    
    renderBankAccountsList(accounts, metadata);

    // รีเฟรชรายการ tenant เพื่ออัพเดทสถานะ
    await loadTenants();
  } catch (error) {
    addNotification('❌ ไม่สามารถรีเฟรชข้อมูลได้: ' + error.message);
    
    // ถ้า error แสดงว่า session หมดอายุ ให้อัพเดทสถานะเป็นไม่เชื่อมต่อ
    if (error.message.includes('Session expired') || error.message.includes('401')) {
      listContainer.innerHTML = '<div class="bank-accounts-empty"><i data-lucide="alert-circle" size="48" style="color: var(--color-error); margin-bottom: var(--space-md);"></i><p>เซสชันหมดอายุ</p><p style="font-size: 0.875rem; color: var(--color-gray-500);">กรุณา Login ใหม่</p></div>';
      await loadTenants(); // รีเฟรชเพื่ออัพเดทสถานะเชื่อมต่อ
    } else {
      // แสดงบัญชีเดิมที่มีอยู่
      const accountsResponse = await api.getBankAccounts(currentTenantId);
      const accounts = (accountsResponse.data || {}).accounts || [];
      let metadata = [];
      try {
        const metadataResponse = await api.getBankAccountsMetadata(currentTenantId);
        metadata = (metadataResponse.data || {}).accounts || [];
      } catch (err) {}
      renderBankAccountsList(accounts, metadata);
    }
    lucide.createIcons();
  } finally {
    refreshIcon.classList.remove('spin-icon');
  }
}

async function addEnglishName(accountId) {
  if (!currentTenantId) return;

  try {
    console.log('[addEnglishName] Creating metadata for account:', accountId);
    addNotification('📄 กำลังเพิ่มข้อมูลบัญชี...');

    const response = await api.createBankAccountMetadata(currentTenantId, accountId);
    const data = response.data || {};

    if (data.exists) {
      addNotification('ℹ️ ข้อมูลมีอยู่แล้ว');
    } else {
      addNotification('✅ เพิ่มข้อมูลบัญชีสำเร็จ! ตอนนี้สามารถกรอกชื่ออังกฤษได้แล้ว');
    }

    // Reload bank accounts with metadata
    await viewBankAccounts(currentTenantId);
  } catch (error) {
    console.error('[addEnglishName] Error:', error);
    addNotification('❌ ไม่สามารถเพิ่มข้อมูลได้: ' + error.message);
  }
}

async function syncBankMetadata() {
  if (!currentTenantId) return;

  try {
    addNotification('🔄 กำลังเพิ่มข้อมูลบัญชีธนาคาร...');

    const response = await api.syncBankAccounts(currentTenantId);
    const data = response.data || {};

    if (data.synced > 0) {
      addNotification(`✅ เพิ่มข้อมูล ${data.synced} บัญชีสำเร็จ! ตอนนี้สามารถเพิ่มชื่ออังกฤษได้แล้ว`);
    } else {
      addNotification(`ℹ️ ข้อมูลบัญชีครบแล้ว (${data.updated} บัญชี)`);
    }

    // Reload bank accounts with metadata
    await viewBankAccounts(currentTenantId);
  } catch (error) {
    addNotification('❌ ไม่สามารถเพิ่มข้อมูลได้: ' + error.message);
  }
}

async function updateEnglishName(metaId) {
  const input = document.getElementById(`en-name-${metaId}`);
  if (!input) return;

  const englishName = input.value.trim();
  if (!englishName) {
    addNotification('❌ กรุณากรอกชื่อภาษาอังกฤษ');
    return;
  }

  try {
    await api.updateEnglishName(metaId, englishName);
    addNotification(`✅ บันทึกชื่อภาษาอังกฤษสำเร็จ`);
  } catch (error) {
    addNotification('❌ บันทึกไม่สำเร็จ: ' + error.message);
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

      // สร้าง webhook URL
      const webhookUrl = `${API_CONFIG.BASE_URL}/webhook/${currentTenantId}/${lineOA.id}`;

      html += `
        <div class="card">
          <div class="card-body">
            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: var(--space-md);">
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
            
            <!-- Webhook URL Section -->
            <div style="background: var(--color-gray-50); padding: var(--space-sm); border-radius: var(--radius-sm); border: 1px solid var(--color-border);">
              <div style="font-size: 0.75rem; font-weight: 500; color: var(--color-gray-600); margin-bottom: var(--space-xs); display: flex; align-items: center; gap: var(--space-xs);">
                <i data-lucide="link" size="12"></i>
                Webhook URL
              </div>
              <div style="display: flex; gap: var(--space-xs); align-items: center;">
                <input 
                  type="text" 
                  value="${webhookUrl}" 
                  readonly 
                  id="webhook-${lineOA.id}"
                  style="flex: 1; padding: 6px var(--space-sm); border: 1px solid var(--color-border); border-radius: var(--radius-sm); font-family: var(--font-mono); font-size: 0.75rem; background: white;"
                >
                <button 
                  class="btn btn-sm" 
                  onclick="copyWebhookUrl('${lineOA.id}')"
                  style="padding: 6px var(--space-sm); background: var(--color-primary); color: white; border: none; border-radius: var(--radius-sm); cursor: pointer; display: flex; align-items: center; gap: 4px; white-space: nowrap;"
                  title="คัดลอก Webhook URL"
                >
                  <i data-lucide="copy" size="14"></i>
                  คัดลอก
                </button>
              </div>
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
  // Reset form when closing
  cancelAddLineOA();
}

function showAddLineOAForm() {
  document.getElementById('addLineOAForm').style.display = 'block';
  document.getElementById('showAddFormBtn').style.display = 'none';
  lucide.createIcons();
}

function cancelAddLineOA() {
  document.getElementById('addLineOAForm').style.display = 'none';
  document.getElementById('showAddFormBtn').style.display = 'block';
  document.getElementById('lineOAFormElement').reset();
}

function submitLineOAForm(event) {
  event.preventDefault();
  
  const name = document.getElementById('lineOAName').value.trim();
  const channel_id = document.getElementById('lineOAChannelId').value.trim();
  const channel_secret = document.getElementById('lineOAChannelSecret').value.trim();
  const channel_access_token = document.getElementById('lineOAAccessToken').value.trim();

  if (!name || !channel_id || !channel_secret || !channel_access_token) {
    addNotification('❌ กรุณากรอกข้อมูลให้ครบทุกช่อง');
    return;
  }

  createLineOA({ name, channel_id, channel_secret, channel_access_token });
}

function copyWebhookUrl(lineOAId) {
  const input = document.getElementById(`webhook-${lineOAId}`);
  if (input) {
    input.select();
    input.setSelectionRange(0, 99999); // For mobile devices
    
    navigator.clipboard.writeText(input.value).then(() => {
      addNotification('✅ คัดลอก Webhook URL แล้ว');
    }).catch(err => {
      // Fallback for older browsers
      document.execCommand('copy');
      addNotification('✅ คัดลอก Webhook URL แล้ว');
    });
  }
}

// Deprecated: openAddLineOAModal is no longer used, replaced with form
function openAddLineOAModal() {
  showAddLineOAForm();
}

async function createLineOA(data) {
  try {
    await api.createLineOA(currentTenantId, data);
    addNotification('✅ เพิ่ม LINE OA สำเร็จ');
    cancelAddLineOA(); // Hide and reset form
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

async function deletePendingItem(transactionId) {
  // สร้าง custom confirmation modal
  const modal = document.createElement('div');
  modal.className = 'delete-confirm-modal';
  modal.innerHTML = `
    <div class="delete-confirm-content">
      <div class="delete-confirm-header">
        <i data-lucide="alert-circle"></i>
        <h3>ยืนยันการลบ</h3>
      </div>
      <p>คุณต้องการลบรายการนี้หรือไม่?</p>
      <div class="delete-confirm-actions">
        <button class="btn-cancel" id="cancelDeleteBtn">ยกเลิก</button>
        <button class="btn-confirm" id="confirmDeleteBtn">ตกลง</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  lucide.createIcons();
  
  // Focus ปุ่มตกลง
  const confirmBtn = document.getElementById('confirmDeleteBtn');
  const cancelBtn = document.getElementById('cancelDeleteBtn');
  confirmBtn.focus();
  
  // Handle Enter key
  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      confirmBtn.click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelBtn.click();
    }
  };
  
  modal.addEventListener('keydown', handleKeyPress);
  
  // Return promise to handle user action
  return new Promise((resolve) => {
    confirmBtn.onclick = async () => {
      try {
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<div class="loading"></div> กำลังลบ...';
        
        await api.deletePendingTransaction(transactionId);
        addNotification('✅ ลบรายการสำเร็จ');
        await loadPendingTransactions();
        
        modal.remove();
        resolve(true);
      } catch (error) {
        addNotification('❌ ไม่สามารถลบรายการได้: ' + error.message);
        modal.remove();
        resolve(false);
      }
    };
    
    cancelBtn.onclick = () => {
      modal.remove();
      resolve(false);
    };
    
    // Click outside to close
    modal.onclick = (e) => {
      if (e.target === modal) {
        modal.remove();
        resolve(false);
      }
    };
  });
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

  // เปลี่ยนจาก dropzone click เป็นตรวจสอบว่าคลิกที่ preview หรือไม่
  dropzone.addEventListener('click', (e) => {
    // ถ้าคลิกที่ปุ่มหรือ element ภายใน upload-preview ให้ข้ามไป
    if (e.target.closest('.upload-preview') || e.target.closest('button')) {
      return;
    }
    input.click();
  });

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

  // เพิ่ม Ctrl+V เพื่อ paste รูปจาก clipboard
  document.addEventListener('paste', (event) => {
    const items = event.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.indexOf('image') !== -1) {
        event.preventDefault();
        const file = item.getAsFile();
        if (file) {
          handleSelectedSlip(file);
        }
        break;
      }
    }
  });
}

function openSlipPicker() {
  document.getElementById('slipUploadInput')?.click();
}

function handleSelectedSlip(file) {
  if (!file) {
    return;
  }

  // แสดงชื่อไฟล์ (ตัดถ้ายาวเกิน)
  const hint = document.getElementById('slipUploadHint');
  if (hint) {
    const truncatedName = file.name.length > 30 ? file.name.substring(0, 27) + '...' : file.name;
    hint.textContent = `ไฟล์ที่เลือก: ${truncatedName}`;
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
            <div style="display: flex; gap: var(--space-xs);">
              <button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); resetSlipUpload();">
                <i data-lucide="x"></i> ลบ
              </button>
            </div>
          </div>
        </div>
      `;
      lucide.createIcons();
    };
    reader.readAsDataURL(file);
  }

  addNotification(`📄 กำลังสแกนสลิป: ${file.name}...`);
  
  // ส่งไปสแกนทันที
  uploadAndScanSlip(file);
}

async function uploadAndScanSlip(file) {
  const loadingIcon = document.getElementById('uploadLoadingIcon');
  
  try {
    // แสดง loading icon
    if (loadingIcon) {
      loadingIcon.style.display = 'block';
      loadingIcon.classList.add('spin-icon'); // เพิ่ม class สำหรับ animation
      lucide.createIcons();
    }
    
    const result = await api.uploadSlip(file);
    
    if (result.success) {
      const data = result.data;
      
      if (data.status === 'matched') {
        addNotification(`✅ สแกนสำเร็จ! จับคู่กับ ${data.sender.name} (${data.tenant.name}) ยอด ${data.slip.amount} บาท`);
      } else {
        addNotification(`⚠️ สแกนสำเร็จ แต่ไม่พบผู้ใช้ในระบบ (${data.tenant.name}) ยอด ${data.slip.amount} บาท`);
      }
      
      // รีเฟรช pending list
      await loadPendingTransactions();
      
      // รีเซ็ต upload zone
      setTimeout(() => {
        resetSlipUpload();
      }, 1500);
    } else {
      addNotification(`❌ สแกนสลิปไม่สำเร็จ: ${result.message || 'Unknown error'}`);
    }
  } catch (error) {
    addNotification(`❌ เกิดข้อผิดพลาด: ${error.message}`);
    console.error('Upload error:', error);
    
    // รีเซ็ต upload zone เมื่อเกิด error
    setTimeout(() => {
      resetSlipUpload();
    }, 1500);
  } finally {
    // ซ่อน loading icon เสมอ (แม้เกิด error) + ลบ animation
    if (loadingIcon) {
      loadingIcon.style.display = 'none';
      loadingIcon.classList.remove('spin-icon'); // ลบ class animation เพื่อหยุดหมุน
      lucide.createIcons();
    }
  }
}

function resetSlipUpload() {
  const dropzone = document.getElementById('slipDropzone');
  const input = document.getElementById('slipUploadInput');
  const loadingIcon = document.getElementById('uploadLoadingIcon');
  const hint = document.getElementById('slipUploadHint');
  
  if (input) {
    input.value = '';
  }
  
  // ซ่อน loading icon
  if (loadingIcon) {
    loadingIcon.style.display = 'none';
    loadingIcon.classList.remove('spin-icon');
  }
  
  // รีเซ็ต hint text
  if (hint) {
    hint.textContent = 'รองรับเฉพาะไฟล์รูปภาพ (JPG, PNG)';
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
