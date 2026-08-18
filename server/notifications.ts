import crypto from 'node:crypto';
import { sendOtpSms, normalisePhone, maskPhone } from './sms.js';
import { sendText as sendWhatsApp, sendTemplate, windowOpen, isOptedOut } from './whatsapp.js';
import { modeOf } from './config.js';

/**
 * One way to tell a citizen something.
 *
 * =========================================================================
 * Why a service and not four call sites
 * =========================================================================
 * Notification logic has a habit of ending up inline: an email here, an SMS
 * there, and eventually nobody can answer "what does a citizen actually
 * receive when their complaint is resolved?" without reading the whole
 * codebase. Worse, consent gets checked in three of the four places.
 *
 * So: one entry point, `notify()`. It owns the template, the channel
 * selection, the consent check and the record of what happened. Adding a
 * channel means writing an adapter; it does not mean touching the workflow.
 *
 * =========================================================================
 * Consent is checked HERE, once
 * =========================================================================
 * Every channel except in-app is opt-in, and the opt-out is honoured before
 * an adapter is ever called. A caller cannot bypass it, because a caller
 * never talks to an adapter.
 *
 * In-app is the exception and is always on: it is not a message pushed at
 * anybody, it is the tracking page they already came to look at. Making that
 * opt-in would mean a citizen could switch off the only guaranteed record of
 * their own complaint.
 */

export type Channel = 'in_app' | 'email' | 'sms' | 'whatsapp';

export type NotificationEvent =
  | 'complaint_registered'
  | 'department_assigned'
  | 'officer_assigned'
  | 'investigation_started'
  | 'information_required'
  | 'resolved'
  | 'closed'
  | 'sla_reminder'
  | 'feedback_request';

export type Recipient = {
  /** Stable id for in-app delivery. Usually the session subject hash. */
  id: string;
  phone?: string;
  email?: string;
  name?: string;
};

export type NotifyContext = {
  complaintId: string;
  category?: string;
  department?: string;
  officerName?: string;
  statusLabel?: string;
  slaDeadline?: string;
  note?: string;
};

// ---------------------------- templates ----------------------------

/**
 * One template per event, in two lengths.
 *
 * `short` is written to survive an SMS: no line breaks, no emoji, under 160
 * characters including the reference. `long` is for in-app, email and
 * WhatsApp, where there is room to say what happens next.
 *
 * Both always carry the reference number. A citizen who receives "your
 * complaint has been updated" with no reference has been told nothing.
 */
const TEMPLATES: Record<NotificationEvent, {
  title: string;
  short: (c: NotifyContext) => string;
  long: (c: NotifyContext) => string;
  /** Meta template name, for sends outside the 24-hour window. */
  waTemplate?: string;
}> = {
  complaint_registered: {
    title: 'Complaint registered',
    short: c => `CivicAI: complaint ${c.complaintId} registered${c.department ? ` with ${c.department}` : ''}. Track it in the CivicAI app.`,
    long: c =>
      `Your complaint has been registered.\n\nReference: ${c.complaintId}` +
      (c.category ? `\nCategory: ${c.category}` : '') +
      (c.department ? `\nDepartment: ${c.department}` : '') +
      (c.slaDeadline ? `\nExpected response by: ${new Date(c.slaDeadline).toLocaleString('en-IN')}` : '') +
      `\n\nYou will be told when the status changes. Keep this reference — you will need it to follow up.` +
      // Channel-specific guidance (e.g. what a further WhatsApp message
      // does) rides along here rather than as a second message. Two
      // notifications back to back for one event reads as a malfunction.
      (c.note ? `\n\n${c.note}` : ''),
    waTemplate: 'complaint_registered',
  },
  department_assigned: {
    title: 'Department assigned',
    short: c => `CivicAI: ${c.complaintId} has been routed to ${c.department ?? 'a department'}.`,
    long: c => `Complaint ${c.complaintId} has been routed to ${c.department ?? 'the relevant department'}. An officer will be assigned next.`,
  },
  officer_assigned: {
    title: 'Officer assigned',
    short: c => `CivicAI: ${c.complaintId} assigned to ${c.officerName ?? 'an officer'}.`,
    long: c =>
      `${c.officerName ?? 'An officer'} is now responsible for complaint ${c.complaintId}.` +
      (c.slaDeadline ? `\n\nExpected action by ${new Date(c.slaDeadline).toLocaleString('en-IN')}.` : ''),
    waTemplate: 'officer_assigned',
  },
  investigation_started: {
    title: 'Investigation started',
    short: c => `CivicAI: work has started on ${c.complaintId}.`,
    long: c => `Work has started on complaint ${c.complaintId}.${c.note ? `\n\n${c.note}` : ''}`,
  },
  information_required: {
    title: 'More information needed',
    short: c => `CivicAI: ${c.complaintId} needs more information from you. Open the app to reply.`,
    long: c =>
      `The officer handling complaint ${c.complaintId} needs something from you before they can continue.` +
      (c.note ? `\n\nThey asked: ${c.note}` : '') +
      `\n\nYour complaint stays open while you reply.`,
    waTemplate: 'information_required',
  },
  resolved: {
    title: 'Marked resolved',
    short: c => `CivicAI: ${c.complaintId} has been marked resolved. Please confirm in the app.`,
    long: c =>
      `Complaint ${c.complaintId} has been marked as resolved.` +
      (c.note ? `\n\n${c.note}` : '') +
      `\n\nIt is not closed yet. If the problem is still there, reopen it — a complaint cannot be closed without you.`,
    waTemplate: 'complaint_resolved',
  },
  closed: {
    title: 'Complaint closed',
    short: c => `CivicAI: ${c.complaintId} is now closed. Thank you.`,
    long: c => `Complaint ${c.complaintId} is now closed after your confirmation. Thank you for reporting it.`,
  },
  sla_reminder: {
    title: 'Still open past its deadline',
    short: c => `CivicAI: ${c.complaintId} has passed its response deadline and has been escalated.`,
    long: c =>
      `Complaint ${c.complaintId} has passed its expected response time and has been escalated to a senior officer.` +
      `\n\nYou do not need to do anything.`,
  },
  feedback_request: {
    title: 'How did we do?',
    short: c => `CivicAI: how was the handling of ${c.complaintId}? Rate it in the app.`,
    long: c => `Complaint ${c.complaintId} is closed. If you have a moment, rating how it was handled helps hold the department to account.`,
  },
};

// ---------------------------- preferences ----------------------------

export type Preferences = {
  in_app: true;   // always on, by design
  email: boolean;
  sms: boolean;
  whatsapp: boolean;
  /** Kills every channel except in-app. The single switch people look for. */
  mutedAll: boolean;
};

const DEFAULTS: Preferences = {
  in_app: true,
  // Off by default. A citizen filing one complaint has not consented to be
  // messaged, and defaulting outbound channels to on is how a public service
  // ends up looking like spam.
  email: false,
  sms: false,
  whatsapp: false,
  mutedAll: false,
};

const preferences = new Map<string, Preferences>();

export const getPreferences = (id: string): Preferences => ({ ...DEFAULTS, ...preferences.get(id) });

export function setPreferences(id: string, patch: Partial<Preferences>): Preferences {
  const next: Preferences = {
    ...getPreferences(id),
    ...patch,
    in_app: true, // not negotiable
  };
  preferences.set(id, next);
  return next;
}

// ---------------------------- in-app inbox ----------------------------

export type InAppNotification = {
  id: string;
  event: NotificationEvent;
  title: string;
  body: string;
  complaintId: string;
  at: string;
  read: boolean;
};

const INBOX_LIMIT = 50;
const inboxes = new Map<string, InAppNotification[]>();

export const inboxFor = (id: string): InAppNotification[] => inboxes.get(id) ?? [];

export function markRead(id: string, notificationId?: string): void {
  const list = inboxes.get(id);
  if (!list) return;
  for (const n of list) if (!notificationId || n.id === notificationId) n.read = true;
}

// ---------------------------- adapters ----------------------------

export type DeliveryResult = {
  channel: Channel;
  ok: boolean;
  simulated: boolean;
  reason?: string;
};

type Adapter = (r: Recipient, event: NotificationEvent, ctx: NotifyContext) => Promise<DeliveryResult>;

const inAppAdapter: Adapter = async (r, event, ctx) => {
  const tpl = TEMPLATES[event];
  const list = inboxes.get(r.id) ?? [];
  list.unshift({
    id: crypto.randomUUID(),
    event,
    title: tpl.title,
    body: tpl.long(ctx),
    complaintId: ctx.complaintId,
    at: new Date().toISOString(),
    read: false,
  });
  if (list.length > INBOX_LIMIT) list.length = INBOX_LIMIT;
  inboxes.set(r.id, list);
  return { channel: 'in_app', ok: true, simulated: false };
};

const smsAdapter: Adapter = async (r, event, ctx) => {
  if (!r.phone) return { channel: 'sms', ok: false, simulated: false, reason: 'no_number' };
  const parsed = normalisePhone(r.phone);
  if (!parsed.ok) return { channel: 'sms', ok: false, simulated: false, reason: 'invalid_number' };

  const simulated = modeOf('sms') !== 'live';
  /**
   * Reuses the OTP transport, which is the same provider call. Note that
   * production SMS is BILLED PER MESSAGE — this is not free, and the UI says
   * so rather than implying otherwise (see server/config.ts).
   */
  const res = await sendOtpSms(parsed.e164, TEMPLATES[event].short(ctx));
  return { channel: 'sms', ok: res.ok, simulated, reason: res.ok ? undefined : 'send_failed' };
};

const whatsappAdapter: Adapter = async (r, event, ctx) => {
  if (!r.phone) return { channel: 'whatsapp', ok: false, simulated: false, reason: 'no_number' };
  const parsed = normalisePhone(r.phone);
  if (!parsed.ok) return { channel: 'whatsapp', ok: false, simulated: false, reason: 'invalid_number' };

  const tpl = TEMPLATES[event];
  const simulated = modeOf('whatsapp') !== 'live';

  /**
   * Inside the 24-hour window a freeform message is allowed and reads
   * better. Outside it, only an approved template may be sent — and if this
   * event has no template, the correct action is to send NOTHING rather than
   * risk the number being flagged. Silence is recoverable; a blocked
   * business number is not.
   */
  if (windowOpen(parsed.e164)) {
    const res = await sendWhatsApp(parsed.e164, tpl.long(ctx));
    return { channel: 'whatsapp', ok: res.ok, simulated, reason: res.ok ? undefined : res.reason };
  }

  if (!tpl.waTemplate) {
    return { channel: 'whatsapp', ok: false, simulated, reason: 'outside_window_no_template' };
  }
  const res = await sendTemplate(parsed.e164, tpl.waTemplate, [ctx.complaintId, ctx.statusLabel ?? tpl.title]);
  return { channel: 'whatsapp', ok: res.ok, simulated, reason: res.ok ? undefined : res.reason };
};

const emailAdapter: Adapter = async (r, event, ctx) => {
  if (!r.email) return { channel: 'email', ok: false, simulated: false, reason: 'no_address' };
  const simulated = modeOf('email') !== 'live';
  const tpl = TEMPLATES[event];
  if (simulated) {
    console.log(`[notify] (simulated email) -> ${r.email}: ${tpl.title} / ${ctx.complaintId}`);
    return { channel: 'email', ok: true, simulated: true };
  }
  try {
    const { sendMail } = await import('./email.js') as any;
    if (typeof sendMail !== 'function') {
      return { channel: 'email', ok: false, simulated, reason: 'transport_unavailable' };
    }
    await sendMail(r.email, tpl.title, tpl.long(ctx));
    return { channel: 'email', ok: true, simulated: false };
  } catch {
    return { channel: 'email', ok: false, simulated, reason: 'send_failed' };
  }
};

const ADAPTERS: Record<Channel, Adapter> = {
  in_app: inAppAdapter,
  sms: smsAdapter,
  whatsapp: whatsappAdapter,
  email: emailAdapter,
};

// ---------------------------- entry point ----------------------------

const recentDeliveries: Array<{ at: string; event: NotificationEvent; complaintId: string; results: DeliveryResult[] }> = [];

/**
 * Tell a citizen something. The only way to do so.
 *
 * Never throws and never blocks the caller's transaction. A complaint whose
 * status change was rolled back because an SMS gateway was slow is a far
 * worse failure than a notification nobody received.
 */
export async function notify(
  event: NotificationEvent,
  recipient: Recipient,
  ctx: NotifyContext,
): Promise<DeliveryResult[]> {
  const prefs = getPreferences(recipient.id);

  const channels: Channel[] = ['in_app'];
  if (!prefs.mutedAll) {
    if (prefs.email) channels.push('email');
    if (prefs.sms) channels.push('sms');
    // A WhatsApp opt-out lives with the phone number, not the account: the
    // person may have replied STOP from a handset without ever opening the
    // portal, and that instruction has to be honoured either way.
    if (prefs.whatsapp && !(recipient.phone && isOptedOut(normalisePhone(recipient.phone).e164 ?? ''))) {
      channels.push('whatsapp');
    }
  }

  const results = await Promise.all(
    channels.map(async c => {
      try {
        return await ADAPTERS[c](recipient, event, ctx);
      } catch (err) {
        console.error(`[notify] ${c} adapter threw`, err);
        return { channel: c, ok: false, simulated: false, reason: 'adapter_error' } as DeliveryResult;
      }
    }),
  );

  recentDeliveries.unshift({ at: new Date().toISOString(), event, complaintId: ctx.complaintId, results });
  if (recentDeliveries.length > 50) recentDeliveries.length = 50;

  return results;
}

export const notificationStatus = () => ({
  inboxes: inboxes.size,
  storedPreferences: preferences.size,
  recentDeliveries: recentDeliveries.slice(0, 10),
  channels: {
    in_app: 'always on',
    email: modeOf('email'),
    sms: modeOf('sms'),
    whatsapp: modeOf('whatsapp'),
  },
});

export { TEMPLATES as NOTIFICATION_TEMPLATES, maskPhone };
