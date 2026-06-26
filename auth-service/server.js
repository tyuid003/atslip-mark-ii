'use strict';

require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const { TelegramClient } = require('telegram');
const { StringSession }  = require('telegram/sessions');
const { Api }            = require('telegram');

// GramJS Password module for 2FA SRP computation
let computeCheck;
try {
  computeCheck = require('telegram/Password').computeCheck;
} catch (_) {
  try { computeCheck = require('telegram').computeCheck; } catch (_2) { /* handled below */ }
}

// ── Config ────────────────────────────────────────────────────────────────
const API_ID   = Number(process.env.TELEGRAM_API_ID);
const API_HASH = String(process.env.TELEGRAM_API_HASH || '');
const PORT     = Number(process.env.PORT) || 4000;

if (!API_ID || !API_HASH || API_HASH === 'undefined') {
  console.error('[auth-service] ERROR: TELEGRAM_API_ID และ TELEGRAM_API_HASH จำเป็นต้องกำหนดใน .env');
  process.exit(1);
}

const app = express();

// CORS — อนุญาต frontend ที่กำหนด หรือ localhost สำหรับ dev
const allowedOrigin = process.env.ALLOWED_ORIGIN || 'http://localhost:3000';
app.use(cors({
  origin: (origin, callback) => {
    // อนุญาต request ที่ไม่มี Origin (เช่น Postman, same-origin) และ origin ที่กำหนด
    if (!origin || origin === allowedOrigin || /^http:\/\/localhost(:\d+)?$/.test(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: Origin ${origin} not allowed`));
    }
  },
  credentials: true,
}));

app.use(express.json({ limit: '2mb' }));

// ── In-memory session store ────────────────────────────────────────────────
/** @type {Map<string, {client: any, status: string, phoneCodeHash?: string, phoneNumber?: string, currentUrl?: string, user?: any, sessionStr?: string, photo?: string|null, error?: string|null, createdAt: number, _forceCheck?: boolean, rawApiId: number, rawApiHash: string}>} */
const store = new Map();

setInterval(() => {
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [id, s] of store) {
    if (s.createdAt < cutoff) {
      s.client?.disconnect().catch(() => {});
      store.delete(id);
    }
  }
}, 5 * 60 * 1000);

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatUser(u) {
  if (!u) return null;
  return {
    id:        u.id != null ? String(u.id) : '',
    firstName: u.firstName  ?? '',
    lastName:  u.lastName   ?? '',
    username:  u.username   ?? '',
    phone:     u.phone      ?? '',
  };
}

async function getUserPhoto(client, user) {
  try {
    const bytes = await client.downloadProfilePhoto(user, { isBig: false });
    if (bytes && bytes.length > 0) {
      return 'data:image/jpeg;base64,' + Buffer.from(bytes).toString('base64');
    }
  } catch (_) {}
  return null;
}

// ── Phone OTP ─────────────────────────────────────────────────────────────

app.post('/api/tg-auth/send-code', async (req, res) => {
  const { phoneNumber } = req.body ?? {};
  if (!phoneNumber) {
    return res.json({ ok: false, error: 'กรุณาระบุ phoneNumber' });
  }
  try {
    const client = new TelegramClient(
      new StringSession(''),
      API_ID,
      API_HASH,
      { connectionRetries: 3 }
    );
    await client.connect();

    const { phoneCodeHash } = await client.sendCode(
      { apiId: API_ID, apiHash: API_HASH },
      phoneNumber
    );

    const id = makeId('phone');
    store.set(id, { client, phoneCodeHash, phoneNumber, createdAt: Date.now(), rawApiId: API_ID, rawApiHash: API_HASH });
    res.json({ ok: true, sessionId: id });
  } catch (e) {
    console.error('[send-code]', e.message);
    res.json({ ok: false, error: e.message });
  }
});

app.post('/api/tg-auth/verify-code', async (req, res) => {
  const { sessionId, code } = req.body ?? {};
  const s = store.get(sessionId);
  if (!s) return res.json({ ok: false, error: 'Session ไม่พบหรือหมดอายุ — ขอ OTP ใหม่' });

  try {
    const result = await s.client.invoke(new Api.auth.SignIn({
      phoneNumber:   s.phoneNumber,
      phoneCodeHash: s.phoneCodeHash,
      phoneCode:     String(code),
    }));

    if (result instanceof Api.auth.AuthorizationSignUpRequired) {
      await s.client.disconnect().catch(() => {});
      store.delete(sessionId);
      return res.json({ ok: false, error: 'หมายเลขนี้ยังไม่ได้ลงทะเบียน Telegram' });
    }

    const sessionStr = s.client.session.save();
    const photo = await getUserPhoto(s.client, result.user).catch(() => null);
    s.client.disconnect().catch(() => {});
    store.delete(sessionId);
    res.json({ ok: true, session: sessionStr, user: formatUser(result.user), photo });
  } catch (e) {
    if (e.errorMessage === 'SESSION_PASSWORD_NEEDED') {
      return res.json({ ok: true, needs2fa: true, sessionId });
    }
    console.error('[verify-code]', e.message);
    res.json({ ok: false, error: e.message });
  }
});

app.post('/api/tg-auth/verify-2fa', async (req, res) => {
  const { sessionId, password } = req.body ?? {};
  const s = store.get(sessionId);
  if (!s) return res.json({ ok: false, error: 'Session ไม่พบหรือหมดอายุ' });
  if (!computeCheck) {
    return res.json({ ok: false, error: 'computeCheck ไม่พร้อม — ลอง: npm install telegram@latest' });
  }
  try {
    const pwdInfo  = await s.client.invoke(new Api.account.GetPassword());
    const pwdCheck = await computeCheck(pwdInfo, password);
    const result   = await s.client.invoke(new Api.auth.CheckPassword({ password: pwdCheck }));

    const sessionStr = s.client.session.save();
    const photo = await getUserPhoto(s.client, result.user).catch(() => null);
    s.client.disconnect().catch(() => {});
    store.delete(sessionId);
    res.json({ ok: true, session: sessionStr, user: formatUser(result.user), photo });
  } catch (e) {
    console.error('[verify-2fa]', e.message);
    res.json({ ok: false, error: e.message });
  }
});

// ── QR Login ──────────────────────────────────────────────────────────────

const TG_DCS = {
  1: { ip: '149.154.175.53',  port: 443 },
  2: { ip: '149.154.167.51',  port: 443 },
  3: { ip: '149.154.175.100', port: 443 },
  4: { ip: '149.154.167.91',  port: 443 },
  5: { ip: '91.108.56.128',   port: 443 },
};

app.post('/api/tg-auth/qr-start', async (req, res) => {
  const sessionId = makeId('qr');
  const d = {
    client:      null,
    status:      'pending',
    currentUrl:  null,
    user:        null,
    sessionStr:  null,
    photo:       null,
    error:       null,
    rawApiId:    API_ID,
    rawApiHash:  API_HASH,
    createdAt:   Date.now(),
    _forceCheck: false,
  };
  store.set(sessionId, d);

  try {
    const client = new TelegramClient(
      new StringSession(''),
      API_ID,
      API_HASH,
      { connectionRetries: 5, retryDelay: 1000 }
    );
    await client.connect();
    d.client = client;

    try {
      const { Raw } = require('telegram/events');
      client.addEventHandler(() => {
        const entry = store.get(sessionId);
        if (entry) entry._forceCheck = true;
      }, new Raw({ types: [Api.UpdateLoginToken] }));
    } catch (_) { /* fallback: pure polling */ }

    const firstUrl = await qrExportToken(d);
    if (!firstUrl && d.status !== 'done') {
      d.client.disconnect().catch(() => {});
      store.delete(sessionId);
      return res.json({ ok: false, error: 'ไม่สามารถสร้าง QR token ได้ — ตรวจสอบ API ID / API Hash' });
    }

    res.json({ ok: true, sessionId, url: d.currentUrl ?? firstUrl });

    if (d.status !== 'done') {
      qrPollLoop(sessionId).catch(e => console.error('[qrPollLoop]', e.message));
    }
  } catch (e) {
    const entry = store.get(sessionId);
    if (entry) { entry.client?.disconnect().catch(() => {}); store.delete(sessionId); }
    console.error('[qr-start]', e.message);
    if (!res.headersSent) res.json({ ok: false, error: e.message });
  }
});

async function qrExportToken(d) {
  try {
    const result = await d.client.invoke(
      new Api.auth.ExportLoginToken({ apiId: d.rawApiId, apiHash: d.rawApiHash, exceptIds: [] })
    );
    return await handleTokenResult(d, result);
  } catch (e) {
    console.error('[qrExportToken]', e.message);
    return null;
  }
}

async function handleTokenResult(d, result) {
  if (result instanceof Api.auth.LoginToken) {
    const b64 = Buffer.from(result.token).toString('base64url');
    d.currentUrl = `tg://login?token=${b64}`;
    return d.currentUrl;
  }
  if (result instanceof Api.auth.LoginTokenSuccess) {
    await finalizeQRAuth(d, result.authorization?.user ?? null);
    return null;
  }
  if (result instanceof Api.auth.LoginTokenMigrateTo) {
    return await handleDCMigration(d, result.dcId, result.token);
  }
  return null;
}

async function handleDCMigration(d, dcId, token) {
  try {
    if (typeof d.client._switchDC === 'function') {
      await d.client._switchDC(dcId);
    } else {
      const dc = TG_DCS[dcId];
      if (!dc) throw new Error(`Unknown DC: ${dcId}`);
      d.client.session.setDC(dcId, dc.ip, dc.port);
      await d.client.disconnect().catch(() => {});
      await d.client.connect();
    }
    const imported = await d.client.invoke(new Api.auth.ImportLoginToken({ token }));
    return await handleTokenResult(d, imported);
  } catch (e) {
    console.error('[handleDCMigration]', e.message);
    return null;
  }
}

async function qrPollLoop(sessionId) {
  const maxMs = 90_000;
  const start  = Date.now();

  while (Date.now() - start < maxMs) {
    await new Promise(resolve => {
      let settled = false;
      function done() { if (!settled) { settled = true; resolve(); } }
      const timer = setTimeout(done, 1500);
      const poller = setInterval(() => {
        const e = store.get(sessionId);
        if (!e || e._forceCheck) {
          if (e) e._forceCheck = false;
          clearInterval(poller);
          clearTimeout(timer);
          done();
        }
      }, 100);
      void timer; void poller;
    });

    const d = store.get(sessionId);
    if (!d || d.status !== 'pending') return;

    try {
      if (d.client.connected === false) await d.client.connect();
      const result = await d.client.invoke(
        new Api.auth.ExportLoginToken({ apiId: d.rawApiId, apiHash: d.rawApiHash, exceptIds: [] })
      );
      await handleTokenResult(d, result);
      if (d.status === 'done' || d.status === 'error') return;
    } catch (e) {
      const entry = store.get(sessionId);
      if (!entry || entry.status !== 'pending') return;
      if (e.errorMessage !== 'AUTH_TOKEN_EXPIRED') console.error('[qrPollLoop]', e.message);
    }
  }

  const d = store.get(sessionId);
  if (d && d.status === 'pending') {
    d.status = 'error';
    d.error  = 'QR Login หมดเวลา 90 วินาที — กด "สร้าง QR" อีกครั้ง';
    d.client?.disconnect().catch(() => {});
  }
}

async function finalizeQRAuth(d, user) {
  d.sessionStr = d.client.session.save();
  if (!user) { try { user = await d.client.getMe(); } catch (_) {} }
  d.photo  = await getUserPhoto(d.client, user).catch(() => null);
  d.user   = formatUser(user);
  d.status = 'done';
  await d.client.disconnect().catch(() => {});
}

app.get('/api/tg-auth/qr-status/:sessionId', (req, res) => {
  const d = store.get(req.params.sessionId);
  if (!d) return res.json({ ok: false, error: 'Session ไม่พบ' });
  res.json({
    ok:      true,
    status:  d.status,
    url:     d.currentUrl,
    user:    d.user,
    session: d.sessionStr,
    photo:   d.photo ?? null,
    error:   d.error,
  });
});

// ── Logout (revoke Telegram session) ─────────────────────────────────────
app.post('/api/tg-auth/logout', async (req, res) => {
  const { session } = req.body ?? {};
  if (!session) return res.json({ ok: true }); // nothing to revoke
  try {
    const client = new TelegramClient(
      new StringSession(String(session)),
      API_ID,
      API_HASH,
      { connectionRetries: 3 }
    );
    await client.connect();
    await client.invoke(new Api.auth.LogOut());
    await client.disconnect();
    res.json({ ok: true });
  } catch (e) {
    console.error('[logout]', e.message);
    res.json({ ok: false, error: e.message });
  }
});

// ── Health ────────────────────────────────────────────────────────────────
app.get('/api/tg-auth/health', (_req, res) => res.json({ ok: true }));

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║  ATslip Telegram Auth Service                ║
║  http://localhost:${PORT}                       ║
╚══════════════════════════════════════════════╝
  TELEGRAM_API_ID  : ${API_ID}
  ALLOWED_ORIGIN   : ${allowedOrigin}
`);
});
