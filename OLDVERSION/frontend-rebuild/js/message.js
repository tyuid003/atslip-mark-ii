/**
 * Message Templates Page - LINE Message Configuration
 */

// State
const messageState = {
  currentTenant: null,
  templates: {}
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initializeMessagePage();
});

/**
 * Initialize message page
 */
function initializeMessagePage() {
  // Load tenant
  messageState.currentTenant = APIService.getSelectedTenant();
  
  // Load templates
  loadMessageTemplates();
  
  // Attach event listeners
  attachMessageEventListeners();
}

/**
 * Attach event listeners
 */
function attachMessageEventListeners() {
  // Tenant selector
  const tenantSelect = document.getElementById('message-tenant-select');
  if (tenantSelect) {
    tenantSelect.addEventListener('change', handleMessageTenantChange);
  }
  
  // Save button
  const saveBtn = document.getElementById('save-messages-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', saveMessageTemplates);
  }
  
  // Test send buttons
  CONFIG.MESSAGE_TYPES.forEach(type => {
    const testBtn = document.getElementById(`test-${type}-btn`);
    if (testBtn) {
      testBtn.addEventListener('click', () => testSendMessage(type));
    }
  });
  
  // Preview buttons
  CONFIG.MESSAGE_TYPES.forEach(type => {
    const previewBtn = document.getElementById(`preview-${type}-btn`);
    if (previewBtn) {
      previewBtn.addEventListener('click', () => previewMessage(type));
    }
  });
}

/**
 * Load message templates
 */
async function loadMessageTemplates() {
  try {
    Utils.showLoading(true);
    
    // TODO: Load from D1 database
    // For now, use CONFIG defaults
    messageState.templates = {
      tenantId: messageState.currentTenant.id,
      on_slip_received: messageState.currentTenant.lineMessages?.on_slip_received || {
        enabled: true,
        template: 'ได้รับสลิปเรียบร้อยแล้ว\nจำนวนเงิน: {amount} บาท\nกำลังตรวจสอบ...'
      },
      on_credited_success: messageState.currentTenant.lineMessages?.on_credited_success || {
        enabled: true,
        template: 'เติมเครดิตสำเร็จ ✅\nจำนวนเงิน: {amount} บาท\nเครดิตคงเหลือ: {balance} บาท'
      },
      on_credited_duplicate: messageState.currentTenant.lineMessages?.on_credited_duplicate || {
        enabled: true,
        template: 'สลิปนี้ถูกใช้งานแล้ว ⚠️\nกรุณาตรวจสอบ'
      }
    };
    
    // Update form
    updateMessageForm();
    
    Utils.showLoading(false);
    
  } catch (error) {
    console.error('Load message templates failed:', error);
    Utils.showToast('เกิดข้อผิดพลาดในการโหลดข้อความ', 'error');
    Utils.showLoading(false);
  }
}

/**
 * Update message form
 */
function updateMessageForm() {
  CONFIG.MESSAGE_TYPES.forEach(type => {
    const template = messageState.templates[type];
    
    // Enabled toggle
    const enabledToggle = document.getElementById(`message-${type}-enabled`);
    if (enabledToggle) {
      enabledToggle.checked = template.enabled;
    }
    
    // Template textarea
    const templateInput = document.getElementById(`message-${type}-template`);
    if (templateInput) {
      templateInput.value = template.template;
    }
  });
}

/**
 * Save message templates
 */
async function saveMessageTemplates() {
  try {
    Utils.showLoading(true);
    
    const newTemplates = { tenantId: messageState.currentTenant.id };
    
    CONFIG.MESSAGE_TYPES.forEach(type => {
      const enabledToggle = document.getElementById(`message-${type}-enabled`);
      const templateInput = document.getElementById(`message-${type}-template`);
      
      newTemplates[type] = {
        enabled: enabledToggle ? enabledToggle.checked : false,
        template: templateInput ? templateInput.value : ''
      };
    });
    
    // TODO: Save to D1 database
    messageState.templates = newTemplates;
    
    Utils.showToast('บันทึกข้อความสำเร็จ', 'success');
    Utils.showLoading(false);
    
  } catch (error) {
    console.error('Save message templates failed:', error);
    Utils.showToast('เกิดข้อผิดพลาดในการบันทึก', 'error');
    Utils.showLoading(false);
  }
}

/**
 * Preview message
 */
function previewMessage(type) {
  const templateInput = document.getElementById(`message-${type}-template`);
  if (!templateInput) return;
  
  const template = templateInput.value;
  
  // Replace placeholders with sample data
  const preview = template
    .replace('{amount}', '1,000')
    .replace('{balance}', '5,000')
    .replace('{name}', 'นายทดสอบ ระบบ')
    .replace('{date}', new Date().toLocaleDateString('th-TH'));
  
  // Show preview
  alert(`ตัวอย่างข้อความ:\n\n${preview}`);
}

/**
 * Test send message
 */
async function testSendMessage(type) {
  try {
    const confirmed = await Utils.confirm(
      `ส่งข้อความทดสอบประเภท "${type}" ?`
    );
    
    if (!confirmed) return;
    
    Utils.showLoading(true);
    
    // TODO: Implement test send via LINE API
    
    Utils.showToast('ส่งข้อความทดสอบสำเร็จ', 'success');
    Utils.showLoading(false);
    
  } catch (error) {
    console.error('Test send message failed:', error);
    Utils.showToast('ส่งข้อความทดสอบไม่สำเร็จ', 'error');
    Utils.showLoading(false);
  }
}

/**
 * Handle tenant change
 */
function handleMessageTenantChange(event) {
  const tenantId = event.target.value;
  messageState.currentTenant = CONFIG.TENANTS.find(t => t.id === tenantId);
  
  loadMessageTemplates();
  
  Utils.showToast(`เปลี่ยนเป็น ${messageState.currentTenant.name}`, 'info');
}
