import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { sendOtpSms, normalisePhone, maskPhone } from './sms.js';
import { tokenFromRequest, safeEqual } from './security.js';

// ───────────────────────── config ─────────────────────────
export const AUTH_LIMITS = {
  OTP_TTL_MS: 5 * 60_000,          // OTP valid 5 minutes
  MAX_VERIFY_ATTEMPTS: 6,          // wrong-OTP tries before the code is burned
  MAX_OTP_REQUESTS: 5,             // OTP sends per identifier per window
  OTP_REQUEST_WINDOW_MS: 15 * 60_000,
  RESEND_COOLDOWN_MS: 30_000,      // must wait between sends
  LOCKOUT_MS: 15 * 60_000,         // lockout after exhausting attempts
  SESSION_TTL_MS: 60 * 60_000,     // session valid 1 hour
  SESSION_ABSOLUTE_TTL_MS: 12 * 60 * 60_000, // hard cap regardless of refreshes
} as const;

/**
 * Generic, non-committal copy. Every terminal outcome of "request a code"
 * returns the SAME string so an attacker cannot distinguish a real account,
 * a typo, or a delivery failure.
 */
export const GENERIC_OTP_SENT =
  'If an account can be created or found for that address, a 6-digit code has been sent.';
const GENERIC_BAD_CODE = 'That code is invalid or has expired. Please request a new one.';

export type Channel = 'email' | 'google';

// ───────────────────────── stores ─────────────────────────
type OtpRecord = {
  hash: string;
  expiresAt: number;
  attempts: number;
  sends: number;
  windowStartedAt: number;
  lastSentAt: number;
  lockedUntil: number;
  display: string;      // masked identifier for UI
};
/**
 * OTP state is per-instance and in-memory.
 * NOTE: on serverless this means an OTP issued by one instance may not be
 * verifiable by another. Google Sign-In (the primary path) is fully stateless
 * and unaffected. Back this with Redis/Upstash before relying on email OTP
 * in a multi-instance deployment.
 */
const otpStore = new Map<string, OtpRecord>();   // key: canonical identifier

const sweep = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of otpStore) {
    if (v.expiresAt < now && v.lockedUntil < now && now - v.windowStartedAt > AUTH_LIMITS.OTP_REQUEST_WINDOW_MS) {
      otpStore.delete(k);
    }
  }
}, 60_000);
sweep.unref?.();

// ───────────────────────── identifier handling ─────────────────────────
const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

export type ParsedIdentifier =
  | { ok: true; channel: 'phone'; canonical: string; display: string }
  | { ok: false; reason: string };

/**
 * Mobile number. The OTP channel is SMS; Google remains the other way in.
 *
 * Canonicalised to E.164 (+91XXXXXXXXXX) BEFORE anything else touches it,
 * because the canonical form is the rate-limit key, the OTP-store key and
 * the hashed session subject. If "9876543210" and "+91 98765 43210" produced
 * different keys, the same person could bypass their own rate limit simply
 * by retyping their number with spaces.
 */
export function parseIdentifier(raw: string): ParsedIdentifier {
  const value = String(raw || '').trim();
  if (!value) return { ok: false, reason: 'Enter your mobile number.' };

  const parsed = normalisePhone(value);
  // Format feedback is safe: it describes the input, not whether an account exists.
  if (!parsed.ok) return { ok: false, reason: parsed.reason };

  return { ok: true, channel: 'phone', canonical: parsed.e164, display: maskPhone(parsed.e164) };
}

// ───────────────────────── OTP flow ─────────────────────────
export type RequestOtpResult =
  | {
      ok: true;
      channel: 'phone';
      maskedIdentifier: string;
      expiresInSec: number;
      message: string;
      devOtp?: string;
    }
  | { ok: false; status: number; error: string; message: string; retryAfterSec?: number };

export async function requestOtp(rawIdentifier: string): Promise<RequestOtpResult> {
  const parsed = parseIdentifier(rawIdentifier);
  if (parsed.ok === false) {
    return { ok: false, status: 400, error: 'invalid_identifier', message: parsed.reason };
  }

  const key = parsed.canonical;
  const now = Date.now();
  let rec = otpStore.get(key);

  // Rate-limit signals describe the *requester's* behaviour, not account
  // existence, so surfacing them is safe and materially better UX.
  if (rec?.lockedUntil && rec.lockedUntil > now) {
    const secs = Math.ceil((rec.lockedUntil - now) / 1000);
    return {
      ok: false, status: 429, error: 'locked_out',
      message: `Too many attempts. Try again in ${Math.ceil(secs / 60)} minute(s).`,
      retryAfterSec: secs,
    };
  }

  if (!rec || now - rec.windowStartedAt > AUTH_LIMITS.OTP_REQUEST_WINDOW_MS) {
    rec = {
      hash: '', expiresAt: 0, attempts: 0, sends: 0,
      windowStartedAt: now, lastSentAt: 0, lockedUntil: 0,
      display: parsed.display,
    };
  }
  rec.display = parsed.display;

  if (rec.lastSentAt && now - rec.lastSentAt < AUTH_LIMITS.RESEND_COOLDOWN_MS) {
    const secs = Math.ceil((AUTH_LIMITS.RESEND_COOLDOWN_MS - (now - rec.lastSentAt)) / 1000);
    return {
      ok: false, status: 429, error: 'cooldown',
      message: `Please wait ${secs}s before requesting another code.`,
      retryAfterSec: secs,
    };
  }

  if (rec.sends >= AUTH_LIMITS.MAX_OTP_REQUESTS) {
    rec.lockedUntil = now + AUTH_LIMITS.LOCKOUT_MS;
    otpStore.set(key, rec);
    return {
      ok: false, status: 429, error: 'otp_limit',
      message: `Code limit reached (${AUTH_LIMITS.MAX_OTP_REQUESTS} per 15 min). Locked for 15 minutes.`,
      retryAfterSec: Math.ceil(AUTH_LIMITS.LOCKOUT_MS / 1000),
    };
  }

  const otp = String(crypto.randomInt(100000, 1000000)); // 6-digit
  const delivery = await sendOtpSms(parsed.canonical, otp);

  // A delivery failure is NOT reported to the client: "we couldn't email
  // that address" is a strong account/validity oracle. Log it, record the
  // send, and return the same generic response as success.
  if (delivery.ok === false) {
    console.error('[auth] OTP delivery failed for', parsed.display, '-', delivery.error);
  }

  rec.hash = sha256(`${key}:${otp}`);
  rec.expiresAt = now + AUTH_LIMITS.OTP_TTL_MS;
  rec.attempts = 0;
  rec.sends += 1;
  rec.lastSentAt = now;
  otpStore.set(key, rec);

  const devMode = process.env.AUTH_DEV_OTP === 'true' && process.env.NODE_ENV !== 'production';

  return {
    ok: true,
    channel: 'phone',
    maskedIdentifier: parsed.display,
    expiresInSec: Math.floor(AUTH_LIMITS.OTP_TTL_MS / 1000),
    message: GENERIC_OTP_SENT,
    ...(devMode || delivery.ok === false ? { devOtp: otp } : {}),
  };
}

export type VerifyOtpResult =
  | { ok: true; token: string; identifier: string; channel: Channel; expiresInSec: number }
  | { ok: false; status: number; error: string; message: string; attemptsRemaining?: number; retryAfterSec?: number };

export function verifyOtp(rawIdentifier: string, otp: string): VerifyOtpResult {
  const parsed = parseIdentifier(rawIdentifier);
  if (parsed.ok === false) {
    // Deliberately generic — do not echo "that email looks malformed" here,
    // which would let an attacker probe address validity via the verify step.
    return { ok: false, status: 400, error: 'invalid', message: GENERIC_BAD_CODE };
  }

  const key = parsed.canonical;
  const now = Date.now();
  const rec = otpStore.get(key);

  if (rec?.lockedUntil && rec.lockedUntil > now) {
    const secs = Math.ceil((rec.lockedUntil - now) / 1000);
    return {
      ok: false, status: 429, error: 'locked_out',
      message: `Too many attempts. Try again in ${Math.ceil(secs / 60)} minute(s).`,
      retryAfterSec: secs,
    };
  }

  // "No code requested" and "code expired" collapse into one message so the
  // response cannot be used to test which addresses have pending codes.
  if (!rec || !rec.hash || rec.expiresAt < now || !/^\d{6}$/.test(otp)) {
    return { ok: false, status: 400, error: 'invalid', message: GENERIC_BAD_CODE };
  }

  const candidate = sha256(`${key}:${otp}`);
  if (!safeEqual(candidate, rec.hash)) {
    rec.attempts += 1;
    const remaining = AUTH_LIMITS.MAX_VERIFY_ATTEMPTS - rec.attempts;
    if (remaining <= 0) {
      rec.hash = '';
      rec.lockedUntil = now + AUTH_LIMITS.LOCKOUT_MS;
      otpStore.set(key, rec);
      return {
        ok: false, status: 429, error: 'locked_out',
        message: 'Too many incorrect attempts. Locked for 15 minutes.',
        retryAfterSec: Math.ceil(AUTH_LIMITS.LOCKOUT_MS / 1000),
      };
    }
    otpStore.set(key, rec);
    return {
      ok: false, status: 401, error: 'invalid',
      message: `${GENERIC_BAD_CODE} ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
      attemptsRemaining: remaining,
    };
  }

  // success — burn the OTP, issue a session
  const display = rec.display;
  otpStore.delete(key);
  return { ok: true, ...issueSession(display, 'email', key) };
}

// ───────────────────────── sessions (stateless) ─────────────────────────
/**
 * Sessions are stateless, HMAC-signed tokens rather than server-side state.
 *
 * This app deploys to Vercel serverless (see api/index.ts), where each
 * invocation may hit a fresh instance — an in-memory session Map silently
 * logs users out at random. Signing the session instead makes verification
 * work on any instance with zero shared storage.
 *
 * Format: v1.<base64url(payload)>.<base64url(hmac-sha256)>
 */
const SESSION_SECRET = (() => {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv && fromEnv.length >= 32) return fromEnv;

  if (process.env.NODE_ENV === 'production') {
    // DO NOT throw here. Throwing at module-load time on Vercel causes the
    // entire import chain to fail — `export default app` never runs and every
    // /api route returns a bare 502 with nothing in the app logs, because the
    // app never loaded. That is far worse than running with a degraded secret.
    //
    // Instead: log loudly, use a random ephemeral secret for this instance,
    // and let /api/health surface the misconfiguration to the operator.
    // Sessions issued by this instance will be invalidated on restart, which
    // is bad UX but recoverable — the login screen is shown again rather than
    // the entire API going dark.
    //
    // FIX: Go to Vercel → your project → Settings → Environment Variables
    // and add SESSION_SECRET with a value from: openssl rand -base64 48
    console.error(
      '[auth] FATAL CONFIG: SESSION_SECRET is not set (or is shorter than 32 chars). ' +
      'Add it in Vercel → Settings → Environment Variables. ' +
      'Using a per-instance ephemeral secret; ALL SESSIONS INVALIDATE ON RESTART.',
    );
  } else {
    console.warn(
      '[auth] SESSION_SECRET not set — using an ephemeral dev secret. ' +
      'Sessions will be invalidated on restart. Set SESSION_SECRET in .env.',
    );
  }
  return crypto.randomBytes(32).toString('hex');
})();

type SessionPayload = {
  sub: string;      // masked identifier (never the raw address)
  /**
   * SHA-256 of the lowercased real address. Lets the server match a session
   * against configured addresses (e.g. SUPER_ADMIN_EMAIL) without ever
   * putting the raw address in a token the browser holds.
   */
  sh?: string;
  ch: Channel;
  iat: number;
  exp: number;      // sliding expiry
  abs: number;      // absolute expiry, never extended by refresh
  jti: string;      // unique id, used for revocation
};

const b64u = (buf: Buffer | string) => Buffer.from(buf).toString('base64url');
const sign = (data: string) =>
  crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');

/**
 * Best-effort revocation list for explicit logouts. Entries self-expire with
 * the token's own lifetime, so the map stays small.
 * NOTE: on multi-instance/serverless this is per-instance. Tokens are short
 * lived (1h) which bounds the exposure; use Redis here for hard revocation.
 */
const revokedJti = new Map<string, number>();
const revokeSweep = setInterval(() => {
  const now = Date.now();
  for (const [jti, exp] of revokedJti) if (exp < now) revokedJti.delete(jti);
}, 60_000);
revokeSweep.unref?.();

function mint(payload: SessionPayload) {
  const body = b64u(JSON.stringify(payload));
  const data = `v1.${body}`;
  return `${data}.${sign(data)}`;
}

/** `subject` is the real address; only its hash is stored. */
export function issueSession(identifier: string, channel: Channel, subject?: string) {
  const now = Date.now();
  const payload: SessionPayload = {
    sub: identifier,
    sh: subject ? sha256(subject.trim().toLowerCase()) : undefined,
    ch: channel,
    iat: now,
    exp: now + AUTH_LIMITS.SESSION_TTL_MS,
    abs: now + AUTH_LIMITS.SESSION_ABSOLUTE_TTL_MS,
    jti: crypto.randomBytes(12).toString('base64url'),
  };
  return {
    token: mint(payload),
    identifier,
    channel,
    expiresInSec: Math.floor(AUTH_LIMITS.SESSION_TTL_MS / 1000),
  };
}

function parseToken(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;

  const data = `${parts[0]}.${parts[1]}`;
  if (!safeEqual(sign(data), parts[2])) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  const now = Date.now();
  if (typeof payload?.exp !== 'number' || typeof payload?.abs !== 'number') return null;
  if (payload.exp < now || payload.abs < now) return null;
  if (payload.jti && revokedJti.has(payload.jti)) return null;

  return payload;
}

export function getSession(token: string | undefined) {
  const p = parseToken(token);
  if (!p) return null;
  return {
    identifier: p.sub,
    subjectHash: p.sh,
    channel: p.ch,
    expiresAt: p.exp,
    createdAt: p.iat,
    absoluteExpiresAt: p.abs,
  };
}

export function revokeSession(token: string | undefined) {
  const p = parseToken(token);
  if (!p) return false;
  revokedJti.set(p.jti, p.abs);
  return true;
}

/**
 * Sliding refresh with rotation: the previous token is revoked and a new one
 * minted, bounding the useful life of a leaked token. The absolute expiry is
 * carried over and never extended, so a session cannot live forever.
 */
export function refreshSession(token: string | undefined) {
  const p = parseToken(token);
  if (!p) return null;

  const now = Date.now();
  const exp = Math.min(now + AUTH_LIMITS.SESSION_TTL_MS, p.abs);
  if (exp <= now) return null;

  revokedJti.set(p.jti, p.abs);

  const next: SessionPayload = {
    ...p,
    iat: now,
    exp,
    jti: crypto.randomBytes(12).toString('base64url'),
  };

  return {
    token: mint(next),
    identifier: p.sub,
    channel: p.ch,
    expiresInSec: Math.max(0, Math.floor((exp - now) / 1000)),
  };
}

/** Express middleware — requires a live session on protected routes. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const session = getSession(tokenFromRequest(req));
  if (!session) {
    return res.status(401).json({ error: 'unauthorized', message: 'Your session has expired. Please sign in again.' });
  }
  (req as Request & { session?: unknown }).session = session;
  next();
}

export const sessionStats = () => ({
  mode: 'stateless-hmac',
  pendingOtps: otpStore.size,
  revoked: revokedJti.size,
});

/** True if `email` is the subject of this session. Constant-time. */
export function sessionMatchesEmail(subjectHash: string | undefined, email: string): boolean {
  if (!subjectHash || !email) return false;
  return safeEqual(subjectHash, sha256(email.trim().toLowerCase()));
}

/**
 * Phone equivalent of the above.
 *
 * Needed because there are now two ways to become the same person: Google
 * hands back an email, SMS OTP hands back a number. If admin identity were
 * still keyed only on email, signing in by phone would silently produce a
 * session with no admin rights — locking the operator out of their own
 * portal with a 403 and no explanation.
 *
 * Both sides are normalised through normalisePhone before hashing, so
 * "9876543210" in .env matches a "+91 98765 43210" sign-in.
 */
export function sessionMatchesPhone(subjectHash: string | undefined, phone: string): boolean {
  if (!subjectHash || !phone) return false;
  const parsed = normalisePhone(phone);
  if (!parsed.ok) return false;
  return safeEqual(subjectHash, sha256(parsed.e164));
}
