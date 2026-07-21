import type { Env } from '../types';
import { jsonResponse } from '../utils/helpers';
import { ScanAPI } from './scan';
import { getOrCreateLineMessageSettings } from '../services/line-message-settings.service';
import { enqueueScanJob, processScanJob } from '../services/scan-queue.service';
import {
  callLineReplyAPI,
  callLinePushAPI,
  fetchLineImage,
  isDuplicateScanResult,
  isConfirmedDuplicate,
  buildFlexMessage,
} from '../utils/line-utils';

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
    if (isDuplicateScanResult(scanResponse, scanPayload)) {
      // แจ้ง "รายการซ้ำ" เฉพาะเมื่อรายการเดิมเติมเครดิตแล้ว (หรือ anti-dup จริง)
      // ถ้ารายการเดิมยัง "รอจับคู่/ยังไม่เติม" → ไม่ส่ง flex ซ้ำ กันลูกค้าเข้าใจผิดว่าฝากสำเร็จ
      if (isConfirmedDuplicate(scanPayload) && settings.enable_duplicate_flex === 1) {
        await callLinePushAPI(lineOA.channel_access_token, userId, [
          buildFlexMessage(settings, 'duplicate', scanPayload?.data || {}),
        ]);
      }
      return; // สลิปซ้ำ: ไม่ตอบ failed reply ไม่ว่ากรณีใด
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

  // หา team_id ของ tenant สำหรับ enqueue (ทำครั้งเดียวก่อน loop)
  const tenantRow = await env.DB.prepare(
    `SELECT team_id FROM tenants WHERE id = ? AND status = 'active' LIMIT 1`
  ).bind(lineOA.tenant_id).first<{ team_id: string }>();

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

    if (tenantRow?.team_id) {
      // Enqueue ด้วย retry mechanism แทน fire-and-forget (แก้ปัญหาสลิปหาย)
      const jobKey = `line-${lineOA.id}-${event.message.id}`;
      const { id: jobId } = await enqueueScanJob(env, {
        team_id: tenantRow.team_id,
        tenant_id: lineOA.tenant_id,
        source: 'line',
        idempotency_key: jobKey,
        payload: {
          line_oa_id: lineOA.id,
          line_user_id: event.source?.userId,
          line_message_id: event.message.id,
        },
      });
      // ส่งเข้า Cloudflare Queue → consumer ประมวลผลแบบเชื่อถือได้ (retry + DLQ)
      // แทน ctx.waitUntil เดิมที่ถูกยกเลิกกลางคันช่วงพีค (ต้นเหตุสลิปค้าง)
      // งานที่ fail/ค้าง ยังมี cron (ทุก 1 นาที) เป็นตัวระบายสำรอง
      await env.SCAN_QUEUE.send({ jobId });
    } else {
      // fallback: ถ้าหา team_id ไม่ได้ ใช้ direct process เดิม
      ctx.waitUntil(processImageEvent(env, lineOA, settings, event));
    }
  }

  return jsonResponse({ success: true, received: true });
}
