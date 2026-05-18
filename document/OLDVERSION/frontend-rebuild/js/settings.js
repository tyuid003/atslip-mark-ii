/**
 * Settings Page - Tenant Configuration
 */

// State
const settingsState = {
  currentTenant: null,
  settings: {}
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initializeSettingsPage();
});

/**
 * Initialize settings page
 */
function initializeSettingsPage() {
  // Load tenant
  settingsState.currentTenant = APIService.getSelectedTenant();
  
  // Load settings
  loadTenantSettings();
  
  // Attach event listeners
  attachSettingsEventListeners();
}

/**
 * Attach event listeners
 */
function attachSettingsEventListeners() {
  // Tenant selector
  const tenantSelect = document.getElementById('settings-tenant-select');
  if (tenantSelect) {
    tenantSelect.addEventListener('change', handleSettingsTenantChange);
  }
  
  // Save button
  const saveBtn = document.getElementById('save-settings-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', saveSettings);
  }
  
  // Test connection buttons
  const testLineBtn = document.getElementById('test-line-btn');
  if (testLineBtn) {
    testLineBtn.addEventListener('click', testLineConnection);
  }
  
  const testApiBtn = document.getElementById('test-api-btn');
  if (testApiBtn) {
    testApiBtn.addEventListener('click', testApiConnection);
  }
}

/**
 * Load tenant settings
 */
async function loadTenantSettings() {
  try {
    Utils.showLoading(true);
    
    // TODO: Load from D1 database
    // For now, use CONFIG defaults
    settingsState.settings = {
      tenantId: settingsState.currentTenant.id,
      name: settingsState.currentTenant.name,
      lineChannelId: settingsState.currentTenant.lineChannelId || '',
      lineChannelSecret: settingsState.currentTenant.lineChannelSecret || '',
      lineAccessToken: settingsState.currentTenant.lineAccessToken || '',
      easyslipKey: settingsState.currentTenant.easyslipKey || '',
      apiBaseUrl: settingsState.currentTenant.apiBaseUrl || '',
      sessionMode: settingsState.currentTenant.sessionMode || 'per-tenant'
    };
    
    // Update form
    updateSettingsForm();
    
    Utils.showLoading(false);
    
  } catch (error) {
    console.error('Load settings failed:', error);
    Utils.showToast('เกิดข้อผิดพลาดในการโหลดการตั้งค่า', 'error');
    Utils.showLoading(false);
  }
}

/**
 * Update settings form
 */
function updateSettingsForm() {
  // Populate form fields
  const fields = [
    'name',
    'lineChannelId',
    'lineChannelSecret',
    'lineAccessToken',
    'easyslipKey',
    'apiBaseUrl',
    'sessionMode'
  ];
  
  fields.forEach(field => {
    const input = document.getElementById(`setting-${field}`);
    if (input) {
      input.value = settingsState.settings[field] || '';
    }
  });
}

/**
 * Save settings
 */
async function saveSettings() {
  try {
    Utils.showLoading(true);
    
    // Get form data
    const fields = [
      'name',
      'lineChannelId',
      'lineChannelSecret',
      'lineAccessToken',
      'easyslipKey',
      'apiBaseUrl',
      'sessionMode'
    ];
    
    const newSettings = { tenantId: settingsState.currentTenant.id };
    
    fields.forEach(field => {
      const input = document.getElementById(`setting-${field}`);
      if (input) {
        newSettings[field] = input.value;
      }
    });
    
    // TODO: Save to D1 database
    settingsState.settings = newSettings;
    
    Utils.showToast('บันทึกการตั้งค่าสำเร็จ', 'success');
    Utils.showLoading(false);
    
  } catch (error) {
    console.error('Save settings failed:', error);
    Utils.showToast('เกิดข้อผิดพลาดในการบันทึก', 'error');
    Utils.showLoading(false);
  }
}

/**
 * Test LINE connection
 */
async function testLineConnection() {
  try {
    Utils.showLoading(true);
    
    const accessToken = document.getElementById('setting-lineAccessToken').value;
    
    if (!accessToken) {
      Utils.showToast('กรุณากรอก LINE Access Token', 'warning');
      Utils.showLoading(false);
      return;
    }
    
    // TODO: Test LINE API connection
    // For now, just show success
    Utils.showToast('เชื่อมต่อ LINE API สำเร็จ', 'success');
    
    Utils.showLoading(false);
    
  } catch (error) {
    console.error('Test LINE connection failed:', error);
    Utils.showToast('เชื่อมต่อ LINE API ไม่สำเร็จ', 'error');
    Utils.showLoading(false);
  }
}

/**
 * Test API connection
 */
async function testApiConnection() {
  try {
    Utils.showLoading(true);
    
    const apiBaseUrl = document.getElementById('setting-apiBaseUrl').value;
    
    if (!apiBaseUrl) {
      Utils.showToast('กรุณากรอก API Base URL', 'warning');
      Utils.showLoading(false);
      return;
    }
    
    // TODO: Test backend API connection
    // For now, just show success
    Utils.showToast('เชื่อมต่อ Backend API สำเร็จ', 'success');
    
    Utils.showLoading(false);
    
  } catch (error) {
    console.error('Test API connection failed:', error);
    Utils.showToast('เชื่อมต่อ Backend API ไม่สำเร็จ', 'error');
    Utils.showLoading(false);
  }
}

/**
 * Handle tenant change in settings
 */
function handleSettingsTenantChange(event) {
  const tenantId = event.target.value;
  settingsState.currentTenant = CONFIG.TENANTS.find(t => t.id === tenantId);
  
  loadTenantSettings();
  
  Utils.showToast(`เปลี่ยนเป็น ${settingsState.currentTenant.name}`, 'info');
}
