/**
 * Real-Time WebSocket Client
 * Manages WebSocket connection to Durable Object for real-time pending transaction updates
 */

class RealtimeClient {
  constructor() {
    this.ws = null;
    this.url = '';
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 3;
    this.reconnectDelay = 1000; // Start with 1 second, exponential backoff
    this.connectionTimeoutMs = 8000;
    this.connectTimeoutId = null;
    this.pollingIntervalId = null;

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

    // Cleanup old WebSocket before creating new one (prevents listener accumulation)
    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onerror = null;
        this.ws.onclose = null;
        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close();
        }
      } catch (_) { /* ignore */ }
      this.ws = null;
    }

    // Construct WebSocket URL with team_id (so backend DO can route only this team's events)
    let baseUrl = window.REALTIME_WS_URL || this.constructWebSocketUrl();
    const teamId = window.currentTeamId;
    if (teamId) {
      baseUrl += (baseUrl.includes('?') ? '&' : '?') + 'team_id=' + encodeURIComponent(teamId);
    }
    this.url = baseUrl;

    console.log('[Realtime] Connecting to:', this.url);

    try {
      this.ws = new WebSocket(this.url);
      this.armConnectionTimeout();

      // Handle connection open
      this.ws.onopen = () => {
        console.log('[Realtime] ✅ Connected');
        this.clearConnectionTimeout();
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;
        this.onConnected();
      };

      // Handle incoming messages (no spam logs in hot path)
      this.ws.onmessage = (event) => {
        try {
          if (!event.data || typeof event.data !== 'string') return;
          if (!event.data.startsWith('{') && !event.data.startsWith('[')) return;
          const message = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (error) {
          console.error('[Realtime] Failed to parse message:', error);
        }
      };

      // Handle errors
      this.ws.onerror = (event) => {
        console.error('[Realtime] ❌ WebSocket error');
        this.clearConnectionTimeout();
        this.onError(event);
      };

      // Handle disconnect
      this.ws.onclose = () => {
        console.log('[Realtime] 🔌 Disconnected');
        this.clearConnectionTimeout();
        this.ws = null;
        this.attemptReconnect();
      };
    } catch (error) {
      console.error('[Realtime] Failed to create WebSocket:', error);
      this.clearConnectionTimeout();
      this.attemptReconnect();
    }
  }

  armConnectionTimeout() {
    this.clearConnectionTimeout();
    this.connectTimeoutId = setTimeout(() => {
      if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
        console.warn('[Realtime] Connection timeout, forcing reconnect/fallback');
        try {
          this.ws.close();
        } catch {
          // ignore close errors
        }
      }
    }, this.connectionTimeoutMs);
  }

  clearConnectionTimeout() {
    if (this.connectTimeoutId) {
      clearTimeout(this.connectTimeoutId);
      this.connectTimeoutId = null;
    }
  }

  /**
   * Construct WebSocket URL based on backend API URL
   * @returns {string} WebSocket URL
   */
  constructWebSocketUrl() {
    const baseUrl = window.API_CONFIG?.BASE_URL;
    if (!baseUrl) {
      // BASE_URL ว่าง = ใช้ host ปัจจุบัน (proxy ผ่าน Cloudflare Pages Function)
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wssUrl = `${protocol}//${window.location.host}/api/realtime/ws`;
      console.log('[Realtime] Constructed WebSocket URL (proxy):', wssUrl);
      return wssUrl;
    }
    // Fallback: direct connection
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
    if (message.type === 'new_pending') {
      this.onNewPending(message.data);
    } else if (message.type === 'transaction_updated') {
      this.onTransactionUpdated(message.data);
    }
  }

  /**
   * Called when a new pending transaction arrives
   * @param {object} data 
   */
  onNewPending(data) {
    console.log('[Realtime] New pending transaction:', data?.id);

    // Add to allPendingTransactions array without reloading
    if (typeof allPendingTransactions !== 'undefined') {
      // Check if this transaction already exists (prevent duplicates on refresh)
      const isDuplicate = allPendingTransactions.some(item => item.id === data.id);
      if (isDuplicate) {
        return;
      }

      allPendingTransactions.unshift(data);
      // Cap array at 500 items to prevent unbounded memory growth
      if (allPendingTransactions.length > 500) {
        allPendingTransactions.length = 500;
      }

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
    if (typeof allPendingTransactions !== 'undefined') {
      // Find and update the transaction
      const index = allPendingTransactions.findIndex(item => item.id === data.id);
      if (index !== -1) {
        // Update the transaction with new status and data
        allPendingTransactions[index] = {
          ...allPendingTransactions[index],
          ...data,
        };

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
      }
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
    if (this.pollingIntervalId) {
      return;
    }

    console.log('[Realtime] Enabling polling fallback (check every 5 seconds)');

    if (typeof showToast === 'function') {
      showToast('⚠️ โหมดสำรอง: ตรวจสอบอัปเดตทุก 5 วินาที', 'warning');
    }

    // Poll every 5 seconds if WebSocket is unavailable
    this.pollingIntervalId = setInterval(() => {
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

    this.clearConnectionTimeout();

    if (this.pollingIntervalId) {
      clearInterval(this.pollingIntervalId);
      this.pollingIntervalId = null;
    }
  }
}

// Auto-initialize on script load
const realtimeClient = new RealtimeClient();

// Cleanup WebSocket and polling when page unloads (prevents leaked connections)
window.addEventListener('pagehide', () => {
  try { realtimeClient.disconnect(); } catch (_) { /* ignore */ }
});
