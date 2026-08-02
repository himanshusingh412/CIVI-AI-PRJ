/**
 * Auth transport.
 *
 * Sessions live in an httpOnly cookie set by the server — the token is
 * deliberately unreachable from JavaScript, so an XSS cannot steal it.
 * We only keep the CSRF token in memory and echo it back in a header
 * (double-submit pattern).
 */

export type Channel = 'phone' | 'google';

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
  channel: 'phone';
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
 * "Am I a developer looking at this?" — answered by WHERE the page is served
 * from, not by how it was built.
 *
 * `import.meta.env.DEV` is false in a production bundle, so running
 * `npm run preview` on your own laptop produced the public-facing "service is
 * temporarily unavailable" message: technically true, completely useless to
 * the one person who could fix it. Anything on localhost gets the actionable
 * text; a real deployment still gets the neutral one.
 */
const isLocalhost =
  typeof location !== 'undefined' &&
  /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i.test(location.hostname);

const isDev = !!(import.meta as any).env?.DEV || isLocalhost;

/**
 * The API server being down is by far the most common local failure, and it
 * does NOT surface as a fetch rejection: Vite's dev proxy answers with an
 * HTML 500/502 instead. Detect that (non-JSON body or a gateway status) and
 * say so plainly rather than emitting a useless "Something went wrong".
 */
function backendDown(res: Response, parsedBody: unknown): boolean {
  const gateway = res.status === 502 || res.status === 503 || res.status === 504;
  const notJson = !res.headers.get('content-type')?.includes('application/json');
  const emptyBody = !parsedBody || Object.keys(parsedBody as object).length === 0;
  return gateway || (res.status >= 500 && (notJson || emptyBody));
}

const BACKEND_DOWN_MESSAGE = isDev
  ? 'Can\'t reach the API server. Start it with "npm run dev:full" (or "npm run server" in a second terminal).'
  : 'The service is temporarily unavailable. Please try again in a moment.';

function toAuthError(res: Response, data: any): AuthError {
  if (backendDown(res, data)) {
    return { ok: false, error: 'backend_unavailable', message: BACKEND_DOWN_MESSAGE };
  }
  const retryHeader = Number(res.headers.get('Retry-After'));
  return {
    ok: false,
    error: data?.error || 'request_failed',
    // Never surface a raw status code or server text to the user.
    message: data?.message || 'Something went wrong. Please try again.',
    attemptsRemaining: data?.attemptsRemaining,
    retryAfterSec: data?.retryAfterSec ?? (Number.isFinite(retryHeader) ? retryHeader : undefined),
  };
}

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
    if (!res.ok) return toAuthError(res, data);
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
    if (!res.ok) return toAuthError(res, data);
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

/**
 * Client-side mobile validation. Mirrors server/sms.ts deliberately —
 * the server is authoritative, this only saves a round trip to be told
 * something the browser already knew.
 *
 * Accepts what people actually type: 9876543210, 09876543210, +91 98765
 * 43210, 91-9876543210.
 */
export function validatePhone(raw: string): { ok: boolean; reason?: string } {
  const digits = String(raw ?? '').replace(/[^\d]/g, '');
  if (!digits) return { ok: false, reason: 'Enter your mobile number.' };

  let local = digits;
  if (local.length === 12 && local.startsWith('91')) local = local.slice(2);
  else if (local.length === 11 && local.startsWith('0')) local = local.slice(1);

  if (local.length !== 10) return { ok: false, reason: 'Enter a 10-digit Indian mobile number.' };
  if (!/^[6-9]/.test(local)) return { ok: false, reason: 'Indian mobile numbers start with 6, 7, 8 or 9.' };
  return { ok: true };
}
