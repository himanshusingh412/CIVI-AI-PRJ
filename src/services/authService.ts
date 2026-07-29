const TOKEN_KEY = 'civicai_token';

export type Channel = 'email' | 'phone';

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(token: string) {
  try { localStorage.setItem(TOKEN_KEY, token); } catch { /* storage blocked */ }
}
export function clearToken() {
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* storage blocked */ }
}

export function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export type AuthError = {
  ok: false;
  error: string;
  message: string;
  attemptsRemaining?: number;
  retryAfterSec?: number;
};

export type RequestOtpOk = {
  ok: true;
  channel: Channel;
  maskedIdentifier: string;
  expiresInSec: number;
  sendsRemaining: number;
  delivery: 'sms' | 'email' | 'console';
  devOtp?: string;
};

export type VerifyOtpOk = {
  ok: true;
  token: string;
  identifier: string;
  channel: Channel;
  expiresInSec: number;
};

async function post<T>(path: string, body: unknown): Promise<T | AuthError> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        error: data.error || 'request_failed',
        message: data.message || `Request failed (${res.status}).`,
        attemptsRemaining: data.attemptsRemaining,
        retryAfterSec: data.retryAfterSec ?? Number(res.headers.get('Retry-After')) ?? undefined,
      };
    }
    return data as T;
  } catch {
    return { ok: false, error: 'network', message: 'Cannot reach the server. Is the backend running?' };
  }
}

export const requestOtp = (identifier: string) =>
  post<RequestOtpOk>('/api/auth/request-otp', { identifier });

export const verifyOtp = (identifier: string, otp: string) =>
  post<VerifyOtpOk>('/api/auth/verify-otp', { identifier, otp });

export const googleSignIn = (credential: string) =>
  post<VerifyOtpOk>('/api/auth/google', { credential });

export async function logout() {
  await fetch('/api/auth/logout', { method: 'POST', headers: authHeaders() }).catch(() => {});
  clearToken();
}

export async function validateSession(): Promise<boolean> {
  if (!getToken()) return false;
  try {
    const res = await fetch('/api/auth/session', { headers: authHeaders() });
    if (!res.ok) { clearToken(); return false; }
    return true;
  } catch {
    return false;
  }
}

// ───────────────────────── validation ─────────────────────────

export function validateEmail(raw: string): { ok: boolean; reason?: string } {
  const e = raw.trim().toLowerCase();
  if (!e) return { ok: false, reason: 'Enter your email address.' };
  if (e.length > 254) return { ok: false, reason: 'Email address is too long.' };
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(e)) return { ok: false, reason: 'Enter a valid email address.' };
  return { ok: true };
}

/** Indian mobile: 10 digits starting 6-9. */
export function validateMobileFormat(raw: string): { ok: boolean; reason?: string } {
  const d = raw.replace(/\D/g, '');
  const local = d.startsWith('91') && d.length === 12 ? d.slice(2)
    : d.startsWith('0') && d.length === 11 ? d.slice(1) : d;
  if (!local) return { ok: false, reason: 'Enter your mobile number.' };
  if (local.length !== 10) return { ok: false, reason: 'Mobile number must be 10 digits.' };
  if (!/^[6-9]/.test(local)) return { ok: false, reason: 'Indian mobile numbers start with 6, 7, 8 or 9.' };
  return { ok: true };
}

/** 9876543210 → "98765 43210" */
export function formatMobile(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 10);
  return d.length > 5 ? `${d.slice(0, 5)} ${d.slice(5)}` : d;
}

export function validateIdentifier(value: string, channel: Channel) {
  return channel === 'email' ? validateEmail(value) : validateMobileFormat(value);
}
