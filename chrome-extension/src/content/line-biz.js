// ============================================================
// ATslip Quick Scan — Content Script (chat.line.biz)
// จับเฉพาะ "รูปที่ลูกค้าส่งในแชท" (media message) แล้วเพิ่มปุ่มกลมสแกนข้างรูป
// เมื่อกด → ส่ง URL รูปให้ background ไปดึง (bypass CORS) → ส่งให้ side panel สแกน
//
// จากการวิเคราะห์ DOM ของ chat.line.biz:
//   - รูป media จริงจะมาจากโดเมน chat-content.line.biz (เช่น .../preview)
//     อยู่ใน <a class="chat-media-link"> ภายใน .chat-item.image
//   - ไม่จับ: emoji (emojipack.landpress.line.me), avatar (profile.line-scdn.net),
//     sticker (stickershop.line-scdn.net), flex card (ใช้ background-image)
// ============================================================
(function () {
  'use strict';

  // จับเฉพาะรูป media ที่ลูกค้า/แอดมินส่งจริง (โดเมน chat-content.line.biz)
  const PHOTO_SELECTOR = 'img[src*="chat-content.line.biz"]';
  const BADGE_CLASS = 'atslip-quickscan-badge';
  const PROCESSED_ATTR = 'data-atslip-scanned';

  const SCAN_SVG = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10"/></svg>`;

  // หา container ที่เหมาะจะวางปุ่ม (anchor ของรูป หรือกล่องรูป)
  function findContainer(img) {
    return (
      img.closest('a.chat-media-link') ||
      img.closest('.chat-item.image') ||
      img.parentElement
    );
  }

  function attachBadge(img) {
    const src = img.currentSrc || img.src || '';
    if (!src.includes('chat-content.line.biz')) return;

    const container = findContainer(img);
    if (!container) return;
    // กันซ้ำ: ถ้ามีปุ่มอยู่แล้วในกล่องนี้ ข้าม
    if (container.getAttribute(PROCESSED_ATTR) === '1') return;
    if (container.querySelector('.' + BADGE_CLASS)) {
      container.setAttribute(PROCESSED_ATTR, '1');
      return;
    }
    container.setAttribute(PROCESSED_ATTR, '1');

    const cs = getComputedStyle(container);
    if (cs.position === 'static') container.style.position = 'relative';

    const badge = document.createElement('button');
    badge.className = BADGE_CLASS;
    badge.type = 'button';
    badge.title = 'สแกนสลิปด้วย ATslip';
    badge.innerHTML = SCAN_SVG;
    badge.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // อ่าน URL รูป "ปัจจุบัน" ตอนกด (กัน URL เก่า/หมดอายุ หรือ Vue re-render img ใหม่)
      const box = badge.closest('a.chat-media-link') || badge.parentElement;
      const curImg = box && box.querySelector('img[src*="chat-content.line.biz"]');
      const url = (curImg && (curImg.currentSrc || curImg.src)) || (img.currentSrc || img.src) || src;
      quickScan(url, badge);
    });
    container.appendChild(badge);
  }

  // แจ้งเตือนบนหน้าจอเมื่อส่วนขยายถูกอัปเดต/ตัดการเชื่อมต่อ (ต้องรีเฟรชหน้า)
  function showReloadHint() {
    if (document.getElementById('atslip-reload-hint')) return;
    const bar = document.createElement('div');
    bar.id = 'atslip-reload-hint';
    bar.textContent = 'ATslip: ส่วนขยายถูกอัปเดต — กรุณารีเฟรชหน้านี้ (F5) เพื่อใช้ Quick scan';
    bar.addEventListener('click', () => location.reload());
    document.body.appendChild(bar);
    setTimeout(() => bar.remove(), 8000);
  }

  // ตรวจว่า extension context ยังใช้ได้อยู่ไหม (orphaned content script → chrome.runtime.id หาย)
  function contextAlive() {
    try { return !!(chrome.runtime && chrome.runtime.id); } catch { return false; }
  }

  function quickScan(url, badge) {
    const original = badge.innerHTML;
    badge.classList.remove('done', 'error');
    badge.classList.add('loading');
    badge.innerHTML = '<span class="atslip-spinner"></span>';

    let settled = false;
    const done = (ok, err) => {
      if (settled) return;
      settled = true;
      badge.classList.remove('loading');
      badge.innerHTML = original;
      badge.classList.add(ok ? 'done' : 'error');
      if (err) {
        console.error('[ATslip QuickScan]', err);
        badge.title = 'สแกนไม่สำเร็จ: ' + err + ' (ลองรีเฟรชหน้า)';
      } else {
        badge.title = 'สแกนสลิปด้วย ATslip';
      }
      setTimeout(() => badge.classList.remove('done', 'error'), 1600);
    };

    // ส่วนขยายถูก reload → content script นี้ใช้ไม่ได้แล้ว ต้องรีเฟรชหน้า
    if (!contextAlive()) {
      showReloadHint();
      return done(false, 'extension context invalidated');
    }

    try {
      // ส่ง URL ให้ background ดึงรูปเอง (bypass CORS)
      chrome.runtime.sendMessage({ type: 'ATSLIP_QUICK_SCAN_URL', url }, (resp) => {
        const lastErr = chrome.runtime.lastError;
        if (lastErr) {
          if (/context invalidated|receiving end does not exist|port closed/i.test(lastErr.message || '')) {
            showReloadHint();
          }
          return done(false, lastErr.message);
        }
        if (!resp || !resp.ok) return done(false, (resp && resp.error) || 'no response');
        done(true);
      });
    } catch (e) {
      if (/context invalidated/i.test(e.message || '')) showReloadHint();
      done(false, e.message || String(e));
    }
  }

  function scanAll() {
    document.querySelectorAll(PHOTO_SELECTOR).forEach(attachBadge);
  }

  // สแกน DOM เริ่มต้น + observe การเปลี่ยนแปลง (แชทโหลดข้อความใหม่ตลอด)
  const observer = new MutationObserver(() => {
    if (observer._t) return;
    observer._t = setTimeout(() => {
      observer._t = null;
      scanAll();
    }, 400);
  });

  function start() {
    scanAll();
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
