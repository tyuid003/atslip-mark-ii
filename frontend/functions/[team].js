// ============================================================
// SMS-HOOK SUB-PROJECT — serve /{teamslug} → sms-hook.html
// (ลบไฟล์นี้ + sms-hook.html เพื่อถอด sub-project ออกจาก frontend)
// ============================================================
// จับ path แบบ segment เดียวที่ไม่มีนามสกุลไฟล์ (คือ team slug)
// path ที่มีนามสกุล (.html/.js/.css/.ico ฯลฯ) จะปล่อยผ่านไปให้ static asset ตามปกติ
// เส้นทางที่ต้องปล่อยผ่านให้ static file ทำงานเอง
const EXCLUDED_PATHS = new Set([
  '/login', '/master', '/api', '/sms-hook', '/flexmessage-preview',
]);

export async function onRequest(context) {
  const { request, next, env } = context;
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/$/, '') || '/';

  // มีนามสกุลไฟล์ → เป็น static asset ปล่อยผ่าน
  if (/\.[a-z0-9]+$/i.test(pathname)) {
    return next();
  }

  // เส้นทางที่รู้จักอยู่แล้ว (login, master, api, …) → ปล่อยผ่าน
  if (EXCLUDED_PATHS.has(pathname)) {
    return next();
  }

  // /{teamslug} → เสิร์ฟหน้า SMS-Hook (หน้าอ่าน slug จาก location.pathname เอง)
  return env.ASSETS.fetch(new Request(new URL('/sms-hook.html', url.origin), request));
}
