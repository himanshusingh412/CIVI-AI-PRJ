import express from 'express';
import {
  authorize, can, visibleTo, canSeeContactDetails, maskPhone, maskName,
  permissionsFor, type Permission, type Principal, ROLES,
} from './rbac.js';
import { record as audit, query as auditQuery, auditStats } from './audit.js';
import {
  canTransition, allowedTransitions, STATUS_LABELS, STATUS_PROGRESS,
  isTerminal, type Status,
} from './workflow.js';
import { store, storeStatus, seedDemoData, type Complaint } from './store.js';
import { getSession } from './auth.js';
import { resolveStaff, toPrincipal, homeRouteFor } from './staff.js';
import { tokenFromRequest, safeError } from './security.js';
import { ipOf } from './rateLimit.js';
import { notify, type NotificationEvent } from './notifications.js';
import { runSlaSweep } from './sla.js';
import { assignableOfficers, resolveAssignee } from './officers.js';

/**
 * Admin API. Every route is guarded by `requirePermission`, which checks
 * capability and (where a record is involved) jurisdiction scope. Denials are
 * audited — a failed access attempt is exactly what an auditor needs to see.
 */

export const adminRouter = express.Router();

/**
 * Permissions that imply write access. Used to reject read-only roles before
 * any workflow detail is evaluated or returned.
 */
const MUTATING_PERMISSIONS: Permission[] = [
  'complaint:create', 'complaint:update_status', 'complaint:assign',
  'complaint:reassign_department', 'complaint:escalate', 'complaint:merge',
  'complaint:note', 'complaint:upload', 'complaint:reopen', 'complaint:close',
  'user:manage',
];

/**
 * Resolves the caller's principal.
 *
 * All of the "who is this person" logic now lives in server/staff.ts, which
 * answers from the users/roles tables (or a configured directory) keyed on
 * the session's subject hash. Two things deliberately disappeared here:
 *
 *   - The DEMO_PRINCIPALS object. Role is data now, not a constant.
 *   - The `x-demo-role` header. It was gated to non-production, but a
 *     request header that changes your role is the exact shape of the bug
 *     this system must never have — and its existence made every reading of
 *     this file start with "except in development". Demo accounts are real
 *     sign-ins now (see DEMO_STAFF), so nothing is lost.
 *
 * Returns null for citizens and unknown sessions alike: deny by default.
 */
async function principalFrom(req: express.Request): Promise<Principal | null> {
  const session = getSession(tokenFromRequest(req));
  if (!session) return null;

  const staff = await resolveStaff(session.subjectHash);
  return staff ? toPrincipal(staff) : null;
}

function requirePermission(permission: Parameters<typeof authorize>[1]) {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const principal = await principalFrom(req);
    if (!principal) {
      return res.status(403).json({ error: 'forbidden', message: 'You do not have admin access.' });
    }
    const verdict = authorize(principal, permission);
    if (!verdict.ok) {
      audit({
        actor: principal, action: 'access:denied', targetType: 'system',
        targetId: req.path, detail: { permission, reason: verdict.reason }, ip: ipOf(req),
      });
      return res.status(403).json({ error: 'forbidden', message: 'Your role cannot perform this action.' });
    }
    (req as any).principal = principal;
    next();
  };
}

const principalOf = (req: express.Request): Principal => (req as any).principal;

/**
 * Which workflow states are worth telling the citizen about.
 *
 * Deliberately partial. `ai_verification`, `field_visit_scheduled` and
 * `evidence_uploaded` are real states an officer needs to see, and noise to
 * the person waiting for their water to come back on.
 */
const CITIZEN_FACING_EVENTS: Partial<Record<Status, NotificationEvent>> = {
  department_assigned: 'department_assigned',
  officer_assigned: 'officer_assigned',
  investigation_started: 'investigation_started',
  resolved: 'resolved',
  citizen_verification: 'resolved',
  closed: 'closed',
};

/** Applies field-level redaction before anything leaves the server. */
function project(c: Complaint, p: Principal) {
  const full = canSeeContactDetails(p);
  return {
    ...c,
    citizenName: full ? c.citizenName : maskName(c.citizenName),
    citizenPhone: full ? c.citizenPhone : maskPhone(c.citizenPhone),
    citizenEmail: full ? c.citizenEmail : undefined,
    // Internal notes are staff-only; auditors read them via the audit log.
    internalNotes: full ? c.internalNotes : [],
    statusLabel: STATUS_LABELS[c.status],
    /**
     * Timeline entries carry the raw enum, which surfaced in the officer's
     * drawer as "officer_assigned". Labelled here rather than in the client
     * so STATUS_LABELS stays the single source of truth - a client-side copy
     * is a second place to forget when a status is added.
     */
    timeline: c.timeline.map(t => ({
      ...t,
      statusLabel: STATUS_LABELS[t.status] ?? String(t.status),
    })),
    progress: STATUS_PROGRESS[c.status],
    /*
     * Assignment travels with the complaint so the drawer can show WHO holds
     * it and WHO handed it over. Both are admin-side facts: `project()` is
     * only ever used for /api/admin responses, and the citizen-facing
     * projection (server/complaints.ts toPublic) does not include them.
     */
    assignment: c.assignment ?? null,
    assignmentHistory: c.assignmentHistory ?? [],
    isTerminal: isTerminal(c.status),
    availableTransitions: allowedTransitions(c.status, p.role).map(t => ({
      to: t.to, label: t.label, toLabel: STATUS_LABELS[t.to],
    })),
  };
}

// ───────────────────────── who am I ─────────────────────────
adminRouter.get('/me', async (req, res) => {
  const p = await principalFrom(req);
  if (!p) return res.status(403).json({ error: 'forbidden', message: 'No admin access.' });
  res.json({
    ok: true,
    principal: { id: p.id, role: p.role, scope: p.scope, displayName: p.displayName },
    permissions: permissionsFor(p.role),
    homeRoute: homeRouteFor(p.role),
    roles: ROLES,
    store: storeStatus(),
  });
});

// ───────────────────────── complaints ─────────────────────────
adminRouter.get('/complaints', requirePermission('complaint:read'), async (req, res) => {
  try {
    const p = principalOf(req);
    let all = await store.list();
    if (all.length === 0) {
      try { await seedDemoData(); } catch {}
      all = await store.list();
    }
    // Scope filtering happens here, not in the UI.
    let rows = visibleTo(p, all);

    const { status, department, district, priority, q } = req.query as Record<string, string>;
    if (status) rows = rows.filter(r => r.status === status);
    // 'unrouted' is a real filter, not a department: complaints that have
    // not been assigned to any department are the ones most needing triage,
    // and a plain equality check would silently return nothing for them.
    if (department === 'unrouted') rows = rows.filter(r => !r.department);
    else if (department) rows = rows.filter(r => r.department === department);
    if (district) rows = rows.filter(r => r.district === district);
    if (priority) rows = rows.filter(r => r.priority === priority);
    if (q) {
      const needle = q.toLowerCase();
      rows = rows.filter(r =>
        r.id.toLowerCase().includes(needle) ||
        r.description.toLowerCase().includes(needle) ||
        r.category.toLowerCase().includes(needle) ||
        (canSeeContactDetails(p) && r.citizenName.toLowerCase().includes(needle)));
    }

    res.json({ ok: true, total: rows.length, complaints: rows.map(r => project(r, p)) });
  } catch (err) { return safeError(res, err); }
});

adminRouter.get('/complaints/:id', requirePermission('complaint:read'), async (req, res) => {
  try {
    const p = principalOf(req);
    const row = await store.get(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found', message: 'Complaint not found.' });

    // Out-of-scope reads return 404, not 403 — a 403 would confirm the record
    // exists, letting someone enumerate complaints outside their jurisdiction.
    const verdict = authorize(p, 'complaint:read', row);
    if (!verdict.ok) {
      audit({ actor: p, action: 'access:denied', targetType: 'complaint', targetId: row.id,
              detail: { reason: verdict.reason }, ip: ipOf(req) });
      return res.status(404).json({ error: 'not_found', message: 'Complaint not found.' });
    }
    res.json({ ok: true, complaint: project(row, p) });
  } catch (err) { return safeError(res, err); }
});

// ───────────────────────── status transition ─────────────────────────
adminRouter.post('/complaints/:id/status', requirePermission('complaint:read'), async (req, res) => {
  try {
    const p = principalOf(req);
    const row = await store.get(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found', message: 'Complaint not found.' });

    if (!authorize(p, 'complaint:read', row).ok) {
      return res.status(404).json({ error: 'not_found', message: 'Complaint not found.' });
    }

    const to = String(req.body?.status || '') as Status;
    const note = String(req.body?.note || '').slice(0, 2000);

    // 1. Can this role mutate anything at all?
    //    Checked BEFORE workflow validation: otherwise a read-only auditor
    //    receives a 422 describing the valid transitions, which leaks
    //    workflow state to a principal with no authority to change it.
    if (!MUTATING_PERMISSIONS.some(perm => can(p, perm))) {
      audit({ actor: p, action: 'access:denied', targetType: 'complaint', targetId: row.id,
              detail: { attempted: to, reason: 'read_only_role' }, ip: ipOf(req) });
      return res.status(403).json({ error: 'forbidden', message: 'Your role cannot perform this action.' });
    }

    // 2. Is the transition legal for this role?
    const move = canTransition(row.status, to, p.role);
    if (!move.ok) return res.status(422).json({ error: 'invalid_transition', message: move.reason });

    // 3. Does the role hold the permission that transition demands, in scope?
    const verdict = authorize(p, move.permission, row);
    if (!verdict.ok) {
      audit({ actor: p, action: 'access:denied', targetType: 'complaint', targetId: row.id,
              detail: { permission: move.permission, reason: verdict.reason }, ip: ipOf(req) });
      return res.status(403).json({ error: 'forbidden', message: 'Your role cannot perform this action.' });
    }

    const updated = await store.update(row.id, {
      status: to,
      timeline: [...row.timeline, {
        at: new Date().toISOString(), status: to,
        actorId: p.id, actorName: p.displayName,
        note: note || undefined, isPublic: true,
      }],
    });

    audit({ actor: p, action: 'complaint:status_change', targetType: 'complaint', targetId: row.id,
            detail: { from: row.status, to }, ip: ipOf(req) });

    /**
     * Not every transition is worth interrupting somebody for. A citizen who
     * gets a message for all fourteen states stops reading them, and then
     * misses the one that actually needed a reply. Only the transitions that
     * change what the citizen should DO or KNOW are notified.
     */
    const event = CITIZEN_FACING_EVENTS[to];
    if (event) {
      void notify(event, {
        id: row.citizenSubjectHash ?? `phone:${row.citizenPhone}`,
        phone: row.citizenPhone || undefined,
        email: row.citizenEmail,
        name: row.citizenName,
      }, {
        complaintId: row.id,
        category: row.category,
        department: updated!.department,
        officerName: updated!.assignedOfficerName,
        statusLabel: STATUS_LABELS[to],
        slaDeadline: updated!.slaDeadline,
        note: note || undefined,
      });
    }

    res.json({ ok: true, complaint: project(updated!, p) });
  } catch (err) { return safeError(res, err); }
});

// ───────────────────────── assignment ─────────────────────────
adminRouter.post('/complaints/:id/assign', requirePermission('complaint:assign'), async (req, res) => {
  try {
    const p = principalOf(req);
    const row = await store.get(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found', message: 'Complaint not found.' });

    const verdict = authorize(p, 'complaint:assign', row);
    if (!verdict.ok) {
      audit({ actor: p, action: 'access:denied', targetType: 'complaint', targetId: row.id,
              detail: { reason: verdict.reason }, ip: ipOf(req) });
      return res.status(404).json({ error: 'not_found', message: 'Complaint not found.' });
    }

    const officerId = String(req.body?.officerId || '').slice(0, 64);
    const reason = String(req.body?.reason || '').slice(0, 300).trim() || undefined;
    if (!officerId) return res.status(400).json({ error: 'bad_request', message: 'officerId is required.' });

    /*
     * The officer is RESOLVED, not accepted.
     *
     * This endpoint previously took both the id and the display name from
     * the request body without checking either. That made assignment a way
     * to grant access rather than merely route work: rbac.inScope() lets a
     * field officer read complaints where assignedOfficerId matches their
     * own scope, so writing an arbitrary id handed that complaint to
     * whoever holds it — and the name shown next to it was whatever the
     * browser typed. See the header of server/officers.ts.
     */
    const resolved = await resolveAssignee(p, officerId, {
      state: row.state, district: row.district,
      department: row.department, ward: row.ward,
    });
    if (!resolved.ok) {
      audit({ actor: p, action: 'access:denied', targetType: 'complaint', targetId: row.id,
              detail: { attemptedOfficerId: officerId, reason: resolved.reason }, ip: ipOf(req) });
      const message =
        resolved.reason === 'unknown_officer' ? 'That officer does not exist.'
        : resolved.reason === 'inactive_officer' ? 'That officer is not currently available.'
        : 'That officer cannot be assigned to this complaint.';
      return res.status(resolved.reason === 'unknown_officer' ? 400 : 403)
                .json({ error: 'invalid_assignee', message });
    }

    const officer = resolved.officer;
    const now = new Date().toISOString();

    // Supersede the previous holder rather than overwriting them: "who had
    // this before" is the question a missed complaint always raises.
    const history = [...(row.assignmentHistory ?? [])].map(a =>
      a.isCurrent ? { ...a, isCurrent: false, unassignedAt: now } : a);

    const assignment = {
      officerId: officer.id,
      officerName: officer.name,
      employeeId: officer.employeeId,
      department: officer.department,
      district: officer.district,
      ward: officer.ward,
      assignedById: p.id,
      assignedByName: p.displayName,
      assignedByRole: p.role,
      assignedAt: now,
      reason,
      isCurrent: true,
    };
    history.push(assignment);

    const updated = await store.update(row.id, {
      assignedOfficerId: officer.id,
      assignedOfficerName: officer.name,
      assignment,
      assignmentHistory: history,
      // Status and assignment are separate concerns: only the initial
      // hand-off advances the workflow, and a later reassignment must not
      // rewind a complaint that is already under investigation.
      status: row.status === 'department_assigned' ? 'officer_assigned' : row.status,
    });

    audit({ actor: p, action: 'complaint:assign', targetType: 'complaint', targetId: row.id,
            detail: { from: row.assignedOfficerId ?? null, to: officer.id, reason }, ip: ipOf(req) });

    res.json({ ok: true, complaint: project(updated!, p) });
  } catch (err) { return safeError(res, err); }
});

// ───────────────────────── notes ─────────────────────────
/**
 * A note without a status change.
 *
 * Officers need somewhere to record "called the citizen, no answer" or "site
 * visit scheduled with the contractor" — facts that are not a workflow
 * transition. Without this, the only way to leave a record was to advance
 * the case, which quietly corrupts the status history into a log of things
 * that did not actually happen.
 *
 * Two audiences, one endpoint, chosen explicitly by the caller:
 *   internal  staff only. Never shown to the citizen.
 *   public    appears in the citizen's tracking timeline.
 *
 * The default is INTERNAL. Getting this backwards publishes an officer's
 * private working note to the complainant, so the safe value is the one you
 * get by saying nothing.
 */
adminRouter.post('/complaints/:id/note', requirePermission('complaint:note'), async (req, res) => {
  try {
    const p = principalOf(req);
    const row = await store.get(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found', message: 'Complaint not found.' });

    const verdict = authorize(p, 'complaint:note', row);
    if (!verdict.ok) {
      audit({ actor: p, action: 'access:denied', targetType: 'complaint', targetId: row.id,
              detail: { permission: 'complaint:note', reason: verdict.reason }, ip: ipOf(req) });
      return res.status(404).json({ error: 'not_found', message: 'Complaint not found.' });
    }

    const body = String(req.body?.body ?? '').trim().slice(0, 2000);
    if (!body) return res.status(400).json({ error: 'bad_request', message: 'A note cannot be empty.' });

    const isPublic = req.body?.visibility === 'public';
    const at = new Date().toISOString();

    const updated = await store.update(row.id, isPublic
      ? { publicUpdates: [...row.publicUpdates, { at, body }] }
      : { internalNotes: [...row.internalNotes, { at, authorId: p.id, authorName: p.displayName, body }] });

    audit({ actor: p, action: 'complaint:note', targetType: 'complaint', targetId: row.id,
            // The note BODY is not audited: it can contain a citizen's
            // personal circumstances, and the audit log is read by people who
            // have no business reading those.
            detail: { visibility: isPublic ? 'public' : 'internal', length: body.length }, ip: ipOf(req) });

    res.json({ ok: true, complaint: project(updated!, p) });
  } catch (err) { return safeError(res, err); }
});

// ───────────────────────── analytics ─────────────────────────
adminRouter.get('/analytics', requirePermission('analytics:read'), async (req, res) => {
  try {
    const p = principalOf(req);
    const rows = visibleTo(p, await store.list());
    const now = Date.now();

    const by = <K extends keyof Complaint>(key: K) =>
      rows.reduce<Record<string, number>>((acc, r) => {
        const k = String(r[key] ?? 'Unassigned');
        acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {});

    const resolved = rows.filter(r => ['resolved', 'citizen_verification', 'closed'].includes(r.status));
    const avgMs = resolved.length
      ? resolved.reduce((s, r) => s + (Date.parse(r.updatedAt) - Date.parse(r.createdAt)), 0) / resolved.length
      : 0;
    const rated = rows.filter(r => typeof r.citizenRating === 'number');

    res.json({
      ok: true,
      scope: p.scope,
      totals: {
        total: rows.length,
        active: rows.filter(r => !['closed', 'rejected_spam', 'merged'].includes(r.status)).length,
        pending: rows.filter(r => ['submitted', 'ai_verification', 'department_assigned'].includes(r.status)).length,
        resolved: resolved.length,
        escalated: rows.filter(r => r.escalationLevel > 0).length,
        overdue: rows.filter(r => Date.parse(r.slaDeadline) < now && !isTerminal(r.status)).length,
        today: rows.filter(r => r.createdAt.slice(0, 10) === new Date().toISOString().slice(0, 10)).length,
      },
      avgResolutionHours: Math.round((avgMs / 3600_000) * 10) / 10,
      satisfaction: rated.length
        ? Math.round((rated.reduce((s, r) => s + (r.citizenRating || 0), 0) / rated.length) * 10) / 10
        : null,
      byDepartment: by('department'),
      byDistrict: by('district'),
      byState: by('state'),
      byPriority: by('priority'),
      byStatus: by('status'),
    });
  } catch (err) { return safeError(res, err); }
});

// ───────────────────────── audit log ─────────────────────────
adminRouter.get('/audit', requirePermission('audit:read'), (req, res) => {
  try {
    const { actorId, action, targetId, limit } = req.query as Record<string, string>;
    res.json({
      ok: true,
      ...auditStats(),
      entries: auditQuery({
        actorId, targetId,
        action: action as any,
        limit: limit ? Number(limit) : undefined,
      }),
    });
  } catch (err) { return safeError(res, err); }
});

// ───────────────────────── SLA sweep (operator-driven) ─────────────────────────
/**
 * Re-evaluate SLA breaches on demand.
 *
 * Previously reachable at this same path with nothing but `requireAuth`,
 * because the route was registered on the app rather than on this router —
 * which meant any signed-in citizen could trigger a nationwide escalation
 * pass and read the resulting breach list. See the note on
 * POST /api/internal/sla/sweep in server/index.ts for the scheduler-facing
 * half of the split.
 *
 * Two things are enforced here that were not before. The sweep itself is a
 * mutation, so it demands `complaint:escalate` rather than mere
 * authentication. And the RESULT is jurisdictional data: `SlaBreach` carries
 * only a complaint id, so returning the raw list would tell a District A
 * officer exactly which District B complaints are running late. The response
 * is therefore intersected with the caller's visible set.
 *
 * `escalated` is deliberately the global count while `breaches` is the
 * scoped subset — the operator is told the sweep did more work than they can
 * see, rather than being quietly shown a smaller number that looks like the
 * whole picture.
 */
adminRouter.post('/sla/sweep', requirePermission('complaint:escalate'), async (req, res) => {
  try {
    const principal = principalOf(req);
    const breaches = await runSlaSweep();

    const visibleIds = new Set(visibleTo(principal, await store.list()).map(c => c.id));
    const scoped = breaches.filter(b => visibleIds.has(b.id));

    audit({
      actor: principal, action: 'complaint:escalate', targetType: 'system',
      targetId: 'sla:sweep',
      detail: { escalatedTotal: breaches.length, visibleToCaller: scoped.length },
      ip: ipOf(req),
    });

    res.json({ ok: true, escalated: breaches.length, breaches: scoped });
  } catch (err) { return safeError(res, err); }
});

// ───────────────────────── officer directory ─────────────────────────
/**
 * GET /api/admin/officers — who this admin may hand work to.
 *
 * Scope-filtered in the data layer, not the UI. An endpoint that returned
 * the whole roster and left the browser to narrow it would leak the
 * staffing of every department and ward to anyone who opened devtools, and
 * would drift from what POST /assign actually accepts. Both now run through
 * the same rbac.inScope() call, so an officer that appears here is by
 * construction one the assignment will take.
 *
 * Optional ?department=&district=&ward= narrow further — useful when the
 * caller is a super admin filling a dropdown for one specific complaint.
 */
adminRouter.get('/officers', requirePermission('complaint:assign'), async (req, res) => {
  try {
    const p = principalOf(req);
    const { department, district, ward } = req.query as Record<string, string | undefined>;

    const eq = (a?: string, b?: string) => !b || a === b;
    const officers = (await assignableOfficers(p))
      .filter(o => eq(o.department, department) && eq(o.district, district) && eq(o.ward, ward))
      .map(o => ({
        id: o.id,
        name: o.name,
        // Employee ids are staffing detail; show them only to roles that
        // already see citizen contact details.
        employeeId: canSeeContactDetails(p) ? o.employeeId : undefined,
        department: o.department,
        district: o.district,
        ward: o.ward,
      }));

    res.json({ ok: true, count: officers.length, officers });
  } catch (err) { return safeError(res, err); }
});

// ───────────────────────── departments ─────────────────────────
/**
 * GET /api/admin/departments — the department-wise overview.
 *
 * Exists because a single flat complaint table is unusable at scale and
 * unsafe at any scale: it invites the client to hold every record and filter
 * locally, which is how jurisdiction leaks. Aggregation happens here, over
 * the rows this principal may already see (visibleTo), so a department admin
 * gets counts for their own department and no evidence that the others exist.
 *
 * The counters mirror the workflow states an operator actually triages by,
 * not the raw enum: `unassigned` is the one that matters most day to day and
 * is not a status at all — it is the absence of an assignment, which is
 * exactly the queue that silently grows when nobody owns it.
 */
adminRouter.get('/departments', requirePermission('complaint:read'), async (req, res) => {
  try {
    const p = principalOf(req);
    const rows = visibleTo(p, await store.list());

    const OPEN_NEW: Status[] = ['submitted', 'ai_verification'];
    const INVESTIGATING: Status[] = ['investigation_started', 'field_visit_scheduled', 'evidence_uploaded'];
    const RESOLVED: Status[] = ['resolved', 'citizen_verification', 'closed'];

    const buckets = new Map<string, Complaint[]>();
    for (const r of rows) {
      // Complaints not yet routed to a department are real and must not be
      // dropped from the overview — they are the ones needing triage most.
      const key = r.department ?? '__unrouted__';
      const list = buckets.get(key) ?? [];
      list.push(r);
      buckets.set(key, list);
    }

    const departments = [...buckets.entries()]
      .map(([department, list]) => ({
        // The stable value the client filters on and translates for display.
        department: department === '__unrouted__' ? null : department,
        total: list.length,
        new: list.filter(c => OPEN_NEW.includes(c.status as Status)).length,
        unassigned: list.filter(c => !c.assignedOfficerId && !isTerminal(c.status)).length,
        assigned: list.filter(c => c.assignedOfficerId && c.status === 'officer_assigned').length,
        investigating: list.filter(c => INVESTIGATING.includes(c.status as Status)).length,
        inProgress: list.filter(c => c.status === 'work_in_progress').length,
        resolved: list.filter(c => RESOLVED.includes(c.status as Status)).length,
        escalated: list.filter(c => c.escalationLevel > 0 && !isTerminal(c.status)).length,
        overdue: list.filter(c => Date.parse(c.slaDeadline) < Date.now() && !isTerminal(c.status)).length,
      }))
      .sort((a, b) => b.total - a.total);

    res.json({
      ok: true,
      total: rows.length,
      departments,
    });
  } catch (err) { return safeError(res, err); }
});

adminRouter.get('/departments/:id', requirePermission('complaint:read'), async (req, res) => {
  try {
    const p = principalOf(req);
    const id = req.params.id.toLowerCase();
    const rows = visibleTo(p, await store.list());
    const matched = rows.filter(r => {
      if (!r.department) return id === 'unrouted' || id === 'null';
      const deptSlug = r.department.toLowerCase().replace(/[^a-z0-9]/g, '');
      return deptSlug.includes(id) || id.includes(deptSlug);
    });

    const OPEN_NEW: Status[] = ['submitted', 'ai_verification'];
    const INVESTIGATING: Status[] = ['investigation_started', 'field_visit_scheduled', 'evidence_uploaded'];
    const RESOLVED: Status[] = ['resolved', 'citizen_verification', 'closed'];

    const summary = {
      department: id,
      total: matched.length,
      new: matched.filter(c => OPEN_NEW.includes(c.status as Status)).length,
      unassigned: matched.filter(c => !c.assignedOfficerId && !isTerminal(c.status)).length,
      assigned: matched.filter(c => c.assignedOfficerId && c.status === 'officer_assigned').length,
      investigating: matched.filter(c => INVESTIGATING.includes(c.status as Status)).length,
      inProgress: matched.filter(c => c.status === 'work_in_progress').length,
      resolved: matched.filter(c => RESOLVED.includes(c.status as Status)).length,
      escalated: matched.filter(c => c.escalationLevel > 0 && !isTerminal(c.status)).length,
      overdue: matched.filter(c => Date.parse(c.slaDeadline) < Date.now() && !isTerminal(c.status)).length,
    };

    res.json({
      ok: true,
      summary,
      complaints: matched,
    });
  } catch (err) { return safeError(res, err); }
});

