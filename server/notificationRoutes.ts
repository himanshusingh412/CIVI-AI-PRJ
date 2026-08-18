import express from 'express';
import {
  getPreferences, setPreferences, inboxFor, markRead, notificationStatus,
} from './notifications.js';
import { safeError } from './security.js';

/**
 * Citizen-facing notification settings and inbox.
 *
 * Keyed on the session's subject hash, never on anything the client sends —
 * otherwise one person could read another's notifications, or switch their
 * channels off, by guessing an id.
 */
export const notificationRouter = express.Router();

const keyFor = (req: express.Request): string => {
  const s = (req as any).session;
  return String(s?.subjectHash || s?.identifier || '');
};

notificationRouter.get('/', (req, res) => {
  try {
    const id = keyFor(req);
    const items = inboxFor(id);
    res.json({
      ok: true,
      notifications: items,
      unread: items.filter(n => !n.read).length,
      preferences: getPreferences(id),
    });
  } catch (err) { return safeError(res, err); }
});

notificationRouter.post('/read', (req, res) => {
  try {
    const id = keyFor(req);
    const notificationId = req.body?.id ? String(req.body.id) : undefined;
    markRead(id, notificationId);
    const items = inboxFor(id);
    res.json({ ok: true, notifications: items, unread: items.filter(n => !n.read).length });
  } catch (err) { return safeError(res, err); }
});

/**
 * PATCH-shaped, but POST: only the keys present are changed, so a client
 * that knows about three channels cannot silently reset a fourth it has
 * never heard of.
 */
notificationRouter.post('/preferences', (req, res) => {
  try {
    const id = keyFor(req);
    const body = req.body ?? {};
    const patch: Record<string, boolean> = {};
    for (const key of ['email', 'sms', 'whatsapp', 'mutedAll'] as const) {
      if (typeof body[key] === 'boolean') patch[key] = body[key];
    }
    res.json({ ok: true, preferences: setPreferences(id, patch) });
  } catch (err) { return safeError(res, err); }
});

/** Operator view. Never exposes message bodies or full contact details. */
notificationRouter.get('/status', (_req, res) => res.json(notificationStatus()));
