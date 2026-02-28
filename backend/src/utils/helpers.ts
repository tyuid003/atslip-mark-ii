// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * สร้าง ID แบบ UUID v4
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * สร้าง timestamp ปัจจุบัน (Unix epoch)
 */
export function currentTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * แปลง Response เป็น JSON พร้อม CORS headers
 */
export function jsonResponse<T>(
  data: T,
  status: number = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Team-Slug',
      ...headers,
    },
  });
}

/**
 * สร้าง Success Response
 */
export function successResponse<T>(data: T, message?: string): Response {
  return jsonResponse({
    success: true,
    data,
    message,
  });
}

/**
 * สร้าง Error Response
 */
export function errorResponse(error: string, status: number = 400): Response {
  return jsonResponse(
    {
      success: false,
      error,
    },
    status
  );
}

/**
 * Handle CORS Preflight
 */
export function handleOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Team-Slug',
      'Access-Control-Max-Age': '86400',
    },
  });
}

/**
 * Parse Request Body เป็น JSON
 */
export async function parseRequestBody<T>(request: Request): Promise<T> {
  try {
    return await request.json();
  } catch (error) {
    throw new Error('Invalid JSON body');
  }
}

/**
 * Validate Required Fields
 */
export function validateRequired(
  data: Record<string, any>,
  requiredFields: string[]
): void {
  const missing = requiredFields.filter((field) => !data[field]);
  if (missing.length > 0) {
    throw new Error(`Missing required fields: ${missing.join(', ')}`);
  }
}

/**
 * Sanitize URL (ลบ trailing slash)
 */
export function sanitizeUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * เข้ารหัส Basic Auth
 */
export function encodeBasicAuth(username: string, password: string): string {
  return btoa(`${username}:${password}`);
}

/**
 * Sleep utility
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
