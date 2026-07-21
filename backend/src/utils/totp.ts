// ============================================================
// TOTP (RFC 6238) — Google Authenticator compatible
// ใช้สร้างรหัส 6 หลักจาก base32 secret (HMAC-SHA1, period 30s)
// ทำงานบน Cloudflare Workers (Web Crypto)
// ============================================================

// Base32 decode (RFC 4648) → Uint8Array
function base32Decode(input: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(input || '').replace(/=+$/, '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  let index = 0;
  const output = new Uint8Array(Math.floor((clean.length * 5) / 8));
  for (let i = 0; i < clean.length; i++) {
    const idx = alphabet.indexOf(clean[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output[index++] = (value >>> (bits - 8)) & 0xff;
      bits -= 8;
    }
  }
  return output.slice(0, index);
}

/**
 * สร้างรหัส TOTP จาก base32 secret
 * @param base32Secret secret จาก otpauth (เช่น "Q5R6JN5TMH6XN3SPXCPJYH3OR4HK44BF")
 * @param opts digits (default 6), period (default 30s), timestamp (ms, default now), offsetSteps (เลื่อนหน้าต่างเวลา)
 */
export async function generateTOTP(
  base32Secret: string,
  opts: { digits?: number; period?: number; timestamp?: number; offsetSteps?: number } = {}
): Promise<string> {
  const digits = opts.digits ?? 6;
  const period = opts.period ?? 30;
  const nowSec = Math.floor((opts.timestamp ?? Date.now()) / 1000);
  let counter = Math.floor(nowSec / period) + (opts.offsetSteps ?? 0);

  const key = base32Decode(base32Secret);
  const counterBytes = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) {
    counterBytes[i] = counter & 0xff;
    counter = Math.floor(counter / 256);
  }

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, counterBytes));
  const offset = sig[sig.length - 1] & 0x0f;
  const binary =
    ((sig[offset] & 0x7f) << 24) |
    ((sig[offset + 1] & 0xff) << 16) |
    ((sig[offset + 2] & 0xff) << 8) |
    (sig[offset + 3] & 0xff);
  return (binary % 10 ** digits).toString().padStart(digits, '0');
}

/** ดึง secret จาก otpauth:// URI (เผื่อ backend ส่ง qrCode มาแต่ไม่ได้ส่ง secret แยก) */
export function extractSecretFromOtpauth(otpauth: string): string | null {
  try {
    const m = String(otpauth || '').match(/[?&]secret=([^&]+)/i);
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}
