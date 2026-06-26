import type { Env } from '../types';

type TgEnv = Env & { TELEGRAM_AUTH_DO: DurableObjectNamespace };

function getDO(env: TgEnv, sessionId: string) {
  const ns = env.TELEGRAM_AUTH_DO;
  return ns.get(ns.idFromName(sessionId));
}

function json(data: any): Response {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// POST /api/tg-auth/send-code  { phoneNumber }  → { ok, sessionId }
export async function handleTgSendCode(request: Request, env: Env): Promise<Response> {
  const sessionId = crypto.randomUUID();
  const body = await request.text();
  const stub = getDO(env as TgEnv, sessionId);
  const res = await stub.fetch(new Request('https://do/send-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  }));
  const data = await res.json() as any;
  return json(data.ok ? { ...data, sessionId } : data);
}

// POST /api/tg-auth/verify-code  { sessionId, code }  → { ok, session, user, photo } | { ok, needs2fa }
export async function handleTgVerifyCode(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as any;
  const { sessionId, ...rest } = body ?? {};
  if (!sessionId) return json({ ok: false, error: 'sessionId required' });
  return getDO(env as TgEnv, sessionId).fetch(new Request('https://do/verify-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rest),
  }));
}

// POST /api/tg-auth/verify-2fa  { sessionId, password }  → { ok, session, user, photo }
export async function handleTgVerify2FA(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as any;
  const { sessionId, ...rest } = body ?? {};
  if (!sessionId) return json({ ok: false, error: 'sessionId required' });
  return getDO(env as TgEnv, sessionId).fetch(new Request('https://do/verify-2fa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rest),
  }));
}

// POST /api/tg-auth/qr-start  {}  → { ok, sessionId, url }
export async function handleTgQRStart(_request: Request, env: Env): Promise<Response> {
  const sessionId = crypto.randomUUID();
  const stub = getDO(env as TgEnv, sessionId);
  const res = await stub.fetch(new Request('https://do/qr-start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  }));
  const data = await res.json() as any;
  return json(data.ok ? { ...data, sessionId } : data);
}

// GET /api/tg-auth/qr-status/:sessionId  → { ok, status, url, session, user, photo, error }
export async function handleTgQRStatus(_request: Request, env: Env, sessionId: string): Promise<Response> {
  if (!sessionId) return json({ ok: false, error: 'sessionId required' });
  return getDO(env as TgEnv, sessionId).fetch(new Request('https://do/qr-status', { method: 'GET' }));
}

// POST /api/tg-auth/logout  { session }  → { ok }
export async function handleTgLogout(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as any;
  const { session } = body ?? {};
  if (!session) return json({ ok: true });
  // Use a disposable DO instance just for the logout call
  const sessionId = crypto.randomUUID();
  return getDO(env as TgEnv, sessionId).fetch(new Request('https://do/logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session }),
  }));
}

// GET /api/tg-auth/health  → { ok: true }
export function handleTgHealth(): Response {
  return json({ ok: true });
}
