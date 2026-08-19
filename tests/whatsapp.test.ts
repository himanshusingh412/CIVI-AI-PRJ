import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.WHATSAPP_VERIFY_TOKEN = 'test-verify-token';
process.env.WHATSAPP_APP_SECRET = 'test-app-secret';

const {
  verifyWebhookChallenge, verifySignature, isDuplicate, parseInbound,
  noteInbound, setOptOut, isOptedOut, windowOpen, sendText,
} = await import('../server/whatsapp.js');

const {
  getPreferences, setPreferences, notify, inboxFor, markRead,
} = await import('../server/notifications.js');

/**
 * WhatsApp webhook and notification consent.
 *
 * The webhook is the only unauthenticated write path in the application, so
 * these are written as the attacks: a forged signature, a replayed message,
 * a malformed envelope, a message to somebody who said STOP.
 */

// ───────────────────────── webhook verification ─────────────────────────

test('the verification handshake rejects a wrong token', () => {
  assert.equal(
    verifyWebhookChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': 'abc' }).ok,
    false,
  );
});

test('the verification handshake rejects a token that is merely a prefix', () => {
  // Guards against a naive startsWith or a length-blind comparison.
  assert.equal(
    verifyWebhookChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': 'test-verify', 'hub.challenge': 'abc' }).ok,
    false,
  );
});

test('the verification handshake accepts the right token and echoes the challenge', () => {
  const r = verifyWebhookChallenge({
    'hub.mode': 'subscribe', 'hub.verify_token': 'test-verify-token', 'hub.challenge': 'echo-me',
  });
  assert.equal(r.ok, true);
  assert.equal(r.ok === true && r.challenge, 'echo-me');
});

test('a subscribe mode is required - any other mode is refused', () => {
  assert.equal(
    verifyWebhookChallenge({ 'hub.mode': 'unsubscribe', 'hub.verify_token': 'test-verify-token', 'hub.challenge': 'x' }).ok,
    false,
  );
});

// ───────────────────────── signatures ─────────────────────────

const sign = (body: Buffer, secret = 'test-app-secret') =>
  `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;

test('a correctly signed body is accepted', () => {
  const body = Buffer.from(JSON.stringify({ entry: [] }));
  assert.equal(verifySignature(body, sign(body)), true);
});

test('a body signed with the wrong secret is rejected', () => {
  const body = Buffer.from(JSON.stringify({ entry: [] }));
  assert.equal(verifySignature(body, sign(body, 'attacker-secret')), false);
});

test('a tampered body fails even with a signature that was once valid', () => {
  const original = Buffer.from(JSON.stringify({ entry: [{ ok: true }] }));
  const signature = sign(original);
  const tampered = Buffer.from(JSON.stringify({ entry: [{ ok: false }] }));
  assert.equal(verifySignature(tampered, signature), false);
});

test('a missing or malformed signature header is rejected, never skipped', () => {
  const body = Buffer.from('{}');
  assert.equal(verifySignature(body, undefined), false);
  assert.equal(verifySignature(body, ''), false);
  assert.equal(verifySignature(body, 'md5=abc'), false);
  assert.equal(verifySignature(body, 'sha256='), false);
});

// ───────────────────────── replay ─────────────────────────

test('the same message id is only accepted once', () => {
  const id = `wamid.${crypto.randomUUID()}`;
  assert.equal(isDuplicate(id), false, 'first delivery must be accepted');
  assert.equal(isDuplicate(id), true, 'Meta retries; the second must be suppressed');
  assert.equal(isDuplicate(id), true);
});

test('different message ids are independent', () => {
  assert.equal(isDuplicate(`wamid.${crypto.randomUUID()}`), false);
  assert.equal(isDuplicate(`wamid.${crypto.randomUUID()}`), false);
});

// ───────────────────────── parsing ─────────────────────────

test('a text message is extracted with an E.164 number', () => {
  const msgs = parseInbound({
    entry: [{ changes: [{ value: { messages: [
      { id: 'w1', from: '919876543210', type: 'text', text: { body: 'no water' } },
    ] } }] }],
  });
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].from, '+919876543210');
  assert.equal(msgs[0].text, 'no water');
});

test('a location message carries coordinates', () => {
  const msgs = parseInbound({
    entry: [{ changes: [{ value: { messages: [
      { id: 'w2', from: '919876543210', type: 'location',
        location: { latitude: 28.61, longitude: 77.2, name: 'Sector 14' } },
    ] } }] }],
  });
  assert.equal(msgs[0].type, 'location');
  assert.equal(msgs[0].location?.lat, 28.61);
  assert.equal(msgs[0].location?.name, 'Sector 14');
});

test('a malformed envelope yields nothing rather than throwing', () => {
  // This is public-internet input; every field is optional in practice.
  assert.deepEqual(parseInbound(null), []);
  assert.deepEqual(parseInbound({}), []);
  assert.deepEqual(parseInbound({ entry: 'not-an-array' }), []);
  assert.deepEqual(parseInbound({ entry: [{ changes: [{ value: {} }] }] }), []);
  assert.deepEqual(parseInbound({ entry: [{ changes: [{ value: { messages: [{}] } }] }] }), []);
});

test('a message from an unparseable number is dropped, not guessed at', () => {
  const msgs = parseInbound({
    entry: [{ changes: [{ value: { messages: [
      { id: 'w3', from: '12', type: 'text', text: { body: 'hi' } },
    ] } }] }],
  });
  assert.equal(msgs.length, 0);
});

// ───────────────────────── consent & window ─────────────────────────

test('the 24-hour window opens only on an inbound message', () => {
  const phone = '+919000011111';
  assert.equal(windowOpen(phone), false);
  noteInbound(phone);
  assert.equal(windowOpen(phone), true);
});

test('a freeform message outside the window is refused rather than attempted', async () => {
  // Meta counts policy violations against the sending number; a portal that
  // quietly burns its own WhatsApp number is worse than one without it.
  const res = await sendText('+919000022222', 'hello');
  assert.equal(res.ok, false);
  assert.equal(res.ok === false && res.reason, 'outside_24h_window');
});

test('an opted-out number receives nothing, even inside the window', async () => {
  const phone = '+919000033333';
  noteInbound(phone);
  setOptOut(phone, true);
  assert.equal(isOptedOut(phone), true);

  const res = await sendText(phone, 'status update');
  assert.equal(res.ok, false);
  assert.equal(res.ok === false && res.reason, 'opted_out');
});

test('the opt-out confirmation itself is still allowed through', async () => {
  // Someone who sends STOP and hears nothing does not know it worked, and
  // sends STOP again. This is the one permitted exception.
  const phone = '+919000044444';
  noteInbound(phone);
  setOptOut(phone, true);

  const res = await sendText(phone, 'You will not receive further messages.', { allowOptedOut: true });
  assert.equal(res.ok, true);
});

test('START reverses an opt-out', () => {
  const phone = '+919000055555';
  setOptOut(phone, true);
  assert.equal(isOptedOut(phone), true);
  setOptOut(phone, false);
  assert.equal(isOptedOut(phone), false);
});

// ───────────────────────── notification consent ─────────────────────────

test('every outbound channel is off by default', () => {
  const p = getPreferences('fresh-user');
  assert.equal(p.email, false);
  assert.equal(p.sms, false);
  assert.equal(p.whatsapp, false);
  assert.equal(p.in_app, true);
});

test('in-app cannot be switched off, however hard a client tries', () => {
  const p = setPreferences('user-1', { in_app: false } as never);
  assert.equal(p.in_app, true);
});

test('a citizen who has opted into nothing still gets the in-app record', async () => {
  const results = await notify('complaint_registered', { id: 'user-2' }, { complaintId: 'CIV-1' });
  assert.deepEqual(results.map(r => r.channel), ['in_app']);
  assert.equal(inboxFor('user-2').length, 1);
  assert.match(inboxFor('user-2')[0].body, /CIV-1/);
});

test('muting everything still leaves the in-app record intact', async () => {
  setPreferences('user-3', { email: true, sms: true, whatsapp: true, mutedAll: true });
  const results = await notify('resolved', { id: 'user-3', phone: '9876543210' }, { complaintId: 'CIV-2' });
  assert.deepEqual(results.map(r => r.channel), ['in_app']);
});

test('an enabled channel is actually attempted', async () => {
  setPreferences('user-4', { sms: true });
  const results = await notify('officer_assigned', { id: 'user-4', phone: '9876543210' }, { complaintId: 'CIV-3' });
  assert.ok(results.some(r => r.channel === 'sms'), 'sms should have been attempted');
});

test('a WhatsApp opt-out on the handset beats an opt-in in the portal', async () => {
  // The person may have replied STOP without ever opening the website, and
  // that instruction has to win.
  const phone = '9000066666';
  setOptOut('+919000066666', true);
  setPreferences('user-5', { whatsapp: true });
  const results = await notify('resolved', { id: 'user-5', phone }, { complaintId: 'CIV-4' });
  assert.equal(results.some(r => r.channel === 'whatsapp'), false);
});

test('every notification carries the complaint reference', async () => {
  // A citizen told "your complaint has been updated" with no reference has
  // been told nothing.
  for (const event of ['complaint_registered', 'officer_assigned', 'resolved', 'closed', 'sla_reminder'] as const) {
    await notify(event, { id: 'user-6' }, { complaintId: 'CIV-REF-9' });
  }
  const inbox = inboxFor('user-6');
  assert.equal(inbox.length, 5);
  for (const n of inbox) assert.match(n.body, /CIV-REF-9/, `${n.event} omitted the reference`);
});

test('marking read is per-user and does not leak across inboxes', async () => {
  await notify('closed', { id: 'user-7' }, { complaintId: 'CIV-5' });
  await notify('closed', { id: 'user-8' }, { complaintId: 'CIV-6' });
  markRead('user-7');
  assert.equal(inboxFor('user-7').every(n => n.read), true);
  assert.equal(inboxFor('user-8').every(n => !n.read), true);
});
