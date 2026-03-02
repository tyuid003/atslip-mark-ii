// Utility Functions - Common helper functions

/**
 * Remove title prefixes from names
 * Removes Thai and English titles like "นาง", "ดร.", "Mr.", "Mrs." etc.
 */
export function removeTitlePrefix(name: string): string {
  if (!name) return "";

  const prefixes = [
    "นางสาว",
    "ด.ช.",
    "ด.ญ.",
    "น.ส.",
    "นาย",
    "นาง",
    "MISTRESS",
    "MASTER",
    "MISTER",
    "MISS",
    "MRS.",
    "MR.",
    "MS.",
    "Master",
    "Mister",
    "Miss",
    "Mrs.",
    "Mr.",
    "Ms."
  ];

  let cleanName = name.trim();
  for (const prefix of prefixes) {
    if (cleanName.startsWith(prefix + " ")) {
      cleanName = cleanName.substring(prefix.length + 1);
      break;
    } else if (cleanName.startsWith(prefix)) {
      cleanName = cleanName.substring(prefix.length);
      break;
    }
  }
  return cleanName.trim();
}

/**
 * Reply with a text message to LINE user
 */
export async function replyMessage(
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
        messages: [
          {
            type: "text",
            text: message
          }
        ]
      })
    });

    if (!response.ok) {
      console.error("[replyMessage] Failed:", await response.text());
      return false;
    }
    return true;
  } catch (error) {
    console.error("[replyMessage] Error:", error);
    return false;
  }
}

/**
 * Push a flex message to LINE user
 */
export async function pushFlexMessage(
  userId: string,
  flexMessage: any,
  accessToken: string
): Promise<boolean> {
  try {
    const response = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        to: userId,
        messages: [flexMessage]
      })
    });

    if (!response.ok) {
      console.error("[pushFlexMessage] Failed:", await response.text());
      return false;
    }
    return true;
  } catch (error) {
    console.error("[pushFlexMessage] Error:", error);
    return false;
  }
}

/**
 * Get image content from LINE message
 */
export async function getImageContent(
  messageId: string,
  accessToken: string
): Promise<ArrayBuffer | null> {
  try {
    const response = await fetch(
      `https://api-data.line.me/v2/bot/message/${messageId}/content`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    if (!response.ok) {
      console.error("[getImageContent] Failed:", response.status);
      return null;
    }

    return await response.arrayBuffer();
  } catch (error) {
    console.error("[getImageContent] Error:", error);
    return null;
  }
}
