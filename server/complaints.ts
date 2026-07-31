import express from 'express';
import { store, type Complaint } from './store.js';
import { publish } from './events.js';
import { scoreDuplicates, classify } from './duplicates.js';

/**
 * Citizen-facing complaint API.
 *
 * The admin portal has talked to the real store since it was built; the
 * citizen app never did — it held complaints in React state seeded with
 * mock rows, so a refresh erased everything a citizen filed and the two
 * portals could not see each other's data. These are the endpoints that
 * close that gap.
 *
 * Scoping rule: the public feed is genuinely public, so it must never carry
 * a complainant's name, phone or email. Those fields are stripped here
 * rather than in the client, because a filter that runs in the browser is
 * not a filter — the data already crossed the network.
 */
export const complaintsRouter = express.Router();

/** Fields safe to show on the transparency feed. */
function toPublic(c: Complaint) {
  return {
    id: c.id,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    category: c.category,
    description: c.description,
    state: c.state,
    district: c.district,
    ward: c.ward,
    lat: c.lat,
    lng: c.lng,
    department: c.department,
    status: c.status,
    priority: c.priority,
    escalationLevel: c.escalationLevel,
    slaDeadline: c.slaDeadline,
    assignedOfficerName: c.assignedOfficerName,
    citizenRating: c.citizenRating,
    timeline: c.timeline,
    publicUpdates: c.publicUpdates,
    attachments: c.attachments,
  };
}

/**
 * GET /api/complaints?state=Delhi&district=New%20Delhi&limit=200
 *
 * Filtering happens server-side so a district query does not ship the whole
 * national dataset to a phone in order to discard 95% of it.
 */
complaintsRouter.get('/', async (req, res) => {
  const { state, district, category, status } = req.query as Record<string, string | undefined>;
  const limit = Math.min(Number(req.query.limit) || 200, 500);

  const eq = (a?: string, b?: string) =>
    !b || String(a ?? '').toLowerCase() === b.toLowerCase();

  const all = await store.list();
  const rows = all
    .filter(c => eq(c.state, state) && eq(c.district, district) &&
                 eq(c.category, category) && eq(c.status as string, status))
    .slice(0, limit);

  res.json({ count: rows.length, total: all.length, complaints: rows.map(toPublic) });
});

/** Full record for one complaint, by its CIV- reference. */
complaintsRouter.get('/:id', async (req, res) => {
  const c = await store.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'not_found' });
  res.json(toPublic(c));
});

/**
 * POST /api/complaints — file a new one.
 *
 * Duplicate detection runs here and is ADVISORY: the complaint is always
 * created. Silently folding a citizen's report into someone else's on a
 * heuristic would break the one promise this system makes, which is that
 * their complaint exists and is tracked. The link is recorded so staff can
 * act on it; the citizen still gets their own reference number.
 */
complaintsRouter.post('/', async (req, res) => {
  const b = req.body ?? {};
  if (!b.category || !b.description) {
    return res.status(400).json({ error: 'invalid', message: 'Category and description are required.' });
  }

  const existing = await store.list();
  const matches = scoreDuplicates(
    { category: b.category, description: b.description, lat: b.lat, lng: b.lng,
      createdAt: new Date().toISOString() },
    existing.map(c => ({ id: c.id, category: c.category, description: c.description,
                         lat: c.lat, lng: c.lng, createdAt: c.createdAt })),
  );
  const top = matches[0];
  const verdict = top ? classify(top.score) : 'distinct';

  const created = await store.create({
    citizenName: b.citizenName ?? 'Anonymous',
    citizenPhone: b.citizenPhone ?? '',
    citizenEmail: b.citizenEmail ?? undefined,
    category: b.category,
    description: b.description,
    state: b.state ?? 'Delhi',
    district: b.district ?? 'New Delhi',
    ward: b.ward ?? undefined,
    lat: b.lat ?? undefined,
    lng: b.lng ?? undefined,
    department: b.department ?? undefined,
    status: 'submitted',
    priority: b.priority ?? 'Medium',
  } as any);

  publish({ type: 'complaint_created', id: created.id });

  res.status(201).json({
    complaint: toPublic(created),
    duplicate: verdict === 'distinct' ? null : {
      of: top.id,
      verdict,
      confidence: Math.round(top.score * 100),
      reasons: top.reasons,
    },
  });
});

/** Citizen rating once the complaint is resolved. */
complaintsRouter.post('/:id/feedback', async (req, res) => {
  const rating = Number(req.body?.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'invalid_rating' });
  }
  const updated = await store.update(req.params.id, { citizenRating: rating } as Partial<Complaint>);
  if (!updated) return res.status(404).json({ error: 'not_found' });

  publish({ type: 'complaint_updated', id: req.params.id, status: String(updated.status) });
  res.json(toPublic(updated));
});
