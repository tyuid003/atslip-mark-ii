// Bank Master List Mapping
// จาก Admin API: GET /api/accounting/banks/list
export const BANK_CODE_TO_ID: Record<string, number> = {
  'kbank': 1,    // กสิกรไทย
  'scb': 2,      // ไทยพาณิชย์
  'bbl': 3,      // กรุงเทพ
  'bay': 4,      // กรุงศรี
  'ktb': 5,      // กรุงไทย
  'ttb': 6,      // ทีเอ็มบีธนชาต
  'gsb': 7,      // ออมสิน
  'baac': 8,     // ธกส
  'kkp': 9,      // เกียรตินาคิน
  'ghb': 10,     // อาคารสงเคราะห์
  'uob': 11,     // ยูโอบี
  'lh': 12,      // แลนด์ แอนด์ เฮ้าส์
  'cimb': 13,    // ซีไอเอ็มบี
  'hsbc': 14,    // เอชเอสบีซี
  'icbc': 15,    // ไอซีบีซี
  'isbt': 16,    // ธนาคารอิสลาม
  'tisco': 17,   // ทิสโก้
  'citi': 18,    // ซิตี้แบงก์
  'scbt': 19,    // สแตนดาร์ดชาร์เตอร์ด
  'true': 20,    // TrueMoney Wallet
  'external': 21, // ธนาคารภายนอก
  'unknown': 100  // ไม่พบข้อมูลธนาคาร
};
