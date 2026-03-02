import type { Env } from '../types';
import { jsonResponse } from '../utils/helpers';
import { ScanAPI } from './scan';
import { getOrCreateLineMessageSettings } from '../services/line-message-settings.service';

function base64FromArrayBuffer(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

async function verifyLineSignature(rawBody: string, channelSecret: string, signatureHeader: string | null): Promise<boolean> {
  if (!signatureHeader || !channelSecret) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(channelSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = base64FromArrayBuffer(signed);
  return expected === signatureHeader;
}

async function callLineReplyAPI(channelAccessToken: string, replyToken: string, messages: any[]): Promise<void> {
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${channelAccessToken}`,
    },
    body: JSON.stringify({
      replyToken,
      messages,
    }),
  });
}

async function callLinePushAPI(channelAccessToken: string, to: string, messages: any[]): Promise<void> {
  await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${channelAccessToken}`,
    },
    body: JSON.stringify({
      to,
      messages,
    }),
  });
}

function formatDisplayDate(rawDate: string | undefined): string {
  if (!rawDate) return '-';
  const parsed = new Date(rawDate);
  if (Number.isNaN(parsed.getTime())) {
    return rawDate;
  }
  return parsed.toLocaleString('th-TH', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatAmountBaht(amount: number): string {
  if (!Number.isFinite(amount)) {
    return '0.00';
  }
  return amount.toFixed(2);
}

function buildFlexAltText(status: 'credited' | 'duplicate' | 'failed', amount: number): string {
  if (status === 'credited') {
    return `✅ ฝากเงินสำเร็จ ${formatAmountBaht(amount)} บาท ขอบคุณที่ใช้บริการค่ะ`;
  }

  if (status === 'duplicate') {
    return '⚠️ ตรวจพบยอดซ้ำ รายการนี้ทำรายการเรียบร้อยแล้วค่ะ';
  }

  return '❌ ระบบไม่สามารถทำรายการได้ เดี๋ยวน้องแอดมินจะตรวจสอบให้ค่ะ🙏';
}

function isDuplicateScanResult(scanResponse: Response, scanPayload: any): boolean {
  const statusCode = scanResponse.status;
  const errorText = [
    scanPayload?.error,
    scanPayload?.message,
    scanPayload?.detail,
  ]
    .filter(Boolean)
    .map((value: any) => String(value))
    .join(' | ')
    .toLowerCase();

  return (
    statusCode === 409 ||
    (statusCode === 400 && (errorText.includes('duplicate') || errorText.includes('ซ้ำ'))) ||
    errorText.includes('duplicate') ||
    errorText.includes('ซ้ำ')
  );
}

function buildFlexMessage(settings: any, status: 'credited' | 'duplicate' | 'failed', scanData: any): any {
  const isSuccessStatus = status === 'credited';
  const statusText = status === 'credited'
    ? settings.success_status_text
    : status === 'duplicate'
      ? settings.duplicate_status_text
      : settings.failed_status_text;
  const statusColor = isSuccessStatus ? settings.status_success_color : settings.status_failed_color;

  const resolvedMemberCode = scanData?.credit?.resolved_memberCode || scanData?.matched_user_id || scanData?.sender?.id || '-';
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
                  {
                    type: 'text',
                    text: 'ยูสเซอร์:',
                    size: 'sm',
                    color: settings.labels_color,
                    flex: 2,
                  },
                  {
                    type: 'text',
                    text: String(resolvedMemberCode),
                    size: 'sm',
                    color: settings.values_color,
                    align: 'end',
                    flex: 4,
                    weight: 'bold',
                  },
                ],
              },
              {
                type: 'separator',
                color: settings.separator_color,
                margin: 'md',
              },
              {
                type: 'box',
                layout: 'horizontal',
                margin: 'md',
                contents: [
                  {
                    type: 'text',
                    text: 'จำนวนเงิน',
                    size: 'sm',
                    color: settings.labels_color,
                  },
                  {
                    type: 'text',
                    text: `${amount.toFixed(2)} THB`,
                    size: 'lg',
                    color: settings.values_color,
                    align: 'end',
                    weight: 'bold',
                  },
                ],
              },
              {
                type: 'box',
                layout: 'horizontal',
                contents: [
                  {
                    type: 'text',
                    text: 'วันที่/เวลา',
                    size: 'sm',
                    color: settings.secondary_text_color,
                  },
                  {
                    type: 'text',
                    text: formatDisplayDate(scanData?.slip?.date),
                    size: 'sm',
                    color: settings.secondary_text_color,
                    align: 'end',
                  },
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
                action: {
                  type: 'uri',
                  label: settings.button_text,
                  uri: settings.play_url,
                },
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
          {
            type: 'text',
            text: settings.footer_text,
            size: 'xxs',
            color: settings.secondary_text_color,
            align: 'center',
          },
        ],
      },
    },
  };
}

async function fetchLineImage(channelAccessToken: string, messageId: string): Promise<File | null> {
  const response = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${channelAccessToken}`,
    },
  });

  if (!response.ok) {
    return null;
  }

  const contentType = response.headers.get('content-type') || 'image/jpeg';
  const buffer = await response.arrayBuffer();
  return new File([buffer], `line-${messageId}.jpg`, { type: contentType });
}

async function processImageEvent(
  env: Env,
  lineOA: any,
  settings: any,
  event: any
): Promise<void> {
  const messageId = event?.message?.id;
  const userId = event?.source?.userId;

  if (!messageId || !userId) {
    return;
  }

  const imageFile = await fetchLineImage(lineOA.channel_access_token, messageId);
  if (!imageFile) {
    if (settings.enable_failed_reply === 1) {
      await callLinePushAPI(lineOA.channel_access_token, userId, [
        {
          type: 'text',
          text: settings.failed_reply_text,
        },
      ]);
    }
    return;
  }

  const formData = new FormData();
  formData.append('file', imageFile);
  formData.append('tenant_id', lineOA.tenant_id);
  formData.append('source', 'webhook');
  formData.append('line_oa_id', lineOA.id);

  const internalRequest = new Request('https://internal.local/api/scan/upload', {
    method: 'POST',
    body: formData,
  });

  const scanResponse = await ScanAPI.handleUploadSlip(internalRequest, env);
  const scanPayload = (await scanResponse.json()) as any;

  if (!scanResponse.ok || !scanPayload?.success) {
    if (isDuplicateScanResult(scanResponse, scanPayload) && settings.enable_duplicate_flex === 1) {
      await callLinePushAPI(lineOA.channel_access_token, userId, [
        buildFlexMessage(settings, 'duplicate', scanPayload?.data || {}),
      ]);
      return;
    }

    if (settings.enable_failed_reply === 1) {
      await callLinePushAPI(lineOA.channel_access_token, userId, [
        {
          type: 'text',
          text: settings.failed_reply_text,
        },
      ]);
    }
    return;
  }

  const data = scanPayload.data || {};
  const status = data.status;

  if (status === 'credited' && settings.enable_success_flex === 1) {
    await callLinePushAPI(lineOA.channel_access_token, userId, [
      buildFlexMessage(settings, 'credited', data),
    ]);
    return;
  }

  if (status === 'duplicate' && settings.enable_duplicate_flex === 1) {
    await callLinePushAPI(lineOA.channel_access_token, userId, [
      buildFlexMessage(settings, 'duplicate', data),
    ]);
    return;
  }

  if (settings.enable_failed_reply === 1) {
    await callLinePushAPI(lineOA.channel_access_token, userId, [
      {
        type: 'text',
        text: settings.failed_reply_text,
      },
    ]);
  }
}

export async function handleLineWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  tenantId: string,
  lineOAId: string
): Promise<Response> {
  const lineOA = await env.DB.prepare(
    `SELECT id, tenant_id, channel_secret, channel_access_token, webhook_enabled, status
     FROM line_oas
     WHERE id = ? AND tenant_id = ? LIMIT 1`
  )
    .bind(lineOAId, tenantId)
    .first<any>();

  if (!lineOA) {
    return jsonResponse({ success: true, ignored: true, reason: 'LINE OA not found' });
  }

  if (lineOA.status !== 'active' || Number(lineOA.webhook_enabled) !== 1) {
    return jsonResponse({ success: true, ignored: true, reason: 'Webhook disabled' });
  }

  const rawBody = await request.text();
  const signature = request.headers.get('x-line-signature');
  const valid = await verifyLineSignature(rawBody, lineOA.channel_secret, signature);

  if (!valid) {
    return jsonResponse({ success: false, error: 'Invalid LINE signature' }, 401);
  }

  const payload = JSON.parse(rawBody || '{}') as any;
  const events = Array.isArray(payload.events) ? payload.events : [];

  const settings = await getOrCreateLineMessageSettings(env, lineOA.id, lineOA.tenant_id);

  for (const event of events) {
    if (event?.type !== 'message' || event?.message?.type !== 'image') {
      continue;
    }

    if (settings.enable_processing_reply === 1 && event.replyToken) {
      await callLineReplyAPI(lineOA.channel_access_token, event.replyToken, [
        {
          type: 'text',
          text: settings.processing_reply_text,
        },
      ]);
    }

    ctx.waitUntil(processImageEvent(env, lineOA, settings, event));
  }

  return jsonResponse({ success: true, received: true });
}
