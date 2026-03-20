// ============================================================
// BACKGROUND SERVICE WORKER
// ============================================================

console.log('ATslip Background Service Worker starting...');

// Installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('ATslip Extension installed');
  
  // Set default team
  chrome.storage.local.set({ currentTeamSlug: 'default' }, () => {
    if (chrome.runtime.lastError) {
      console.error('Failed to set default team:', chrome.runtime.lastError);
    } else {
      console.log('Default team set');
    }
  });
});

// Handle extension icon click - open side panel
if (chrome.action && chrome.action.onClicked) {
  chrome.action.onClicked.addListener(async (tab) => {
    console.log('Extension icon clicked');
    try {
      if (chrome.sidePanel && chrome.sidePanel.open) {
        await chrome.sidePanel.open({ windowId: tab.windowId });
        console.log('Side panel opened');
      } else {
        console.warn('chrome.sidePanel API not available');
      }
    } catch (error) {
      console.error('Failed to open side panel:', error);
    }
  });
}

// Listen for messages from content script or popup
if (chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Message received:', request);
    
    if (request.action === 'uploadSlip') {
      handleSlipUpload(request.data)
        .then(() => sendResponse({ success: true }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
    }
    
    return false;
  });
}

// Handle slip upload
async function handleSlipUpload(data) {
  console.log('Handling slip upload:', data);
  // Implementation for handling slip uploads
  return Promise.resolve();
}

// Handle notifications
function showNotification(title, message, type = 'basic') {
  console.log('showNotification called:', title, message);
  
  if (!chrome.notifications) {
    console.warn('chrome.notifications not available');
    return;
  }
  
  chrome.notifications.create(
    {
      type: type,
      iconUrl: 'icons/icon128.png',
      title: title,
      message: message,
      priority: 2
    },
    (notificationId) => {
      if (chrome.runtime.lastError) {
        console.error('Notification error:', chrome.runtime.lastError);
      } else {
        console.log('Notification created:', notificationId);
      }
    }
  );
}

// Make function available globally
self.showNotification = showNotification;

console.log('ATslip Background Service Worker initialized successfully');
