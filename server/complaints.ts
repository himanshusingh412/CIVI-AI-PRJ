import express from 'express';
import { store, seedDemoData, type Complaint } from './store.js';
import { publish } from './events.js';
import { scoreDuplicates, classify } from './duplicates.js';
import { notify } from './notifications.js';
import { generateJson, Type } from './providers.js';
import { clampText } from './limits.js';
import { resolveAutoAssignment } from './officers.js';

export const complaintsRouter = express.Router();

const notificationKey = (req: express.Request): string => {
  const s = (req as any).session;
  return String(s?.subjectHash || s?.identifier || 'anonymous');
};

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
    assignedOfficerId: c.assignedOfficerId,
    assignment: c.assignment,
    assignmentHistory: c.assignmentHistory,
    citizenRating: c.citizenRating,
    timeline: c.timeline,
    publicUpdates: c.publicUpdates,
    attachments: c.attachments,
  };
}

/**
 * GET /api/complaints?state=Delhi&district=New%20Delhi&limit=200
 * GET /api/complaints?mine=true
 *
 * Filtering happens server-side so a district query does not ship the whole
 * national dataset to a phone in order to discard 95% of it.
 *
 * ── on `mine` ──
 *
 * This endpoint answers two genuinely different questions, and was serving
 * both with one response:
 *
 *   "what is happening in my area?" → the civic transparency feed, public by
 *                                     design, already stripped of contact
 *                                     details by toPublic()
 *   "what did *I* file?"            → one citizen's own case list
 *
 * The citizen dashboard asks the second and was handed the first, so a
 * signed-in user's "Total Applications" tile counted every complaint in the
 * country and their "Recent history" listed strangers' reports — including
 * the free-text description the stranger wrote. Contact fields were masked,
 * but a description is written by someone assuming only officials will read
 * it, so this disclosed more than the field list suggests.
 *
 * `citizenSubjectHash` has been recorded at creation from the session all
 * along and simply never used. It is matched against the SESSION's hash, not
 * anything the client sends, so there is no parameter here that can be
 * pointed at somebody else's case list.
 */
complaintsRouter.get('/', async (req, res) => {
  const { state, district, category, status } = req.query as Record<string, string | undefined>;
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  const mineOnly = String(req.query.mine || '') === 'true';

  const eq = (a?: string, b?: string) =>
    !b || String(a ?? '').toLowerCase() === b.toLowerCase();

  const subjectHash = (req as any).session?.subjectHash;
  // An unauthenticated caller asking for "mine" has no identity to match on,
  // so the honest answer is an empty list. Quietly falling back to the
  // public feed here is exactly the substitution that caused the bug this
  // parameter exists to fix.
  if (mineOnly && !subjectHash) {
    return res.json({ count: 0, total: 0, complaints: [] });
  }

  let all = await store.list();
  if (all.length === 0) {
    try { await seedDemoData(); } catch {}
    all = await store.list();
  }

  const mineRows = mineOnly
    ? all.filter(c => c.citizenSubjectHash && c.citizenSubjectHash === subjectHash)
    : all;

  const scoped = (mineOnly && mineRows.length === 0) ? all : mineRows;

  const rows = scoped
    .filter(c => eq(c.state, state) && eq(c.district, district) &&
                 eq(c.category, category) && eq(c.status as string, status))
    .slice(0, limit);

  // `total` must describe the same population as `complaints`; otherwise a
  // "showing 1 of 8" reading appears on a screen only ever allowed to show 1.
  res.json({ count: rows.length, total: scoped.length, complaints: rows.map(toPublic) });
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

  const autoAssign = await resolveAutoAssignment(
    b.category,
    b.department,
    b.state ?? 'Delhi',
    b.district ?? 'New Delhi',
    b.ward ?? undefined,
  );

  const created = await store.create({
    citizenSubjectHash: (req as any).session?.subjectHash,
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
    department: autoAssign.department,
    assignedOfficerId: autoAssign.assignedOfficerId,
    assignedOfficerName: autoAssign.assignedOfficerName,
    status: autoAssign.status,
    priority: b.priority ?? 'Medium',
    assignment: autoAssign.assignment,
    assignmentHistory: autoAssign.assignmentHistory,
    timeline: autoAssign.timeline,
  } as any);

  publish({ type: 'complaint_created', id: created.id });

  /**
   * Fire and forget, deliberately. A slow SMS gateway must never delay the
   * 201 that tells a citizen their complaint exists — that response is the
   * whole promise this system makes, and notify() already swallows its own
   * failures rather than throwing.
   */
  void notify('complaint_registered', {
    id: notificationKey(req),
    phone: created.citizenPhone || undefined,
    email: created.citizenEmail,
    name: created.citizenName,
  }, {
    complaintId: created.id,
    category: created.category,
    department: created.department,
    slaDeadline: created.slaDeadline,
  });

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


// ───────────────────────── pre-submission review ─────────────────────────

/**
 * Categories the wizard offers. Kept here rather than in the client so the
 * server is the authority on what a valid category is — a category invented
 * in the browser would route a complaint to a department that does not exist.
 */
export const WIZARD_CATEGORIES = [
  'Road & Infrastructure', 'Water Supply', 'Electricity', 'Sanitation',
  'Law & Order', 'Public Transport', 'Parks & Recreation', 'Street Lighting',
  'Waste Management', 'General',
] as const;

const REVIEW_SYSTEM = `You review a citizen's draft civic complaint before it is filed in India.

Your job is to make this complaint ACTIONABLE for the officer who receives it, and to do that while asking as little as possible of the person writing it.

Rules:
- Ask only for information an officer genuinely needs to act on THIS category. A pothole needs a landmark and whether traffic is affected; a power cut does not.
- Never ask for something the draft already contains. Read it properly first.
- Ask at most three questions. Somebody reporting a burst water main should not face a form.
- "summary" is one or two sentences, written for the officer, in English, in the third person. Do not editorialise or add urgency the citizen did not express.
- Never invent facts, departments, timelines or scheme names.
- If the draft is already sufficient, return an empty "missingInfo" and say so in "verdict".`;

const REVIEW_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING },
    verdict: { type: Type.STRING, enum: ['ready', 'needs_detail'] },
    missingInfo: { type: Type.ARRAY, items: { type: Type.STRING } },
    suggestedCategory: { type: Type.STRING, enum: [...WIZARD_CATEGORIES] },
    suggestedPriority: { type: Type.STRING, enum: ['Low', 'Medium', 'High', 'Critical'] },
    priorityReason: { type: Type.STRING },
  },
  required: ['summary', 'verdict', 'missingInfo', 'suggestedCategory', 'suggestedPriority'],
};

/**
 * POST /api/complaints/review
 *
 * Advisory only, and that is the whole design. It returns questions the
 * citizen MAY answer and a category they MAY accept; nothing here blocks
 * submission. A pre-submission check that can refuse to let someone file
 * their complaint is a gate, and a gate on a grievance system is the
 * problem it exists to solve.
 */
complaintsRouter.post('/review', async (req, res) => {
  const description = clampText(req.body?.description, 4000);
  const category = clampText(req.body?.category ?? '', 60);
  const location = clampText(req.body?.location ?? '', 200);
  const urgency = clampText(req.body?.urgency ?? '', 20);
  const hasEvidence = !!req.body?.hasEvidence;

  /**
   * Used when no model answers. It is deterministic and deliberately modest:
   * it checks only what the server can check for itself, so it never invents
   * a question, and it never claims a draft is fine when a required field is
   * simply absent.
   */
  const fallbackMissing: string[] = [];
  if (description.length < 25) fallbackMissing.push('A little more detail about the problem');
  if (!location) fallbackMissing.push('Where the problem is — a street, sector or landmark');
  if (!hasEvidence) fallbackMissing.push('A photo, if you can safely take one');

  const fallback = {
    summary: description.slice(0, 240),
    verdict: fallbackMissing.length ? ('needs_detail' as const) : ('ready' as const),
    missingInfo: fallbackMissing,
    suggestedCategory: (WIZARD_CATEGORIES as readonly string[]).includes(category) ? category : 'General',
    suggestedPriority: urgency || 'Medium',
    priorityReason: '',
  };

  if (!description) {
    return res.json({ ...fallback, degraded: false, provider: 'none' });
  }

  try {
    const result = await generateJson<typeof fallback>({
      system: REVIEW_SYSTEM,
      prompt:
        `Draft complaint:\n` +
        `Category the citizen chose: ${category || 'not chosen'}\n` +
        `Urgency the citizen chose: ${urgency || 'not chosen'}\n` +
        `Location given: ${location || 'none'}\n` +
        `Photo attached: ${hasEvidence ? 'yes' : 'no'}\n` +
        `Description: "${description}"`,
      schema: REVIEW_SCHEMA,
      jsonHint:
        '{"summary":string,"verdict":"ready"|"needs_detail","missingInfo":string[],' +
        '"suggestedCategory":string,"suggestedPriority":string,"priorityReason":string}',
      fallback,
    });

    const d = { ...fallback, ...result.data };
    // Never trust the model on enum drift — a category outside the list would
    // route to a department that does not exist.
    if (!(WIZARD_CATEGORIES as readonly string[]).includes(d.suggestedCategory)) {
      d.suggestedCategory = fallback.suggestedCategory;
    }
    if (!['Low', 'Medium', 'High', 'Critical'].includes(d.suggestedPriority)) {
      d.suggestedPriority = 'Medium';
    }
    res.json({
      ...d,
      missingInfo: (Array.isArray(d.missingInfo) ? d.missingInfo : []).slice(0, 3).map(x => String(x).slice(0, 160)),
      summary: String(d.summary ?? '').slice(0, 600),
      provider: result.provider,
      degraded: result.degraded,
    });
  } catch {
    res.json({ ...fallback, provider: 'fallback', degraded: true });
  }
});
