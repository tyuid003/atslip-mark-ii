import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { Api } from 'telegram';
import { computeCheck } from 'telegram/Password';

const DC_IPS: Record<number, [string, number]> = {
  1: ['149.154.175.53', 443],
  2: ['149.154.167.51', 443],
  3: ['149.154.175.100', 443],
  4: ['149.154.167.91', 443],
  5: ['91.108.56.128', 443],
};

function formatUser(u: any) {
  if (!u) return null;
  return {
    id: u.id != null ? String(u.id) : '',
    firstName: u.firstName ?? '',
    lastName: u.lastName ?? '',
    username: u.username ?? '',
    phone: u.phone ?? '',
  };
}

export class TelegramAuthDO {
  private state: DurableObjectState;
  private env: any;

  // In-memory session state (survives while alarm keeps DO alive)
  private client: TelegramClient | null = null;
  private phone = '';
  private phoneCodeHash = '';
  private qrStatus = 'idle';
  private qrUrl = '';
  private qrTokenExpiry = 0;   // Unix timestamp — when current QR token expires
  private qrScanned = false;   // True once Telegram signals user scanned (DC migration / success)
  private sessionStr = '';
  private user: any = null;
  private photo: string | null = null;
  private qrError: string | null = null;
  private debugLog: string[] = [];   // Recent diagnostic entries (last 20)
  private pollInFlight = false;       // Mutex: one ExportLoginToken at a time

  private dlog(msg: string): void {
    const ts = new Date().toISOString().substring(11, 23);
    this.debugLog.push(`${ts} ${msg}`);
    if (this.debugLog.length > 20) this.debugLog.shift();
    console.log('[TgAuthDO]', msg);
  }

  constructor(state: DurableObjectState, env: any) {
    this.state = state;
    this.env = env;
    // Keep DO alive for 5 min while auth is in-progress
    state.storage.setAlarm(Date.now() + 5 * 60 * 1000).catch(() => {});
  }

  async alarm(): Promise<void> {
    // If auth is still pending, extend lifetime by 2 more minutes
    if (this.qrStatus === 'pending' || (this.phone && !this.sessionStr)) {
      await this.state.storage.setAlarm(Date.now() + 2 * 60 * 1000).catch(() => {});
    }
  }

  private makeClient(sessionStr = ''): TelegramClient {
    const apiId = parseInt(this.env.TELEGRAM_API_ID || '0', 10);
    const apiHash = String(this.env.TELEGRAM_API_HASH || '');
    return new TelegramClient(new StringSession(sessionStr), apiId, apiHash, {
      connectionRetries: 3,
      retryDelay: 1000,
    });
  }

  private json(data: any, status = 200): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async fetch(request: Request): Promise<Response> {
    const segments = new URL(request.url).pathname.split('/').filter(Boolean);
    const action = segments[segments.length - 1];
    try {
      switch (action) {
        case 'send-code':   return await this.handleSendCode(request);
        case 'verify-code': return await this.handleVerifyCode(request);
        case 'verify-2fa':  return await this.handle2FA(request);
        case 'qr-start':    return await this.handleQRStart();
        case 'qr-status':   return await this.handleQRStatus();
        case 'logout':      return await this.handleLogout(request);
        default:            return this.json({ ok: false, error: 'Not found' }, 404);
      }
    } catch (e: any) {
      console.error('[TelegramAuthDO]', action, e?.message);
      return this.json({ ok: false, error: e?.message ?? 'Internal error' }, 500);
    }
  }

  // ── Phone OTP ────────────────────────────────────────────────────────

  private async handleSendCode(request: Request): Promise<Response> {
    const { phoneNumber } = await request.json() as any;
    if (!phoneNumber) return this.json({ ok: false, error: 'phoneNumber required' }, 400);

    if (this.client) { await this.client.disconnect().catch(() => {}); this.client = null; }

    this.client = this.makeClient();
    await this.client.connect();

    const apiId = parseInt(this.env.TELEGRAM_API_ID || '0', 10);
    const apiHash = String(this.env.TELEGRAM_API_HASH || '');
    const { phoneCodeHash } = await this.client.sendCode({ apiId, apiHash }, phoneNumber);

    this.phone = phoneNumber;
    this.phoneCodeHash = phoneCodeHash;
    // Persist so verify-code can recover if DO is briefly evicted
    await this.state.storage.put('phone', phoneNumber);
    await this.state.storage.put('phoneCodeHash', phoneCodeHash);

    return this.json({ ok: true });
  }

  private async handleVerifyCode(request: Request): Promise<Response> {
    const { code } = await request.json() as any;
    if (!code) return this.json({ ok: false, error: 'code required' }, 400);

    // Restore from storage if DO was evicted between steps
    if (!this.phoneCodeHash) {
      this.phone = (await this.state.storage.get<string>('phone')) ?? '';
      this.phoneCodeHash = (await this.state.storage.get<string>('phoneCodeHash')) ?? '';
    }
    if (!this.phoneCodeHash) {
      return this.json({ ok: false, error: 'Session expired — please request new OTP' }, 400);
    }
    if (!this.client) {
      this.client = this.makeClient();
      await this.client.connect();
    }

    try {
      const result = await this.client.invoke(new Api.auth.SignIn({
        phoneNumber: this.phone,
        phoneCodeHash: this.phoneCodeHash,
        phoneCode: String(code),
      }));

      if (result instanceof Api.auth.AuthorizationSignUpRequired) {
        await this.client.disconnect().catch(() => {}); this.client = null;
        return this.json({ ok: false, error: 'หมายเลขนี้ยังไม่ได้ลงทะเบียน Telegram' });
      }

      const sessionStr = (this.client.session as StringSession).save();
      const photo = await this.getPhoto((result as any).user);
      await this.client.disconnect().catch(() => {}); this.client = null;

      return this.json({ ok: true, session: sessionStr, user: formatUser((result as any).user), photo });
    } catch (e: any) {
      if (e?.errorMessage === 'SESSION_PASSWORD_NEEDED') {
        return this.json({ ok: true, needs2fa: true });
      }
      throw e;
    }
  }

  private async handle2FA(request: Request): Promise<Response> {
    const { password } = await request.json() as any;
    if (!password) return this.json({ ok: false, error: 'password required' }, 400);
    if (!this.client) {
      this.client = this.makeClient();
      await this.client.connect();
    }

    const pwdInfo = await this.client.invoke(new Api.account.GetPassword()) as Api.account.Password;
    const pwdCheck = await computeCheck(pwdInfo, password);
    const result = await this.client.invoke(new Api.auth.CheckPassword({ password: pwdCheck }));

    const sessionStr = (this.client.session as StringSession).save();
    const photo = await this.getPhoto((result as any).user);
    await this.client.disconnect().catch(() => {}); this.client = null;

    return this.json({ ok: true, session: sessionStr, user: formatUser((result as any).user), photo });
  }

  // ── QR Login ─────────────────────────────────────────────────────────

  private async handleQRStart(): Promise<Response> {
    if (this.client) { await this.client.disconnect().catch(() => {}); this.client = null; }
    this.qrStatus = 'pending';
    this.qrUrl = '';
    this.qrError = null;
    this.qrScanned = false;

    this.client = this.makeClient();
    await this.client.connect();

    const apiId = parseInt(this.env.TELEGRAM_API_ID || '0', 10);
    const apiHash = String(this.env.TELEGRAM_API_HASH || '');
    const result = await this.client.invoke(
      new Api.auth.ExportLoginToken({ apiId, apiHash, exceptIds: [] })
    );
    await this.processTokenResult(result);

    if (!this.qrUrl && this.qrStatus !== 'done') {
      await this.client.disconnect().catch(() => {}); this.client = null;
      return this.json({ ok: false, error: 'Failed to generate QR token' });
    }

    return this.json({ ok: true, url: this.qrUrl });
  }

  private async handleQRStatus(): Promise<Response> {
    if (this.qrStatus === 'done') {
      return this.json({ ok: true, status: 'done', session: this.sessionStr, user: this.user, photo: this.photo, url: null, error: null });
    }
    if (this.qrStatus === 'error') {
      return this.json({ ok: true, status: 'error', session: null, user: null, photo: null, url: null, error: this.qrError });
    }
    if (!this.client) {
      return this.json({ ok: false, error: 'QR session expired — please restart' });
    }

    // Mutex: if another poll is already running (DC migration is slow),
    // return current state immediately to avoid concurrent invokes.
    if (this.pollInFlight) {
      this.dlog('poll skipped — already in flight');
      return this.json({
        ok: true,
        status: this.qrStatus,
        scanned: this.qrScanned,
        url: this.qrUrl || null,
        session: this.sessionStr || null,
        user: this.user,
        photo: this.photo,
        error: this.qrError,
        debug: this.debugLog,
      });
    }

    const apiId = parseInt(this.env.TELEGRAM_API_ID || '0', 10);
    const apiHash = String(this.env.TELEGRAM_API_HASH || '');

    // Poll ExportLoginToken — Telegram returns:
    //   - LoginToken              → still waiting (returns same token if not expired)
    //   - LoginTokenSuccess       → user scanned & confirmed → finalize
    //   - LoginTokenMigrateTo     → user scanned, must migrate DC then re-export
    this.pollInFlight = true;
    try {
      const result = await this.client.invoke(
        new Api.auth.ExportLoginToken({ apiId, apiHash, exceptIds: [] })
      );
      await this.processTokenResult(result);
    } catch (e: any) {
      const msg = e?.errorMessage ?? e?.message ?? 'Unknown error';
      this.dlog('poll error: ' + msg);
      // Token-expiry style errors → just continue (token will be regenerated)
      if (msg !== 'AUTH_TOKEN_INVALID' && msg !== 'AUTH_TOKEN_EXPIRED') {
        this.qrStatus = 'error';
        this.qrError = msg;
      }
    } finally {
      this.pollInFlight = false;
    }

    return this.json({
      ok: true,
      status: this.qrStatus,
      scanned: this.qrScanned,
      url: this.qrUrl || null,
      session: this.sessionStr || null,
      user: this.user,
      photo: this.photo,
      error: this.qrError,
      debug: this.debugLog,
    });
  }

  private async processTokenResult(result: any): Promise<void> {
    const cls = result?.className ?? result?.constructor?.name ?? 'unknown';
    this.dlog('processTokenResult: ' + cls);
    if (result instanceof Api.auth.LoginToken) {
      const b64 = Buffer.from(result.token).toString('base64url');
      this.qrUrl = `tg://login?token=${b64}`;
      this.qrTokenExpiry = result.expires; // Unix timestamp
    } else if (result instanceof Api.auth.LoginTokenSuccess) {
      this.qrScanned = true;
      this.dlog('LoginTokenSuccess — finalizing');
      await this.finalizeQRAuth((result.authorization as any)?.user ?? null);
    } else if (result instanceof Api.auth.LoginTokenMigrateTo) {
      this.qrScanned = true;
      this.dlog('LoginTokenMigrateTo dc=' + result.dcId);
      await this.handleDCMigration(result.dcId, result.token);
    } else {
      this.dlog('UNKNOWN result type: ' + cls);
    }
  }

  private async handleDCMigration(dcId: number, token: any): Promise<void> {
    this.dlog('handleDCMigration: dcId=' + dcId);
    const dc = DC_IPS[dcId];
    if (!dc) {
      this.dlog('handleDCMigration: unknown DC ' + dcId);
      this.qrStatus = 'error';
      this.qrError = 'Unknown DC: ' + dcId;
      return;
    }

    // Disconnect old client (on home DC)
    if (this.client) {
      await this.client.disconnect().catch(() => {});
      this.client = null;
    }

    // Build a NEW client with a fresh StringSession pre-configured to the target DC.
    // setDC alone on the existing session doesn't transfer auth_key — must start clean.
    const apiId = parseInt(this.env.TELEGRAM_API_ID || '0', 10);
    const apiHash = String(this.env.TELEGRAM_API_HASH || '');
    const newSession = new StringSession('');
    newSession.setDC(dcId, dc[0], dc[1]);
    this.client = new TelegramClient(newSession, apiId, apiHash, {
      connectionRetries: 3,
      retryDelay: 1000,
    });

    try {
      await this.client.connect();
      this.dlog('handleDCMigration: connected to DC ' + dcId);
      const imported = await this.client.invoke(new Api.auth.ImportLoginToken({ token }));
      this.dlog('handleDCMigration: ImportLoginToken returned ' + (imported?.className ?? 'unknown'));
      await this.processTokenResult(imported);
    } catch (e: any) {
      const msg = e?.errorMessage ?? e?.message ?? 'DC migration failed';
      this.dlog('handleDCMigration error: ' + msg);
      this.qrStatus = 'error';
      this.qrError = 'DC migration failed: ' + msg;
    }
  }

  private async finalizeQRAuth(user: any): Promise<void> {
    if (!this.client) return;
    try {
      this.sessionStr = (this.client.session as StringSession).save();
      this.dlog('saved session, len=' + this.sessionStr.length);
      if (!user) {
        this.dlog('no user in result, calling getMe()');
        try { user = await this.client.getMe(); } catch (e: any) { this.dlog('getMe err: ' + e?.message); }
      }
      if (!user) throw new Error('Could not retrieve Telegram user after QR scan');
      this.dlog('got user id=' + user.id);
      this.photo = await this.getPhoto(user);
      this.user = formatUser(user);
      this.qrStatus = 'done';
      this.dlog('qrStatus=done');
    } catch (e: any) {
      this.qrStatus = 'error';
      this.qrError = e?.message ?? 'Failed to finalize QR auth';
      this.dlog('finalize error: ' + this.qrError);
    } finally {
      await this.client.disconnect().catch(() => {}); this.client = null;
    }
  }

  // ── Logout ────────────────────────────────────────────────────────────

  private async handleLogout(request: Request): Promise<Response> {
    const { session } = await request.json() as any;
    if (!session) return this.json({ ok: true });
    try {
      const c = this.makeClient(String(session));
      await c.connect();
      await c.invoke(new Api.auth.LogOut());
      await c.disconnect().catch(() => {});
    } catch (_) { /* best-effort */ }
    return this.json({ ok: true });
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private async getPhoto(user: any): Promise<string | null> {
    if (!this.client || !user) return null;
    try {
      const bytes = await this.client.downloadProfilePhoto(user, { isBig: false } as any);
      if (bytes && (bytes as any).length > 0) {
        return 'data:image/jpeg;base64,' + Buffer.from(bytes as any).toString('base64');
      }
    } catch (_) {}
    return null;
  }
}
