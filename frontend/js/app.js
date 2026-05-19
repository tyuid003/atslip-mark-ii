// ============================================================
// APPLICATION STATE
// ============================================================

let currentTeamSlug = null; // team slug จาก URL
let currentPage = 'dashboard';
let currentTeamId = null;
let currentTenants = [];
let currentTenantId = null;
let currentLineOAs = [];
let currentEditingLineOAId = null;
let notifications = [];
let unreadCount = 0;
let toastEnabled = true; // สถานะการแสดง toast notification
let toastQueue = []; // คิวสำหรับ toast notifications
let isShowingToast = false; // สถานะการแสดง toast
let isUploading = false; // ป้องกันการอัพโหลดซ้อน

// Filter & Sort state
let pendingFilterTenant = null; // Filter by tenant ID
let pendingFilterStatus = null; // Filter by status
let pendingSortBy = 'created_at'; // Sort by field
let pendingSortOrder = 'DESC'; // Sort order (ASC/DESC)
let pendingSearchQuery = ''; // Search query
let allPendingTransactions = []; // Store all pending data before filtering/sorting

// ============================================================
// INITIALIZATION
// ============================================================

async function init() {
  const routeInfo = window.getRouteInfoFromURL();
  currentTeamSlug = routeInfo.teamSlug;
  currentPage = routeInfo.page || 'dashboard';
  window.currentTeamSlug = currentTeamSlug; // export เป็น global variable
  window.currentPage = currentPage;
  window.currentTeamId = null;
  console.log('Current Team Slug:', currentTeamSlug);

  if (typeof window.setLayoutForPage === 'function') {
    window.setLayoutForPage(currentPage);
  }
  
  // อัพเดท page title และ badge ถ้าไม่ใช่ default team
  if (currentTeamSlug !== 'default') {
    try {
      // ดึงข้อมูล team จาก API
      const response = await api.getTeamBySlug(currentTeamSlug);
      const teamData = response.data;
      currentTeamId = teamData.id || null;
      window.currentTeamId = currentTeamId;
      
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
      currentTeamId = null;
      window.currentTeamId = null;
      // ถ้า error ใช้ slug แทน
      document.title = `${currentTeamSlug.toUpperCase()} - ATslip Auto Deposit`;
      const teamBadge = document.getElementById('teamBadge');
      if (teamBadge) {
        teamBadge.textContent = currentTeamSlug;
        teamBadge.style.display = 'inline-block';
      }
    }
  }
  
  if (currentPage === 'reply-message') {
    if (typeof window.initReplyMessagePage === 'function') {
      await window.initReplyMessagePage();
    }
    return;
  }

  // ถ้าเป็น default team (ไม่มี team slug ใน URL) แสดง empty state
  if (currentTeamSlug === 'default') {
    bindUploadEvents();
    UI.showEmptyState();
    return;
  }

  bindUploadEvents();
  await loadTenants();
  await loadPendingTransactions();
  initializeNotifications();
  connectWebSocket();
}

// รีเฟรชเมื่อ hash เปลี่ยน (สำหรับ team switching)
window.addEventListener('hashchange', () => {
  const routeInfo = window.getRouteInfoFromURL();
  const newTeamSlug = routeInfo.teamSlug;
  const newPage = routeInfo.page || 'dashboard';

  if (newTeamSlug !== currentTeamSlug || newPage !== currentPage) {
    currentTeamSlug = newTeamSlug;
    currentPage = newPage;
    window.currentTeamSlug = currentTeamSlug;
    window.currentPage = currentPage;
    console.log('Route changed to:', currentTeamSlug, currentPage);
    window.location.reload(); // reload หน้าใหม่เมื่อเปลี่ยน team
  }
});

// ============================================================
// TENANT MANAGEMENT
// ============================================================

let tenantCache = null; // Cache รายชื่อ tenant ในหน่วยความจำ

async function loadTenants() {
  try {
    UI.showLoading();
    
    // ลองโหลดจาก sessionStorage ก่อน และเช็คว่า cache ยังไม่หมดอายุ
    const cachedData = sessionStorage.getItem('tenants_cache');
    const cacheTime = sessionStorage.getItem('tenants_cache_time');
    const now = Date.now();
    const cacheMaxAge = 60000; // 1 นาที
    
    if (cachedData && cacheTime && (now - parseInt(cacheTime)) < cacheMaxAge) {
      try {
        const parsed = JSON.parse(cachedData);
        if (Array.isArray(parsed) && parsed.length > 0) {
          currentTenants = parsed;
          tenantCache = parsed;
          UI.renderTenants(currentTenants);
          console.log('[Tenants] Loaded from sessionStorage cache');
          return;
        }
      } catch (e) {
        console.warn('[Tenants] Failed to parse cache:', e);
      }
    }
    
    // ถ้าไม่มี cache หรือ parse ไม่ได้ หรือหมดอายุ ให้โหลดจาก API
    console.log('[Tenants] Loading from API...');
    const response = await api.getTenants();
    currentTenants = response.data || [];
    tenantCache = currentTenants;
    
    // บันทึกลง sessionStorage พร้อม timestamp
    sessionStorage.setItem('tenants_cache', JSON.stringify(currentTenants));
    sessionStorage.setItem('tenants_cache_time', now.toString());
    console.log('[Tenants] Loaded from API and cached:', currentTenants.length, 'tenants');
    
    UI.renderTenants(currentTenants);
  } catch (error) {
    console.error('[Tenants] Load error:', error);
    addNotification('❌ ไม่สามารถโหลดข้อมูล: ' + error.message);
  } finally {
    UI.hideLoading();
  }
}

// ฟังก์ชันสำหรับ clear cache และโหลดใหม่
function refreshTenants() {
  sessionStorage.removeItem('tenants_cache');
  tenantCache = null;
  return loadTenants();
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
      
      // รีเฟรชบัญชีทันทีเพื่ออัพเดทสถานะการเชื่อมต่อ
      try {
        await api.refreshBankAccounts(currentLoginTenant.id);
        addNotification(`✅ รีเฟรชรายชื่อบัญชีสำเร็จ`);
      } catch (refreshError) {
        console.warn('Auto-refresh failed:', refreshError);
      }
      
      // Clear cache และโหลดรายการ tenant ใหม่
      sessionStorage.removeItem('tenants_cache');
      tenantCache = null;
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
    
    // Clear cache และโหลดใหม่เพื่ออัพเดทสถานะ
    sessionStorage.removeItem('tenants_cache');
    tenantCache = null;
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

    // รีเฟรชรายการ tenant เพื่ออัพเดทสถานะ (clear cache ก่อน)
    sessionStorage.removeItem('tenants_cache');
    tenantCache = null;
    await loadTenants();
  } catch (error) {
    addNotification('❌ ไม่สามารถรีเฟรชข้อมูลได้: ' + error.message);
    
    // ถ้า error แสดงว่า session หมดอายุ ให้อัพเดทสถานะเป็นไม่เชื่อมต่อ
    if (error.message.includes('Session expired') || error.message.includes('401') || error.message.includes('No active session')) {
      listContainer.innerHTML = '<div class="bank-accounts-empty"><i data-lucide="alert-circle" size="48" style="color: var(--color-error); margin-bottom: var(--space-md);"></i><p>เซสชันหมดอายุหรือไม่เชื่อมต่อ</p><p style="font-size: 0.875rem; color: var(--color-gray-500);">กรุณา Login ใหม่</p></div>';
      
      // Clear cache และรีเฟรชเพื่ออัพเดทสถานะเชื่อมต่อ
      sessionStorage.removeItem('tenants_cache');
      tenantCache = null;
      await loadTenants();
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

    validateLineOAConfiguration();

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
    html = '<div style="display: flex; flex-direction: column; gap: var(--space-sm);">';
    currentLineOAs.forEach((lineOA) => {
      const webhookUrl = `${API_CONFIG.WEBHOOK_BASE_URL}/webhook/${encodeURIComponent(currentTenantId)}/${encodeURIComponent(lineOA.id)}`;

      html += `
        <div class="lineoa-card">
          <div class="lineoa-card-top">
            <div class="lineoa-card-main">
              <i data-lucide="message-circle" size="16"></i>
              <div class="lineoa-card-info">
                <div class="lineoa-card-name">${lineOA.name}</div>
                <div class="lineoa-card-channel">${lineOA.channel_id}</div>
              </div>
            </div>
            <div class="lineoa-card-actions">
              <button class="btn btn-secondary lineoa-btn-compact lineoa-btn-icon" onclick="editLineOA('${lineOA.id}')" title="แก้ไข LINE OA">
                <i data-lucide="pencil" size="13"></i>
              </button>
              <button class="btn btn-danger lineoa-btn-compact lineoa-btn-icon" onclick="deleteLineOA('${lineOA.id}')" title="ลบ LINE OA">
                <i data-lucide="trash-2" size="13"></i>
              </button>
            </div>
          </div>
          <div class="lineoa-webhook-row">
            <input 
              type="text" 
              value="${webhookUrl}" 
              readonly 
              id="webhook-${lineOA.id}"
              class="lineoa-webhook-input"
            >
            <button class="btn btn-secondary lineoa-btn-compact" onclick="copyWebhookUrl('${lineOA.id}')" title="คัดลอก Webhook URL">
              <i data-lucide="copy" size="13"></i>
              คัดลอก
            </button>
          </div>
        </div>
      `;
    });
    html += '</div>';
  }

  document.getElementById('lineOAList').innerHTML = html;
  lucide.createIcons();
}

function validateLineOAConfiguration() {
  if (!currentLineOAs.length) {
    return;
  }

  const invalidItems = currentLineOAs.filter((lineOA) => {
    return !lineOA.name || !lineOA.channel_id || !lineOA.channel_secret || !lineOA.channel_access_token;
  });

  if (invalidItems.length > 0) {
    addNotification(`⚠️ พบ LINE OA ที่ตั้งค่าไม่ครบ ${invalidItems.length} รายการ`);
  }
}

function closeLineOAModal() {
  document.getElementById('lineOAModal').style.display = 'none';
  cancelAddLineOA();
}

function showAddLineOAForm(lineOA = null) {
  currentEditingLineOAId = lineOA?.id || null;

  document.getElementById('addLineOAForm').style.display = 'block';
  document.getElementById('showAddFormBtn').style.display = 'none';

  const submitLabel = document.getElementById('submitLineOAFormBtnText');
  if (submitLabel) {
    submitLabel.textContent = currentEditingLineOAId ? 'บันทึกการแก้ไข' : 'เพิ่ม LINE OA';
  }

  if (lineOA) {
    document.getElementById('lineOAName').value = lineOA.name || '';
    document.getElementById('lineOAChannelId').value = lineOA.channel_id || '';
    document.getElementById('lineOAChannelSecret').value = lineOA.channel_secret || '';
    document.getElementById('lineOAAccessToken').value = lineOA.channel_access_token || '';
  }

  lucide.createIcons();
}

function editLineOA(lineOAId) {
  const lineOA = currentLineOAs.find((item) => item.id === lineOAId);
  if (!lineOA) {
    addNotification('❌ ไม่พบข้อมูล LINE OA สำหรับแก้ไข');
    return;
  }

  showAddLineOAForm(lineOA);
}

function cancelAddLineOA() {
  currentEditingLineOAId = null;
  document.getElementById('addLineOAForm').style.display = 'none';
  document.getElementById('showAddFormBtn').style.display = 'block';
  document.getElementById('lineOAFormElement').reset();

  const submitLabel = document.getElementById('submitLineOAFormBtnText');
  if (submitLabel) {
    submitLabel.textContent = 'เพิ่ม LINE OA';
  }
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

  const payload = { name, channel_id, channel_secret, channel_access_token };

  if (currentEditingLineOAId) {
    updateLineOA(currentEditingLineOAId, payload);
    return;
  }

  createLineOA(payload);
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

async function updateLineOA(lineOAId, data) {
  try {
    await api.updateLineOA(lineOAId, data);
    addNotification('✅ บันทึกการแก้ไข LINE OA สำเร็จ');
    cancelAddLineOA();
    await manageLineOAs(currentTenantId);
    await loadTenants();
  } catch (error) {
    addNotification('❌ บันทึกการแก้ไขไม่สำเร็จ: ' + error.message);
  }
}

async function deleteLineOA(lineOAId) {
  const target = currentLineOAs.find((item) => item.id === lineOAId);
  const lineOAName = target?.name || lineOAId;

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
    allPendingTransactions = list; // Store all data
    applyPendingFiltersAndSort();
  } catch (error) {
    UI.renderPendingTransactions([]);
  }
}

function applyPendingFiltersAndSort() {
  // Start with all data
  let filtered = [...allPendingTransactions];
  
  // Apply search filter
  if (pendingSearchQuery.trim()) {
    const query = pendingSearchQuery.toLowerCase();
    filtered = filtered.filter(item => {
      const senderName = (item.sender_name || '').toLowerCase();
      const matchedUsername = (item.matched_username || '').toLowerCase();
      const matchedUserId = (item.matched_user_id || '').toLowerCase();
      const amount = String(item.amount || '');
      const slipRef = (item.slip_ref || '').toLowerCase();
      const senderAccount = (item.sender_account || '').toLowerCase();
      const receiverName = (item.receiver_name || '').toLowerCase();
      
      return senderName.includes(query) || 
             matchedUsername.includes(query) || 
             matchedUserId.includes(query) ||
             amount.includes(query) ||
             slipRef.includes(query) ||
             senderAccount.includes(query) ||
             receiverName.includes(query);
    });
  }
  
  // Apply tenant filter
  if (pendingFilterTenant) {
    filtered = filtered.filter(item => item.tenant_id === pendingFilterTenant);
  }
  
  // Apply status filter
  if (pendingFilterStatus) {
    filtered = filtered.filter(item => item.status === pendingFilterStatus);
  }
  
  // Apply sorting
  filtered.sort((a, b) => {
    let aVal, bVal;
    
    switch (pendingSortBy) {
      case 'sender_name':
        aVal = (a.sender_name || '').toLowerCase();
        bVal = (b.sender_name || '').toLowerCase();
        break;
      case 'matched_username':
        aVal = (a.matched_username || '').toLowerCase();
        bVal = (b.matched_username || '').toLowerCase();
        break;
      case 'amount':
        aVal = Number(a.amount || 0);
        bVal = Number(b.amount || 0);
        break;
      case 'status':
        aVal = a.status || '';
        bVal = b.status || '';
        break;
      case 'created_at':
      default:
        aVal = a.created_at || 0;
        bVal = b.created_at || 0;
        break;
    }
    
    if (typeof aVal === 'string') {
      return pendingSortOrder === 'DESC' 
        ? bVal.localeCompare(aVal, 'th-TH')
        : aVal.localeCompare(bVal, 'th-TH');
    }
    
    return pendingSortOrder === 'DESC' 
      ? bVal - aVal
      : aVal - bVal;
  });
  
  UI.renderPendingTransactions(filtered.slice(0, 50));
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

async function creditPendingItem(transactionId, event) {
  const btn = event?.currentTarget;
  const originalHtml = btn ? btn.innerHTML : '';

  if (btn) {
    if (btn.dataset.loading === '1') return;
    btn.dataset.loading = '1';
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2" class="spin-icon"></i>';
    lucide.createIcons();
  }

  try {
    const response = await api.creditPendingTransaction(transactionId);

    const status = response?.data?.status;
    if (status === 'duplicate') {
      addNotification('⚠️ รายการซ้ำในระบบแอดมิน');
    } else {
      addNotification('✅ เติมเครดิตสำเร็จ');
    }

    await loadPendingTransactions();
  } catch (error) {
    addNotification('❌ เติมเครดิตไม่สำเร็จ: ' + error.message);
    if (btn) {
      btn.disabled = false;
      btn.dataset.loading = '0';
      btn.innerHTML = originalHtml;
      lucide.createIcons();
    }
  }
}

async function withdrawPendingCredit(transactionId) {
  try {
    await api.withdrawPendingCredit(transactionId, {
      remark: 'Manual withdraw from pending list',
    });

    addNotification('✅ ดึงเครดิตกลับสำเร็จ');
    await loadPendingTransactions();
  } catch (error) {
    addNotification('❌ ดึงเครดิตกลับไม่สำเร็จ: ' + error.message);
  }
}

window.creditPendingItem = creditPendingItem;
window.withdrawPendingCredit = withdrawPendingCredit;

// ============================================================
// USER SEARCH & MANUAL MATCHING
// ============================================================

let currentSearchTransactionId = null;
let currentSearchTenantId = null;
let searchDebounceTimer = null;
let availableTenants = [];

async function openUserSearch(transactionId, tenantId) {
  currentSearchTransactionId = transactionId;
  currentSearchTenantId = tenantId;
  
  // ใช้ cache ที่โหลดไว้แล้ว หรือโหลดจาก sessionStorage
  if (tenantCache && tenantCache.length > 0) {
    availableTenants = tenantCache;
  } else {
    const cachedData = sessionStorage.getItem('tenants_cache');
    if (cachedData) {
      try {
        availableTenants = JSON.parse(cachedData);
        tenantCache = availableTenants;
      } catch (e) {
        console.warn('[User Search] Failed to parse tenant cache');
        availableTenants = [];
      }
    }
  }
  
  // ถ้ายังไม่มี ให้โหลดจาก API
  if (!availableTenants || availableTenants.length === 0) {
    try {
      const response = await api.getTenants();
      availableTenants = response.data || [];
      tenantCache = availableTenants;
      sessionStorage.setItem('tenants_cache', JSON.stringify(availableTenants));
    } catch (error) {
      console.error('[User Search] Failed to load tenants:', error);
      availableTenants = [];
    }
  }
  
  // Create modal
  const modal = document.createElement('div');
  modal.className = 'user-search-modal';
  
  const tenantOptions = availableTenants
    .map(t => `<option value="${t.id}" ${t.id === tenantId ? 'selected' : ''}>${t.name}</option>`)
    .join('');
  
  modal.innerHTML = `
    <div class="user-search-content">
      <div class="user-search-header">
        <h3>ค้นหาและจับคู่ผู้ใช้</h3>
        <button class="user-search-close" onclick="closeUserSearch()">
          <i data-lucide="x" style="width: 20px; height: 20px;"></i>
        </button>
      </div>
      <div class="user-search-tenant-selector">
        <label for="tenantSelect">เลือกเว็บที่ต้องการค้นหา:</label>
        <select id="tenantSelect" class="user-search-tenant-select">
          ${tenantOptions}
        </select>
      </div>
      <div class="user-search-input-wrapper">
        <input 
          type="text" 
          class="user-search-input" 
          id="userSearchInput"
          placeholder="พิมพ์ชื่อหรือรหัสสมาชิกเพื่อค้นหา..."
          autocomplete="off"
        />
        <i data-lucide="search" class="user-search-icon" onclick="retryUserSearch()" style="width: 16px; height: 16px; cursor: pointer;" title="ค้นหาใหม่"></i>
      </div>
      <div class="user-search-results" id="userSearchResults">
        <div class="user-search-empty">
          พิมพ์ในช่องค้นหาเพื่อเริ่มค้นหาผู้ใช้
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  lucide.createIcons();
  
  // Get selected tenant from dropdown
  const tenantSelect = document.getElementById('tenantSelect');
  tenantSelect.addEventListener('change', (e) => {
    currentSearchTenantId = e.target.value;
    console.log('[User Search] Tenant changed to:', currentSearchTenantId);
  });
  
  // Focus input
  const input = document.getElementById('userSearchInput');
  setTimeout(() => input.focus(), 100);
  
  // Bind search event
  input.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    
    // Clear previous timer
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
    }
    
    // Debounce search (300ms)
    searchDebounceTimer = setTimeout(async () => {
      if (query.length >= 2) {
        await performUserSearch(query);
      } else if (query.length === 0) {
        document.getElementById('userSearchResults').innerHTML = `
          <div class="user-search-empty">
            พิมพ์ในช่องค้นหาเพื่อเริ่มค้นหาผู้ใช้
          </div>
        `;
      }
    }, 300);
  });
  
  // Enter to search
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      performUserSearch(e.target.value.trim());
    } else if (e.key === 'Escape') {
      closeUserSearch();
    }
  });
  
  // Click outside to close
  modal.onclick = (e) => {
    if (e.target === modal) {
      closeUserSearch();
    }
  };
}

window.openUserSearch = openUserSearch;

function closeUserSearch() {
  const modal = document.querySelector('.user-search-modal');
  if (modal) {
    modal.remove();
  }
  currentSearchTransactionId = null;
}

window.closeUserSearch = closeUserSearch;

function retryUserSearch() {
  const input = document.getElementById('userSearchInput');
  if (input && input.value.trim().length >= 2) {
    performUserSearch(input.value.trim());
  }
}

window.retryUserSearch = retryUserSearch;

async function performUserSearch(query) {
  const resultsDiv = document.getElementById('userSearchResults');
  
  if (!query || query.length < 2) {
    resultsDiv.innerHTML = `
      <div class="user-search-empty">
        กรุณาพิมพ์อย่างน้อย 2 ตัวอักษร
      </div>
    `;
    return;
  }
  
  // Show loading
  resultsDiv.innerHTML = `
    <div class="user-search-loading">
      <div class="loading"></div>
      กำลังค้นหา...
    </div>
  `;
  
  try {
    // Search both member and non-member in parallel
    console.log('[User Search] Searching in parallel:', query, 'tenant:', currentSearchTenantId);
    
    const [memberResponse, nonMemberResponse] = await Promise.all([
      api.searchUsers(query, 'member', currentSearchTenantId).catch(err => ({ data: { users: [] } })),
      api.searchUsers(query, 'non-member', currentSearchTenantId).catch(err => ({ data: { users: [] } }))
    ]);
    
    const memberUsers = (memberResponse.data?.users || []).map(u => ({ ...u, category: 'member' }));
    const nonMemberUsers = (nonMemberResponse.data?.users || []).map(u => ({ ...u, category: 'non-member' }));
    
    // Combine results: members first, then non-members
    const allUsers = [...memberUsers, ...nonMemberUsers];
    
    console.log(`[User Search] Found ${memberUsers.length} members + ${nonMemberUsers.length} non-members = ${allUsers.length} total`);
    
    if (allUsers.length === 0) {
      resultsDiv.innerHTML = `
        <div class="user-search-empty">
          ไม่พบผู้ใช้ที่ตรงกับ "${query}"
        </div>
      `;
      return;
    }
    
    // Display results with category headers
    let html = '';
    
    if (memberUsers.length > 0) {
      html += `<div class="user-search-category-header">สมาชิก (${memberUsers.length})</div>`;
      html += memberUsers.map(user => {
        const displayName = user.fullname || user.username || 'ไม่ระบุชื่อ';
        const selectUserId = String(user.memberCode || user.username || user.id || '').replace(/'/g, "\\'");
        const displayUserCode = user.memberCode || user.username || user.id;
        
        return `
          <div class="user-result-item" onclick="selectUser('${selectUserId}', '${displayName.replace(/'/g, "\\'")}')">
            <div class="user-result-name">${displayName}</div>
            <div class="user-result-id">รหัส: ${displayUserCode}</div>
            <span class="user-result-category member">สมาชิก</span>
          </div>
        `;
      }).join('');
    }
    
    if (nonMemberUsers.length > 0) {
      html += `<div class="user-search-category-header">ไม่ใช่สมาชิก (${nonMemberUsers.length})</div>`;
      html += nonMemberUsers.map(user => {
        const displayName = user.fullname || user.username || 'ไม่ระบุชื่อ';
        const selectUserId = String(user.memberCode || user.username || user.id || '').replace(/'/g, "\\'");
        const displayUserCode = user.memberCode || user.username || user.id;
        
        return `
          <div class="user-result-item" onclick="selectUser('${selectUserId}', '${displayName.replace(/'/g, "\\'")}')">
            <div class="user-result-name">${displayName}</div>
            <div class="user-result-id">รหัส: ${displayUserCode}</div>
            <span class="user-result-category non-member">ไม่ใช่สมาชิก</span>
          </div>
        `;
      }).join('');
    }
    
    resultsDiv.innerHTML = html;
    
  } catch (error) {
    console.error('[User Search] Error:', error);
    resultsDiv.innerHTML = `
      <div class="user-search-empty" style="color: var(--color-red-600);">
        เกิดข้อผิดพลาด: ${error.message}
      </div>
    `;
  }
}

async function selectUser(userId, userName) {
  if (!currentSearchTransactionId) {
    addNotification('❌ ไม่พบข้อมูลรายการ');
    closeUserSearch();
    return;
  }
  
  if (!currentSearchTenantId) {
    addNotification('❌ กรุณาเลือกเว็บก่อนจับคู่');
    return;
  }
  
  try {
    console.log('[Manual Match] Attempting to match transaction:', {
      transactionId: currentSearchTransactionId,
      userId: userId,
      userName: userName,
      tenantId: currentSearchTenantId
    });
    
    const result = await api.matchPendingTransaction(currentSearchTransactionId, {
      matched_user_id: userId,
      matched_username: userName,
      tenant_id: currentSearchTenantId
    });
    
    console.log('[Manual Match] Success:', result);
    addNotification(`✅ จับคู่กับ ${userName} สำเร็จ`);
    closeUserSearch();
    await loadPendingTransactions();
    
  } catch (error) {
    console.error('[Manual Match] Error:', error);
    
    const errorMsg = error.message || '';
    addNotification('❌ ไม่สามารถจับคู่ได้: ' + errorMsg);
  }
}

window.selectUser = selectUser;

// ============================================================
// HELPER: Error Message Translation
// ============================================================

function translateErrorMessage(errorMsg) {
  if (!errorMsg) return 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
  
  const errorLower = errorMsg.toLowerCase();
  
  // Tenant matching errors
  if (errorLower.includes('no matching tenant') || errorLower.includes('not found for this slip')) {
    return 'ไม่พบบัญชีปลายทางในระบบ อาจจะปลอมน๊าาา';
  }
  
  // EASYSLIP API errors
  if (errorLower.includes('qrcode_not_found') || errorLower.includes('qr code not found')) {
    return 'ไม่พบ QR Code ในภาพ ขอภาพชัดๆหน่อยงับเตง';
  }
  if (errorLower.includes('invalid_qrcode') || errorLower.includes('invalid qr')) {
    return 'QR Code ไม่ถูกต้อง กรุณาใช้สลิปที่มี QR Code ที่สมบูรณ์หน่อย';
  }
  if (errorLower.includes('image_too_large')) {
    return 'ขนาดรูปภาพใหญ่เกินไปพี่ชาย';
  }
  if (errorLower.includes('unsupported_format') || errorLower.includes('invalid format')) {
    return 'รูปแบบไฟล์ไม่รองรับ กรุณาใช้ไฟล์ JPG หรือ PNG';
  }
  if (errorLower.includes('quota') || errorLower.includes('rate limit')) {
    return 'ใช้งานเกินโควต้า กรุณารอสักครู่แล้วลองใหม่อีกครั้ง';
  }
  if (errorLower.includes('authentication') || errorLower.includes('unauthorized')) {
    return 'การยืนยันตัวตนล้มเหลว กรุณาตรวจสอบ Token';
  }
  
  // Network errors
  if (errorLower.includes('network') || errorLower.includes('fetch')) {
    return 'เกิดปัญหาการเชื่อมต่อเครือข่าย กรุณาตรวจสอบอินเทอร์เน็ต';
  }
  if (errorLower.includes('timeout')) {
    return 'หมดเวลาการเชื่อมต่อ กรุณาลองใหม่อีกครั้ง';
  }
  
  // Default: return original message
  return errorMsg;
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

  // ป้องกันการอัพโหลดซ้อน
  if (isUploading) {
    addNotification('⏳ กรุณารอให้สแกนสลิปปัจจุบันเสร็จก่อน อย่าฟ้าวๆ');
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
      // ป้องกัน race condition: ถ้า upload เสร็จแล้ว (isUploading = false) ไม่ต้องแสดง preview
      if (!isUploading) {
        return;
      }
      
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
    // ตั้งค่า flag ว่ากำลังอัพโหลด
    isUploading = true;
    
    // แสดง loading icon
    if (loadingIcon) {
      loadingIcon.style.display = 'block';
      loadingIcon.classList.add('spin-icon'); // เพิ่ม class สำหรับ animation
      lucide.createIcons();
    }
    
    const result = await api.uploadSlip(file);
    
    // Display debug logs in console
    if (result.data && result.data.debug) {
      console.log('🔍 ===== BACKEND MATCHING PROCESS =====');
      result.data.debug.forEach(log => console.log(log));
      console.log('🔍 ===== END OF BACKEND PROCESS =====');
    }
    
    if (result.success) {
      const data = result.data;
      
      // แสดงข้อความตามสถานะ
      if (data.status === 'credited') {
        addNotification(`✅ เติมเครดิตสำเร็จ! ${data.sender.name} (${data.tenant.name}) ยอด ${data.slip.amount} บาท`);
      } else if (data.status === 'duplicate') {
        addNotification(`⚠️ ยอดซ้ำ! ${data.sender.name} (${data.tenant.name}) ยอด ${data.slip.amount} บาท - เคยเติมแล้ว`);
      } else if (data.status === 'matched') {
        addNotification(`✅ สแกนสำเร็จ! จับคู่กับ ${data.sender.name} (${data.tenant.name}) ยอด ${data.slip.amount} บาท`);
      } else {
        // status = 'pending'
        addNotification(`⚠️ สแกนสำเร็จ แต่ไม่พบผู้ใช้ในระบบ (${data.tenant.name}) ยอด ${data.slip.amount} บาท`);
      }
      
      // รีเฟรช pending list
      await loadPendingTransactions();
    } else {
      addNotification(`❌ สแกนสลิปไม่สำเร็จ: ${result.message || 'Unknown error'}`);
    }
  } catch (error) {
    // Display debug logs even in error case
    if (error.response) {
      try {
        const errorData = await error.response.json();
        if (errorData.debug) {
          console.log('🔍 ===== BACKEND MATCHING PROCESS (ERROR) =====');
          errorData.debug.forEach(log => console.log(log));
          console.log('🔍 ===== END OF BACKEND PROCESS =====');
        }
      } catch (e) {
        // Ignore JSON parse errors
      }
    }
    
    const translatedError = translateErrorMessage(error.message);
    addNotification(`❌ ${translatedError}`);
    console.error('Upload error:', error);
  } finally {
    // ปลดล็อค flag เพื่อให้สามารถอัพโหลดใหม่ได้
    isUploading = false;
    
    // ซ่อน loading icon เสมอ (แม้เกิด error) + ลบ animation
    if (loadingIcon) {
      loadingIcon.style.display = 'none';
      loadingIcon.classList.remove('spin-icon'); // ลบ class animation เพื่อหยุดหมุน
      lucide.createIcons();
    }
    
    // รีเซ็ต upload zone ทันทีเพื่อให้สามารถอัพโหลดต่อได้
    resetSlipUpload();
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
// REALTIME WEBSOCKET
// ============================================================

let realtimeWS = null;
let wsReconnectTimer = null;
let wsConnected = false;

function connectWebSocket() {
  if (wsReconnectTimer) {
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = null;
  }

  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${proto}//${window.location.host}/api/realtime/ws`;

  try {
    realtimeWS = new WebSocket(wsUrl);

    realtimeWS.addEventListener('open', () => {
      wsConnected = true;
      console.log('[WS] Connected to realtime server');
    });

    realtimeWS.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(event.data);
        handleRealtimeMessage(message);
      } catch (e) {
        console.warn('[WS] Failed to parse message:', e);
      }
    });

    realtimeWS.addEventListener('close', () => {
      wsConnected = false;
      console.log('[WS] Disconnected, reconnecting in 5s...');
      wsReconnectTimer = setTimeout(connectWebSocket, 5000);
    });

    realtimeWS.addEventListener('error', () => {
      // close event fires after error, which handles reconnect
    });
  } catch (e) {
    console.warn('[WS] Connection error:', e);
    wsReconnectTimer = setTimeout(connectWebSocket, 5000);
  }
}

function handleRealtimeMessage(message) {
  if (!message || !message.type) return;
  if (message.type === 'connected') return;

  if (message.type === 'new_pending') {
    // Reload from API to pick up the new item with full data and team filter
    loadPendingTransactions();
    const data = message.data || {};
    addNotification(`🔔 สลิปใหม่: ${data.sender_name || ''} ยอด ${data.amount || ''} บาท`);
    return;
  }

  if (message.type === 'transaction_updated') {
    const update = message.data;
    if (!update || !update.id) return;

    const idx = allPendingTransactions.findIndex((t) => t.id === update.id);
    if (idx === -1) {
      // บางเคส event มาก่อน data จะเข้าลิสต์ (เช่น scan from LINE แล้ว auto-credit ทันที)
      loadPendingTransactions();
      return;
    }

    // Patch the item in place
    const item = { ...allPendingTransactions[idx] };
    if (update.status !== undefined) item.status = update.status;
    if (update.matched_user_id !== undefined) item.matched_user_id = update.matched_user_id;
    if (update.matched_username !== undefined) item.matched_username = update.matched_username;
    if (update.tenant_id !== undefined) {
      item.tenant_id = update.tenant_id;
      // อัพเดทชื่อเว็บ (tenant_name) ด้วย: ใช้จาก payload ก่อน ถ้าไม่มีให้ดึงจาก cache
      if (update.tenant_name) {
        item.tenant_name = update.tenant_name;
      } else if (tenantCache && tenantCache.length > 0) {
        const t = tenantCache.find((x) => x.id === update.tenant_id);
        if (t) item.tenant_name = t.name;
      }
    }
    allPendingTransactions[idx] = item;

    applyPendingFiltersAndSort();
    return;
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
  
  // โหลดสถานะ toast notification จาก localStorage
  try {
    const savedToastState = localStorage.getItem('atslip_toast_enabled');
    if (savedToastState !== null) {
      toastEnabled = savedToastState === 'true';
    }
    updateToastToggleIcon();
  } catch (e) {
    console.warn('ไม่สามารถโหลดสถานะ toast จาก localStorage:', e);
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
  
  // แสดง toast notification (ถ้าเปิดใช้งาน)
  showToastNotification(title);
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

function showToastNotification(message) {
  // ถ้า toast ถูกปิดใช้งาน ไม่แสดง
  if (!toastEnabled) {
    return;
  }

  // เพิ่มข้อความลงคิว
  toastQueue.push(message);
  
  // ถ้ากำลังแสดง toast อยู่ ให้รอ
  if (isShowingToast) {
    return;
  }
  
  // แสดง toast จากคิว
  processToastQueue();
}

function processToastQueue() {
  // ถ้าไม่มีในคิว หรือกำลังแสดงอยู่ ให้หยุด
  if (toastQueue.length === 0 || isShowingToast) {
    return;
  }
  
  const container = document.getElementById('toastContainer');
  if (!container) {
    return;
  }
  
  // ตั้งสถานะว่ากำลังแสดง
  isShowingToast = true;
  
  // ดึงข้อความแรกจากคิว
  const message = toastQueue.shift();

  // สร้าง toast element
  const toast = document.createElement('div');
  toast.className = 'toast';
  
  // กำหนดสีตามประเภทข้อความ
  if (message.startsWith('✅') || message.startsWith('✔')) {
    toast.classList.add('toast-success');
  } else if (message.startsWith('❌') || message.startsWith('⛔')) {
    toast.classList.add('toast-error');
  } else if (message.startsWith('⚠') || message.startsWith('⚡')) {
    toast.classList.add('toast-warning');
  } else if (message.startsWith('ℹ') || message.startsWith('📊')) {
    toast.classList.add('toast-info');
  } else {
    toast.classList.add('toast-error'); // default
  }

  const content = document.createElement('div');
  content.className = 'toast-content';
  content.textContent = message;
  content.title = message; // เพิ่ม tooltip เพื่อดูข้อความเต็มเมื่อ hover
  
  toast.appendChild(content);
  container.appendChild(toast);

  // แสดง toast ด้วย animation
  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  // ลบ toast หลัง 3 วินาที
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      toast.remove();
      // เสร็จแล้ว ตั้งสถานะว่าไม่ได้แสดงแล้ว
      isShowingToast = false;
      // แสดง toast ถัดไปในคิว (ถ้ามี)
      processToastQueue();
    }, 300); // รอ animation เสร็จ
  }, 3000);
}

function toggleToastNotifications() {
  toastEnabled = !toastEnabled;
  
  // บันทึกสถานะลง localStorage
  try {
    localStorage.setItem('atslip_toast_enabled', String(toastEnabled));
  } catch (e) {
    console.warn('ไม่สามารถบันทึกสถานะ toast ลง localStorage:', e);
  }
  
  // อัพเดท icon
  updateToastToggleIcon();
  
  // แสดงการแจ้งเตือน
  const statusText = toastEnabled ? 'เปิด' : 'ปิด';
  showToastNotification(`${toastEnabled ? '🔔' : '🔕'} การแจ้งเตือนแบบป๊อปอัพ: ${statusText}`);
  
  // รีเฟรช icons
  setTimeout(() => {
    lucide.createIcons();
  }, 10);
}

function updateToastToggleIcon() {
  const icon = document.getElementById('toastToggleIcon');
  const btn = icon?.closest('.toast-toggle-btn');
  
  if (!icon || !btn) {
    return;
  }
  
  // อัพเดท icon
  icon.setAttribute('data-lucide', toastEnabled ? 'bell' : 'bell-off');
  
  // อัพเดท class
  if (toastEnabled) {
    btn.classList.remove('disabled');
  } else {
    btn.classList.add('disabled');
  }
  
  // รีเฟรช icon
  lucide.createIcons();
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
    if (toggle) {
      toggle.disabled = true;
    }

    // จำสถานะที่ user เพิ่งกด
    pendingToggleStates.set(tenantId, enabled);
    // Optimistic update - แสดงผลทันทีโดยไม่ reload ทั้งหน้า
    if (toggle) {
      toggle.checked = enabled;
    }

    const response = await api.toggleAutoDeposit(tenantId, enabled);

    // ใช้ค่าจริงจาก DB ที่ backend ตอบกลับ
    const serverEnabled = !!response?.data?.auto_deposit_enabled;

    // อัพเดท state ในหน่วยความจำ
    const tenant = currentTenants.find((item) => item.id === tenantId);
    if (tenant) {
      tenant.auto_deposit_enabled = serverEnabled ? 1 : 0;
    }

    // sync cache เพื่อให้ค่าไม่เด้งกลับตอนเปิดหน้าใหม่
    sessionStorage.setItem('tenants_cache', JSON.stringify(currentTenants));
    tenantCache = currentTenants;

    // force UI ให้ตรงกับ DB จริง
    if (toggle) {
      toggle.checked = serverEnabled;
    }

    addNotification(`${serverEnabled ? '✅ เปิด' : '❌ ปิด'} Auto Deposit สำหรับ tenant`);
    
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
  } finally {
    if (toggle) {
      toggle.disabled = false;
    }
  }
}

function toggleFilterDropdown() {
  const dropdown = document.getElementById('filterDropdown');
  const isVisible = dropdown.style.display === 'block';
  dropdown.style.display = isVisible ? 'none' : 'block';
  
  // Populate tenants if not already set
  const filterTenantDropdown = document.getElementById('filterTenantDropdown');
  if (filterTenantDropdown.options.length === 1) {
    currentTenants.forEach(tenant => {
      const option = document.createElement('option');
      option.value = tenant.id;
      option.textContent = tenant.name;
      filterTenantDropdown.appendChild(option);
    });
  }
  
  // Set current values
  filterTenantDropdown.value = pendingFilterTenant || '';
  document.getElementById('filterStatusDropdown').value = pendingFilterStatus || '';
}

function applyPendingFilter() {
  const tenantSelect = document.getElementById('filterTenantDropdown');
  const statusSelect = document.getElementById('filterStatusDropdown');
  
  pendingFilterTenant = tenantSelect.value || null;
  pendingFilterStatus = statusSelect.value || null;
  
  // Apply filter
  applyPendingFiltersAndSort();
}

function applyPendingSearch() {
  const searchInput = document.getElementById('pendingSearchInput');
  pendingSearchQuery = searchInput?.value || '';
  applyPendingFiltersAndSort();
}

// Close dropdown when clicking outside
document.addEventListener('click', function(event) {
  const dropdown = document.getElementById('filterDropdown');
  const filterBtn = event.target.closest('.filter-btn');
  const dropdownContent = event.target.closest('.filter-dropdown');
  
  // Only close if clicking outside both the button and the dropdown content
  if (dropdown && !filterBtn && !dropdownContent && dropdown.style.display === 'block') {
    dropdown.style.display = 'none';
  }
});

// ============================================================
// REPORT FEATURE
// ============================================================

window.openReportModal = function(transactionId) {
  const tx = (allPendingTransactions || []).find((t) => t.id === transactionId);
  const modal = document.getElementById('reportModal');
  if (!modal) {
    console.error('[Report] reportModal element not found');
    return;
  }

  // เก็บ context อัตโนมัติ (ทีม + เว็บ) ไม่ให้ผู้ใช้กรอก
  modal.dataset.transactionId = transactionId;
  modal.dataset.teamId = (tx && tx.team_id) || window.currentTeamId || '';
  modal.dataset.tenantId = (tx && tx.tenant_id) || '';
  modal.dataset.tenantName = (tx && tx.tenant_name) || '';

  const txIdInput = document.getElementById('reportTransactionId');
  if (txIdInput) txIdInput.value = transactionId;

  // reset form (แอดมินกรอกชื่อผู้ส่งเอง ไม่ใช้ค่าจากลูกค้า)
  const senderInput = document.getElementById('reportSenderName');
  const detailInput = document.getElementById('reportDetail');
  if (senderInput) senderInput.value = '';
  if (detailInput) detailInput.value = '';
  document.querySelectorAll('input[name="reportType"]').forEach((cb) => { cb.checked = false; });

  modal.style.display = 'flex';
  if (window.lucide) lucide.createIcons();
};

window.closeReportModal = function() {
  const modal = document.getElementById('reportModal');
  if (modal) modal.style.display = 'none';
};

window.submitReport = async function() {
  const modal = document.getElementById('reportModal');
  if (!modal) return;

  const transactionId = modal.dataset.transactionId;
  const teamId = modal.dataset.teamId;
  const tenantId = modal.dataset.tenantId;
  const tenantName = modal.dataset.tenantName;
  const senderName = (document.getElementById('reportSenderName')?.value || '').trim();
  const detail = (document.getElementById('reportDetail')?.value || '').trim();
  const reportTypes = Array.from(document.querySelectorAll('input[name="reportType"]:checked'))
    .map((cb) => cb.value);

  if (!detail) {
    UI.showToast('⚠ กรุณากรอกรายละเอียดปัญหา', 'warning');
    return;
  }
  if (!transactionId || !teamId || !tenantId) {
    UI.showToast('❌ ข้อมูลรายการไม่ครบ (team/tenant)', 'error');
    return;
  }

  try {
    await api.reportTransaction({
      transactionId, senderName, detail, reportTypes,
      teamId, tenantId, tenantName,
    });
    UI.showToast('✅ ส่งรีพอร์ตเรียบร้อย', 'success');
    window.closeReportModal();
  } catch (err) {
    console.error('[Report] submit failed:', err);
    UI.showToast('❌ ส่งรีพอร์ตไม่สำเร็จ: ' + (err.message || err), 'error');
  }
};

// ========== Report Log Page (full page) ==========
window.__reportLogCache = [];

const REPORT_TYPE_LABELS = {
  match_customer: 'จับคู่ลูกค้าผิด',
  match_tenant: 'จับคู่เว็บผิด',
  other: 'อื่นๆ',
};

function escapeReportText(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatReportDate(epochSeconds) {
  if (!epochSeconds) return '-';
  try {
    const d = new Date(Number(epochSeconds) * 1000);
    return d.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
  } catch (_) { return '-'; }
}

function extractSlipTransactionTime(slipDataStr) {
  if (!slipDataStr) return null;
  try {
    const obj = typeof slipDataStr === 'string' ? JSON.parse(slipDataStr) : slipDataStr;
    return obj?.data?.date || obj?.date || obj?.transTimestamp || obj?.transaction_date || null;
  } catch (_) { return null; }
}

// ลบคำนำหน้าชื่อ (ตรงกับ removeTitlePrefix ฝั่ง backend)
function reportRemoveTitlePrefix(name) {
  if (!name) return '';
  return String(name).replace(/^(นาย|นาง|นางสาว|น\.ส\.|ด\.ช\.|ด\.ญ\.|mr\.?|mrs\.?|ms\.?|miss)\s*/i, '');
}
function reportNormalize(name) {
  return reportRemoveTitlePrefix(name || '').toLowerCase().replace(/\s+/g, '');
}
// หา longest common substring ระหว่าง 2 ชื่อ (normalize แล้ว) — คืนค่าตัวอักษรที่ match
function reportMatchedChars(a, b) {
  const x = reportNormalize(a);
  const y = reportNormalize(b);
  if (!x || !y) return '';
  const maxLen = Math.min(x.length, y.length);
  for (let len = maxLen; len >= 1; len--) {
    for (let start = 0; start <= x.length - len; start++) {
      const chunk = x.substring(start, start + len);
      if (y.includes(chunk)) return chunk;
    }
  }
  return '';
}
// หา matched chars สำหรับผู้รับ — ลองทั้ง TH และ EN
function reportMatchedCharsReceiver(slipName, nameTh, nameEn) {
  const a = reportMatchedChars(slipName, nameTh);
  const b = reportMatchedChars(slipName, nameEn);
  return a.length >= b.length ? a : b;
}

window.openReportLogPage = async function(e) {
  if (e && e.preventDefault) e.preventDefault();
  const dashboard = document.getElementById('dashboardPage');
  const page = document.getElementById('reportLogPage');
  const body = document.getElementById('reportLogBody');
  const detail = document.getElementById('reportLogDetail');
  if (!page || !body) {
    console.error('[Report] reportLogPage element not found');
    return;
  }
  if (dashboard) dashboard.style.display = 'none';
  page.style.display = 'block';
  if (detail) {
    detail.innerHTML = '<div style="color: var(--color-gray-500); text-align: center; padding: 40px 20px;">เลือกรายการทางซ้ายเพื่อดูรายละเอียด</div>';
  }
  body.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--color-gray-500);">กำลังโหลด...</div>';

  try {
    const params = new URLSearchParams();
    if (window.currentTeamId) params.set('teamId', window.currentTeamId);
    params.set('limit', '200');
    const res = await api.request('/api/report-logs?' + params.toString());
    const rows = (res && res.data) || [];
    window.__reportLogCache = rows;

    if (!rows.length) {
      body.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--color-gray-500);">ยังไม่มีรายการรีพอร์ต</div>';
      return;
    }

    body.innerHTML = rows.map((r, idx) => {
      let types = [];
      try { types = JSON.parse(r.report_types || '[]'); } catch (_) { types = []; }
      const typeText = types.map((t) => REPORT_TYPE_LABELS[t] || t).join(', ');
      const tenant = r.tenant_name || r.tenant_id || '-';
      return `
        <div class="report-log-row" data-idx="${idx}" onclick="window.viewReportDetail(${idx})"
          style="border: 1px solid var(--color-gray-200); border-radius: 8px; padding: 10px; margin-bottom: 8px; cursor: pointer; transition: background 0.15s;"
          onmouseover="this.style.background='var(--color-gray-50)'" onmouseout="this.style.background=''">
          <div style="display: flex; justify-content: space-between; gap: 8px; margin-bottom: 4px;">
            <strong style="font-size: 0.95em;">${escapeReportText(tenant)}</strong>
            <span style="color: var(--color-gray-500); font-size: 0.8em;">${formatReportDate(r.created_at)}</span>
          </div>
          ${typeText ? `<div style="color: #d97706; font-size: 0.85em; margin-bottom: 2px;">${escapeReportText(typeText)}</div>` : ''}
          <div style="color: var(--color-gray-600); font-size: 0.85em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            ${escapeReportText(r.detail || '')}
          </div>
          <div style="margin-top: 6px; display: flex; gap: 6px;">
            <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 0.8em;" onclick="event.stopPropagation(); window.viewReportDetail(${idx})">
              ดูรายละเอียด
            </button>
            <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 0.8em; color: #dc2626; border-color: #fecaca;" onclick="event.stopPropagation(); window.deleteReportLog('${escapeReportText(r.id)}')">
              ลบ
            </button>
          </div>
        </div>
      `;
    }).join('');

    if (window.lucide) lucide.createIcons();
  } catch (err) {
    console.error('[Report] load logs failed:', err);
    body.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--color-danger, #dc2626);">โหลดรายการรีพอร์ตไม่สำเร็จ</div>';
  }
};

window.viewReportDetail = function(idx) {
  const rows = window.__reportLogCache || [];
  const r = rows[idx];
  const detail = document.getElementById('reportLogDetail');
  if (!detail || !r) return;

  let types = [];
  try { types = JSON.parse(r.report_types || '[]'); } catch (_) {}
  const typeText = types.map((t) => REPORT_TYPE_LABELS[t] || t).join(', ') || '-';

  let meta = {};
  try { meta = JSON.parse(r.metadata || '{}'); } catch (_) {}

  const slipTime = extractSlipTransactionTime(meta.slip_data);
  const teamName = r.team_name || meta.team_name || r.team_id || '-';
  const tenantName = r.tenant_name || '-';

  const row = (label, value) => `
    <div style="display: flex; gap: 12px; padding: 6px 0; border-bottom: 1px dashed var(--color-gray-200);">
      <div style="width: 200px; color: var(--color-gray-600); font-size: 0.9em;">${escapeReportText(label)}</div>
      <div style="flex: 1; word-break: break-word;">${escapeReportText(value || '-')}</div>
    </div>
  `;

  detail.innerHTML = `
    <div style="margin-bottom: 16px;">
      <h3 style="margin: 0 0 4px 0; font-size: 1.05rem;">รายละเอียดรีพอร์ต</h3>
      <div style="color: var(--color-gray-500); font-size: 0.85em;">TX: ${escapeReportText(r.transaction_id)}</div>
    </div>

    <div style="margin-bottom: 16px;">
      <h4 style="margin: 0 0 6px 0; font-size: 0.95rem; color: #d97706;">ปัญหาที่ระบุ</h4>
      <div style="background: #fff7ed; border: 1px solid #fed7aa; border-radius: 6px; padding: 10px;">
        <div style="font-weight: 600; margin-bottom: 4px;">${escapeReportText(typeText)}</div>
        <div style="white-space: pre-wrap;">${escapeReportText(r.detail || '')}</div>
      </div>
    </div>

    <div style="margin-bottom: 16px;">
      <h4 style="margin: 0 0 6px 0; font-size: 0.95rem;">ข้อมูลรายการ</h4>
      ${row('ทีม', teamName)}
      ${row('เว็บที่รีพอร์ต', tenantName)}
      ${row('ยอดเงิน', meta.amount != null ? Number(meta.amount).toLocaleString('th-TH', { minimumFractionDigits: 2 }) + ' บาท' : '-')}
      ${row('ชื่อในสลิป (ผู้โอน)', meta.slip_sender_name)}
      ${row('บัญชีผู้โอน', meta.slip_sender_account)}
      ${row('ชื่อในสลิป (ผู้รับ)', meta.slip_receiver_name)}
      ${row('บัญชีผู้รับ', meta.slip_receiver_account)}
      ${row('ชื่อที่ระบบ match (ผู้โอน)', meta.matched_username)}
      ${row('ชื่อที่ระบบ match (ผู้รับ TH)', meta.matched_receiver_name_th)}
      ${row('ชื่อที่ระบบ match (ผู้รับ EN)', meta.matched_receiver_name_en)}
      ${(() => {
        const senderChars = reportMatchedChars(meta.slip_sender_name, meta.matched_username);
        const receiverChars = reportMatchedCharsReceiver(meta.slip_receiver_name, meta.matched_receiver_name_th, meta.matched_receiver_name_en);
        const chip = (txt) => txt
          ? `<span style="display: inline-block; background: #fef9c3; color: #92400e; border: 1px solid #fde68a; padding: 2px 8px; border-radius: 6px; font-family: monospace; font-weight: 600; letter-spacing: 0.5px;">${escapeReportText(txt)}</span> <span style="color: var(--color-gray-500); font-size: 0.85em;">(${txt.length} ตัว)</span>`
          : '<span style="color: var(--color-gray-400);">- ไม่พบตัวอักษรที่ match -</span>';
        return `
          <div style="display: flex; gap: 12px; padding: 6px 0; border-bottom: 1px dashed var(--color-gray-200);">
            <div style="width: 200px; color: var(--color-gray-600); font-size: 0.9em;">อักษรที่ match (ผู้โอน)</div>
            <div style="flex: 1; word-break: break-word;">${chip(senderChars)}</div>
          </div>
          <div style="display: flex; gap: 12px; padding: 6px 0; border-bottom: 1px dashed var(--color-gray-200);">
            <div style="width: 200px; color: var(--color-gray-600); font-size: 0.9em;">อักษรที่ match (ผู้รับ)</div>
            <div style="flex: 1; word-break: break-word;">${chip(receiverChars)}</div>
          </div>
        `;
      })()}
      ${row('สถานะรายการ', meta.status)}
    </div>

    <div style="margin-bottom: 16px;">
      <h4 style="margin: 0 0 6px 0; font-size: 0.95rem;">เวลา</h4>
      ${row('เวลาที่โอน (จากสลิป)', slipTime)}
      ${row('เวลาที่ทำรายการ (เข้าระบบ)', formatReportDate(meta.transaction_created_at))}
      ${row('เวลาที่รีพอร์ต', formatReportDate(r.created_at))}
    </div>

    <div>
      <h4 style="margin: 0 0 6px 0; font-size: 0.95rem;">ผู้ส่งรีพอร์ต</h4>
      ${row('ชื่อ', r.sender_name)}
    </div>
  `;
};

window.closeReportLogPage = function() {
  const dashboard = document.getElementById('dashboardPage');
  const page = document.getElementById('reportLogPage');
  if (page) page.style.display = 'none';
  if (dashboard) dashboard.style.display = 'block';
};

window.deleteReportLog = async function(reportId) {
  if (!reportId) return;
  if (!confirm('ต้องการลบรายการรีพอร์ตนี้ใช่หรือไม่?')) return;
  try {
    await api.request('/api/report-logs/' + encodeURIComponent(reportId), { method: 'DELETE' });
    UI.showToast('🗑 ลบรีพอร์ตแล้ว', 'success');
    // reload list
    await window.openReportLogPage();
    // clear detail panel
    const detail = document.getElementById('reportLogDetail');
    if (detail) {
      detail.innerHTML = '<div style="color: var(--color-gray-500); text-align: center; padding: 40px 20px;">เลือกรายการทางซ้ายเพื่อดูรายละเอียด</div>';
    }
  } catch (err) {
    console.error('[Report] delete failed:', err);
    UI.showToast('❌ ลบไม่สำเร็จ: ' + (err.message || err), 'error');
  }
};

// ============================================================
// SCAN LOG PAGE (รายการสแกนทั้งหมด + filter + pagination)
// ============================================================
window.__scanLogState = { page: 1, limit: 50, total: 0, pollTimer: null };

function scanLogToDatetimeLocalValue(epochSec) {
  if (!epochSec) return '';
  const d = new Date(epochSec * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function scanLogDatetimeLocalToEpoch(v) {
  if (!v) return '';
  const t = new Date(v).getTime();
  if (isNaN(t)) return '';
  return Math.floor(t / 1000);
}

window.openScanLogPage = async function(e) {
  if (e && e.preventDefault) e.preventDefault();
  const dashboard = document.getElementById('dashboardPage');
  const page = document.getElementById('scanLogPage');
  if (!page) { console.error('[ScanLog] page element not found'); return; }
  if (dashboard) dashboard.style.display = 'none';
  page.style.display = 'block';

  // Populate tenant filter
  const tenantSelect = document.getElementById('scanLogTenantFilter');
  if (tenantSelect && tenantSelect.options.length <= 1 && Array.isArray(window.currentTenants)) {
    window.currentTenants.forEach((tenant) => {
      const opt = document.createElement('option');
      opt.value = tenant.id;
      opt.textContent = tenant.name;
      tenantSelect.appendChild(opt);
    });
  }

  window.__scanLogState.page = 1;
  await scanLogReload(1);

  // Start polling every 10s (only when on page 1 and no date filter)
  if (window.__scanLogState.pollTimer) clearInterval(window.__scanLogState.pollTimer);
  window.__scanLogState.pollTimer = setInterval(() => {
    const dateFrom = document.getElementById('scanLogDateFrom')?.value;
    const dateTo = document.getElementById('scanLogDateTo')?.value;
    if (window.__scanLogState.page === 1 && !dateFrom && !dateTo) {
      scanLogReload(1, true);
    }
  }, 10000);

  if (window.lucide) lucide.createIcons();
};

window.closeScanLogPage = function() {
  const dashboard = document.getElementById('dashboardPage');
  const page = document.getElementById('scanLogPage');
  if (page) page.style.display = 'none';
  if (dashboard) dashboard.style.display = 'block';
  if (window.__scanLogState.pollTimer) {
    clearInterval(window.__scanLogState.pollTimer);
    window.__scanLogState.pollTimer = null;
  }
};

window.scanLogClearFilters = function() {
  const ids = ['scanLogTenantFilter', 'scanLogStatusFilter', 'scanLogDateFrom', 'scanLogDateTo'];
  ids.forEach((id) => { const el = document.getElementById(id); if (el) el.value = ''; });
  scanLogReload(1);
};

window.scanLogReload = async function(page, silent) {
  if (typeof page === 'number') window.__scanLogState.page = page;
  const listEl = document.getElementById('scanLogList');
  const totalLabel = document.getElementById('scanLogTotalLabel');
  const pagEl = document.getElementById('scanLogPagination');
  if (!listEl) return;
  if (!silent) listEl.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--color-gray-500);">กำลังโหลด...</div>';

  const tenantId = document.getElementById('scanLogTenantFilter')?.value || '';
  const status = document.getElementById('scanLogStatusFilter')?.value || '';
  const dateFromEpoch = scanLogDatetimeLocalToEpoch(document.getElementById('scanLogDateFrom')?.value);
  const dateToEpoch = scanLogDatetimeLocalToEpoch(document.getElementById('scanLogDateTo')?.value);

  try {
    const res = await api.searchPendingTransactions({
      page: window.__scanLogState.page,
      limit: window.__scanLogState.limit,
      tenantId,
      status,
      dateFrom: dateFromEpoch,
      dateTo: dateToEpoch,
    });
    const payload = res?.data || {};
    const items = payload.data || [];
    const total = Number(payload.total || 0);
    window.__scanLogState.total = total;

    if (totalLabel) {
      totalLabel.textContent = total > 0 ? `ทั้งหมด ${total.toLocaleString('th-TH')} รายการ` : 'ไม่พบรายการ';
    }

    if (items.length === 0) {
      listEl.innerHTML = '<div style="padding: 40px 20px; text-align: center; color: var(--color-gray-500);">ไม่พบรายการตามตัวกรอง</div>';
    } else {
      // Reuse the same item HTML used in the scan card
      const prev = document.getElementById('pendingList');
      const originalParent = prev?.parentNode;
      // Render into a detached pendingList first using UI.renderPendingTransactions then move
      // Simpler: render directly using same template
      listEl.innerHTML = items.map((item) => renderScanLogItemHTML(item)).join('');
      if (window.lucide) lucide.createIcons();
    }

    // Pagination controls
    if (pagEl) {
      const totalPages = Math.max(1, Math.ceil(total / window.__scanLogState.limit));
      const cur = window.__scanLogState.page;
      const pages = [];
      const pushBtn = (label, target, disabled, active) => {
        pages.push(`<button class="btn ${active ? 'btn-primary' : 'btn-secondary'}" style="padding: 4px 10px; font-size: 0.85em; ${disabled ? 'opacity: 0.4; pointer-events: none;' : ''}" onclick="scanLogReload(${target})">${label}</button>`);
      };
      pushBtn('« แรก', 1, cur === 1, false);
      pushBtn('‹ ก่อนหน้า', Math.max(1, cur - 1), cur === 1, false);
      // Window of 5 pages around current
      const start = Math.max(1, cur - 2);
      const end = Math.min(totalPages, start + 4);
      for (let i = start; i <= end; i++) pushBtn(String(i), i, false, i === cur);
      pushBtn('ถัดไป ›', Math.min(totalPages, cur + 1), cur === totalPages, false);
      pushBtn('สุดท้าย »', totalPages, cur === totalPages, false);
      pagEl.innerHTML = pages.join('') + `<span style="color: var(--color-gray-600); font-size: 0.85em; margin-left: var(--space-md);">หน้า ${cur} / ${totalPages}</span>`;
    }
  } catch (err) {
    console.error('[ScanLog] load failed:', err);
    if (!silent) listEl.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--color-danger, #dc2626);">โหลดไม่สำเร็จ: ${err.message || err}</div>`;
  }
};

function renderScanLogItemHTML(item) {
  const amount = Number(item.amount || 0).toLocaleString('th-TH');
  let slipDate = '-';
  try {
    if (item.slip_data) {
      const sd = typeof item.slip_data === 'string' ? JSON.parse(item.slip_data) : item.slip_data;
      if (sd && sd.date) {
        const d = new Date(sd.date);
        if (!isNaN(d.getTime())) {
          slipDate = d.toLocaleString('th-TH', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
        }
      }
    }
    if (slipDate === '-' && item.created_at) {
      slipDate = new Date(item.created_at * 1000).toLocaleString('th-TH');
    }
  } catch (_) {
    slipDate = item.created_at ? new Date(item.created_at * 1000).toLocaleString('th-TH') : '-';
  }
  let matchedUserText = '';
  if (item.matched_username && item.matched_user_id) matchedUserText = `${item.matched_username} (${item.matched_user_id})`;
  else if (item.matched_username) matchedUserText = item.matched_username;
  else if (item.matched_user_id) matchedUserText = `(${item.matched_user_id})`;
  const statusConfig = {
    pending: { color: 'yellow', label: 'รอจับคู่' },
    matched: { color: 'blue', label: 'จับคู่แล้ว' },
    credited: { color: 'green', label: 'เติมแล้ว' },
    duplicate: { color: 'red', label: 'ยอดซ้ำ' },
    failed: { color: 'red', label: 'ล้มเหลว' },
  };
  const status = statusConfig[item.status] || statusConfig.pending;
  const canWithdraw = item.status === 'credited';
  const canCredit = !!item.matched_user_id && item.status !== 'credited' && item.status !== 'duplicate';
  const creditActionHtml = canWithdraw
    ? `<button class="pending-credit-btn pending-credit-btn-withdraw" onclick="withdrawPendingCredit('${item.id}')" title="ดึงเครดิตกลับ">ดึงเครดิตกลับ</button>`
    : (canCredit
        ? `<button class="pending-credit-btn" onclick="creditPendingItem('${item.id}', event)" title="เติมเครดิต">เติมเครดิต</button>`
        : '');
  return `
    <div class="pending-item" data-item-id="${item.id}" data-tenant-id="${item.tenant_id}">
      <div class="pending-item-top">
        <span class="status-badge status-${status.color}">${status.label}</span>
        <div class="matched-user-info">
          ${matchedUserText ? `<span class="matched-user-text">${matchedUserText}</span>` : ''}
          <button class="pending-search-btn" onclick="openUserSearch('${item.id}', '${item.tenant_id}')" title="ค้นหาและจับคู่ผู้ใช้">
            <i data-lucide="search"></i>
          </button>
          <button class="pending-report-btn" onclick="openReportModal('${item.id}')" title="รีพอร์ตปัญหา">
            <i data-lucide="alert-triangle"></i>
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
            ${item.receiver_name ? `<i data-lucide="arrow-right" style="width: 13px; height: 13px; color: var(--color-gray-400); flex-shrink: 0;"></i><span class="receiver-name">${item.receiver_name}</span>` : ''}
          </div>
          <div>
            <span class="slip-date">${slipDate}</span>${item.tenant_name ? `<span class="tenant-name">${item.tenant_name}</span>` : ''}
          </div>
        </div>
        <div class="pending-amount-actions">
          ${creditActionHtml}
          <span class="amount">${amount} บาท</span>
        </div>
      </div>
    </div>
  `;
}

// ============================================================
// START APPLICATION
// ============================================================

document.addEventListener('DOMContentLoaded', init);
