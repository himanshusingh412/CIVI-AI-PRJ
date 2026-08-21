import type { Principal, Scope } from './rbac.js';
import { inScope } from './rbac.js';
import { demoStaffAvailable } from './staff.js';

/**
 * The officer roster: who exists, and where each one is posted.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Why this file has to exist before assignment can be trusted
 * ─────────────────────────────────────────────────────────────────────────
 * POST /complaints/:id/assign used to take BOTH halves of the officer's
 * identity from the request body:
 *
 *     officerId:   String(req.body?.officerId   || '')
 *     officerName: String(req.body?.officerName || '')
 *
 * Nothing checked that the id belonged to a real officer, and the display
 * name was simply whatever the browser said it was. Two consequences, both
 * reachable by an admin who is legitimately allowed to assign SOMETHING:
 *
 *   1. A complaint could be assigned to an officer id that does not exist,
 *      parking it in a queue nobody reads while the UI shows it as handled.
 *   2. Because rbac.inScope() grants a field officer access to complaints
 *      where `assignedOfficerId === scope.officerId`, writing an arbitrary
 *      id GRANTS READ ACCESS to whoever holds that id. Assignment was an
 *      unaudited permission-granting operation.
 *
 * So the roster is the authority: an id is resolved here or the assignment
 * is refused, and the name is read from the record rather than accepted
 * from the caller.
 */

export type Officer = {
  id: string;
  name: string;
  /** Employee/staff reference shown to admins who may see it. */
  employeeId?: string;
  department: string;
  state: string;
  district: string;
  /** Local area. Absent for officers who cover a whole district. */
  ward?: string;
  active: boolean;
};

/**
 * Demo roster, mirroring the ward-scoped complaints seeded in store.ts and
 * the demo area officers in staff.ts, so the assignment flow is exercisable
 * without provisioning a database.
 *
 * Gated on the same demo check as the staff seed: an assignable officer that
 * survives into production is a real person's workload being handed to a
 * fictional one.
 */
const DEMO_OFFICERS: Officer[] = [
  { id: 'off-1', name: 'Suresh Kumar', employeeId: 'EMP-1001', department: 'Water Department',   state: 'Delhi', district: 'New Delhi',   active: true },
  { id: 'off-2', name: 'Priya Sharma', employeeId: 'EMP-1002', department: 'Roads Department',   state: 'Delhi', district: 'South Delhi', active: true },
  { id: 'off-3', name: 'Amit Verma',   employeeId: 'EMP-1003', department: 'Sanitation Department', state: 'Maharashtra', district: 'Mumbai', active: true },

  // Ward-posted officers, one per demo area. These are the ones that make
  // §16 (filter the dropdown by department + district + ward) observable:
  // Electricity/Ward 12 and Water/Ward 15 share a district, so a dropdown
  // that ignores ward would visibly offer the wrong person.
  { id: 'off-elec-12',  name: 'Ravi Chandra',  employeeId: 'EMP-2012', department: 'Electricity Board',     state: 'Delhi', district: 'District A', ward: 'Ward 12', active: true },
  { id: 'off-elec-12b', name: 'Neha Gupta',    employeeId: 'EMP-2013', department: 'Electricity Board',     state: 'Delhi', district: 'District A', ward: 'Ward 12', active: true },
  { id: 'off-water-15', name: 'Kavita Menon',  employeeId: 'EMP-2015', department: 'Water Department',      state: 'Delhi', district: 'District A', ward: 'Ward 15', active: true },
  { id: 'off-trans-4',  name: 'Imran Khan',    employeeId: 'EMP-2004', department: 'Transport Department',  state: 'Delhi', district: 'District B', ward: 'Ward 4',  active: true },
  // Deliberately inactive: assigning work to someone on leave should fail
  // even though the id resolves, which is a different rejection from
  // "no such officer" and worth being able to demonstrate.
  { id: 'off-elec-12x', name: 'Suspended Officer', employeeId: 'EMP-2099', department: 'Electricity Board', state: 'Delhi', district: 'District A', ward: 'Ward 12', active: false },
];

async function fromDatabase(): Promise<Officer[] | null> {
  try {
    const { client } = await import('./store.postgres.js');
    const sql = client();
    if (!sql) return null;

    const rows = await sql.query(
      `SELECT o.id::text        AS id,
              o.officer_name    AS name,
              o.designation     AS employee_id,
              d.name            AS department,
              o.assigned_state  AS state,
              o.assigned_district AS district,
              o.assigned_ward   AS ward,
              o.is_available    AS active
         FROM officers o
         JOIN departments d ON d.id = o.department_id
        WHERE o.deleted_at IS NULL`,
      [],
    );
    const list = Array.isArray(rows) ? rows : rows?.rows ?? [];
    return list.map((r: any) => ({
      id: r.id,
      name: r.name || 'Officer',
      employeeId: r.employee_id || undefined,
      department: r.department,
      state: r.state,
      district: r.district,
      ward: r.ward || undefined,
      active: r.active !== false,
    }));
  } catch (err) {
    // A directory that cannot answer must not silently become an empty
    // roster that rejects every assignment, nor a wildcard that accepts
    // any id. Returning null lets the caller fall back explicitly.
    console.error('[officers] directory lookup failed', err);
    return null;
  }
}

/** Everyone on the roster, database first, demo seed only outside production. */
export async function allOfficers(): Promise<Officer[]> {
  const db = await fromDatabase();
  if (db && db.length) return db;
  return demoStaffAvailable() ? DEMO_OFFICERS : [];
}

/**
 * Officers this principal is allowed to assign work to.
 *
 * Reuses rbac.inScope() rather than re-deriving the comparison, so the
 * dropdown can never drift from the check the assign endpoint performs —
 * an officer that appears in the list is by construction one the assignment
 * will accept.
 *
 * `assignedOfficerId` is set to the officer's own id so that a field-officer
 * principal (whose scope IS an assignment) does not match every colleague.
 */
export async function assignableOfficers(principal: Principal): Promise<Officer[]> {
  const roster = await allOfficers();
  return roster.filter(
    (o) =>
      o.active &&
      inScope(principal, {
        state: o.state,
        district: o.district,
        department: o.department,
        ward: o.ward,
        assignedOfficerId: o.id,
      }),
  );
}

export type ResolveReason = 'unknown_officer' | 'inactive_officer' | 'out_of_scope';

/**
 * Deliberately ONE shape with optional members rather than a discriminated
 * union of `{ok:true,…} | {ok:false,…}`.
 *
 * This project compiles without `strict`, and therefore without
 * `strictNullChecks` — under which TypeScript does not narrow discriminated
 * unions at all. The idiomatic union version type-errors at every call site
 * ("Property 'reason' does not exist…") even though the code is correct, and
 * the usual workarounds are casts, which throw away the checking that made
 * the union worth having. A flat result is honest about what this config can
 * actually verify.
 */
export type ResolveResult = {
  ok: boolean;
  officer?: Officer;
  reason?: ResolveReason;
};

/**
 * Resolve an officer id for an assignment, or explain the refusal.
 *
 * Three distinct refusals, kept separate because they mean different things
 * to an operator: the id is wrong, the person is unavailable, or the person
 * is real and available but outside what this admin may hand work to.
 */
export async function resolveAssignee(
  principal: Principal,
  officerId: string,
  target: { state?: string; district?: string; department?: string; ward?: string },
): Promise<ResolveResult> {
  const roster = await allOfficers();
  const officer = roster.find((o) => o.id === officerId);
  if (!officer) return { ok: false, reason: 'unknown_officer' };
  if (!officer.active) return { ok: false, reason: 'inactive_officer' };

  // The assigner must be allowed to reach the officer …
  const assignerReaches = inScope(principal, {
    state: officer.state,
    district: officer.district,
    department: officer.department,
    ward: officer.ward,
    assignedOfficerId: officer.id,
  });
  if (!assignerReaches) return { ok: false, reason: 'out_of_scope' };

  /*
   * … and the officer must actually cover the complaint. Without this an
   * admin with wide scope could hand a Ward 12 electricity fault to a Ward 4
   * transport officer: authorised, but nonsense — and it would then vanish
   * from the queue of everyone who could act on it.
   */
  const covers = (a?: string, b?: string) => !a || !b || a === b;
  const fits =
    covers(officer.department, target.department) &&
    covers(officer.district, target.district) &&
    covers(officer.ward, target.ward);
  if (!fits) return { ok: false, reason: 'out_of_scope' };

  return { ok: true, officer };
}

/** Exposed for tests and for seeding. */
export const _demoOfficers = DEMO_OFFICERS;
