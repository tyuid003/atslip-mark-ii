// ============================================================
// SMS-HOOK SUB-PROJECT — serve /{teamslug} → sms-hook.html
// (ลบไฟล์นี้ + sms-hook.html เพื่อถอด sub-project ออกจาก frontend)
// ============================================================
// จับ path แบบ segment เดียวที่ไม่มีนามสกุลไฟล์ (คือ team slug)
// path ที่มีนามสกุล (.html/.js/.css/.ico ฯลฯ) จะปล่อยผ่านไปให้ static asset ตามปกติ
export async function onRequest(context) {
  const { request, next, env } = context;
  const url = new URL(request.url);

  // มีนามสกุลไฟล์ → เป็น static asset ปล่อยผ่าน
  if (/\.[a-z0-9]+$/i.test(url.pathname)) {
    return next();
  }

  // /{teamslug} → เสิร์ฟหน้า SMS-Hook (หน้าอ่าน slug จาก location.pathname เอง)
  return env.ASSETS.fetch(new Request(new URL('/sms-hook.html', url.origin), request));
}
