// LINE Webhook Handler - Process incoming LINE messages

import { getImageContent, removeTitlePrefix, pushFlexMessage } from '../utils/helpers';
import { createCreditedFlexMessage, createDuplicateFlexMessage } from '../utils/flex-messages';
import { verifySlip, matchAccount, searchUser, submitCredit } from '../api/scan';

/**
 * Process LINE webhook events
 */
export async function handleLineWebhook(
  request: Request,
  env: any,
  ctx: any,
  tenantId: string,
  oaId: string
): Promise<Response> {
  try {
    console.log(`[handleLineWebhook] ==================== START ====================`);

    // Get LINE OA config
    const lineOas = await getLineOas(env, tenantId);
    const lineOa = lineOas.find((oa: any) => oa.id === oaId);

    if (!lineOa) {
      console.error(`❌ LINE OA not found: ${oaId}`);
      return new Response("LINE OA not found", { status: 404 });
    }

    const body = await request.json() as any;
    if (!body.events || body.events.length === 0) {
      return new Response("OK", { status: 200 });
    }

    const messageSettings = await getMessageSettings(env, tenantId);

    for (let i = 0; i < body.events.length; i++) {
      const event = body.events[i];
      console.log(`[handleLineWebhook] Processing event ${i + 1}/${body.events.length}`);

      if (event.type === "message" && event.message?.type === "image") {
        const messageId = event.message.id;
        const replyToken = event.replyToken;
        const userId = event.source?.userId || "unknown";

        console.log(`[handleLineWebhook] 📸 Image message from user: ${userId}`);

        // Send immediate reply
        if (messageSettings.imageReplyEnabled && messageSettings.imageReplyMessage) {
          await replyMessage(
            replyToken,
            messageSettings.imageReplyMessage,
            lineOa.accessToken
          );
        }

        // Download image
        const imageBuffer = await getImageContent(messageId, lineOa.accessToken);
        if (!imageBuffer) {
          console.error(`❌ Failed to download image`);
          continue;
        }

        // Save and process in background
        try {
          const now = new Date().toISOString();
          const tempId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

          const saveResult = await env.DB.prepare(`
            INSERT INTO pending_transactions 
            (tenant_id, slip_data, user_data, status, amount, sender_account, sender_bank, receiver_account, created_at, slip_ref, credited_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            tenantId,
            JSON.stringify({ pending: "verification in progress" }),
            JSON.stringify({
              lineUserId: userId,
              messageId,
              timestamp: Date.now(),
              imageSize: imageBuffer.byteLength
            }),
            "pending_verification",
            0,
            "Pending Verification",
            "unknown",
            "unknown",
            now,
            tempId,
            null
          ).run();

          const transactionId = saveResult.meta.last_row_id;
          console.log(`✅ Saved transaction ID: ${transactionId}`);

          // Schedule background processing
          ctx.waitUntil(
            processSlipInBackground(
              env,
              tenantId,
              transactionId,
              imageBuffer,
              userId,
              replyToken,
              lineOa.accessToken,
              messageSettings
            )
          );
        } catch (saveError) {
          console.error(`❌ Error saving transaction:`, saveError);
        }
      }
    }

    console.log(`[handleLineWebhook] ==================== END ====================`);
    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error(`[handleLineWebhook] ❌ Error:`, error);
    return new Response("Internal Server Error", { status: 500 });
  }
}

/**
 * Background task to verify and process slip
 */
async function processSlipInBackground(
  env: any,
  tenantId: string,
  transactionId: number,
  imageBuffer: ArrayBuffer,
  userId: string,
  replyToken: string,
  accessToken: string,
  messageSettings: any
): Promise<void> {
  try {
    console.log(`🔄 Processing slip for transaction ID: ${transactionId}`);

    // Verify slip
    const verifyResult = await verifySlip(env, tenantId, imageBuffer);
    if (!verifyResult.success) {
      console.error(`❌ Verification failed`);
      await env.DB.prepare(`
        UPDATE pending_transactions 
        SET status = ? 
        WHERE id = ?
      `).bind("failed", transactionId).run();
      return;
    }

    const slipData = verifyResult.data?.data || verifyResult.data;
    const now = new Date().toISOString();

    // Update with slip data
    await env.DB.prepare(`
      UPDATE pending_transactions 
      SET slip_data = ?, status = ?
      WHERE id = ?
    `).bind(JSON.stringify(slipData), "pending", transactionId).run();

    // Match account
    const receiverAccount = slipData.receiver?.account?.value;
    const receiverName = slipData.receiver?.account?.name?.en;

    const accountMatch = await matchAccount(env, tenantId, receiverAccount, receiverName);
    if (!accountMatch.matched) {
      console.log(`⚠️ Account not matched`);
      return;
    }

    // Search for user
    const senderName = removeTitlePrefix(
      slipData.sender?.account?.name?.th || slipData.sender?.account?.name?.en || ""
    );
    const searchResult = await searchUser(env, tenantId, senderName);
    
    if (!searchResult.user) {
      console.log(`⚠️ User not found`);
      return;
    }

    // Submit credit
    const creditResult = await submitCredit(
      env,
      tenantId,
      slipData,
      searchResult.user,
      accountMatch.accountId!
    );

    if (!creditResult.success) {
      console.warn(`⚠️ Credit submission failed`);
      return;
    }

    const finalStatus = creditResult.isDuplicate ? "duplicate" : "credited";
    
    // Update transaction status
    await env.DB.prepare(`
      UPDATE pending_transactions 
      SET status = ?, credited_at = ?
      WHERE id = ?
    `).bind(finalStatus, now, transactionId).run();

    console.log(`✅ Transaction completed with status: ${finalStatus}`);

    // Send flex message
    if (messageSettings.flexMessageEnabled && userId) {
      try {
        const amount = slipData.amount?.amount || 0;
        const flexMessage = finalStatus === "credited"
          ? createCreditedFlexMessage(
              amount,
              searchResult.user.memberCode || "ยูสเซอร์",
              searchResult.user.fullname,
              slipData.date || now,
              messageSettings
            )
          : createDuplicateFlexMessage(
              amount,
              searchResult.user.memberCode,
              slipData.date || now,
              messageSettings
            );

        await pushFlexMessage(userId, flexMessage, accessToken);
        console.log(`✅ Flex message sent`);
      } catch (flexError) {
        console.error(`⚠️ Failed to send flex message:`, flexError);
      }
    }
  } catch (error) {
    console.error(`❌ Background processing error:`, error);
  }
}

/**
 * Get LINE OAs for tenant
 */
async function getLineOas(env: any, tenantId: string): Promise<any[]> {
  try {
    const results = await env.DB.prepare(`
      SELECT id, tenant_id, name, channel_id, channel_secret, access_token, created_at
      FROM line_oas
      WHERE tenant_id = ?
      ORDER BY created_at ASC
    `).bind(tenantId).all();

    return (results.results || []).map((row: any) => ({
      id: row.id,
      tenantId: row.tenant_id,
      name: row.name,
      channelId: row.channel_id,
      channelSecret: row.channel_secret,
      accessToken: row.access_token,
      createdAt: row.created_at
    }));
  } catch (error) {
    console.error("[getLineOas] Error:", error);
    return [];
  }
}

/**
 * Get message settings
 */
async function getMessageSettings(env: any, tenantId: string): Promise<any> {
  try {
    const result = await env.DB.prepare(`
      SELECT * FROM message_settings WHERE tenant_id = ?
    `).bind(tenantId).first();

    if (!result) {
      return {
        flexMessageEnabled: true,
        imageReplyEnabled: true,
        imageReplyMessage: "ขอบคุณที่ส่งสลิป กำลังตรวจสอบ...",
        duplicateReplyEnabled: true,
        colorHeaderFooterBg: "#000000",
        colorBodyBg: "#1A1A1A",
        colorPrimary: "#D4AF37",
        colorSuccessText: "#33FF33",
        colorValueText: "#FFFFFF",
        colorSeparator: "#333333",
        colorMutedText: "#888888"
      };
    }

    return result;
  } catch (error) {
    console.error("Error getting message settings:", error);
    return {};
  }
}

/**
 * Reply to LINE user
 */
async function replyMessage(
  replyToken: string,
  message: string,
  accessToken: string
): Promise<boolean> {
  try {
    const response = await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        replyToken,
        messages: [{ type: "text", text: message }]
      })
    });

    return response.ok;
  } catch (error) {
    console.error("[replyMessage] Error:", error);
    return false;
  }
}
