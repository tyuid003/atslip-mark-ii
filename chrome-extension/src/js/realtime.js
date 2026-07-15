// ============================================================
// ATslip Side Panel — Realtime (WebSocket)
// เชื่อมต่อ /api/realtime/ws เดียวกับ ATslip เพื่ออัปเดตรายการสแกนแบบ realtime
// เมื่อมี new_pending หรือ transaction_updated (ทุกการเปลี่ยนสถานะ) → refresh รายการ
// มี fallback เป็น polling ถ้าต่อ WS ไม่ได้
// ============================================================
const Realtime = {
  ws: null,
  reconnectAttempts: 0,
  maxReconnect: 5,
  reconnectDelay: 1000,
  _refreshTimer: null,
  _stopped: false,

  start() {
    this._stopped = false;
    this.connect();
  },

  stop() {
    this._stopped = true;
    if (this.ws) {
      try {
        this.ws.onopen = this.ws.onmessage = this.ws.onerror = this.ws.onclose = null;
        this.ws.close();
      } catch (_) {}
      this.ws = null;
    }
  },

  connect() {
    if (this._stopped) return;
    if (!Settings.isConfigured()) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;

    let url;
    try { url = Api.wsUrl(); } catch { return; }

    try {
      this.ws = new WebSocket(url);
      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;
        // เมื่อต่อ realtime ได้ ลดการ poll (ใช้ realtime เป็นหลัก)
        ScanList.setRealtimeActive(true);
      };
      this.ws.onmessage = (event) => {
        if (!event.data || typeof event.data !== 'string') return;
        if (!event.data.startsWith('{')) return;
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }
        this.handle(msg);
      };
      this.ws.onerror = () => { /* onclose จะจัดการ reconnect */ };
      this.ws.onclose = () => {
        this.ws = null;
        ScanList.setRealtimeActive(false);
        this.reconnect();
      };
    } catch (_) {
      this.reconnect();
    }
  },

  reconnect() {
    if (this._stopped) return;
    if (this.reconnectAttempts >= this.maxReconnect) {
      // ยอมแพ้ WS → ให้ polling ทำงานถี่ขึ้นแทน
      ScanList.setRealtimeActive(false);
      return;
    }
    this.reconnectAttempts++;
    setTimeout(() => this.connect(), this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 15000);
  },

  handle(msg) {
    // ทุกการเปลี่ยนแปลง (ใบใหม่ / เปลี่ยนสถานะ) → refresh รายการ (debounce)
    if (msg.type === 'new_pending' || msg.type === 'transaction_updated') {
      this.scheduleRefresh();
    }
  },

  scheduleRefresh() {
    clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(() => ScanList.refresh(true), 250);
  },
};

window.Realtime = Realtime;
