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


    try {
      this.ws = new WebSocket(this.url);
      this.armConnectionTimeout();

      // Handle connection open
      this.ws.onopen = () => {
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
      return wssUrl;
    }
    // Fallback: direct connection
    const wssUrl = baseUrl.replace(/^https?:\/\//, 'wss://').replace(/^http:\/\//, 'ws://') + '/api/realtime/ws';
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
    } else if (message.type === 'join_request') {
      this.onJoinRequest(message.data);
    } else if (message.type === 'join_request_resolved') {
      this.onJoinRequestResolved(message.data);
    } else if (message.type === 'member_kicked') {
      window.dispatchEvent(new CustomEvent('memberKicked', { detail: message.data }));
    }
  }

  /**
   * Called when a new pending transaction arrives
   * @param {object} data 
   */
  onNewPending(data) {

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

      // ── Throttle when tab hidden ──
      // เมื่อผู้ใช้ไม่ได้มองหน้านี้ ไม่ต้อง re-render DOM (lucide.createIcons)
      // หรือเล่นเสียง — แค่อัพเดทข้อมูลพอ. ตอนกลับมาดูจะ flush ครั้งเดียว
      if (typeof document !== 'undefined' && document.hidden) {
        this._pendingFlush = true;
        return;
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

        // Throttle when tab hidden — update data only, defer render
        if (typeof document !== 'undefined' && document.hidden) {
          this._pendingFlush = true;
          return;
        }

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


    if (typeof showToast === 'function') {
      showToast('⚠️ โหมดสำรอง: ตรวจสอบอัปเดตทุก 5 วินาที', 'warning');
    }

    // Poll every 5 seconds if WebSocket is unavailable
    this.pollingIntervalId = setInterval(() => {
      if (typeof refreshPendingTransactions === 'function') {
        refreshPendingTransactions();
      }
    }, 5000);
  }

  /**
   * Play notification sound (optional)
   * Uses a single shared AudioContext (don't create new one per notification —
   * each AudioContext is heavyweight, browsers GC slowly → leaks 100+ MB/hour
   * if user keeps tab open with frequent slip notifications).
   */
  playNotificationSound() {
    // ปิดเสียงเมื่อแท็บไม่ได้ active (ไม่ได้ยินอยู่ดี + ลดงาน)
    if (typeof document !== 'undefined' && document.hidden) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      // singleton — สร้างครั้งเดียวต่อหน้า
      if (!RealtimeClient._audioCtx) {
        RealtimeClient._audioCtx = new AC();
      }
      const ctx = RealtimeClient._audioCtx;
      // บางเบราว์เซอร์ suspend AudioContext ตอนแท็บ idle → resume ก่อน
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
        ctx.resume().catch(() => {});
      }
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      oscillator.frequency.value = 800;
      oscillator.type = 'sine';
      gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.5);
      // disconnect หลังจบเพื่อให้ node ถูก GC
      oscillator.onended = () => {
        try { oscillator.disconnect(); } catch (_) {}
        try { gainNode.disconnect(); } catch (_) {}
      };
    } catch (error) {
      // Silently fail if audio is not available
    }
  }

  /**
   * Handle incoming join request notification (show approval card to team members)
   */
  onJoinRequest(data) {
    // เฉพาะ user ที่เป็นสมาชิกของทีมนี้ถึงจะเห็น
    if (!window.currentTeamId || String(data.team_id) !== String(window.currentTeamId)) return;
    const me = window.atslipAuth?.user;
    // ไม่แสดงให้ตัวเองเห็น
    if (me && String(me.telegram_id) === String(data.telegram_id)) return;
    showJoinRequestCard(data);
    // แจ้งหน้าจัดการผู้ใช้ให้ refresh ถ้าเปิดอยู่
    window.dispatchEvent(new CustomEvent('joinRequestArrived', { detail: data }));
  }

  /**
   * Handle join_request_resolved — notify the requester
   */
  onJoinRequestResolved(data) {
    const me = window.atslipAuth?.user;
    if (!me) return;
    if (String(me.telegram_id) === String(data.telegram_id)) {
      window.dispatchEvent(new CustomEvent('joinRequestResolved', { detail: data }));
    }
    // ลบ notification card ถ้ายังแสดงอยู่
    const card = document.getElementById(`join-req-card-${data.request_id}`);
    if (card) card.remove();
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

// ============================================================
// JOIN REQUEST APPROVAL CARD
// ============================================================
function showJoinRequestCard(data) {
  const slug = window.currentTeamSlug || '';
  const requestId = data.request_id;
  const existing = document.getElementById(`join-req-card-${requestId}`);
  if (existing) return; // ไม่แสดงซ้ำ

  let container = document.getElementById('joinRequestContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'joinRequestContainer';
    container.className = 'join-request-container';
    document.body.appendChild(container);
  }

  const card = document.createElement('div');
  card.id = `join-req-card-${requestId}`;
  card.className = 'join-request-card';

  const avatarHtml = data.photo
    ? `<img src="${data.photo}" class="join-req-avatar-img" alt="">`
    : `<div class="join-req-avatar-init">${(data.display_name || '?').charAt(0).toUpperCase()}</div>`;

  const name = String(data.display_name || data.telegram_id).replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const teamName = String(data.team_name || slug).replace(/</g, '&lt;').replace(/>/g, '&gt;');

  card.innerHTML = `
    <div class="join-req-avatar">${avatarHtml}</div>
    <div class="join-req-body">
      <div class="join-req-text">
        <strong>${name}</strong> ได้ขออนุมัติการเข้าใช้งานทีม <strong>${teamName}</strong>
        <span class="join-req-sub">กดปฏิเสธหากท่านไม่รู้จัก</span>
      </div>
      <div class="join-req-actions">
        <button class="join-req-btn approve" onclick="resolveJoinRequest('${slug}','${requestId}','approve')">อนุมัติ</button>
        <button class="join-req-btn reject"  onclick="resolveJoinRequest('${slug}','${requestId}','reject')">ปฏิเสธ</button>
      </div>
    </div>
    <button class="join-req-close" onclick="document.getElementById('join-req-card-${requestId}')?.remove()" aria-label="ปิด">✕</button>
  `;

  container.appendChild(card);
  // auto-dismiss หลัง 2 นาที
  setTimeout(() => card.remove(), 120000);
}

window.resolveJoinRequest = async function(slug, requestId, action) {
  const card = document.getElementById(`join-req-card-${requestId}`);
  if (card) card.style.opacity = '0.5';
  try {
    if (action === 'approve') await api.approveJoinRequest(slug, requestId);
    else await api.rejectJoinRequest(slug, requestId);
    if (card) card.remove();
    if (typeof addNotification === 'function') {
      addNotification(action === 'approve' ? '✅ อนุมัติแล้ว' : '❌ ปฏิเสธแล้ว');
    }
  } catch (e) {
    if (card) card.style.opacity = '1';
    alert('เกิดข้อผิดพลาด: ' + (e.message || e));
  }
};

// Auto-initialize on script load
const realtimeClient = new RealtimeClient();

// Cleanup WebSocket and polling when page unloads (prevents leaked connections)
window.addEventListener('pagehide', () => {
  try { realtimeClient.disconnect(); } catch (_) { /* ignore */ }
});

// ──────────────────────────────────────────────────────────────
// MEMORY HOUSEKEEPING
// ──────────────────────────────────────────────────────────────
// 1) ตอนแท็บกลับมา visible: ถ้ามี pending updates ที่สะสมไว้ → render ครั้งเดียว
// 2) ทุก 10 นาที: ตัด array ใหญ่ๆ ลง + ปล่อยให้ browser GC
//    (ปกติ Chrome จะ GC แท็บที่ idle อยู่เอง แต่ถ้าผู้ใช้เปิดแท็บไว้ตลอด
//     ไม่เคย idle เลย จะไม่ trigger GC → RAM โตเรื่อยๆ)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && realtimeClient._pendingFlush) {
    realtimeClient._pendingFlush = false;
    if (typeof applyPendingFiltersAndSort === 'function') {
      try { applyPendingFiltersAndSort(); } catch (_) {}
    }
  }
});

// ตัด array ทุก 10 นาที + ลบ toast cache
setInterval(() => {
  try {
    if (typeof allPendingTransactions !== 'undefined' && Array.isArray(allPendingTransactions)) {
      // ลดเพดานเป็น 200 ถ้าทิ้งแท็บไว้นาน (ลดจาก 500 ที่เก็บไว้ตอน active)
      if (allPendingTransactions.length > 200) {
        allPendingTransactions.length = 200;
      }
    }
    // เคลียร์ toast queue ถ้ายาวเกิน
    if (typeof toastQueue !== 'undefined' && Array.isArray(toastQueue) && toastQueue.length > 5) {
      toastQueue.length = 5;
    }
    // ตัด notifications ลงเหลือ 50 (จากเดิม 99) เพื่อลดขนาด localStorage + DOM
    if (typeof notifications !== 'undefined' && Array.isArray(notifications) && notifications.length > 50) {
      notifications.length = 50;
      try { localStorage.setItem('atslip_notifications', JSON.stringify(notifications)); } catch (_) {}
    }
  } catch (_) { /* ignore */ }
}, 10 * 60 * 1000); // 10 minutes
