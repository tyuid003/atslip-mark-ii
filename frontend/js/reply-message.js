let replyMessageState = {
  tenants: [],
  lineOAByTenant: new Map(),
  selectedLineOAId: null,
  selectedTenantId: null,
};

function setLayoutForPage(page) {
  const dashboard = document.getElementById('dashboardPage');
  const replyPage = document.getElementById('replyMessagePage');
  const pageNavReplyBtn = document.getElementById('goReplyPageBtn');

  const isReplyPage = page === 'reply-message';

  if (dashboard) dashboard.style.display = isReplyPage ? 'none' : 'block';
  if (replyPage) replyPage.style.display = isReplyPage ? 'block' : 'none';

  if (pageNavReplyBtn) {
    pageNavReplyBtn.classList.toggle('active', isReplyPage);
  }
}

function goToReplyMessagePage() {
  const teamSlug = window.currentTeamSlug || window.getTeamFromURL();
  window.location.hash = `#/${teamSlug}/reply-message`;
}

function goToDashboardPage() {
  const teamSlug = window.currentTeamSlug || window.getTeamFromURL();
  window.location.hash = `#/${teamSlug}`;
}

function renderReplyMessageCards() {
  const root = document.getElementById('replyTenantGrid');
  if (!root) return;

  if (!replyMessageState.tenants.length) {
    root.innerHTML = '<div class="text-muted">ยังไม่มี tenant ในระบบ</div>';
    return;
  }

  const html = replyMessageState.tenants
    .map((tenant) => {
      const lineOAs = replyMessageState.lineOAByTenant.get(tenant.id) || [];
      const lineOAHtml = lineOAs.length
        ? lineOAs
            .map(
              (lineOA) => `
                <div class="reply-lineoa-item">
                  <div>
                    <div class="reply-lineoa-name">${lineOA.name}</div>
                    <div class="reply-lineoa-meta">${lineOA.channel_id}</div>
                  </div>
                  <button class="btn btn-secondary btn-sm" onclick="openReplySettingsModal('${tenant.id}', '${lineOA.id}')">
                    <i data-lucide="settings" size="14"></i>
                    ตั้งค่า
                  </button>
                </div>
              `
            )
            .join('')
        : '<div class="text-muted">ยังไม่มี LINE OA</div>';

      return `
        <div class="reply-tenant-card">
          <div class="reply-tenant-title">
            <h3>${tenant.name}</h3>
            <span class="badge badge-info">${lineOAs.length} LINE OA</span>
          </div>
          <div class="reply-lineoa-list">
            ${lineOAHtml}
          </div>
        </div>
      `;
    })
    .join('');

  root.innerHTML = html;
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function bindColorSync(colorId, textId) {
  const colorInput = document.getElementById(colorId);
  const textInput = document.getElementById(textId);
  if (!colorInput || !textInput) return;

  colorInput.addEventListener('input', () => {
    textInput.value = colorInput.value.toUpperCase();
  });

  textInput.addEventListener('input', () => {
    const value = textInput.value.trim().toUpperCase();
    if (/^#[0-9A-F]{6}$/.test(value)) {
      colorInput.value = value;
    }
  });
}

function setupReplySettingsColorBindings() {
  const map = [
    ['headerBackgroundColor', 'headerBackgroundColorText'],
    ['bodyBackgroundColor', 'bodyBackgroundColorText'],
    ['footerBackgroundColor', 'footerBackgroundColorText'],
    ['headerTitleColor', 'headerTitleColorText'],
    ['statusSuccessColor', 'statusSuccessColorText'],
    ['statusFailedColor', 'statusFailedColorText'],
    ['labelsColor', 'labelsColorText'],
    ['valuesColor', 'valuesColorText'],
    ['secondaryTextColor', 'secondaryTextColorText'],
    ['separatorColor', 'separatorColorText'],
    ['buttonColor', 'buttonColorText'],
  ];

  map.forEach(([colorId, textId]) => bindColorSync(colorId, textId));
}

function fillReplySettingsForm(settings) {
  document.getElementById('enableProcessingReply').checked = Number(settings.enable_processing_reply) === 1;
  document.getElementById('processingReplyText').value = settings.processing_reply_text || '';
  document.getElementById('enableSuccessFlex').checked = Number(settings.enable_success_flex) === 1;
  document.getElementById('enableDuplicateFlex').checked = Number(settings.enable_duplicate_flex) === 1;
  document.getElementById('enableFailedReply').checked = Number(settings.enable_failed_reply) === 1;
  document.getElementById('failedReplyText').value = settings.failed_reply_text || '';
  document.getElementById('logoImageUrl').value = settings.logo_image_url || '';
  document.getElementById('playUrl').value = settings.play_url || '';
  document.getElementById('headerTitleText').value = settings.header_title_text || '';
  document.getElementById('successStatusText').value = settings.success_status_text || '';
  document.getElementById('duplicateStatusText').value = settings.duplicate_status_text || '';
  document.getElementById('failedStatusText').value = settings.failed_status_text || '';
  document.getElementById('footerText').value = settings.footer_text || '';
  document.getElementById('buttonText').value = settings.button_text || '';

  const colorMap = [
    ['headerBackgroundColor', 'headerBackgroundColorText', settings.header_background_color],
    ['bodyBackgroundColor', 'bodyBackgroundColorText', settings.body_background_color],
    ['footerBackgroundColor', 'footerBackgroundColorText', settings.footer_background_color],
    ['headerTitleColor', 'headerTitleColorText', settings.header_title_color],
    ['statusSuccessColor', 'statusSuccessColorText', settings.status_success_color],
    ['statusFailedColor', 'statusFailedColorText', settings.status_failed_color],
    ['labelsColor', 'labelsColorText', settings.labels_color],
    ['valuesColor', 'valuesColorText', settings.values_color],
    ['secondaryTextColor', 'secondaryTextColorText', settings.secondary_text_color],
    ['separatorColor', 'separatorColorText', settings.separator_color],
    ['buttonColor', 'buttonColorText', settings.button_color],
  ];

  colorMap.forEach(([colorId, textId, value]) => {
    const colorInput = document.getElementById(colorId);
    const textInput = document.getElementById(textId);
    if (colorInput) colorInput.value = value || '#000000';
    if (textInput) textInput.value = (value || '#000000').toUpperCase();
  });
}

async function openReplySettingsModal(tenantId, lineOAId) {
  replyMessageState.selectedTenantId = tenantId;
  replyMessageState.selectedLineOAId = lineOAId;

  try {
    const lineOAs = replyMessageState.lineOAByTenant.get(tenantId) || [];
    const lineOA = lineOAs.find((item) => item.id === lineOAId);
    document.getElementById('replySettingsLineOAName').textContent = lineOA?.name || 'LINE OA';

    const response = await api.getLineReplySettings(lineOAId);
    fillReplySettingsForm(response.data || {});

    document.getElementById('replySettingsModal').style.display = 'flex';
    setupReplySettingsColorBindings();
  } catch (error) {
    if (typeof addNotification === 'function') {
      addNotification('❌ ไม่สามารถโหลดค่า reply message: ' + error.message);
    }
  }
}

function closeReplySettingsModal() {
  document.getElementById('replySettingsModal').style.display = 'none';
  replyMessageState.selectedTenantId = null;
  replyMessageState.selectedLineOAId = null;
}

async function saveReplySettings() {
  if (!replyMessageState.selectedLineOAId) {
    return;
  }

  const payload = {
    enable_processing_reply: document.getElementById('enableProcessingReply').checked,
    processing_reply_text: document.getElementById('processingReplyText').value.trim(),
    enable_success_flex: document.getElementById('enableSuccessFlex').checked,
    enable_duplicate_flex: document.getElementById('enableDuplicateFlex').checked,
    enable_failed_reply: document.getElementById('enableFailedReply').checked,
    failed_reply_text: document.getElementById('failedReplyText').value.trim(),
    logo_image_url: document.getElementById('logoImageUrl').value.trim(),
    play_url: document.getElementById('playUrl').value.trim(),
    header_title_text: document.getElementById('headerTitleText').value.trim(),
    success_status_text: document.getElementById('successStatusText').value.trim(),
    duplicate_status_text: document.getElementById('duplicateStatusText').value.trim(),
    failed_status_text: document.getElementById('failedStatusText').value.trim(),
    footer_text: document.getElementById('footerText').value.trim(),
    button_text: document.getElementById('buttonText').value.trim(),
    header_background_color: document.getElementById('headerBackgroundColorText').value.trim(),
    body_background_color: document.getElementById('bodyBackgroundColorText').value.trim(),
    footer_background_color: document.getElementById('footerBackgroundColorText').value.trim(),
    header_title_color: document.getElementById('headerTitleColorText').value.trim(),
    status_success_color: document.getElementById('statusSuccessColorText').value.trim(),
    status_failed_color: document.getElementById('statusFailedColorText').value.trim(),
    labels_color: document.getElementById('labelsColorText').value.trim(),
    values_color: document.getElementById('valuesColorText').value.trim(),
    secondary_text_color: document.getElementById('secondaryTextColorText').value.trim(),
    separator_color: document.getElementById('separatorColorText').value.trim(),
    button_color: document.getElementById('buttonColorText').value.trim(),
  };

  try {
    await api.updateLineReplySettings(replyMessageState.selectedLineOAId, payload);
    if (typeof addNotification === 'function') {
      addNotification('✅ บันทึกค่า Reply/Flex Message สำเร็จ');
    }
    closeReplySettingsModal();
  } catch (error) {
    if (typeof addNotification === 'function') {
      addNotification('❌ บันทึกค่า Reply/Flex Message ไม่สำเร็จ: ' + error.message);
    }
  }
}

async function initReplyMessagePage() {
  try {
    const tenantResponse = await api.getTenants();
    replyMessageState.tenants = tenantResponse.data || [];

    await Promise.all(
      replyMessageState.tenants.map(async (tenant) => {
        const response = await api.getLineOAs(tenant.id);
        replyMessageState.lineOAByTenant.set(tenant.id, response.data || []);
      })
    );

    renderReplyMessageCards();
  } catch (error) {
    const root = document.getElementById('replyTenantGrid');
    if (root) {
      root.innerHTML = `<div class="text-danger">โหลดข้อมูลไม่สำเร็จ: ${error.message}</div>`;
    }
  }
}

window.setLayoutForPage = setLayoutForPage;
window.goToReplyMessagePage = goToReplyMessagePage;
window.goToDashboardPage = goToDashboardPage;
window.initReplyMessagePage = initReplyMessagePage;
window.openReplySettingsModal = openReplySettingsModal;
window.closeReplySettingsModal = closeReplySettingsModal;
window.saveReplySettings = saveReplySettings;
