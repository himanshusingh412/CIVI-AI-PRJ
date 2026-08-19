import express from 'express';
import {
  verifyWebhookChallenge, verifySignature, isDuplicate, parseInbound,
  noteInbound, setOptOut, sendText, whatsappStatus, recentOutbox,
  type InboundMessage,
} from './whatsapp.js';
import { handleChat } from './chat.js';
import { store } from './store.js';
import { publish } from './events.js';
import { notify } from './notifications.js';
import { modeOf } from './config.js';
import type { ChatTurn } from './limits.js';

/**
 * WhatsApp as a complaint intake channel.
 *
 * =========================================================================
 * Why this channel matters more than it looks
 * =========================================================================
 * A large share of the people this portal exists for will never install an
 * app or open a browser to a government website, but they use WhatsApp every
 * day and it is already on their phone. For them this is not a convenience
 * feature; it is the difference between filing a complaint and not.
 *
 * Which is why the conversation reuses handleChat rather than reimplementing
 * intake: the same extraction, the same categories, the same "what is still
 * missing" logic that the web assistant uses. A WhatsApp complaint is a real
 * complaint in the same store, with the same reference format, visible to
 * the same officer. Two intake paths that disagree about what a complaint is
 * would be two products.
 *
 * =========================================================================
 * Everything arriving here is hostile until proven otherwise
 * =========================================================================
 * This is the only unauthenticated write path in the application. In order:
 *   1. signature   HMAC over the RAW body, against the app secret
 *   2. deduplicate Meta retries; without this one message becomes three
 *                  complaints
 *   3. parse       defensively, every field optional in practice
 *   4. consent     STOP is honoured before anything else happens
 *
 * The handler always answers 200. Meta retries anything else with increasing
 * aggression and eventually disables the subscription, so a bug in complaint
 * creation must not be reported as a delivery failure.
 */
export const whatsappRouter = express.Router();

// ---------------------------- conversation state ----------------------------

type Conversation = {
  phone: string;
  history: ChatTurn[];
  coords?: { lat: number; lng: number };
  updatedAt: number;
};

const CONVO_TTL_MS = 60 * 60_000;
const MAX_TURNS = 12;
const conversations = new Map<string, Conversation>();

const convoSweep = setInterval(() => {
  const cutoff = Date.now() - CONVO_TTL_MS;
  for (const [k, v] of conversations) if (v.updatedAt < cutoff) conversations.delete(k);
}, 5 * 60_000);
convoSweep.unref?.();

function conversationFor(phone: string): Conversation {
  const existing = conversations.get(phone);
  if (existing) { existing.updatedAt = Date.now(); return existing; }
  const fresh: Conversation = { phone, history: [], updatedAt: Date.now() };
  conversations.set(phone, fresh);
  return fresh;
}

// ---------------------------- keyword commands ----------------------------

/**
 * Recognised before the AI sees anything.
 *
 * STOP must work even when the model is down, the quota is spent, or the
 * message is gibberish around the word. Routing an opt-out through a
 * language model is how you end up ignoring one.
 */
const STOP_WORDS = ['stop', 'unsubscribe', 'band karo', 'band karein', 'ruko'];
const START_WORDS = ['start', 'subscribe', 'resume', 'chalu karo'];
const HELP_WORDS = ['help', 'madad', 'sahayata', 'menu'];

const HELP_TEXT =
  'CivicAI — citizen grievance helpline.\n\n' +
  'Just describe your problem in your own words and I will register it. ' +
  'You can write in Hindi, English or a mix.\n\n' +
  'Commands:\n' +
  'STATUS <reference> — check a complaint\n' +
  'STOP — stop receiving messages\n' +
  'HELP — see this again';

// ---------------------------- webhook ----------------------------

/**
 * GET — the verification handshake Meta performs once when the webhook URL
 * is saved in the dashboard. It must echo hub.challenge as PLAIN TEXT with
 * no quotes; returning JSON here is the classic reason a correct-looking
 * webhook never activates.
 */
whatsappRouter.get('/webhook', (req, res) => {
  const result = verifyWebhookChallenge(req.query as Record<string, unknown>);
  if (!result.ok) return res.sendStatus(403);
  res.type('text/plain').send(result.challenge);
});

/**
 * POST — inbound messages.
 *
 * express.raw, not express.json: the signature is computed over the exact
 * bytes Meta sent, and re-serialising a parsed object changes key order and
 * whitespace and therefore the digest.
 */
whatsappRouter.post('/webhook', async (req, res) => {
    /**
     * The raw bytes come from the `verify` hook on the global JSON parser
     * (see server/index.ts), not from express.raw on this route. Mounting a
     * second body parser here would be too late — the global one has already
     * consumed the stream, and req.body would be the parsed object with the
     * original bytes gone.
     */
    const raw: Buffer = (req as any).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));

    /**
     * In live mode an unsigned or wrongly-signed request is rejected, full
     * stop. In simulation there is no app secret to sign with, so the check
     * is skipped — and that is exactly why /api/whatsapp/simulate (below)
     * refuses to exist in production.
     */
    if (modeOf('whatsapp') === 'live') {
      if (!verifySignature(raw, req.get('x-hub-signature-256'))) {
        console.warn('[whatsapp] rejected an inbound message with a bad signature');
        return res.sendStatus(403);
      }
    }

    // Acknowledge immediately. Meta's retry policy punishes slow handlers,
    // and an AI round trip plus a database write is not fast.
    res.sendStatus(200);

    let payload: unknown;
    try { payload = JSON.parse(raw.toString('utf8') || '{}'); }
    catch { return; }

    for (const message of parseInbound(payload)) {
      try { await handleInbound(message); }
      catch (err) { console.error('[whatsapp] failed to handle a message', err); }
    }
});

// ---------------------------- the conversation ----------------------------

export async function handleInbound(message: InboundMessage): Promise<void> {
  if (isDuplicate(message.messageId)) return;

  const phone = message.from;
  // Any inbound message opens the 24-hour freeform window, per Meta policy.
  noteInbound(phone);

  const text = message.text.trim();
  const lower = text.toLowerCase();

  // ── consent, before anything else ──
  if (STOP_WORDS.some(w => lower === w || lower.startsWith(`${w} `))) {
    // Opt-out is recorded FIRST and unconditionally. If the confirmation
    // then fails to send, the person is still opted out — losing an opt-out
    // because a network call failed is the one outcome that is not
    // acceptable here.
    setOptOut(phone, true);
    await sendText(
      phone,
      'You will not receive further messages from CivicAI. Send START at any time to turn them back on.',
      { allowOptedOut: true },
    );
    return;
  }
  if (START_WORDS.some(w => lower === w)) {
    setOptOut(phone, false);
    await sendText(phone, 'Messages are back on. Describe a problem and I will register it, or send HELP for options.');
    return;
  }
  if (HELP_WORDS.some(w => lower === w)) {
    await sendText(phone, HELP_TEXT);
    return;
  }

  // ── status lookup ──
  const statusMatch = text.match(/^status\s+(\S+)/i);
  if (statusMatch) {
    const found = await store.get(statusMatch[1].toUpperCase());
    if (!found) {
      await sendText(phone, `No complaint found with reference ${statusMatch[1]}. Check the reference and try again.`);
      return;
    }
    await sendText(
      phone,
      `Complaint ${found.id}\n` +
      `Status: ${String(found.status).replace(/_/g, ' ')}\n` +
      `Category: ${found.category}\n` +
      (found.assignedOfficerName ? `Officer: ${found.assignedOfficerName}\n` : '') +
      (found.slaDeadline ? `Expected by: ${new Date(found.slaDeadline).toLocaleString('en-IN')}` : ''),
    );
    return;
  }

  const convo = conversationFor(phone);

  // ── a shared location pin ──
  if (message.location) {
    convo.coords = { lat: message.location.lat, lng: message.location.lng };
    if (message.location.name) {
      convo.history.push({ role: 'user', content: `The location is ${message.location.name}` });
    }
    await sendText(phone, 'Got the location. Now tell me what the problem is, if you have not already.');
    return;
  }

  /**
   * Images arrive as a media id that must be downloaded through the Graph
   * API with the access token. Not implemented: it would mean fetching and
   * storing an arbitrary attacker-supplied file from an unauthenticated
   * webhook, and that deserves its own review rather than being slipped in
   * here. The citizen is told plainly rather than left wondering whether
   * their photo arrived.
   */
  if (message.type === 'image' || message.type === 'document') {
    await sendText(
      phone,
      'I cannot receive attachments on WhatsApp yet — only text. Please describe the problem in words, ' +
      'and you can add photos later from the CivicAI website using your complaint reference.',
    );
    if (!text) return;
  }

  if (!text) {
    await sendText(phone, 'Please describe the problem in a message, or send HELP for options.');
    return;
  }

  // ── the same understanding the web assistant uses ──
  convo.history.push({ role: 'user', content: text });
  convo.history = convo.history.slice(-MAX_TURNS);

  const reply = await handleChat({
    message: text,
    history: convo.history.slice(0, -1),
    coords: convo.coords ?? null,
    sessionKey: `wa:${phone}`,
  });

  convo.history.push({ role: 'assistant', content: reply.reply });
  convo.history = convo.history.slice(-MAX_TURNS);

  /**
   * File anyway, eventually.
   *
   * `readyToFile` comes from the model, and when no provider answers the
   * fallback sets it to false forever. Left alone, that means a citizen on
   * WhatsApp can describe their problem five times and never once have a
   * complaint created — the system asking for detail indefinitely while
   * quietly recording nothing. The web has a form to fall back to; WhatsApp
   * has nothing.
   *
   * So after three attempts, or immediately if the assistant is degraded and
   * there is already enough to act on, it gets filed with whatever is there.
   * An imperfect complaint that exists beats a perfect one that does not.
   */
  const userTurns = convo.history.filter(t => t.role === 'user').length;
  const enoughToFile = convo.history
    .filter(t => t.role === 'user').map(t => t.content).join(' ').trim().length >= 20;
  const forceFile = enoughToFile && (userTurns >= 3 || (reply.degraded && userTurns >= 2));

  if (!reply.readyToFile && !forceFile) {
    await sendText(phone, reply.reply);
    return;
  }

  // ── file it ──
  const description = convo.history
    .filter(t => t.role === 'user')
    .map(t => t.content)
    .join(' ')
    .slice(0, 4000);

  const created = await store.create({
    citizenName: 'WhatsApp user',
    citizenPhone: phone,
    category: reply.category,
    description,
    state: 'Delhi',
    district: 'New Delhi',
    ward: reply.location?.label,
    lat: reply.location?.lat ?? convo.coords?.lat,
    lng: reply.location?.lng ?? convo.coords?.lng,
    status: 'submitted',
    priority: reply.priority,
  } as any);

  publish({ type: 'complaint_created', id: created.id });

  /**
   * Someone who filed by WhatsApp is opted in to WhatsApp by definition -
   * they started the conversation. Setting it here rather than leaving the
   * default off is the difference between them hearing about their own
   * complaint again and never hearing anything.
   */
  const { setPreferences } = await import('./notifications.js');
  setPreferences(`wa:${phone}`, { whatsapp: true });

  /**
   * One message, not two.
   *
   * The caveat about partial information and the note about what a further
   * message does both ride inside the registration notification. Sending
   * them separately meant a citizen received three messages in four seconds
   * for a single event, which reads as a malfunction — and the last of the
   * three was the least important.
   */
  const caveats = [
    !reply.readyToFile
      ? `I registered this as ${created.category} on what you told me, so it is not lost. ` +
        `If I have missed something, open ${created.id} on the CivicAI website to add detail.`
      : '',
    `Send STATUS ${created.id} at any time to check on it. Anything else you send starts a NEW complaint.`,
  ].filter(Boolean).join('\n\n');

  await notify('complaint_registered', { id: `wa:${phone}`, phone }, {
    complaintId: created.id,
    category: created.category,
    department: created.department,
    slaDeadline: created.slaDeadline,
    note: caveats,
  });

  // Conversation is finished; the next message starts a new complaint.
  conversations.delete(phone);
}

// ---------------------------- operator surfaces ----------------------------

whatsappRouter.get('/status', (_req, res) => {
  res.json({ ...whatsappStatus(), outbox: recentOutbox(10) });
});

/**
 * POST /api/whatsapp/simulate
 *
 * Feeds a message through the exact inbound pipeline so the channel can be
 * demonstrated without a Meta account. It is NOT a mock of the handler - it
 * calls the real one, so what a reviewer sees is what production runs.
 *
 * Refuses to exist in production, and refuses to exist in live mode. An
 * endpoint that injects unauthenticated messages as if they came from an
 * arbitrary phone number is a complaint-forgery API; the only safe version
 * of it is one that cannot be reached where it would matter.
 */
whatsappRouter.post('/simulate', express.json({ limit: '16kb' }), async (req, res) => {
  if (process.env.NODE_ENV === 'production' || modeOf('whatsapp') === 'live') {
    return res.status(404).json({ error: 'not_found' });
  }
  const from = String(req.body?.from ?? '').trim();
  const text = String(req.body?.text ?? '').slice(0, 2000);
  if (!from || !text) {
    return res.status(400).json({ error: 'bad_request', message: 'from and text are required.' });
  }

  await handleInbound({
    messageId: `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    from: from.startsWith('+') ? from : `+91${from.replace(/\D/g, '').slice(-10)}`,
    type: 'text',
    text,
  });

  res.json({ ok: true, simulated: true, outbox: recentOutbox(5) });
});
