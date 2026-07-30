/**
 * Auth transport.
 *
 * Sessions live in an httpOnly cookie set by the server — the token is
 * deliberately unreachable from JavaScript, so an XSS cannot steal it.
 * We only keep the CSRF token in memory and echo it back in a header
 * (double-submit pattern).
 */

export type Channel = 'email' | 'google';

export type AuthUser = {
  identifier: string;   // already masked by the server
  channel: Channel;
};

export type AuthError = {
  ok: false;
  error: string;
  message: string;
  attemptsRemaining?: number;
  retryAfterSec?: number;
};

export type SessionOk = {
  ok: true;
  identifier: string;
  channel: Channel;
  expiresInSec: number;
  csrfToken: string;
};

export type RequestOtpOk = {
  ok: true;
  channel: 'email';
  maskedIdentifier: string;
  expiresInSec: number;
  message: string;
  devOtp?: string;
};

const CSRF_COOKIE = 'civicai_csrf';
const CSRF_HEADER = 'x-csrf-token';

/** Reads the (non-httpOnly) CSRF cookie the server issued. */
function csrfFromCookie(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : '';
}

function isAuthError(v: unknown): v is AuthError {
  return !!v && typeof v === 'object' && (v as any).ok === false;
}

const NETWORK_ERROR: AuthError = {
  ok: false,
  error: 'network',
  message: 'Cannot reach the server. Check your connection and try again.',
};

/**
 * All mutating calls go through here so the CSRF header and credentials
 * are never accidentally omitted.
 */
export async function apiPost<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T | AuthError> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        [CSRF_HEADER]: csrfFromCookie(),
      },
      body: JSON.stringify(body ?? {}),
      signal,
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const retryHeader = Number(res.headers.get('Retry-After'));
      return {
        ok: false,
        error: data.error || 'request_failed',
        // Never surface a raw status code or server text to the user.
        message: data.message || 'Something went wrong. Please try again.',
        attemptsRemaining: data.attemptsRemaining,
        retryAfterSec: data.retryAfterSec ?? (Number.isFinite(retryHeader) ? retryHeader : undefined),
      };
    }
    return data as T;
  } catch (err) {
    if ((err as any)?.name === 'AbortError') throw err;
    return NETWORK_ERROR;
  }
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T | AuthError> {
  try {
    const res = await fetch(path, { credentials: 'same-origin', signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        error: data.error || 'request_failed',
        message: data.message || 'Something went wrong. Please try again.',
      };
    }
    return data as T;
  } catch (err) {
    if ((err as any)?.name === 'AbortError') throw err;
    return NETWORK_ERROR;
  }
}

// ───────────────────────── endpoints ─────────────────────────

export const requestOtp = (identifier: string, meta: { formElapsedMs: number; company: string }) =>
  apiPost<RequestOtpOk>('/api/auth/request-otp', { identifier, ...meta });

export const verifyOtp = (identifier: string, otp: string) =>
  apiPost<SessionOk>('/api/auth/verify-otp', { identifier, otp });

export const googleSignIn = (credential: string) =>
  apiPost<SessionOk>('/api/auth/google', { credential });

export const refreshSession = (signal?: AbortSignal) =>
  apiPost<SessionOk>('/api/auth/refresh', {}, signal);

export const logout = () => apiPost<{ ok: true }>('/api/auth/logout');

export type SessionInfo = {
  ok: true;
  session: { identifier: string; channel: Channel; expiresAt: number };
};

export const fetchSession = (signal?: AbortSignal) => apiGet<SessionInfo>('/api/auth/session', signal);

export { isAuthError };

// ───────────────────────── validation ─────────────────────────

export function validateEmail(raw: string): { ok: boolean; reason?: string } {
  const e = raw.trim().toLowerCase();
  if (!e) return { ok: false, reason: 'Enter your email address.' };
  if (e.length > 254) return { ok: false, reason: 'Email address is too long.' };
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(e)) return { ok: false, reason: 'Enter a valid email address.' };
  return { ok: true };
}
