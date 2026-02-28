// Flex Message Creator - Generate LINE Flex Messages

export interface MessageSettings {
  flexLogoUrl: string;
  colorHeaderFooterBg: string;
  colorBodyBg: string;
  colorPrimary: string;
  colorSuccessText: string;
  colorValueText: string;
  colorSeparator: string;
  colorMutedText: string;
  gameUrl?: string;
}

/**
 * Create a flex message for successful credit transaction
 */
export function createCreditedFlexMessage(
  amount: number,
  memberCode: string,
  fullname: string,
  slipDate: string,
  settings: MessageSettings
): any {
  const displayMemberCode = memberCode && memberCode.trim() !== "" 
    ? memberCode.trim() 
    : "(ยูสเซอร์)";
  
  const displayFullname = fullname && fullname.trim() !== "" 
    ? fullname.trim() 
    : "ผู้ใช้";

  let timestamp: string;
  try {
    const slipDateTime = new Date(slipDate);
    timestamp = slipDateTime.toLocaleString("th-TH", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch (e) {
    timestamp = new Date().toLocaleString("th-TH", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  const formattedAmount = amount.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  const headerContents: any[] = [];
  
  if (settings.flexLogoUrl) {
    headerContents.push({
      type: "image",
      url: settings.flexLogoUrl,
      size: "4xl",
      aspectMode: "fit",
      margin: "none",
      align: "center",
      gravity: "top"
    });
  }

  headerContents.push({
    type: "text",
    text: "AUTO DEPOSIT SUCCESS",
    weight: "bold",
    color: settings.colorPrimary || "#D4AF37",
    size: "sm",
    align: "center",
    margin: settings.flexLogoUrl ? "md" : "none"
  });

  const bodyContents = [
    {
      type: "text",
      text: "ฝากเงินสำเร็จ",
      weight: "bold",
      size: "xl",
      color: settings.colorSuccessText || "#33FF33",
      align: "center"
    },
    {
      type: "box",
      layout: "vertical",
      margin: "lg",
      spacing: "sm",
      contents: [
        {
          type: "box",
          layout: "horizontal",
          contents: [
            {
              type: "text",
              text: "ยูสเซอร์:",
              size: "sm",
              color: settings.colorPrimary || "#D4AF37",
              flex: 2
            },
            {
              type: "text",
              text: displayMemberCode,
              size: "sm",
              color: settings.colorValueText || "#FFFFFF",
              align: "end",
              flex: 4,
              weight: "bold"
            }
          ]
        },
        {
          type: "separator",
          color: settings.colorSeparator || "#333333",
          margin: "md"
        },
        {
          type: "box",
          layout: "horizontal",
          margin: "md",
          contents: [
            {
              type: "text",
              text: "จำนวนเงิน",
              size: "sm",
              color: settings.colorPrimary || "#D4AF37"
            },
            {
              type: "text",
              text: `${formattedAmount} THB`,
              size: "lg",
              color: settings.colorValueText || "#FFFFFF",
              align: "end",
              weight: "bold"
            }
          ]
        },
        {
          type: "box",
          layout: "horizontal",
          contents: [
            {
              type: "text",
              text: "วันที่/เวลา",
              size: "sm",
              color: settings.colorMutedText || "#888888"
            },
            {
              type: "text",
              text: timestamp,
              size: "sm",
              color: settings.colorMutedText || "#888888",
              align: "end"
            }
          ]
        }
      ]
    }
  ];

  if (settings.gameUrl) {
    bodyContents.push({
      type: "box",
      layout: "vertical",
      margin: "xl",
      contents: [
        {
          type: "button",
          action: {
            type: "uri",
            label: "เข้าเล่นเกม",
            uri: settings.gameUrl
          },
          style: "primary",
          color: settings.colorPrimary || "#D4AF37",
          height: "sm"
        }
      ]
    });
  }

  return {
    type: "flex",
    altText: `✅ ฝากเงินสำเร็จ ${formattedAmount} THB`,
    contents: {
      type: "bubble",
      size: "mega",
      direction: "ltr",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: settings.colorHeaderFooterBg || "#000000",
        contents: headerContents
      },
      body: {
        type: "box",
        layout: "vertical",
        backgroundColor: settings.colorBodyBg || "#1A1A1A",
        contents: bodyContents
      },
      footer: {
        type: "box",
        layout: "vertical",
        backgroundColor: settings.colorHeaderFooterBg || "#000000",
        contents: [
          {
            type: "text",
            text: "ขอบคุณที่ใช้บริการค่ะ",
            size: "xxs",
            color: settings.colorMutedText || "#888888",
            align: "center"
          }
        ]
      }
    }
  };
}

/**
 * Create a flex message for duplicate transaction
 */
export function createDuplicateFlexMessage(
  amount: number,
  memberCode: string,
  slipDate: string,
  settings: MessageSettings
): any {
  let timestamp: string;
  try {
    const slipDateTime = new Date(slipDate);
    timestamp = slipDateTime.toLocaleString("th-TH", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch (e) {
    timestamp = new Date().toLocaleString("th-TH", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  const formattedAmount = amount.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  const headerContents: any[] = [];
  if (settings.flexLogoUrl) {
    headerContents.push({
      type: "image",
      url: settings.flexLogoUrl,
      size: "4xl",
      aspectMode: "fit",
      margin: "none",
      align: "center",
      gravity: "top"
    });
  }

  headerContents.push({
    type: "text",
    text: "DUPLICATE TRANSACTION",
    weight: "bold",
    color: "#FFA500",
    size: "sm",
    align: "center",
    margin: settings.flexLogoUrl ? "md" : "none"
  });

  return {
    type: "flex",
    altText: `⚠️ รายการซ้ำ ${formattedAmount} THB`,
    contents: {
      type: "bubble",
      size: "mega",
      direction: "ltr",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: settings.colorHeaderFooterBg || "#000000",
        contents: headerContents
      },
      body: {
        type: "box",
        layout: "vertical",
        backgroundColor: settings.colorBodyBg || "#1A1A1A",
        contents: [
          {
            type: "text",
            text: "รายการฝากซ้ำ",
            weight: "bold",
            size: "xl",
            color: "#FFA500",
            align: "center"
          },
          {
            type: "box",
            layout: "vertical",
            margin: "lg",
            spacing: "sm",
            contents: [
              {
                type: "text",
                text: "พบรายการนี้ในระบบแล้ว",
                size: "sm",
                color: settings.colorMutedText || "#888888",
                align: "center",
                wrap: true
              },
              {
                type: "separator",
                color: settings.colorSeparator || "#333333",
                margin: "md"
              },
              {
                type: "box",
                layout: "horizontal",
                margin: "md",
                contents: [
                  {
                    type: "text",
                    text: "จำนวนเงิน",
                    size: "sm",
                    color: settings.colorPrimary || "#D4AF37"
                  },
                  {
                    type: "text",
                    text: `${formattedAmount} THB`,
                    size: "lg",
                    color: settings.colorValueText || "#FFFFFF",
                    align: "end",
                    weight: "bold"
                  }
                ]
              },
              {
                type: "box",
                layout: "horizontal",
                contents: [
                  {
                    type: "text",
                    text: "ยูสเซอร์:",
                    size: "sm",
                    color: settings.colorPrimary || "#D4AF37",
                    flex: 2
                  },
                  {
                    type: "text",
                    text: memberCode,
                    size: "sm",
                    color: settings.colorValueText || "#FFFFFF",
                    align: "end",
                    flex: 4,
                    weight: "bold"
                  }
                ]
              },
              {
                type: "separator",
                color: settings.colorSeparator || "#333333",
                margin: "md"
              },
              {
                type: "box",
                layout: "horizontal",
                margin: "md",
                contents: [
                  {
                    type: "text",
                    text: "วันที่/เวลา",
                    size: "sm",
                    color: settings.colorMutedText || "#888888"
                  },
                  {
                    type: "text",
                    text: timestamp,
                    size: "sm",
                    color: settings.colorMutedText || "#888888",
                    align: "end"
                  }
                ]
              }
            ]
          }
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        backgroundColor: settings.colorHeaderFooterBg || "#000000",
        contents: [
          {
            type: "text",
            text: "ขอบคุณที่ใช้บริการค่ะ",
            size: "xxs",
            color: settings.colorMutedText || "#888888",
            align: "center"
          }
        ]
      }
    }
  };
}
