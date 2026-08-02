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
import { store, storeStatus, type Complaint } from './store.js';
import { getSession, sessionMatchesEmail, sessionMatchesPhone } from './auth.js';
import { tokenFromRequest, safeError } from './security.js';
import { ipOf } from './rateLimit.js';

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
 * Demo principal directory.
 *
 * NOTE: role assignment is keyed off the signed-in session identity. In
 * production this belongs in the users table with an admin-managed mapping;
 * hard-coding it here keeps the RBAC layer demonstrable without inventing a
 * half-built user-management system that would look more finished than it is.
 */
const DEMO_PRINCIPALS: Record<string, Omit<Principal, 'id'>> = {
  'super':    { role: 'super_admin',        scope: {},                                                  displayName: 'Super Admin' },
  'state':    { role: 'state_admin',        scope: { state: 'Delhi' },                                  displayName: 'Delhi State Admin' },
  'district': { role: 'district_admin',     scope: { state: 'Delhi', district: 'New Delhi' },           displayName: 'New Delhi District Admin' },
  'dept':     { role: 'department_officer', scope: { state: 'Delhi', department: 'Water Department' },  displayName: 'Water Dept Officer' },
  'field':    { role: 'field_officer',      scope: { officerId: 'off-1' },                              displayName: 'Field Officer (off-1)' },
  'auditor':  { role: 'auditor',            scope: {},                                                  displayName: 'Read-only Auditor' },
};

/**
 * Resolves the caller's principal.
 *
 * The `x-demo-role` header is honoured ONLY outside production, so the RBAC
 * matrix can be exercised without six real accounts. In production the role
 * must come from the session, and an unmapped session gets no admin access
 * at all (deny by default).
 */
function principalFrom(req: express.Request): Principal | null {
  const session = getSession(tokenFromRequest(req));
  if (!session) return null;

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const demo = String(req.headers['x-demo-role'] || '').toLowerCase();
    if (demo && DEMO_PRINCIPALS[demo]) {
      return { id: `demo-${demo}`, ...DEMO_PRINCIPALS[demo] };
    }
  }

  // Match on the session's subject hash, not the displayed identifier —
  // that value is masked ("hi•••@gmail.com") and could never equal a real
  // address, which silently disabled SUPER_ADMIN_EMAIL entirely.
  // Two doors to the same identity: Google gives an email, SMS OTP gives a
  // number. Either configured value grants super_admin, so switching the OTP
  // channel to SMS cannot lock the operator out.
  const superEmail = process.env.SUPER_ADMIN_EMAIL || '';
  const superPhone = process.env.SUPER_ADMIN_PHONE || '';
  const isSuper =
    (superEmail && sessionMatchesEmail(session.subjectHash, superEmail)) ||
    (superPhone && sessionMatchesPhone(session.subjectHash, superPhone));
  const mapped = isSuper ? DEMO_PRINCIPALS.super : null;

  if (!mapped) return null; // deny by default
  return { id: session.identifier, ...mapped };
}

function requirePermission(permission: Parameters<typeof authorize>[1]) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const principal = principalFrom(req);
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
    progress: STATUS_PROGRESS[c.status],
    isTerminal: isTerminal(c.status),
    availableTransitions: allowedTransitions(c.status, p.role).map(t => ({
      to: t.to, label: t.label, toLabel: STATUS_LABELS[t.to],
    })),
  };
}

// ───────────────────────── who am I ─────────────────────────
adminRouter.get('/me', (req, res) => {
  const p = principalFrom(req);
  if (!p) return res.status(403).json({ error: 'forbidden', message: 'No admin access.' });
  res.json({
    ok: true,
    principal: { id: p.id, role: p.role, scope: p.scope, displayName: p.displayName },
    permissions: permissionsFor(p.role),
    roles: ROLES,
    store: storeStatus(),
  });
});

// ───────────────────────── complaints ─────────────────────────
adminRouter.get('/complaints', requirePermission('complaint:read'), async (req, res) => {
  try {
    const p = principalOf(req);
    const all = await store.list();
    // Scope filtering happens here, not in the UI.
    let rows = visibleTo(p, all);

    const { status, department, district, priority, q } = req.query as Record<string, string>;
    if (status) rows = rows.filter(r => r.status === status);
    if (department) rows = rows.filter(r => r.department === department);
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
    const officerName = String(req.body?.officerName || '').slice(0, 120);
    if (!officerId) return res.status(400).json({ error: 'bad_request', message: 'officerId is required.' });

    const updated = await store.update(row.id, {
      assignedOfficerId: officerId,
      assignedOfficerName: officerName || officerId,
      status: row.status === 'department_assigned' ? 'officer_assigned' : row.status,
    });

    audit({ actor: p, action: 'complaint:assign', targetType: 'complaint', targetId: row.id,
            detail: { from: row.assignedOfficerId ?? null, to: officerId }, ip: ipOf(req) });

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
