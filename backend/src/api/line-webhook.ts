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
  const messageType = messages[0]?.type || 'unknown';
  const isFlexMessage = messageType === 'flex';
  
  console.log('[LINE Reply API] Sending reply:', {
    messageType,
    isFlexMessage,
    messageCount: messages.length,
    replyTokenPrefix: replyToken.substring(0, 10) + '...',
  });

  try {
    const response = await fetch('https://api.line.me/v2/bot/message/reply', {
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

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('[LINE Reply API] Failed:', {
        status: response.status,
        statusText: response.statusText,
        errorBody,
        messageType,
      });
      throw new Error(`LINE Reply API failed: ${response.status} ${errorBody}`);
    }

    console.log('[LINE Reply API] Success:', {
      status: response.status,
      messageType,
      isFlexMessage,
    });
  } catch (error) {
    console.error('[LINE Reply API] Exception:', {
      error: error instanceof Error ? error.message : String(error),
      messageType,
    });
    throw error;
  }
}

async function callLinePushAPI(channelAccessToken: string, to: string, messages: any[]): Promise<void> {
  const messageType = messages[0]?.type || 'unknown';
  const isFlexMessage = messageType === 'flex';
  const flexAltText = isFlexMessage ? messages[0]?.altText : undefined;
  
  console.log('[LINE Push API] Sending push message:', {
    messageType,
    isFlexMessage,
    flexAltText,
    messageCount: messages.length,
    toUserPrefix: to.substring(0, 8) + '...',
  });

  try {
    const response = await fetch('https://api.line.me/v2/bot/message/push', {
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

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('[LINE Push API] Failed:', {
        status: response.status,
        statusText: response.statusText,
        errorBody,
        messageType,
        flexAltText,
      });
      throw new Error(`LINE Push API failed: ${response.status} ${errorBody}`);
    }

    console.log('[LINE Push API] Success:', {
      status: response.status,
      messageType,
      isFlexMessage,
      flexAltText,
    });
  } catch (error) {
    console.error('[LINE Push API] Exception:', {
      error: error instanceof Error ? error.message : String(error),
      messageType,
      flexAltText,
    });
    throw error;
  }
}

function formatDisplayDate(rawDate: string | undefined): string {
  if (!rawDate) return '-';
  
  try {
    const parsed = new Date(rawDate);
    if (Number.isNaN(parsed.getTime())) {
      // ถ้า parse ไม่ได้ ลองแยกแล้วสร้าง Date ใหม่
      const dateStr = rawDate.substring(0, 19); // "2026-03-02T12:10:00"
      return dateStr.replace('T', ' '); // "2026-03-02 12:10:00"
    }
    
    // ปรับเวลา UTC เป็น Thai timezone (UTC+7)
    // getTime() ได้มิลลิวินาทีตั้งแต่ epoch
    const utcTime = parsed.getTime();
    const thaiTime = new Date(utcTime + 7 * 60 * 60 * 1000); // เพิ่ม 7 ชั่วโมง
    
    return thaiTime.toLocaleString('th-TH', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch (error) {
    console.log('[formatDisplayDate] Error:', error, 'rawDate:', rawDate);
    return rawDate || '-';
  }
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

  console.log('[buildFlexMessage] Building Flex message:', {
    status,
    amount,
    resolvedMemberCode,
    hasSlipData: !!scanData?.slip,
    hasCreditData: !!scanData?.credit,
  });

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

  console.log('[processImageEvent] Starting:', {
    tenantId: lineOA.tenant_id,
    lineOAId: lineOA.id,
    messageId,
    userIdPrefix: userId?.substring(0, 8) + '...',
  });

  if (!messageId || !userId) {
    console.log('[processImageEvent] Missing messageId or userId');
    return;
  }

  const imageFile = await fetchLineImage(lineOA.channel_access_token, messageId);
  if (!imageFile) {
    console.log('[processImageEvent] Failed to fetch image from LINE');
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

  console.log('[processImageEvent] Image fetched, starting scan');

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

  console.log('[processImageEvent] Scan completed:', {
    success: scanPayload?.success,
    status: scanPayload?.data?.status,
    scanResponseOk: scanResponse.ok,
  });

  if (!scanResponse.ok || !scanPayload?.success) {
    if (isDuplicateScanResult(scanResponse, scanPayload) && settings.enable_duplicate_flex === 1) {
      console.log('[processImageEvent] Duplicate scan detected, sending duplicate flex');
      await callLinePushAPI(lineOA.channel_access_token, userId, [
        buildFlexMessage(settings, 'duplicate', scanPayload?.data || {}),
      ]);
      return;
    }

    console.log('[processImageEvent] Scan failed, sending failed reply');
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
    console.log('[processImageEvent] Status is credited, sending success flex');
    await callLinePushAPI(lineOA.channel_access_token, userId, [
      buildFlexMessage(settings, 'credited', data),
    ]);
    return;
  }

  if (status === 'duplicate' && settings.enable_duplicate_flex === 1) {
    console.log('[processImageEvent] Status is duplicate, sending duplicate flex');
    await callLinePushAPI(lineOA.channel_access_token, userId, [
      buildFlexMessage(settings, 'duplicate', data),
    ]);
    return;
  }

  console.log('[processImageEvent] No matching status for flex, sending failed reply if enabled');
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
  console.log('[LINE Webhook] Received webhook:', {
    tenantId,
    lineOAId,
  });

  const lineOA = await env.DB.prepare(
    `SELECT id, tenant_id, channel_secret, channel_access_token, webhook_enabled, status
     FROM line_oas
     WHERE id = ? AND tenant_id = ? LIMIT 1`
  )
    .bind(lineOAId, tenantId)
    .first<any>();

  if (!lineOA) {
    console.log('[LINE Webhook] LINE OA not found:', { tenantId, lineOAId });
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

  console.log('[LINE Webhook] Parsed events:', {
    eventCount: events.length,
    eventTypes: events.map((e: any) => e?.type).join(', '),
  });

  const settings = await getOrCreateLineMessageSettings(env, lineOA.id, lineOA.tenant_id);

  console.log('[LINE Webhook] Message settings loaded:', {
    enable_processing_reply: settings.enable_processing_reply,
    enable_success_flex: settings.enable_success_flex,
    enable_duplicate_flex: settings.enable_duplicate_flex,
    enable_failed_reply: settings.enable_failed_reply,
  });

  for (const event of events) {
    if (event?.type !== 'message' || event?.message?.type !== 'image') {
      console.log('[LINE Webhook] Skipping non-image event:', { eventType: event?.type, messageType: event?.message?.type });
      continue;
    }

    console.log('[LINE Webhook] Processing image event');

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
