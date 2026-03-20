// ============================================================
// APPLICATION STATE
// ============================================================

let currentTeamSlug = 'default';
let currentTeamId = null;
let currentTenants = [];
let currentPendingTransactions = [];
let notifications = [];
let realtimeConnection = null;
let isUploading = false;
let uploadPreviewUrl = null;
let activeUserSearchTransactionId = null;
let activeUserSearchTenantId = null;
let lastRenderedPendingTransactions = [];
const userSearchState = new Map();

// Search state
let searchQuery = '';

// ============================================================
// INITIALIZATION
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
  console.log('ATslip Extension loaded');
  
  // Load saved team slug
  const result = await chrome.storage.local.get(['currentTeamSlug']);
  currentTeamSlug = result.currentTeamSlug || 'default';
  
  // Initialize UI
  initializeEventListeners();
  await loadTeams();
  await loadData();
  
  // Start realtime connection
  initializeRealtime();
  
  // Auto refresh every 30 seconds
  setInterval(() => {
    loadPendingTransactions();
  }, 30000);
});

// ============================================================
// EVENT LISTENERS
// ============================================================

function initializeEventListeners() {
  // Team selector
  document.getElementById('teamSelect').addEventListener('change', async (e) => {
    currentTeamSlug = e.target.value;
    await api.setCurrentTeamSlug(currentTeamSlug);
    await loadData();
    initializeRealtime();
  });

  // Refresh button
  document.getElementById('refreshBtn').addEventListener('click', async () => {
    await loadData();
    showToast('รีเฟรชข้อมูลแล้ว', 'success');
  });

  // Notification button
  document.getElementById('notificationBtn').addEventListener('click', () => {
    // TODO: Show notification panel
    showToast('การแจ้งเตือน', 'info');
  });

  document.addEventListener('click', () => {
    closeAllTenantMenus();
  });

  // Tenant row scroll controls
  document.getElementById('tenantPrevBtn').addEventListener('click', () => {
    const tenantList = document.getElementById('tenantList');
    tenantList.scrollBy({ left: -tenantList.clientWidth, behavior: 'smooth' });
  });

  document.getElementById('tenantNextBtn').addEventListener('click', () => {
    const tenantList = document.getElementById('tenantList');
    tenantList.scrollBy({ left: tenantList.clientWidth, behavior: 'smooth' });
  });

  document.getElementById('tenantList').addEventListener('scroll', syncTenantArrowState);

  // Tenant menu actions via delegation (CSP-safe)
  document.getElementById('tenantList').addEventListener('click', async (e) => {
    const openExternalBtn = e.target.closest('[data-action="open-tenant-external"]');
    if (openExternalBtn) {
      e.stopPropagation();
      const targetUrl = openExternalBtn.dataset.url;
      if (targetUrl) {
        window.open(targetUrl, '_blank');
      }
      return;
    }

    const actionBtn = e.target.closest('[data-action]');
    if (!actionBtn) return;

    const action = actionBtn.dataset.action;
    const tenantId = actionBtn.dataset.tenantId;
    if (!tenantId) return;

    if (action === 'refresh-tenant') {
      await refreshTenantData(tenantId);
      return;
    }
    if (action === 'toggle-tenant-connection') {
      const isConnected = actionBtn.dataset.connected === 'true';
      await toggleTenantConnection(tenantId, isConnected);
      return;
    }
    if (action === 'remove-tenant-local') {
      removeTenantLocal(tenantId);
    }
  });

  // Upload zone
  const uploadZone = document.getElementById('uploadZone');
  const fileInput = document.getElementById('fileInput');

  uploadZone.addEventListener('click', () => {
    fileInput.click();
  });

  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('dragging');
  });

  uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('dragging');
  });

  uploadZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    uploadZone.classList.remove('dragging');
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      await handleFileUpload(files[0]);
    }
  });

  fileInput.addEventListener('change', async (e) => {
    const files = e.target.files;
    if (files.length > 0) {
      await handleFileUpload(files[0]);
    }
  });

  // Paste image anywhere in side panel
  document.addEventListener('paste', async (e) => {
    const clipboardItems = e.clipboardData?.items;
    if (!clipboardItems) return;

    for (const item of clipboardItems) {
      if (item.type && item.type.startsWith('image/')) {
        const pastedFile = item.getAsFile();
        if (pastedFile) {
          const ext = item.type.split('/')[1] || 'png';
          const file = new File([pastedFile], `pasted-slip.${ext}`, { type: pastedFile.type });
          showToast('ตรวจพบภาพจากคลิปบอร์ด กำลังอัปโหลด...', 'info');
          await handleFileUpload(file);
          break;
        }
      }
    }
  });

  // Search input
  document.getElementById('searchInput').addEventListener('input', (e) => {
    searchQuery = e.target.value.trim().toLowerCase();
    filterPendingTransactions();
  });

  // Copy user fullname + username from pending card
  document.getElementById('pendingList').addEventListener('click', async (e) => {
    const deleteBtn = e.target.closest('[data-action="delete-pending"]');
    if (deleteBtn) {
      const transactionId = deleteBtn.dataset.transactionId;
      if (!transactionId) return;
      await deletePendingItem(transactionId);
      return;
    }

    const searchToggle = e.target.closest('[data-action="toggle-user-search"]');
    if (searchToggle) {
      const transactionId = searchToggle.dataset.transactionId;
      const tenantId = searchToggle.dataset.tenantId;
      if (!transactionId || !tenantId) return;

      if (activeUserSearchTransactionId === transactionId) {
        activeUserSearchTransactionId = null;
        activeUserSearchTenantId = null;
      } else {
        activeUserSearchTransactionId = transactionId;
        activeUserSearchTenantId = tenantId;
      }
      renderPendingTransactions(lastRenderedPendingTransactions);
      return;
    }

    const selectUser = e.target.closest('[data-action="select-user"]');
    if (selectUser) {
      const transactionId = selectUser.dataset.transactionId;
      const tenantId = selectUser.dataset.tenantId;
      const userId = selectUser.dataset.userId;
      const userName = selectUser.dataset.userName;
      if (!transactionId || !tenantId || !userId || !userName) return;
      await matchPendingUser(transactionId, tenantId, userId, userName);
      return;
    }

    const creditBtn = e.target.closest('[data-action="credit-pending"]');
    if (creditBtn) {
      const transactionId = creditBtn.dataset.transactionId;
      if (!transactionId) return;
      await creditPendingItem(transactionId);
      return;
    }

    const copyTarget = e.target.closest('[data-action="copy-user"]');
    if (!copyTarget) return;
    const copyValue = copyTarget.dataset.copyValue || '';
    if (!copyValue) return;
    try {
      await navigator.clipboard.writeText(copyValue);
      showToast('คัดลอกข้อมูลผู้ใช้แล้ว', 'success');
    } catch {
      showToast('คัดลอกไม่สำเร็จ', 'error');
    }
  });

  document.getElementById('pendingList').addEventListener('input', async (e) => {
    const searchInput = e.target.closest('[data-action="user-search-input"]');
    if (!searchInput) return;

    const transactionId = searchInput.dataset.transactionId;
    const tenantId = searchInput.dataset.tenantId;
    if (!transactionId || !tenantId) return;

    const query = String(searchInput.value || '').trim();
    const currentState = userSearchState.get(transactionId) || {};
    userSearchState.set(transactionId, {
      ...currentState,
      query,
      loading: query.length >= 2,
      users: query.length >= 2 ? [] : null,
      error: null,
    });
    renderPendingTransactions(lastRenderedPendingTransactions);

    if (query.length < 2) return;
    await performUserSearch(transactionId, tenantId, query);
  });
}

// ============================================================
// DATA LOADING
// ============================================================

async function loadTeams() {
  try {
    const response = await api.getTeams();
    const teams = response.data || [];
    
    const teamSelect = document.getElementById('teamSelect');
    teamSelect.innerHTML = '<option value="default">-- เลือกทีม --</option>';
    
    teams.forEach(team => {
      const option = document.createElement('option');
      option.value = team.slug;
      option.textContent = team.name;
      option.selected = team.slug === currentTeamSlug;
      teamSelect.appendChild(option);
    });
  } catch (error) {
    console.error('Failed to load teams:', error);
  }
}

async function loadData() {
  if (currentTeamSlug === 'default') {
    showEmptyState();
    return;
  }
  
  await Promise.all([
    loadTenants(),
    loadPendingTransactions(),
  ]);
}

async function loadTenants() {
  try {
    const response = await api.getTenants();
    currentTenants = normalizeListPayload(response);
    
    renderTenants();
  } catch (error) {
    console.error('Failed to load tenants:', error);
    showError('ไม่สามารถโหลดรายชื่อเว็บได้');
  }
}

async function loadPendingTransactions() {
  try {
    const response = await api.getPendingTransactions();
    currentPendingTransactions = normalizeListPayload(response);
    
    filterPendingTransactions();
  } catch (error) {
    console.error('Failed to load pending transactions:', error);
    showError('ไม่สามารถโหลดรายการสแกนได้');
  }
}

// ============================================================
// RENDERING
// ============================================================

function renderTenants() {
  const tenantList = document.getElementById('tenantList');
  const tenantCount = document.getElementById('tenantCount');
  const prevBtn = document.getElementById('tenantPrevBtn');
  const nextBtn = document.getElementById('tenantNextBtn');
  
  if (currentTenants.length === 0) {
    tenantList.innerHTML = '<div class="sp-empty">ไม่มีเว็บในทีมนี้</div>';
    tenantCount.textContent = '0';
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    return;
  }

  tenantCount.textContent = currentTenants.length;
  prevBtn.disabled = false;
  nextBtn.disabled = false;

  tenantList.innerHTML = currentTenants.map(tenant => `
    <div class="sp-tenant-card">
      <div class="sp-tenant-info">
        <div class="sp-tenant-icon">${(tenant.name || 'U').charAt(0).toUpperCase()}</div>
        <div class="sp-tenant-meta">
          <div class="sp-tenant-name">${escapeHtml(tenant.name || 'Unknown')}</div>
          <div class="sp-tenant-url">${escapeHtml(tenant.admin_api_url || '-')}</div>
          <div class="sp-status-row">
            <div class="sp-tenant-status">
              <span class="sp-status-dot ${tenant.status === 'active' ? '' : 'inactive'}"></span>
              ${tenant.status === 'active' ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}
            </div>
            <span class="sp-mini-pill">${tenant.admin_connected ? 'เชื่อมต่อแล้ว' : 'ยังไม่เชื่อมต่อ'}</span>
          </div>
        </div>
      </div>
      <div class="sp-tenant-card-actions">
        <button class="sp-tenant-menu-btn sp-tenant-external-btn" data-action="open-tenant-external" data-url="https://app.atslip.biz/#/${escapeAttr(tenant.team_slug || currentTeamSlug || 'default')}" title="เปิดหน้าเว็บ">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 3h7v7"></path>
            <path d="M10 14L21 3"></path>
            <path d="M21 14v7h-7"></path>
            <path d="M3 10V3h7"></path>
            <path d="M3 21l7-7"></path>
          </svg>
        </button>
      </div>
    </div>
  `).join('');

  tenantList.scrollTo({ left: 0, behavior: 'auto' });
  syncTenantArrowState();
}

function filterPendingTransactions() {
  let filtered = [...currentPendingTransactions];

  if (searchQuery) {
    filtered = filtered.filter((item) => {
      const haystacks = [
        item.sender_name,
        item.matched_username,
        item.tenant_name,
        item.slip_ref,
        String(item.amount || ''),
        extractReceiverDisplay(item),
      ]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase());

      return haystacks.some((value) => value.includes(searchQuery));
    });
  }
  
  renderPendingTransactions(filtered);
}

function renderPendingTransactions(transactions) {
  lastRenderedPendingTransactions = transactions;
  const pendingList = document.getElementById('pendingList');
  const pendingCount = document.getElementById('pendingCount');
  
  if (transactions.length === 0) {
    pendingList.innerHTML = '<div class="sp-empty">ไม่มีรายการสแกน</div>';
    pendingCount.textContent = '0';
    return;
  }
  
  pendingCount.textContent = transactions.length;
  
  pendingList.innerHTML = transactions.map(t => {
    const tenant = currentTenants.find(tn => String(tn.id) === String(t.tenant_id));
    const statusText = getStatusText(t.status);
    const senderName = t.sender_name || 'Unknown';
    const receiverDisplay = extractReceiverDisplay(t);
    const displayName = t.matched_username || '-';
    const displayUsername = t.matched_user_id ? String(t.matched_user_id) : '';
    const copyText = displayUsername ? `${displayName} (${displayUsername})` : displayName;
    const isMatched = t.status === 'matched';
    const canCopyUser = !!(t.matched_username || t.matched_user_id);
    const createdAtMs = Number(t.created_at || 0) * 1000;
    const date = createdAtMs > 0 ? new Date(createdAtMs).toLocaleString('th-TH', {
      dateStyle: 'short',
      timeStyle: 'short'
    }) : '-';
    
    return `
      <div class="sp-pending-item">
        <div class="sp-pending-header">
          <div class="sp-pending-amount">฿${formatNumber(t.amount)}</div>
          <div class="sp-pending-header-actions">
            <span class="sp-pending-status ${t.status}">${statusText}</span>
            <button type="button" class="sp-pending-delete-btn" data-action="delete-pending" data-transaction-id="${t.id}" title="ลบรายการ">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6 6 18"></path>
                <path d="m6 6 12 12"></path>
              </svg>
            </button>
          </div>
        </div>
        <div class="sp-pending-info">
          <div class="sp-pending-row sp-pending-row-main">
            <span class="sp-pending-line-text"><strong>จาก:</strong> ${escapeHtml(senderName)}</span>
            <span class="sp-inline-arrow">&rarr;</span>
            <span class="sp-pending-receiver" title="ชื่อบัญชีผู้รับโอน ${escapeHtml(receiverDisplay)}">${escapeHtml(receiverDisplay)}</span>
          </div>
          <div class="sp-pending-row sp-pending-row-user">
            ${canCopyUser
              ? `<button type="button" class="sp-pending-user-copy" data-action="copy-user" data-copy-value="${escapeAttr(copyText)}" title="คลิกเพื่อคัดลอก ${escapeAttr(copyText)}"><strong>ผู้ใช้:</strong> <span class="sp-user-copy-text">${escapeHtml(displayName)}${displayUsername ? ` (${escapeHtml(displayUsername)})` : ''}</span></button>`
              : `<div class="sp-pending-user-copy sp-pending-user-placeholder"><strong>ผู้ใช้:</strong> <span class="sp-user-copy-text">-</span></div>`}
            ${t.status === 'pending' ? `<button type="button" class="sp-pending-inline-btn" data-action="toggle-user-search" data-tenant-id="${t.tenant_id}" data-transaction-id="${t.id}" title="ค้นหาลูกค้า">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8"></circle>
                <path d="m21 21-4.3-4.3"></path>
              </svg>
            </button>` : ''}
            ${isMatched ? `<button type="button" class="sp-pending-inline-btn sp-credit-btn" data-action="credit-pending" data-transaction-id="${t.id}">เติมเครดิต</button>` : ''}
          </div>
          ${renderUserSearchDropdown(t)}
          <div><strong>เวลา:</strong> ${date}</div>
          <div class="sp-pending-tenant-corner"><strong>เว็บ:</strong> ${escapeHtml(tenant?.name || 'Unknown')}</div>
        </div>
      </div>
    `;
  }).join('');
}

// ============================================================
// FILE UPLOAD
// ============================================================

async function handleFileUpload(file) {
  if (isUploading) {
    showToast('กำลังประมวลผลสลิปอยู่ กรุณารอสักครู่', 'warning');
    return;
  }

  if (!file.type.startsWith('image/')) {
    showToast('กรุณาเลือกไฟล์รูปภาพเท่านั้น', 'error');
    return;
  }

  isUploading = true;
  setUploadPreview(file);
  setUploadProcessing(true);

  try {
    showToast('กำลังสแกนสลิป...', 'info');
    
    const response = await api.uploadSlip(file, null);
    
    if (response.success) {
      showToast('สแกนสลิปสำเร็จ!', 'success');
      
      // Reload pending transactions
      await loadPendingTransactions();
      
      // Clear file input
      document.getElementById('fileInput').value = '';
    } else {
      showToast(response.message || 'การสแกนล้มเหลว', 'error');
    }
  } catch (error) {
    console.error('Upload failed:', error);
    showToast(error.message || 'ไม่สามารถอัพโหลดสลิปได้', 'error');
  } finally {
    isUploading = false;
    setUploadProcessing(false);
    clearUploadPreview();
  }
}

// ============================================================
// REALTIME CONNECTION
// ============================================================

function initializeRealtime() {
  if (realtimeConnection) {
    realtimeConnection.close();
    realtimeConnection = null;
  }

  if (currentTeamSlug === 'default') {
    return;
  }

  const wsUrl = `${API_CONFIG.BASE_URL.replace(/^http/, 'ws')}/api/realtime/ws`;
  try {
    realtimeConnection = new WebSocket(wsUrl);

    realtimeConnection.addEventListener('open', () => {
      console.log('Realtime connection initialized');
    });

    realtimeConnection.addEventListener('message', async (event) => {
      try {
        const payload = JSON.parse(event.data || '{}');
        if (payload?.type === 'connected') {
          return;
        }

        if (payload?.type === 'new_pending' || payload?.type === 'transaction_updated') {
          await loadPendingTransactions();
        }
      } catch (error) {
        console.error('Realtime message parse error:', error);
      }
    });

    realtimeConnection.addEventListener('close', () => {
      // Auto reconnect with small backoff
      setTimeout(() => {
        initializeRealtime();
      }, 3000);
    });

    realtimeConnection.addEventListener('error', (error) => {
      console.error('Realtime error:', error);
    });
  } catch (error) {
    console.error('Realtime connection failed:', error);
  }
}

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  
  const toast = document.createElement('div');
  toast.className = `sp-toast ${type}`;
  
  const title = type === 'success' ? 'สำเร็จ' : 
                type === 'error' ? 'เกิดข้อผิดพลาด' :
                type === 'warning' ? 'คำเตือน' : 'แจ้งเตือน';
  
  toast.innerHTML = `
    <div class="sp-toast-title">${title}</div>
    <div class="sp-toast-message">${escapeHtml(message)}</div>
  `;
  
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'slideIn 0.3s ease-out reverse';
    setTimeout(() => {
      container.removeChild(toast);
    }, 300);
  }, 3000);
}

function showError(message) {
  showToast(message, 'error');
}

function showEmptyState() {
  const prevBtn = document.getElementById('tenantPrevBtn');
  const nextBtn = document.getElementById('tenantNextBtn');
  document.getElementById('tenantList').innerHTML = '<div class="sp-empty">กรุณาเลือกทีม</div>';
  document.getElementById('pendingList').innerHTML = '<div class="sp-empty">กรุณาเลือกทีม</div>';
  if (prevBtn) prevBtn.disabled = true;
  if (nextBtn) nextBtn.disabled = true;
}

function normalizeListPayload(response) {
  if (!response) return [];
  if (Array.isArray(response)) return response;
  if (Array.isArray(response.data)) return response.data;
  if (Array.isArray(response.list)) return response.list;
  if (response.data && Array.isArray(response.data.results)) return response.data.results;
  if (Array.isArray(response.results)) return response.results;
  return [];
}

function closeAllTenantMenus() {
  document.querySelectorAll('.sp-tenant-menu-dropdown').forEach((menu) => {
    menu.hidden = true;
  });
}

function toggleTenantMenu(tenantId) {
  const target = document.getElementById(`tenantMenu-${tenantId}`);
  if (!target) return;
  const willOpen = target.hidden;
  closeAllTenantMenus();
  target.hidden = !willOpen;
}

function syncTenantArrowState() {
  const tenantList = document.getElementById('tenantList');
  const prevBtn = document.getElementById('tenantPrevBtn');
  const nextBtn = document.getElementById('tenantNextBtn');
  if (!tenantList || !prevBtn || !nextBtn || currentTenants.length === 0) return;

  const maxScrollLeft = tenantList.scrollWidth - tenantList.clientWidth;
  const current = tenantList.scrollLeft;
  prevBtn.disabled = current <= 2;
  nextBtn.disabled = current >= maxScrollLeft - 2;
}

async function refreshTenantData(tenantId) {
  closeAllTenantMenus();
  try {
    if (typeof api.refreshBankAccounts === 'function') {
      await api.refreshBankAccounts(tenantId);
      showToast('รีเฟรชบัญชีธนาคารแล้ว', 'success');
    } else {
      showToast('ยังไม่รองรับการรีเฟรชใน extension นี้', 'warning');
    }
  } catch (error) {
    showToast(error.message || 'รีเฟรชไม่สำเร็จ', 'error');
  }
}

async function toggleTenantConnection(tenantId, isConnected) {
  closeAllTenantMenus();
  try {
    if (isConnected) {
      await api.disconnectAdmin(tenantId);
      showToast('ยกเลิกการเชื่อมต่อแล้ว', 'success');
    } else {
      await api.connectAdmin(tenantId);
      showToast('เชื่อมต่อสำเร็จ', 'success');
    }
    await loadTenants();
  } catch (error) {
    showToast(error.message || 'อัปเดตการเชื่อมต่อไม่สำเร็จ', 'error');
  }
}

function removeTenantLocal(tenantId) {
  closeAllTenantMenus();
  currentTenants = currentTenants.filter((tenant) => String(tenant.id) !== String(tenantId));
  renderTenants();
}

function renderUserSearchDropdown(item) {
  if (item.status !== 'pending' || activeUserSearchTransactionId !== item.id) {
    return '';
  }

  const state = userSearchState.get(item.id) || {};
  const query = state.query || '';
  const users = Array.isArray(state.users) ? state.users : [];
  const loading = !!state.loading;
  const error = state.error || '';

  let bodyHtml = '<div class="sp-user-search-hint">พิมพ์อย่างน้อย 2 ตัวอักษร</div>';
  if (loading) {
    bodyHtml = '<div class="sp-user-search-hint">กำลังค้นหา...</div>';
  } else if (error) {
    bodyHtml = `<div class="sp-user-search-error">${escapeHtml(error)}</div>`;
  } else if (query.length >= 2 && users.length === 0) {
    bodyHtml = '<div class="sp-user-search-hint">ไม่พบผู้ใช้</div>';
  } else if (users.length > 0) {
    bodyHtml = users.map((user) => {
      const name = String(user.fullname || user.username || 'ไม่ระบุชื่อ');
      const userId = String(user.memberCode || user.username || user.id || '');
      const badge = user.category === 'non-member' ? 'ไม่ใช่สมาชิก' : 'สมาชิก';
      return `
        <button type="button" class="sp-user-search-item" data-action="select-user" data-transaction-id="${item.id}" data-tenant-id="${item.tenant_id}" data-user-id="${escapeAttr(userId)}" data-user-name="${escapeAttr(name)}">
          <span class="sp-user-search-name">${escapeHtml(name)}</span>
          <span class="sp-user-search-meta">${escapeHtml(userId)} • ${escapeHtml(badge)}</span>
        </button>
      `;
    }).join('');
  }

  return `
    <div class="sp-user-search-dropdown">
      <input
        type="text"
        class="sp-input sp-user-search-input"
        data-action="user-search-input"
        data-transaction-id="${item.id}"
        data-tenant-id="${item.tenant_id}"
        value="${escapeAttr(query)}"
        placeholder="ค้นหาลูกค้า..."
      >
      <div class="sp-user-search-results">${bodyHtml}</div>
    </div>
  `;
}

async function performUserSearch(transactionId, tenantId, query) {
  const guardQuery = String(query || '').trim();
  if (guardQuery.length < 2) {
    return;
  }

  try {
    const [memberResponse, nonMemberResponse] = await Promise.all([
      api.searchUsers(guardQuery, 'member', tenantId).catch(() => ({ data: { users: [] } })),
      api.searchUsers(guardQuery, 'non-member', tenantId).catch(() => ({ data: { users: [] } })),
    ]);

    const memberUsers = (memberResponse?.data?.users || []).map((u) => ({ ...u, category: 'member' }));
    const nonMemberUsers = (nonMemberResponse?.data?.users || []).map((u) => ({ ...u, category: 'non-member' }));
    const users = [...memberUsers, ...nonMemberUsers];

    const currentState = userSearchState.get(transactionId) || {};
    if ((currentState.query || '') !== guardQuery) {
      return;
    }

    userSearchState.set(transactionId, {
      ...currentState,
      loading: false,
      users,
      error: null,
    });
    renderPendingTransactions(lastRenderedPendingTransactions);
  } catch (error) {
    const currentState = userSearchState.get(transactionId) || {};
    userSearchState.set(transactionId, {
      ...currentState,
      loading: false,
      users: [],
      error: error instanceof Error ? error.message : 'ค้นหาไม่สำเร็จ',
    });
    renderPendingTransactions(lastRenderedPendingTransactions);
  }
}

async function matchPendingUser(transactionId, tenantId, userId, userName) {
  try {
    await api.matchPendingTransaction(transactionId, {
      matched_user_id: userId,
      matched_username: userName,
      tenant_id: tenantId,
    });

    showToast(`จับคู่ ${userName} สำเร็จ`, 'success');
    activeUserSearchTransactionId = null;
    activeUserSearchTenantId = null;
    userSearchState.delete(transactionId);
    await loadPendingTransactions();
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'จับคู่ผู้ใช้ไม่สำเร็จ', 'error');
  }
}

async function creditPendingItem(transactionId) {
  try {
    await api.creditPendingTransaction(transactionId);
    showToast('ส่งคำสั่งเติมเครดิตแล้ว', 'success');
    await loadPendingTransactions();
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'เติมเครดิตไม่สำเร็จ', 'error');
  }
}

async function deletePendingItem(transactionId) {
  const shouldDelete = window.confirm('คุณต้องการลบรายการนี้หรือไม่?');
  if (!shouldDelete) {
    return;
  }

  try {
    await api.deletePendingTransaction(transactionId);
    showToast('ลบรายการสำเร็จ', 'success');
    if (activeUserSearchTransactionId === transactionId) {
      activeUserSearchTransactionId = null;
      activeUserSearchTenantId = null;
    }
    userSearchState.delete(transactionId);
    await loadPendingTransactions();
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'ลบรายการไม่สำเร็จ', 'error');
  }
}

function extractReceiverDisplay(item) {
  if (item.receiver_name) {
    return String(item.receiver_name);
  }

  try {
    const slipData = typeof item.slip_data === 'string' ? JSON.parse(item.slip_data) : item.slip_data;
    const receiverName = slipData?.receiver?.account?.name?.th || slipData?.receiver?.account?.name?.en;
    if (receiverName) {
      return String(receiverName);
    }

    const account = slipData?.receiver?.account?.bank?.account || slipData?.receiver?.account?.proxy?.account;
    if (account) {
      return String(account);
    }
  } catch {
    // Ignore invalid slip_data and fallback below.
  }

  return String(item.receiver_account || '-');
}

function setUploadPreview(file) {
  const preview = document.getElementById('uploadPreview');
  const emptyState = document.getElementById('uploadEmptyState');
  if (!preview || !emptyState) return;

  if (uploadPreviewUrl) {
    URL.revokeObjectURL(uploadPreviewUrl);
  }

  uploadPreviewUrl = URL.createObjectURL(file);
  preview.src = uploadPreviewUrl;
  preview.hidden = false;
  emptyState.hidden = true;
}

function setUploadProcessing(isProcessing) {
  const uploadZone = document.getElementById('uploadZone');
  const processing = document.getElementById('uploadProcessing');
  const preview = document.getElementById('uploadPreview');
  const canShowProcessing = Boolean(preview && !preview.hidden && preview.getAttribute('src'));
  if (uploadZone) {
    uploadZone.setAttribute('aria-busy', isProcessing ? 'true' : 'false');
  }
  if (processing) {
    processing.hidden = !(isProcessing && canShowProcessing);
  }
}

function clearUploadPreview() {
  const preview = document.getElementById('uploadPreview');
  const emptyState = document.getElementById('uploadEmptyState');
  const fileInput = document.getElementById('fileInput');
  if (!preview || !emptyState) return;

  preview.hidden = true;
  preview.removeAttribute('src');
  emptyState.hidden = false;

  const processing = document.getElementById('uploadProcessing');
  if (processing) {
    processing.hidden = true;
  }

  if (uploadPreviewUrl) {
    URL.revokeObjectURL(uploadPreviewUrl);
    uploadPreviewUrl = null;
  }

  if (fileInput) {
    fileInput.value = '';
  }
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatNumber(num) {
  return new Intl.NumberFormat('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

function getStatusText(status) {
  const statusMap = {
    pending: 'รอจับคู่',
    matched: 'จับคู่แล้ว',
    credited: 'เติมแล้ว',
    duplicate: 'ยอดซ้ำ',
    failed: 'ล้มเหลว',
  };
  return statusMap[status] || status;
}

// Make functions available globally
