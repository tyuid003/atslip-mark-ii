(function () {
  const STORAGE_KEY = 'atslip-popup-alert-hidden-date';
  const CONTENT_URL = 'popup-alert.md';
  let initialized = false;
  let overlayElement = null;

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getTodayKey() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function shouldSkipForToday() {
    return window.localStorage.getItem(STORAGE_KEY) === getTodayKey();
  }

  function setSkipForToday(enabled) {
    if (enabled) {
      window.localStorage.setItem(STORAGE_KEY, getTodayKey());
      return;
    }

    window.localStorage.removeItem(STORAGE_KEY);
  }

  function closeListIfOpen(htmlParts, listState) {
    if (!listState.type) {
      return;
    }

    htmlParts.push(`</${listState.type}>`);
    listState.type = null;
  }

  function renderMarkdown(markdownText) {
    const lines = markdownText.replace(/\r/g, '').split('\n');
    const htmlParts = [];
    const listState = { type: null };
    let firstHeadingUsed = false;

    for (const rawLine of lines) {
      const line = rawLine.trim();

      if (!line) {
        closeListIfOpen(htmlParts, listState);
        continue;
      }

      const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
      if (headingMatch) {
        closeListIfOpen(htmlParts, listState);
        const level = Math.min(headingMatch[1].length, 6);
        const content = escapeHtml(headingMatch[2]);

        if (!firstHeadingUsed && level === 1) {
          htmlParts.push(`<h1 class="popup-alert-title">${content}</h1>`);
          firstHeadingUsed = true;
        } else {
          htmlParts.push(`<h${level} class="popup-alert-heading popup-alert-heading-${level}">${content}</h${level}>`);
        }
        continue;
      }

      const quoteMatch = line.match(/^>\s?(.*)$/);
      if (quoteMatch) {
        closeListIfOpen(htmlParts, listState);
        htmlParts.push(`<blockquote class="popup-alert-quote">${escapeHtml(quoteMatch[1])}</blockquote>`);
        continue;
      }

      const bulletMatch = line.match(/^-\s+(.*)$/);
      if (bulletMatch) {
        if (listState.type !== 'ul') {
          closeListIfOpen(htmlParts, listState);
          htmlParts.push('<ul class="popup-alert-list">');
          listState.type = 'ul';
        }
        htmlParts.push(`<li>${escapeHtml(bulletMatch[1])}</li>`);
        continue;
      }

      const orderedMatch = line.match(/^\d+\.\s+(.*)$/);
      if (orderedMatch) {
        if (listState.type !== 'ol') {
          closeListIfOpen(htmlParts, listState);
          htmlParts.push('<ol class="popup-alert-list popup-alert-list-ordered">');
          listState.type = 'ol';
        }
        htmlParts.push(`<li>${escapeHtml(orderedMatch[1])}</li>`);
        continue;
      }

      closeListIfOpen(htmlParts, listState);
      htmlParts.push(`<p class="popup-alert-paragraph">${escapeHtml(line)}</p>`);
    }

    closeListIfOpen(htmlParts, listState);
    return htmlParts.join('');
  }

  async function loadContent() {
    const response = await fetch(CONTENT_URL, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Failed to load popup alert content: ${response.status}`);
    }

    return response.text();
  }

  function closePopup() {
    if (!overlayElement) {
      return;
    }

    const checkbox = overlayElement.querySelector('#popupAlertSkipToday');
    setSkipForToday(Boolean(checkbox?.checked));
    document.body.classList.remove('popup-alert-open');
    overlayElement.remove();
    overlayElement = null;
  }

  function buildPopup(contentHtml) {
    overlayElement = document.createElement('div');
    overlayElement.className = 'popup-alert-overlay';
    overlayElement.innerHTML = `
      <div class="popup-alert-dialog" role="dialog" aria-modal="true" aria-labelledby="popupAlertHeading">
        <button type="button" class="popup-alert-close" aria-label="ปิดประกาศ">
          <span aria-hidden="true">&times;</span>
        </button>
        <div class="popup-alert-body" id="popupAlertHeading">
          ${contentHtml}
        </div>
        <div class="popup-alert-footer">
          <label class="popup-alert-checkbox-row">
            <input type="checkbox" id="popupAlertSkipToday">
            <span>ไม่ต้องแสดงอีกในวันนี้</span>
          </label>
        </div>
      </div>
    `;

    const closeButton = overlayElement.querySelector('.popup-alert-close');
    closeButton?.addEventListener('click', closePopup);

    document.body.appendChild(overlayElement);
    document.body.classList.add('popup-alert-open');
  }

  async function init() {
    if (initialized || shouldSkipForToday()) {
      initialized = true;
      return;
    }

    initialized = true;

    try {
      const content = await loadContent();
      if (!content.trim()) {
        return;
      }

      buildPopup(renderMarkdown(content));
    } catch (error) {
      console.error('[PopupAlert] Unable to initialize popup alert:', error);
    }
  }

  window.PopupAlert = {
    init,
    close: closePopup,
    clearSkipForToday() {
      window.localStorage.removeItem(STORAGE_KEY);
    },
  };

  document.addEventListener('DOMContentLoaded', init);
})();