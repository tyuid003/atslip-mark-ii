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
    if (message.type === 'new_pending') {
      console.log('[Realtime] Detected new_pending message, calling onNewPending');
      // New pending transaction received
      this.onNewPending(message.data);
    } else {
      console.log('[Realtime] Unknown message type:', message.type);
    }
  }

  /**
   * Called when a new pending transaction arrives
   * @param {object} data 
   */
  onNewPending(data) {
    console.log('[Realtime] New pending transaction:', data);

    // Add to allPendingTransactions array without reloading
    if (typeof allPendingTransactions !== 'undefined') {
      allPendingTransactions.unshift(data);

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
