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
      const webhookUrl = `${API_CONFIG.BASE_URL}/webhook/${encodeURIComponent(currentTenantId)}/${encodeURIComponent(lineOA.id)}`;

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

async function creditPendingItem(transactionId) {
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
// START APPLICATION
// ============================================================

document.addEventListener('DOMContentLoaded', init);
