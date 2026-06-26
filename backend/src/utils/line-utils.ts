/**
 * Shared LINE messaging utilities.
 * Used by both line-webhook.ts and scan-queue.service.ts (LINE queue handler).
 * Must NOT import from scan-queue.service.ts to avoid circular dependencies.
 */

export async function callLineReplyAPI(channelAccessToken: string, replyToken: string, messages: any[]): Promise<void> {
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${channelAccessToken}`,
    },
    body: JSON.stringify({ replyToken, messages }),
  });
}

export async function callLinePushAPI(channelAccessToken: string, to: string, messages: any[]): Promise<void> {
  await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${channelAccessToken}`,
    },
    body: JSON.stringify({ to, messages }),
  });
}

export async function fetchLineImage(channelAccessToken: string, messageId: string): Promise<File | null> {
  const response = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${channelAccessToken}` },
  });
  if (!response.ok) return null;
  const contentType = response.headers.get('content-type') || 'image/jpeg';
  const buffer = await response.arrayBuffer();
  return new File([buffer], `line-${messageId}.jpg`, { type: contentType });
}

export function isDuplicateScanResult(scanResponse: Response, scanPayload: any): boolean {
  const statusCode = scanResponse.status;
  const errorText = [scanPayload?.error, scanPayload?.message, scanPayload?.detail]
    .filter(Boolean)
    .map((v: any) => String(v))
    .join(' | ')
    .toLowerCase();
  return (
    statusCode === 409 ||
    (statusCode === 400 && (errorText.includes('duplicate') || errorText.includes('ซ้ำ'))) ||
    errorText.includes('duplicate') ||
    errorText.includes('ซ้ำ')
  );
}

function formatDisplayDate(rawDate: string | undefined): string {
  if (!rawDate) return '-';
  const hasTimezone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(rawDate);
  if (!hasTimezone) {
    const normalized = rawDate.replace('T', ' ').trim();
    const match = normalized.match(/^(\d{4})[-/](\d{2})[-/](\d{2})\s+(\d{2}):(\d{2})/);
    if (match) {
      const [, year, month, day, hour, minute] = match;
      return `${day}/${month}/${year} ${hour}:${minute}`;
    }
  }
  const parsed = new Date(rawDate);
  if (Number.isNaN(parsed.getTime())) return rawDate;
  return parsed.toLocaleString('th-TH', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: 'Asia/Bangkok',
  });
}

function formatAmountBaht(amount: number): string {
  if (!Number.isFinite(amount)) return '0.00';
  return amount.toFixed(2);
}

function buildFlexAltText(status: 'credited' | 'duplicate' | 'failed', amount: number): string {
  if (status === 'credited') return `✅ ฝากเงินสำเร็จ ${formatAmountBaht(amount)} บาท ขอบคุณที่ใช้บริการค่ะ`;
  if (status === 'duplicate') return '⚠️ ตรวจพบยอดซ้ำ รายการนี้ทำรายการเรียบร้อยแล้วค่ะ';
  return '❌ ระบบไม่สามารถทำรายการได้ เดี๋ยวน้องแอดมินจะตรวจสอบให้ค่ะ🙏';
}

export function buildFlexMessage(settings: any, status: 'credited' | 'duplicate' | 'failed', scanData: any): any {
  const isSuccessStatus = status === 'credited';
  const statusText = status === 'credited'
    ? settings.success_status_text
    : status === 'duplicate'
      ? settings.duplicate_status_text
      : settings.failed_status_text;
  const statusColor = isSuccessStatus ? settings.status_success_color : settings.status_failed_color;
  const resolvedMemberCode = scanData?.credit?.resolved_memberCode
    || scanData?.sender?.username
    || scanData?.matched_user_id
    || scanData?.sender?.id
    || '-';
  const amount = Number(scanData?.slip?.amount || 0);

  return {
    type: 'flex',
    altText: buildFlexAltText(status, amount),
    contents: {
      type: 'bubble',
      size: 'mega',
      direction: 'ltr',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: settings.header_background_color,
        contents: [
          {
            type: 'image',
            url: settings.logo_image_url,
            size: '4xl',
            aspectMode: 'fit',
            margin: 'none',
            align: 'center',
            gravity: 'top',
          },
          {
            type: 'text',
            text: settings.header_title_text,
            weight: 'bold',
            color: settings.header_title_color,
            size: 'sm',
            align: 'center',
            margin: 'md',
          },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: settings.body_background_color,
        contents: [
          {
            type: 'text',
            text: statusText,
            weight: 'bold',
            size: 'xl',
            color: statusColor,
            align: 'center',
          },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'lg',
            spacing: 'sm',
            contents: [
              {
                type: 'box',
                layout: 'horizontal',
                contents: [
                  { type: 'text', text: 'ยูสเซอร์:', size: 'sm', color: settings.labels_color, flex: 2 },
                  { type: 'text', text: String(resolvedMemberCode), size: 'sm', color: settings.values_color, align: 'end', flex: 4, weight: 'bold' },
                ],
              },
              { type: 'separator', color: settings.separator_color, margin: 'md' },
              {
                type: 'box',
                layout: 'horizontal',
                margin: 'md',
                contents: [
                  { type: 'text', text: 'จำนวนเงิน', size: 'sm', color: settings.labels_color },
                  { type: 'text', text: `${amount.toFixed(2)} THB`, size: 'lg', color: settings.values_color, align: 'end', weight: 'bold' },
                ],
              },
              {
                type: 'box',
                layout: 'horizontal',
                contents: [
                  { type: 'text', text: 'วันที่/เวลา', size: 'sm', color: settings.secondary_text_color },
                  { type: 'text', text: formatDisplayDate(scanData?.slip?.date), size: 'sm', color: settings.secondary_text_color, align: 'end' },
                ],
              },
            ],
          },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'xl',
            contents: [
              {
                type: 'button',
                action: { type: 'uri', label: settings.button_text, uri: settings.play_url },
                style: 'primary',
                color: settings.button_color,
                height: 'sm',
              },
            ],
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: settings.footer_background_color,
        contents: [
          { type: 'text', text: settings.footer_text, size: 'xxs', color: settings.secondary_text_color, align: 'center' },
        ],
      },
    },
  };
}

/**
 * buildUshopLogCard — สร้างข้อมูลการ์ดแบบ structured สำหรับให้ univers_shop
 * แสดงผลในหน้าแชทเป็นการ์ด (ไม่ใช่ข้อความเปล่า ๆ) ให้แอดมินเห็นเหมือน flex
 */
export function buildUshopLogCard(
  settings: any,
  status: 'credited' | 'duplicate' | 'failed',
  scanData: any
): any {
  const statusText = status === 'credited'
    ? settings.success_status_text
    : status === 'duplicate'
      ? settings.duplicate_status_text
      : settings.failed_status_text;
  const statusColor = status === 'credited' ? settings.status_success_color : settings.status_failed_color;
  const resolvedMemberCode = scanData?.credit?.resolved_memberCode
    || scanData?.sender?.username
    || scanData?.matched_user_id
    || scanData?.sender?.id
    || '-';
  const amount = Number(scanData?.slip?.amount || 0);

  return {
    kind: 'flex',
    status,
    title: settings.header_title_text,
    statusText,
    statusColor,
    memberCode: String(resolvedMemberCode),
    amount,
    amountText: `${amount.toFixed(2)} THB`,
    date: formatDisplayDate(scanData?.slip?.date),
    ref: scanData?.slip?.ref || '',
    footer: settings.footer_text,
    // ── ข้อมูลสไตล์ต่อ tenant เพื่อให้ U-shop render การ์ดเหมือน LINE OA จริง ──
    style: {
      logoUrl: settings.logo_image_url,
      headerBg: settings.header_background_color,
      headerTitleColor: settings.header_title_color,
      bodyBg: settings.body_background_color,
      labelsColor: settings.labels_color,
      valuesColor: settings.values_color,
      separatorColor: settings.separator_color,
      secondaryTextColor: settings.secondary_text_color,
      buttonText: settings.button_text,
      buttonColor: settings.button_color,
      playUrl: settings.play_url,
      footerBg: settings.footer_background_color,
    },
  };
}

