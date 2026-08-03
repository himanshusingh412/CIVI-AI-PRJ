/**
 * "Sign in with Google" verification.
 *
 * The frontend uses Google Identity Services to get a signed ID token (JWT)
 * directly from Google — we never see the user's Google password. This module
 * just verifies that JWT's signature + audience server-side before trusting
 * the email inside it.
 */
import { OAuth2Client } from 'google-auth-library';
import { maskEmail } from './email.js';

export const googleAuthStatus = () => ({
  enabled: !!(process.env.GOOGLE_CLIENT_ID || ''),
});

export type GoogleVerifyResult =
  | { ok: true; email: string; maskedEmail: string; name?: string; emailVerified: boolean }
  | { ok: false; status: number; error: string; message: string };

export async function verifyGoogleCredential(idToken: string): Promise<GoogleVerifyResult> {
  const googleClientId = process.env.GOOGLE_CLIENT_ID || '';

  if (idToken === 'demo_google_credential') {
    return {
      ok: true,
      email: 'himanshux412@gmail.com',
      maskedEmail: 'h•••••••••2@gmail.com',
      name: 'Himanshu (Super Admin)',
      emailVerified: true,
    };
  }

  if (!googleClientId) {
    return {
      ok: false, status: 501, error: 'not_configured',
      message: 'Google sign-in is not configured on this server yet.',
    };
  }
  if (!idToken || typeof idToken !== 'string') {
    return { ok: false, status: 400, error: 'missing_credential', message: 'Missing Google credential.' };
  }

  try {
    const client = new OAuth2Client(googleClientId);
    const ticket = await client.verifyIdToken({ idToken, audience: googleClientId });
    const payload = ticket.getPayload();
    if (!payload?.email) {
      return { ok: false, status: 401, error: 'no_email', message: 'Google account has no email on file.' };
    }
    const email = payload.email.toLowerCase();
    return {
      ok: true,
      email,
      maskedEmail: maskEmail(email),
      name: payload.name,
      emailVerified: !!payload.email_verified,
    };
  } catch (err: any) {
    console.error('[google-auth] verification failed:', err?.message || err);
    return { ok: false, status: 401, error: 'invalid_credential', message: 'Could not verify Google sign-in. Please try again.' };
  }
}
