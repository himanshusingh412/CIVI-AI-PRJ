/**
 * Cross-cutting security primitives: cookies, CSRF, timing equalisation,
 * bot detection and safe error shaping.
 */
import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';

const isProd = process.env.NODE_ENV === 'production';

export const SESSION_COOKIE = 'civicai_session';
export const CSRF_COOKIE = 'civicai_csrf';
export const CSRF_HEADER = 'x-csrf-token';

// ───────────────────────── cookies ─────────────────────────
/**
 * Minimal cookie parser — avoids pulling in cookie-parser for two cookies.
 * Values are URI-encoded on write, so decode on read.
 */
export function readCookies(req: Request): Record<string, string> {
  const raw = req.headers.cookie;
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (!(k in out)) {
      try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
    }
  }
  return out;
}

function serializeCookie(
  name: string,
  value: string,
  opts: { maxAgeSec: number; httpOnly: boolean },
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${opts.maxAgeSec}`,
    // Lax blocks the cookie on cross-site POSTs (the CSRF vector) while
    // still surviving normal top-level navigation back into the app.
    'SameSite=Lax',
  ];
  if (opts.httpOnly) parts.push('HttpOnly');
  // Secure would make cookies unusable over plain-http localhost dev.
  if (isProd) parts.push('Secure');
  return parts.join('; ');
}

function appendCookie(res: Response, cookie: string) {
  const prev = res.getHeader('Set-Cookie');
  if (!prev) res.setHeader('Set-Cookie', cookie);
  else if (Array.isArray(prev)) res.setHeader('Set-Cookie', [...prev, cookie]);
  else res.setHeader('Set-Cookie', [String(prev), cookie]);
}

/**
 * Issues the session cookie (httpOnly — unreachable from JS, so an XSS
 * cannot exfiltrate it) plus the CSRF cookie (deliberately readable so
 * the SPA can echo it back in a header — the double-submit pattern).
 */
export function setSessionCookies(res: Response, token: string, maxAgeSec: number): string {
  const csrf = crypto.randomBytes(24).toString('hex');
  appendCookie(res, serializeCookie(SESSION_COOKIE, token, { maxAgeSec, httpOnly: true }));
  appendCookie(res, serializeCookie(CSRF_COOKIE, csrf, { maxAgeSec, httpOnly: false }));
  return csrf;
}

export function clearSessionCookies(res: Response) {
  appendCookie(res, serializeCookie(SESSION_COOKIE, '', { maxAgeSec: 0, httpOnly: true }));
  appendCookie(res, serializeCookie(CSRF_COOKIE, '', { maxAgeSec: 0, httpOnly: false }));
}

/** Session token from the cookie, falling back to a Bearer header for API clients. */
export function tokenFromRequest(req: Request): string | undefined {
  const cookie = readCookies(req)[SESSION_COOKIE];
  if (cookie) return cookie;
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : undefined;
}

// ───────────────────────── CSRF ─────────────────────────
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Length-safe constant-time string compare. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Double-submit CSRF check. Only enforced for cookie-authenticated
 * mutations: a request carrying an explicit Bearer token can't be forged
 * by a browser (an attacker's page cannot set that header cross-origin).
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();

  const usesCookieAuth = !!readCookies(req)[SESSION_COOKIE];
  if (!usesCookieAuth) return next();

  const cookieToken = readCookies(req)[CSRF_COOKIE];
  const headerToken = String(req.headers[CSRF_HEADER] || '');

  if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
    return res.status(403).json({
      error: 'csrf',
      message: 'Your session could not be verified. Please refresh the page and try again.',
    });
  }
  next();
}

// ───────────────────────── timing equalisation ─────────────────────────
/**
 * Pads a handler to a fixed floor so response latency cannot be used to
 * infer whether an account/OTP exists. Adds a small random jitter so the
 * floor itself is not a precise signal.
 */
export async function constantTime<T>(floorMs: number, fn: () => Promise<T> | T): Promise<T> {
  const started = Date.now();
  try {
    return await fn();
  } finally {
    const jitter = crypto.randomInt(0, 60);
    const elapsed = Date.now() - started;
    const wait = Math.max(0, floorMs + jitter - elapsed);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
  }
}

// ───────────────────────── bot detection ─────────────────────────
const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET_KEY || '';

export const botStatus = () => ({
  captcha: TURNSTILE_SECRET ? 'turnstile' : 'honeypot-only',
});

/**
 * Layered bot defence:
 *  1. Honeypot field — hidden from humans, filled by naive bots.
 *  2. Form dwell time — humans take >1.5s to read and type.
 *  3. Cloudflare Turnstile when a secret is configured.
 * Always returns a generic reason; never explains which check tripped.
 */
export async function checkNotBot(body: any, ip: string): Promise<{ ok: boolean }> {
  if (typeof body?.company === 'string' && body.company.trim() !== '') return { ok: false };

  const elapsed = Number(body?.formElapsedMs);
  if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < 1200) return { ok: false };

  if (TURNSTILE_SECRET) {
    const token = String(body?.captchaToken || '');
    if (!token) return { ok: false };
    try {
      const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: TURNSTILE_SECRET, response: token, remoteip: ip }),
        signal: AbortSignal.timeout(5000),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!data?.success) return { ok: false };
    } catch {
      // Fail open on provider outage — availability beats a hard lockout here,
      // and the honeypot + rate limits still apply.
      console.warn('[security] Turnstile verification unreachable; falling back to honeypot');
    }
  }
  return { ok: true };
}

// ───────────────────────── safe errors ─────────────────────────
/** Logs the real error server-side, returns an opaque id to the client. */
export function safeError(res: Response, err: unknown, status = 500) {
  const ref = crypto.randomBytes(6).toString('hex');
  console.error(`[error ${ref}]`, err instanceof Error ? err.stack : err);
  return res.status(status).json({
    error: 'internal',
    message: 'Something went wrong on our end. Please try again.',
    ref,
  });
}

/** Baseline hardening headers (helmet-equivalent for the handful that matter here). */
export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('Permissions-Policy', 'geolocation=(self), microphone=(self), camera=(self)');
  res.removeHeader('X-Powered-By');
  next();
}
