// ============================================================
// ATslip Side Panel — Background Service Worker (MV3)
// ============================================================
//  1. เปิด side panel เมื่อคลิกไอคอน extension
//  2. รับ URL รูปจาก content script (chat.line.biz Quick Scan)
//     → เปิด side panel (ทันทีใน handler เพื่อรักษา user gesture)
//     → ดึงรูปเอง (bypass CORS ผ่าน host_permissions)
//     → เก็บลง storage.session ให้ side panel หยิบไปสแกน
// ============================================================

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error('[bg] setPanelBehavior failed', err));
});

chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (err) {
    /* openPanelOnActionClick handles the normal case */
  }
});

// แปลง blob → dataURL (service worker ไม่มี FileReader → base64 เอง)
async function fetchImageAsDataUrl(url) {
  // ลองแบบมี credentials ก่อน (เผื่อรูปต้องใช้ cookie) แล้ว fallback เป็นไม่มี
  let resp;
  try {
    resp = await fetch(url, { credentials: 'include' });
    if (!resp.ok) throw new Error(String(resp.status));
  } catch (_) {
    resp = await fetch(url);
  }
  if (!resp.ok) throw new Error(`fetch failed (${resp.status})`);
  const blob = await resp.blob();
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  const b64 = btoa(binary);
  const type = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/jpeg';
  return `data:${type};base64,${b64}`;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'ATSLIP_QUICK_SCAN_URL') {
    // เปิด side panel แบบ synchronous ใน handler (รักษา user gesture ให้มากที่สุด)
    if (sender.tab && sender.tab.windowId != null) {
      try { chrome.sidePanel.open({ windowId: sender.tab.windowId }); } catch (_) {}
    }
    (async () => {
      try {
        const dataUrl = await fetchImageAsDataUrl(msg.url);
        // เก็บลง session storage → side panel ฟัง onChanged / อ่านตอนเปิด
        await chrome.storage.session.set({
          pendingQuickScan: { dataUrl, filename: 'line-slip.jpg', ts: Date.now() },
        });
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
      }
    })();
    return true; // async response
  }

  if (msg.type === 'ATSLIP_OPEN_PANEL') {
    if (sender.tab && sender.tab.windowId != null) {
      try { chrome.sidePanel.open({ windowId: sender.tab.windowId }); } catch (_) {}
    }
    sendResponse({ ok: true });
    return true;
  }
});
