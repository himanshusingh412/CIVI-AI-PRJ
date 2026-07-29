import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { sendOtpSms, normalizeMobile, maskMobile } from './sms.js';
import { sendOtpEmail, isValidEmail, maskEmail } from './email.js';

// ───────────────────────── config ─────────────────────────
export const AUTH_LIMITS = {
  OTP_TTL_MS: 5 * 60_000,          // OTP valid 5 minutes
  MAX_VERIFY_ATTEMPTS: 9,          // wrong-OTP tries before the code is burned
  MAX_OTP_REQUESTS: 5,             // OTP sends per identifier per window
  OTP_REQUEST_WINDOW_MS: 15 * 60_000,
  RESEND_COOLDOWN_MS: 30_000,      // must wait between sends
  LOCKOUT_MS: 15 * 60_000,         // lockout after exhausting attempts
  SESSION_TTL_MS: 60 * 60_000,     // session valid 1 hour
} as const;

export type Channel = 'email' | 'phone';

// ───────────────────────── stores ─────────────────────────
type OtpRecord = {
  hash: string;
  expiresAt: number;
  attempts: number;
  sends: number;
  windowStartedAt: number;
  lastSentAt: number;
  lockedUntil: number;
  channel: Channel;
  display: string;      // masked identifier for UI
};
type Session = { identifier: string; channel: Channel; expiresAt: number; createdAt: number };

const otpStore = new Map<string, OtpRecord>();   // key: canonical identifier
const sessions = new Map<string, Session>();     // key: token

const sweep = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of otpStore) {
    if (v.expiresAt < now && v.lockedUntil < now && now - v.windowStartedAt > AUTH_LIMITS.OTP_REQUEST_WINDOW_MS) {
      otpStore.delete(k);
    }
  }
  for (const [k, s] of sessions) if (s.expiresAt < now) sessions.delete(k);
}, 60_000);
sweep.unref?.();

// ───────────────────────── identifier handling ─────────────────────────
const hash = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

export type ParsedIdentifier =
  | { ok: true; channel: Channel; canonical: string; display: string; e164?: string; local?: string }
  | { ok: false; reason: string };

/** Accepts an email address or an Indian mobile number and normalizes it. */
export function parseIdentifier(raw: string): ParsedIdentifier {
  const value = String(raw || '').trim();
  if (!value) return { ok: false, reason: 'Enter your email address or mobile number.' };

  // Anything containing "@" is treated as an email attempt
  if (value.includes('@')) {
    const check = isValidEmail(value);
    if (!check.ok) return { ok: false, reason: check.reason! };
    const canonical = value.toLowerCase();
    return { ok: true, channel: 'email', canonical, display: maskEmail(canonical) };
  }

  const mobile = normalizeMobile(value);
  if (!mobile.ok) {
    // If it has letters it was probably a malformed email
    if (/[a-zA-Z]/.test(value)) return { ok: false, reason: 'Enter a valid email address or 10-digit mobile number.' };
    return { ok: false, reason: mobile.reason! };
  }
  return {
    ok: true,
    channel: 'phone',
    canonical: `+${mobile.e164}`,
    display: maskMobile(mobile.local!),
    e164: mobile.e164,
    local: mobile.local,
  };
}

// ───────────────────────── OTP flow ─────────────────────────
export type RequestOtpResult =
  | {
      ok: true;
      channel: Channel;
      maskedIdentifier: string;
      expiresInSec: number;
      devOtp?: string;
      sendsRemaining: number;
      delivery: 'sms' | 'email' | 'console';
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

  if (rec?.lockedUntil && rec.lockedUntil > now) {
    const secs = Math.ceil((rec.lockedUntil - now) / 1000);
    return {
      ok: false, status: 429, error: 'locked_out',
      message: `Too many attempts. This account is locked for ${Math.ceil(secs / 60)} more minute(s).`,
      retryAfterSec: secs,
    };
  }

  if (!rec || now - rec.windowStartedAt > AUTH_LIMITS.OTP_REQUEST_WINDOW_MS) {
    rec = {
      hash: '', expiresAt: 0, attempts: 0, sends: 0,
      windowStartedAt: now, lastSentAt: 0, lockedUntil: 0,
      channel: parsed.channel, display: parsed.display,
    };
  }
  rec.channel = parsed.channel;
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

  // Deliver first — a gateway failure must not consume a send.
  const delivery = parsed.channel === 'email'
    ? await sendOtpEmail(parsed.canonical, otp)
    : await sendOtpSms(parsed.e164!, parsed.local!, otp);

  if (!delivery.ok) {
    return {
      ok: false,
      status: 502,
      error: 'delivery_failed',
      message: parsed.channel === 'email'
        ? 'Could not send the email right now. Please check the address and try again.'
        : 'Could not send the SMS right now. Please check the number and try again.',
    };
  }

  rec.hash = hash(`${key}:${otp}`);
  rec.expiresAt = now + AUTH_LIMITS.OTP_TTL_MS;
  rec.attempts = 0;
  rec.sends += 1;
  rec.lastSentAt = now;
  otpStore.set(key, rec);

  const devMode = process.env.AUTH_DEV_OTP === 'true';
  const deliveryLabel: 'sms' | 'email' | 'console' =
    delivery.provider === 'console' ? 'console' : parsed.channel === 'email' ? 'email' : 'sms';

  return {
    ok: true,
    channel: parsed.channel,
    maskedIdentifier: parsed.display,
    expiresInSec: Math.floor(AUTH_LIMITS.OTP_TTL_MS / 1000),
    sendsRemaining: AUTH_LIMITS.MAX_OTP_REQUESTS - rec.sends,
    delivery: deliveryLabel,
    ...(devMode ? { devOtp: otp } : {}),
  };
}

export type VerifyOtpResult =
  | { ok: true; token: string; identifier: string; channel: Channel; expiresInSec: number }
  | { ok: false; status: number; error: string; message: string; attemptsRemaining?: number; retryAfterSec?: number };

export function verifyOtp(rawIdentifier: string, otp: string): VerifyOtpResult {
  const parsed = parseIdentifier(rawIdentifier);
  if (parsed.ok === false) {
    return { ok: false, status: 400, error: 'invalid_identifier', message: parsed.reason };
  }

  const key = parsed.canonical;
  const now = Date.now();
  const rec = otpStore.get(key);

  if (rec?.lockedUntil && rec.lockedUntil > now) {
    const secs = Math.ceil((rec.lockedUntil - now) / 1000);
    return {
      ok: false, status: 429, error: 'locked_out',
      message: `Locked out. Try again in ${Math.ceil(secs / 60)} minute(s).`,
      retryAfterSec: secs,
    };
  }
  if (!rec || !rec.hash) {
    return { ok: false, status: 400, error: 'no_otp', message: 'No code was requested for this account.' };
  }
  if (rec.expiresAt < now) {
    return { ok: false, status: 400, error: 'expired', message: 'Code expired. Please request a new one.' };
  }
  if (!/^\d{6}$/.test(otp)) {
    return {
      ok: false, status: 400, error: 'malformed', message: 'Code must be 6 digits.',
      attemptsRemaining: AUTH_LIMITS.MAX_VERIFY_ATTEMPTS - rec.attempts,
    };
  }

  const candidate = hash(`${key}:${otp}`);
  const match =
    candidate.length === rec.hash.length &&
    crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(rec.hash));

  if (!match) {
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
      ok: false, status: 401, error: 'invalid_otp',
      message: `Incorrect code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
      attemptsRemaining: remaining,
    };
  }

  // success — burn the OTP, issue a session
  const display = rec.display;
  const channel = rec.channel;
  otpStore.delete(key);

  return { ok: true, ...issueSession(display, channel) };
}

/** Creates a session and returns the token — shared by OTP verification and Google sign-in. */
export function issueSession(identifier: string, channel: Channel) {
  const now = Date.now();
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, {
    identifier,
    channel,
    expiresAt: now + AUTH_LIMITS.SESSION_TTL_MS,
    createdAt: now,
  });
  return { token, identifier, channel, expiresInSec: Math.floor(AUTH_LIMITS.SESSION_TTL_MS / 1000) };
}

export function revokeSession(token: string) {
  return sessions.delete(token);
}

export function getSession(token: string | undefined) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (s.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return s;
}

/** Express middleware — requires a live session on protected routes. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  const session = getSession(token);
  if (!session) {
    return res.status(401).json({ error: 'unauthorized', message: 'Session expired or invalid. Please log in again.' });
  }
  (req as Request & { session?: unknown }).session = session;
  next();
}
