import crypto from 'node:crypto';
import { modeOf } from './config.js';
import { normalisePhone, maskPhone } from './sms.js';

/**
 * WhatsApp, via the Meta Cloud API.
 *
 * =========================================================================
 * The 24-hour window is not a detail
 * =========================================================================
 * Meta does not let a business send whatever it likes whenever it likes. A
 * business may send FREEFORM text only within 24 hours of the person's last
 * inbound message; outside that window only pre-approved TEMPLATES may be
 * sent, and sending them to someone who never opted in gets the number
 * blocked.
 *
 * That rule is modelled here rather than discovered in production, because
 * an implementation that ignores it works perfectly in every demo — the
 * tester always messaged first — and then fails the moment it tries to tell
 * a real citizen their complaint was resolved three days later.
 *
 * =========================================================================
 * Live and simulated
 * =========================================================================
 * With credentials, this calls Meta. Without them it records into an outbox
 * so the workflow is fully demonstrable and an operator can see exactly what
 * WOULD have been sent. Simulated sends are marked, counted separately, and
 * never reported as delivered.
 *
 * The word "connected" is never used about this integration. See
 * server/config.ts.
 */

const GRAPH_VERSION = 'v21.0';

const TOKEN = () => process.env.WHATSAPP_ACCESS_TOKEN || '';
const PHONE_ID = () => process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const VERIFY_TOKEN = () => process.env.WHATSAPP_VERIFY_TOKEN || '';
const APP_SECRET = () => process.env.WHATSAPP_APP_SECRET || '';

/**
 * The `reason?: undefined` / `simulated?: undefined` members are
 * load-bearing: this tsconfig has strictNullChecks off, and without them
 * TypeScript refuses to narrow the union on `res.ok` — the same trap already
 * documented in server/sms.ts and server/rbac.ts.
 */
export type WhatsAppSendResult =
  | { ok: true; simulated: boolean; messageId: string; reason?: undefined; retryable?: undefined }
  | { ok: false; reason: string; retryable: boolean; simulated?: undefined; messageId?: undefined };

export type OutboxEntry = {
  id: string;
  to: string;          // masked, never the full number
  body: string;
  kind: 'freeform' | 'template';
  templateName?: string;
  at: string;
  simulated: boolean;
};

/**
 * What was sent, or would have been. Bounded ring buffer: this is an
 * operator diagnostic, not a message archive, and an unbounded one on a
 * long-running process is a memory leak with a friendly name.
 */
const OUTBOX_LIMIT = 100;
const outbox: OutboxEntry[] = [];

function record(entry: OutboxEntry) {
  outbox.unshift(entry);
  if (outbox.length > OUTBOX_LIMIT) outbox.length = OUTBOX_LIMIT;
}

export const recentOutbox = (limit = 20): OutboxEntry[] => outbox.slice(0, limit);

// ---------------------------- consent & window ----------------------------

type Contact = {
  /** E.164. The key everywhere. */
  phone: string;
  /** Last inbound message time - opens the 24-hour freeform window. */
  lastInboundAt: number;
  /** Explicit opt-out. Survives further inbound messages until reversed. */
  optedOut: boolean;
};

const contacts = new Map<string, Contact>();
const WINDOW_MS = 24 * 3600_000;

export function noteInbound(phone: string): void {
  const c = contacts.get(phone) ?? { phone, lastInboundAt: 0, optedOut: false };
  c.lastInboundAt = Date.now();
  contacts.set(phone, c);
}

export function setOptOut(phone: string, optedOut: boolean): void {
  const c = contacts.get(phone) ?? { phone, lastInboundAt: 0, optedOut: false };
  c.optedOut = optedOut;
  contacts.set(phone, c);
}

export const isOptedOut = (phone: string): boolean => !!contacts.get(phone)?.optedOut;

export const windowOpen = (phone: string): boolean => {
  const c = contacts.get(phone);
  return !!c && Date.now() - c.lastInboundAt < WINDOW_MS;
};

export const whatsappStatus = () => {
  const mode = modeOf('whatsapp');
  return {
    mode,
    configured: !!(TOKEN() && PHONE_ID() && VERIFY_TOKEN()),
    signatureVerification: !!APP_SECRET(),
    knownContacts: contacts.size,
    openWindows: [...contacts.values()].filter(c => Date.now() - c.lastInboundAt < WINDOW_MS).length,
    optedOut: [...contacts.values()].filter(c => c.optedOut).length,
    outboxSize: outbox.length,
    webhookPath: '/api/whatsapp/webhook',
  };
};

// ---------------------------- sending ----------------------------

async function callGraph(payload: Record<string, unknown>): Promise<WhatsAppSendResult> {
  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_ID()}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      // 4xx is a payload or policy problem and will fail identically on
      // retry; 5xx and network errors are worth retrying.
      const retryable = res.status >= 500;
      console.error('[whatsapp] send failed', res.status);
      return { ok: false, reason: `whatsapp_${res.status}`, retryable };
    }
    const body: any = await res.json();
    return { ok: true, simulated: false, messageId: body?.messages?.[0]?.id ?? 'unknown' };
  } catch (err: any) {
    return { ok: false, reason: err?.name === 'TimeoutError' ? 'timeout' : 'network', retryable: true };
  }
}

/**
 * Freeform text. Only valid inside the 24-hour window.
 *
 * Refuses rather than "trying anyway" when the window is shut: Meta counts
 * policy violations against the sending number, and a portal that quietly
 * burns its own WhatsApp number is worse than one that never had it.
 */
export async function sendText(
  rawPhone: string,
  body: string,
  opts: {
    /**
     * Send even though this number has opted out.
     *
     * Exactly one legitimate use: confirming the opt-out itself. Someone who
     * sends STOP and hears nothing back does not know whether it worked, and
     * the usual next move is to send STOP again, and again. The confirmation
     * is a transactional reply to a message they just sent, inside their own
     * open window — not marketing, and not a loophole for anything else.
     */
    allowOptedOut?: boolean;
  } = {},
): Promise<WhatsAppSendResult> {
  const parsed = normalisePhone(rawPhone);
  if (!parsed.ok) return { ok: false, reason: 'invalid_number', retryable: false };
  const phone = parsed.e164;

  if (isOptedOut(phone) && !opts.allowOptedOut) {
    return { ok: false, reason: 'opted_out', retryable: false };
  }
  if (!windowOpen(phone)) return { ok: false, reason: 'outside_24h_window', retryable: false };

  const text = String(body ?? '').slice(0, 4000);
  const simulated = modeOf('whatsapp') !== 'live';

  record({
    id: crypto.randomUUID(), to: maskPhone(phone), body: text,
    kind: 'freeform', at: new Date().toISOString(), simulated,
  });

  if (simulated) {
    console.log(`[whatsapp] (simulated) -> ${maskPhone(phone)}: ${text.slice(0, 80)}`);
    return { ok: true, simulated: true, messageId: `sim-${crypto.randomBytes(6).toString('hex')}` };
  }

  return callGraph({ to: phone.replace('+', ''), type: 'text', text: { body: text } });
}

/**
 * A pre-approved template. The only thing that may be sent outside the
 * window, and only to someone who has not opted out.
 */
export async function sendTemplate(
  rawPhone: string,
  templateName: string,
  params: string[],
  languageCode = 'en',
): Promise<WhatsAppSendResult> {
  const parsed = normalisePhone(rawPhone);
  if (!parsed.ok) return { ok: false, reason: 'invalid_number', retryable: false };
  const phone = parsed.e164;

  if (isOptedOut(phone)) return { ok: false, reason: 'opted_out', retryable: false };

  const simulated = modeOf('whatsapp') !== 'live';
  record({
    id: crypto.randomUUID(), to: maskPhone(phone),
    body: `[${templateName}] ${params.join(' | ')}`,
    kind: 'template', templateName, at: new Date().toISOString(), simulated,
  });

  if (simulated) {
    console.log(`[whatsapp] (simulated template ${templateName}) -> ${maskPhone(phone)}`);
    return { ok: true, simulated: true, messageId: `sim-${crypto.randomBytes(6).toString('hex')}` };
  }

  return callGraph({
    to: phone.replace('+', ''),
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      components: params.length
        ? [{ type: 'body', parameters: params.map(p => ({ type: 'text', text: p })) }]
        : [],
    },
  });
}

// ---------------------------- webhook security ----------------------------

/** GET verification handshake. Meta calls this once when the URL is saved. */
export function verifyWebhookChallenge(query: Record<string, unknown>): { ok: true; challenge: string } | { ok: false } {
  const mode = String(query['hub.mode'] ?? '');
  const token = String(query['hub.verify_token'] ?? '');
  const challenge = String(query['hub.challenge'] ?? '');
  const expected = VERIFY_TOKEN();

  if (mode !== 'subscribe' || !expected) return { ok: false };
  // Constant-time: this token is the only thing standing between an attacker
  // and pointing our webhook subscription at their own endpoint.
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false };

  return { ok: true, challenge };
}

/**
 * X-Hub-Signature-256 over the RAW request body.
 *
 * Must be computed on the exact bytes Meta sent. Re-serialising a parsed
 * object changes key order and whitespace and produces a different digest,
 * which is why the webhook route uses express.raw and not express.json.
 */
export function verifySignature(rawBody: Buffer, header: string | undefined): boolean {
  const secret = APP_SECRET();
  // No secret configured means signatures cannot be checked. Reported by
  // whatsappStatus().signatureVerification rather than silently passing.
  if (!secret) return false;
  if (!header?.startsWith('sha256=')) return false;

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const given = header.slice('sha256='.length);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(given, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Replay protection.
 *
 * Meta retries a webhook it believes failed, so the same message id can
 * legitimately arrive several times. Without deduplication, one citizen
 * message becomes three identical complaints - which is not a security
 * problem so much as a data-quality catastrophe that only shows up under
 * load, exactly when nobody is watching.
 */
const seenMessages = new Map<string, number>();
const SEEN_TTL_MS = 60 * 60_000;

const seenSweep = setInterval(() => {
  const cutoff = Date.now() - SEEN_TTL_MS;
  for (const [id, at] of seenMessages) if (at < cutoff) seenMessages.delete(id);
}, 5 * 60_000);
seenSweep.unref?.();

export function isDuplicate(messageId: string): boolean {
  if (!messageId) return false;
  if (seenMessages.has(messageId)) return true;
  seenMessages.set(messageId, Date.now());
  return false;
}

// ---------------------------- inbound parsing ----------------------------

export type InboundMessage = {
  messageId: string;
  from: string;          // E.164
  type: 'text' | 'image' | 'location' | 'audio' | 'document' | 'other';
  text: string;
  location?: { lat: number; lng: number; name?: string };
  mediaId?: string;
};

/**
 * Pull messages out of Meta's envelope.
 *
 * Written defensively on purpose: this is unauthenticated-shaped input from
 * the public internet, and every field is optional in practice even where
 * the documentation implies otherwise.
 */
export function parseInbound(payload: any): InboundMessage[] {
  const out: InboundMessage[] = [];
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];

  for (const entry of entries) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const value = change?.value;
      for (const m of Array.isArray(value?.messages) ? value.messages : []) {
        const rawFrom = String(m?.from ?? '');
        const parsed = normalisePhone(rawFrom.startsWith('+') ? rawFrom : `+${rawFrom}`);
        if (!parsed.ok) continue;

        const type = String(m?.type ?? 'other');
        out.push({
          messageId: String(m?.id ?? ''),
          from: parsed.e164,
          type: (['text', 'image', 'location', 'audio', 'document'].includes(type) ? type : 'other') as InboundMessage['type'],
          text: String(m?.text?.body ?? m?.caption ?? '').slice(0, 2000),
          location: m?.location
            ? {
                lat: Number(m.location.latitude),
                lng: Number(m.location.longitude),
                name: m.location.name ? String(m.location.name).slice(0, 120) : undefined,
              }
            : undefined,
          mediaId: m?.image?.id ?? m?.document?.id ?? m?.audio?.id,
        });
      }
    }
  }
  return out;
}
