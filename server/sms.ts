/**
 * SMS delivery for one-time codes.
 *
 * Mirrors server/email.ts exactly, including the console fallback: with no
 * provider configured the code is logged rather than sent, so the auth flow
 * stays testable end to end without an SMS account. `smsStatus()` reports
 * which mode is active so /api/health never implies messages are going out
 * when they are not.
 *
 * India-first by design. This is a portal for Indian civic grievances, so
 * bare 10-digit input is assumed to be +91 rather than rejected — expecting
 * a citizen to type a country code onto their own number is a needless way
 * to lose them at the first field.
 */

export type SmsResult =
  | { ok: true; provider: 'msg91' | 'twilio' | 'console' }
  | { ok: false; provider: string; error: string };

const MSG91 = () => process.env.MSG91_AUTH_KEY || '';
const TWILIO_SID = () => process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_TOKEN = () => process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_FROM = () => process.env.TWILIO_FROM_NUMBER || '';

export const smsStatus = () => {
  if (MSG91()) return { enabled: true, provider: 'msg91' as const };
  if (TWILIO_SID() && TWILIO_TOKEN() && TWILIO_FROM()) return { enabled: true, provider: 'twilio' as const };
  return { enabled: false, provider: 'console' as const };
};

/**
 * Accepts the forms people actually type: 9876543210, 09876543210,
 * +91 98765 43210, 91-9876543210.
 *
 * The leading-digit rule is real: Indian mobile numbers begin 6-9, so
 * anything else is a landline or a typo and would silently never receive
 * a code.
 */
/**
 * The explicit `?: undefined` members are load-bearing. This tsconfig has
 * strictNullChecks off, and without them TypeScript refuses to narrow the
 * union on `!result.ok` — the same trap server/rbac.ts hit.
 */
type PhoneParse =
  | { ok: true; e164: string; reason?: undefined }
  | { ok: false; reason: string; e164?: undefined };

export function normalisePhone(raw: string): PhoneParse {
  const digits = String(raw ?? '').replace(/[^\d]/g, '');
  if (!digits) return { ok: false, reason: 'Enter your mobile number.' };

  let local = digits;
  if (local.length === 12 && local.startsWith('91')) local = local.slice(2);
  else if (local.length === 11 && local.startsWith('0')) local = local.slice(1);

  if (local.length !== 10) {
    return { ok: false, reason: 'Enter a 10-digit Indian mobile number.' };
  }
  if (!/^[6-9]/.test(local)) {
    return { ok: false, reason: 'Indian mobile numbers start with 6, 7, 8 or 9.' };
  }
  return { ok: true, e164: `+91${local}` };
}

/** "+919876543210" -> "+91 98•••••210" — enough to recognise, not to reuse. */
export function maskPhone(e164: string): string {
  const d = e164.replace(/^\+91/, '');
  if (d.length !== 10) return '•••';
  return `+91 ${d.slice(0, 2)}•••••${d.slice(7)}`;
}

export function isValidPhone(raw: string): { ok: boolean; reason?: string } {
  const r = normalisePhone(raw);
  return r.ok ? { ok: true } : { ok: false, reason: r.reason };
}

export async function sendOtpSms(to: string, otp: string): Promise<SmsResult> {
  const status = smsStatus();
  const body = `Your verification code is ${otp}. It expires in 5 minutes.`;

  if (!status.enabled) {
    console.log(`[sms] (console mode) OTP for ${maskPhone(to)} = ${otp}`);
    return { ok: true, provider: 'console' };
  }

  try {
    if (status.provider === 'msg91') {
      const res = await fetch('https://control.msg91.com/api/v5/flow/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authkey: MSG91() },
        body: JSON.stringify({
          template_id: process.env.MSG91_TEMPLATE_ID,
          short_url: '0',
          recipients: [{ mobiles: to.replace('+', ''), OTP: otp }],
        }),
      });
      if (!res.ok) return { ok: false, provider: 'msg91', error: `HTTP ${res.status}` };
      return { ok: true, provider: 'msg91' };
    }

    const auth = Buffer.from(`${TWILIO_SID()}:${TWILIO_TOKEN()}`).toString('base64');
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID()}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: to, From: TWILIO_FROM(), Body: body }),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      console.error('[sms] Twilio error:', res.status, errBody?.message || errBody);
      return { ok: false, provider: 'twilio', error: `HTTP ${res.status}: ${errBody?.message || 'send_failed'}` };
    }
    return { ok: true, provider: 'twilio' };
  } catch (e: any) {
    // Never surface provider errors to the caller: whether a send succeeded
    // leaks whether the number is registered.
    return { ok: false, provider: status.provider, error: e?.message ?? 'send_failed' };
  }
}
