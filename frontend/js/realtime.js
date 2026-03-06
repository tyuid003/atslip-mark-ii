/**
 * Real-Time WebSocket Client
 * Manages WebSocket connection to Durable Object for real-time pending transaction updates
 */

class RealtimeClient {
  constructor() {
    this.ws = null;
    this.url = '';
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000; // Start with 1 second, exponential backoff

    // Auto-connect on page load
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.connect());
    } else {
      this.connect();
    }
  }

  /**
   * Connect to WebSocket
   */
  connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log('[Realtime] Already connected, skipping duplicate connection');
      return;
    }

    // Construct WebSocket URL
    this.url = window.REALTIME_WS_URL || this.constructWebSocketUrl();

    console.log('[Realtime] Connecting to:', this.url);

    try {
      this.ws = new WebSocket(this.url);

      // Handle connection open
      this.ws.addEventListener('open', () => {
        console.log('[Realtime] ✅ Connected');
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;
        this.onConnected();
      });

      // Handle incoming messages
      this.ws.addEventListener('message', (event) => {
        console.log('[Realtime] Raw event received:', { dataType: typeof event.data, dataLength: event.data?.length });
        try {
          // Skip ping/pong or non-JSON messages
          if (!event.data || typeof event.data !== 'string') {
            console.log('[Realtime] Skipped: data is not string', typeof event.data);
            return;
          }

          // Try to parse as JSON, skip if not JSON
          if (!event.data.startsWith('{') && !event.data.startsWith('[')) {
            console.log('[Realtime] Received non-JSON message (ping/connection keepalive):', event.data);
            return;
          }

          console.log('[Realtime] Parsing JSON:', event.data.substring(0, 100));
          const message = JSON.parse(event.data);
          console.log('[Realtime] 📨 Message received:', message);
          this.handleMessage(message);
        } catch (error) {
          console.error('[Realtime] Failed to parse message:', error, 'Data:', event.data?.substring(0, 200));
        }
      });;

      // Handle errors
      this.ws.addEventListener('error', (event) => {
        console.error('[Realtime] ❌ WebSocket error:', event);
        this.onError(event);
      });

      // Handle disconnect
      this.ws.addEventListener('close', () => {
        console.log('[Realtime] 🔌 Disconnected');
        this.ws = null;
        this.attemptReconnect();
      });
    } catch (error) {
      console.error('[Realtime] Failed to create WebSocket:', error);
      this.attemptReconnect();
    }
  }

  /**
   * Construct WebSocket URL based on backend API URL
   * @returns {string} WebSocket URL
   */
  constructWebSocketUrl() {
    // Use backend URL from config and convert to WebSocket protocol
    const baseUrl = window.API_CONFIG?.BASE_URL || 'https://atslip-backend.tyuid003.workers.dev';
    const wssUrl = baseUrl.replace(/^https?:\/\//, 'wss://').replace(/^http:\/\//, 'ws://') + '/api/realtime/ws';
    
    console.log('[Realtime] Constructed WebSocket URL:', wssUrl);
    return wssUrl;
  }

  /**
   * Attempt to reconnect with exponential backoff
   */
  attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[Realtime] Max reconnection attempts reached. Switching to polling fallback.');
      this.enablePollingFallback();
      return;
    }

    this.reconnectAttempts++;
    console.log(`[Realtime] Reconnecting in ${this.reconnectDelay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    setTimeout(() => {
      this.connect();
    }, this.reconnectDelay);

    // Exponential backoff: double the delay, max 30 seconds
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
  }

  /**
   * Handle incoming WebSocket message
   * @param {object} message 
   */
  handleMessage(message) {
    console.log('[Realtime] handleMessage called with:', message);

    if (!this.isMessageForCurrentTeam(message?.data)) {
      console.log('[Realtime] ⏭️ Ignored message from other team:', {
        currentTeamSlug: window.currentTeamSlug,
        currentTeamId: window.currentTeamId,
        messageTeamSlug: message?.data?.team_slug,
        messageTeamId: message?.data?.team_id,
      });
      return;
    }

    if (message.type === 'new_pending') {
      console.log('[Realtime] Detected new_pending message, calling onNewPending');
      // New pending transaction received
      this.onNewPending(message.data);
    } else if (message.type === 'transaction_updated') {
      console.log('[Realtime] Detected transaction_updated message, calling onTransactionUpdated');
      // Transaction status changed (credit applied, etc)
      this.onTransactionUpdated(message.data);
    } else if (message.type === 'tenant_connection_updated') {
      console.log('[Realtime] Detected tenant_connection_updated message, calling onTenantConnectionUpdated');
      // Tenant admin connection status changed
      this.onTenantConnectionUpdated(message.data);
    } else {
      console.log('[Realtime] Unknown message type:', message.type);
    }
  }

  /**
   * Check if incoming realtime payload belongs to current team
   * @param {object} data
   * @returns {boolean}
   */
  isMessageForCurrentTeam(data) {
    if (!data) return false;

    const currentTeamSlug = window.currentTeamSlug || (typeof window.getTeamFromURL === 'function' ? window.getTeamFromURL() : null);
    const currentTeamId = window.currentTeamId || null;

    if (data.team_id && currentTeamId) {
      return String(data.team_id) === String(currentTeamId);
    }

    if (data.team_slug && currentTeamSlug) {
      return String(data.team_slug) === String(currentTeamSlug);
    }

    // Strict isolation: if payload has no team info, ignore it
    return false;
  }

  /**
   * Called when a new pending transaction arrives
   * @param {object} data 
   */
  onNewPending(data) {
    console.log('[Realtime] New pending transaction:', data);

    // Add to allPendingTransactions array without reloading
    if (typeof allPendingTransactions !== 'undefined') {
      // Check if this transaction already exists (prevent duplicates on refresh)
      const isDuplicate = allPendingTransactions.some(item => item.id === data.id);
      if (isDuplicate) {
        console.log('[Realtime] ⚠️ Transaction already exists, skipping duplicate:', data.id);
        return;
      }

      allPendingTransactions.unshift(data);
      console.log('[Realtime] ✅ Transaction added. Total:', allPendingTransactions.length);

      // Show toast notification
      if (typeof showToast === 'function') {
        showToast(`📨 ใบสลิปใหม่: ${data.sender_name} - ${data.amount.toLocaleString()} บาท`, 'info');
      }

      // Re-apply filters and render
      if (typeof applyPendingFiltersAndSort === 'function') {
        applyPendingFiltersAndSort();
      }

      // Optionally play a sound notification
      this.playNotificationSound();
    }
  }

  /**
   * Called when a transaction status is updated (credit applied, duplicate detected, etc)
   * @param {object} data 
   */
  onTransactionUpdated(data) {
    console.log('[Realtime] Transaction updated:', data);

    if (typeof allPendingTransactions !== 'undefined') {
      // Find and update the transaction
      const index = allPendingTransactions.findIndex(item => item.id === data.id);
      if (index !== -1) {
        // Update the transaction with new status and data
        allPendingTransactions[index] = {
          ...allPendingTransactions[index],
          ...data,
        };
        console.log('[Realtime] ✅ Transaction updated:', data.id, 'new status:', data.status);

        // Show appropriate toast message
        if (typeof showToast === 'function') {
          let message = '';
          if (data.status === 'credited') {
            message = `✅ เติมเครดิตสำเร็จ: ${data.message || 'ธุรกรรมเสร็จสมบูรณ์'}`;
          } else if (data.status === 'duplicate') {
            message = `⚠️ ซ้ำ: ${data.message || 'ธุรกรรมซ้ำกับระบบ'}`;
          } else if (data.status === 'failed') {
            message = `❌ เติมเครดิตล้มเหลว: ${data.message || 'เกิดข้อผิดพลาด'}`;
          } else if (data.status === 'matched') {
            message = `🔗 จับคู่: ${data.matched_username || 'ไม่พบชื่อ'}`;
          } else {
            message = `📋 สถานะเปลี่ยน: ${data.status}`;
          }
          showToast(message, data.status === 'credited' ? 'success' : data.status === 'failed' ? 'error' : 'info');
        }

        // Re-apply filters and render
        if (typeof applyPendingFiltersAndSort === 'function') {
          applyPendingFiltersAndSort();
        }

        // Play notification sound
        this.playNotificationSound();
      } else {
        console.log('[Realtime] ⚠️ Transaction not found in list:', data.id);

        // Fallback: force refresh to sync latest status from backend
        if (typeof refreshPendingTransactions === 'function') {
          console.log('[Realtime] 🔄 Triggering fallback refresh for missing transaction:', data.id);
          refreshPendingTransactions();
        }
      }
    }
  }

  /**
   * Called when tenant admin connection status changes
   * @param {object} data
   */
  onTenantConnectionUpdated(data) {
    console.log('[Realtime] Tenant connection updated:', data);

    if (!data || !data.tenant_id) {
      return;
    }

    if (typeof currentTenants === 'undefined' || !Array.isArray(currentTenants)) {
      return;
    }

    const tenantIndex = currentTenants.findIndex((tenant) => tenant.id === data.tenant_id);
    if (tenantIndex === -1) {
      return;
    }

    currentTenants[tenantIndex] = {
      ...currentTenants[tenantIndex],
      admin_connected: !!data.admin_connected,
      bank_account_count: Number.isFinite(data.bank_account_count)
        ? data.bank_account_count
        : currentTenants[tenantIndex].bank_account_count,
      updated_at: data.updated_at || currentTenants[tenantIndex].updated_at,
    };

    // Keep cache in sync so later page actions don't revert the status.
    try {
      sessionStorage.setItem('tenants_cache', JSON.stringify(currentTenants));
      sessionStorage.setItem('tenants_cache_time', Date.now().toString());
    } catch (error) {
      console.warn('[Realtime] Failed to update tenants cache:', error);
    }

    if (typeof UI !== 'undefined' && typeof UI.renderTenants === 'function' && document.getElementById('tenantGrid')) {
      UI.renderTenants(currentTenants);
    }

    if (typeof showToast === 'function') {
      const tenantName = data.tenant_name || currentTenants[tenantIndex].name || 'Tenant';
      const statusText = data.admin_connected ? 'เชื่อมต่อแล้ว' : 'ยกเลิกการเชื่อมต่อแล้ว';
      showToast(`🔌 ${tenantName}: ${statusText}`, data.admin_connected ? 'success' : 'warning');
    }
  }

  /**
   * Called when WebSocket connects successfully
   */
  onConnected() {
    console.log('[Realtime] 🟢 Real-time updates enabled');
    
    // Optionally show toast
    if (typeof showToast === 'function') {
      showToast('🟢 เชื่อมต่อเรียลไทม์สำเร็จ', 'success');
    }
  }

  /**
   * Called when WebSocket encounters an error
   * @param {event} event 
   */
  onError(event) {
    console.error('[Realtime] Error occurred:', event);
  }

  /**
   * Enable polling fallback (for when WebSocket is unavailable)
   */
  enablePollingFallback() {
    console.log('[Realtime] Enabling polling fallback (check every 5 seconds)');

    if (typeof showToast === 'function') {
      showToast('⚠️ โหมดสำรอง: ตรวจสอบอัปเดตทุก 5 วินาที', 'warning');
    }

    // Poll every 5 seconds if WebSocket is unavailable
    setInterval(() => {
      if (typeof refreshPendingTransactions === 'function') {
        console.log('[Realtime] Polling refresh...');
        refreshPendingTransactions();
      }
    }, 5000);
  }

  /**
   * Play notification sound (optional)
   */
  playNotificationSound() {
    try {
      // Create a simple beep using Web Audio API
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const audioContext = new AudioContext();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.frequency.value = 800;
      oscillator.type = 'sine';

      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.5);
    } catch (error) {
      // Silently fail if audio is not available
      console.log('[Realtime] Audio notification unavailable');
    }
  }

  /**
   * Disconnect WebSocket
   */
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// Auto-initialize on script load
const realtimeClient = new RealtimeClient();
