/**
 * Email delivery for OTPs, via Resend's HTTP API (no SMTP dependency).
 * Falls back to console logging when no key is configured.
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const EMAIL_FROM = process.env.EMAIL_FROM || 'CivicAI <onboarding@resend.dev>';
const EMAIL_ENABLED = process.env.EMAIL_ENABLED === 'true';

export type EmailResult =
  | { ok: true; provider: 'resend' | 'console'; messageId?: string }
  | { ok: false; provider: 'resend' | 'console'; error: string };

export const emailStatus = () => {
  const enabled = process.env.EMAIL_ENABLED === 'true';
  const apiKey = process.env.RESEND_API_KEY || '';
  const from = process.env.EMAIL_FROM || 'CivicAI <onboarding@resend.dev>';
  return {
    enabled,
    provider: enabled && apiKey ? 'resend' : 'console',
    from,
  };
};

export function isValidEmail(raw: string): { ok: boolean; reason?: string } {
  const e = String(raw || '').trim().toLowerCase();
  if (e.length > 254) return { ok: false, reason: 'Email address is too long.' };
  // Deliberately pragmatic, not RFC-exhaustive.
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(e)) {
    return { ok: false, reason: 'Enter a valid email address.' };
  }
  return { ok: true };
}

export function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  const head = user.slice(0, Math.min(2, user.length));
  return `${head}${'•'.repeat(Math.max(3, user.length - 2))}@${domain}`;
}

function otpHtml(otp: string) {
  return `<!doctype html><html><body style="margin:0;background:#F8FAFC;font-family:'Segoe UI',system-ui,-apple-system,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:440px;background:#fff;border:1px solid #E2E8F0;border-radius:16px;padding:32px">
        <tr><td>
          <h1 style="margin:0 0 8px;font-size:20px;color:#0F172A">Your CivicAI verification code</h1>
          <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6">
            Enter this code to sign in. It expires in 5 minutes.
          </p>
          <div style="background:#F1F5F9;border-radius:12px;padding:20px;text-align:center;margin-bottom:24px">
            <span style="font-size:32px;font-weight:700;letter-spacing:10px;color:#0F172A;font-family:monospace">${otp}</span>
          </div>
          <p style="margin:0;font-size:13px;color:#475569;line-height:1.6">
            If you didn't request this, you can safely ignore this email. Never share this code with anyone —
            CivicAI staff will never ask for it.
          </p>
        </td></tr>
      </table>
      <p style="margin:16px 0 0;font-size:12px;color:#94A3B8">CivicAI · Citizen Grievance Portal</p>
    </td></tr>
  </table></body></html>`;
}

async function sendViaResend(to: string, otp: string): Promise<EmailResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [to],
        subject: `${otp} is your CivicAI verification code`,
        html: otpHtml(otp),
        text: `Your CivicAI verification code is ${otp}. It expires in 5 minutes. Never share this code.`,
      }),
      signal: controller.signal,
    });

    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = body?.message || `Resend responded ${res.status}`;
      console.error('[email] send failed:', msg);
      return { ok: false, provider: 'resend', error: String(msg) };
    }
    return { ok: true, provider: 'resend', messageId: body?.id };
  } catch (err: any) {
    const msg = err?.name === 'AbortError' ? 'Resend request timed out' : err?.message || 'network error';
    console.error('[email] send failed:', msg);
    return { ok: false, provider: 'resend', error: msg };
  } finally {
    clearTimeout(timer);
  }
}

export async function sendOtpEmail(to: string, otp: string): Promise<EmailResult> {
  if (EMAIL_ENABLED && RESEND_API_KEY) {
    const result = await sendViaResend(to, otp);
    if (result.ok) console.log(`[email] OTP delivered to ${maskEmail(to)} via Resend`);
    return result;
  }
  console.log(`[email] (console mode) OTP for ${maskEmail(to)} = ${otp}`);
  return { ok: true, provider: 'console' };
}
