/**
 * SMS delivery for OTPs.
 *
 * Primary provider: MSG91 (India). We generate and track the OTP ourselves so
 * our own attempt/lockout rules stay authoritative — MSG91 is used purely as
 * the delivery pipe via its Flow/OTP endpoint.
 *
 * If no credentials are configured the sender falls back to console logging so
 * local development still works.
 */

const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY || '';
const MSG91_TEMPLATE_ID = process.env.MSG91_TEMPLATE_ID || '';
const MSG91_SENDER_ID = process.env.MSG91_SENDER_ID || 'CIVCAI';
const SMS_ENABLED = process.env.SMS_ENABLED === 'true';
const DEFAULT_COUNTRY = process.env.SMS_COUNTRY_CODE || '91';

export type SmsResult =
  | { ok: true; provider: 'msg91' | 'console'; messageId?: string }
  | { ok: false; provider: 'msg91' | 'console'; error: string };

export const smsStatus = () => ({
  enabled: SMS_ENABLED,
  provider: SMS_ENABLED && MSG91_AUTH_KEY ? 'msg91' : 'console',
  templateConfigured: !!MSG91_TEMPLATE_ID,
  senderId: MSG91_SENDER_ID,
});

/** Indian mobile numbers: 10 digits starting 6-9. Accepts +91/91/0 prefixes. */
export function normalizeMobile(raw: string): { ok: boolean; e164?: string; local?: string; reason?: string } {
  const digits = String(raw || '').replace(/\D/g, '');
  let local = digits;

  if (local.startsWith('91') && local.length === 12) local = local.slice(2);
  else if (local.startsWith('0') && local.length === 11) local = local.slice(1);

  if (local.length !== 10) return { ok: false, reason: 'Mobile number must be 10 digits.' };
  if (!/^[6-9]/.test(local)) return { ok: false, reason: 'Indian mobile numbers start with 6, 7, 8 or 9.' };

  return { ok: true, local, e164: `${DEFAULT_COUNTRY}${local}` };
}

export function maskMobile(local: string) {
  return `+${DEFAULT_COUNTRY} ${'X'.repeat(6)}${local.slice(-4)}`;
}

async function sendViaMsg91(e164: string, otp: string): Promise<SmsResult> {
  const url = new URL('https://control.msg91.com/api/v5/otp');
  url.searchParams.set('mobile', e164);
  url.searchParams.set('otp', otp);
  url.searchParams.set('otp_length', String(otp.length));
  url.searchParams.set('otp_expiry', '5');
  if (MSG91_TEMPLATE_ID) url.searchParams.set('template_id', MSG91_TEMPLATE_ID);
  if (MSG91_SENDER_ID) url.searchParams.set('sender', MSG91_SENDER_ID);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: { authkey: MSG91_AUTH_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      signal: controller.signal,
    });

    const body: any = await res.json().catch(() => ({}));

    // MSG91 returns { type: "success", request_id } or { type: "error", message }
    if (!res.ok || body?.type === 'error') {
      const msg = body?.message || `MSG91 responded ${res.status}`;
      console.error('[sms] MSG91 send failed:', msg);
      return { ok: false, provider: 'msg91', error: String(msg) };
    }

    return { ok: true, provider: 'msg91', messageId: body?.request_id };
  } catch (err: any) {
    const msg = err?.name === 'AbortError' ? 'MSG91 request timed out' : err?.message || 'network error';
    console.error('[sms] MSG91 send failed:', msg);
    return { ok: false, provider: 'msg91', error: msg };
  } finally {
    clearTimeout(timer);
  }
}

export async function sendOtpSms(e164: string, local: string, otp: string): Promise<SmsResult> {
  if (SMS_ENABLED && MSG91_AUTH_KEY) {
    const result = await sendViaMsg91(e164, otp);
    if (result.ok) console.log(`[sms] OTP delivered to ${maskMobile(local)} via MSG91`);
    return result;
  }

  // Dev mode — no gateway configured
  console.log(`[sms] (console mode) OTP for ${maskMobile(local)} = ${otp}`);
  return { ok: true, provider: 'console' };
}
