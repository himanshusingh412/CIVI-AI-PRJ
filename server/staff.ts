import crypto from 'crypto';
import type { Principal, Role, Scope } from './rbac.js';
import { ROLES } from './rbac.js';
import { normalisePhone } from './sms.js';
import { demoModeEnabled, isProduction } from './config.js';

/**
 * Staff identity: who is an officer, and what jurisdiction do they hold?
 *
 * ─────────────────────────────────────────────────────────────────────────
 * What this replaces
 * ─────────────────────────────────────────────────────────────────────────
 * Roles used to be a hardcoded object in admin.ts plus an `x-demo-role`
 * header. That was honest about being a stand-in, but it meant exactly one
 * real account could exist (SUPER_ADMIN_EMAIL) and there was no way to
 * demonstrate a scoped officer without inventing a header. Both problems are
 * the same problem: role was not data.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * The rule that matters
 * ─────────────────────────────────────────────────────────────────────────
 * A role is NEVER taken from the client. Not from a header, not from a
 * request body, not from a route the browser chose to visit. The only input
 * is the session's subject hash — a SHA-256 of the verified email or phone,
 * minted server-side when the identity provider vouched for it. Everything
 * else is a lookup.
 *
 * This is why `resolve()` takes a hash and nothing else. There is no
 * parameter an attacker could supply that changes the answer.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Resolution order
 * ─────────────────────────────────────────────────────────────────────────
 *   1. break-glass   SUPER_ADMIN_EMAIL / SUPER_ADMIN_PHONE from the
 *                    environment. Deliberately first, so a broken database
 *                    can never lock the operator out of their own portal.
 *   2. database      users ⋈ roles ⋈ officers. The real answer in
 *                    production.
 *   3. STAFF_DIRECTORY  a JSON env var, for deployments with no database
 *                    yet but real people who need access.
 *   4. demo seed     built-in accounts, ONLY outside production and ONLY
 *                    with demo mode on. This is what makes the RBAC matrix
 *                    demonstrable without provisioning six real identities.
 *
 * Anything not found by step 4 is a citizen. Deny by default: an unknown
 * session gets no staff capability at all.
 */

export type StaffSource = 'break-glass' | 'database' | 'env' | 'demo-seed';

export type StaffRecord = {
  id: string;
  displayName: string;
  role: Role;
  scope: Scope;
  status: 'active' | 'suspended';
  /** Where the grant came from. Surfaced to super admins, and audited. */
  source: StaffSource;
};

const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

/** Session subject hashes are computed over the canonical form. Mirror it exactly. */
const hashEmail = (email: string) => sha256(email.trim().toLowerCase());
const hashPhone = (phone: string) => {
  const p = normalisePhone(phone);
  return p.ok ? sha256(p.e164) : null;
};

const isRole = (v: unknown): v is Role => (ROLES as readonly string[]).includes(String(v));

// ───────────────────────── route mapping ─────────────────────────
/**
 * Where a signed-in principal lands.
 *
 * The client asks the SERVER for this rather than deciding from a role it
 * holds locally, so a tampered client can only send itself to a route the
 * server will then refuse to serve data for.
 */
export const HOME_ROUTES: Record<Role | 'citizen', string> = {
  super_admin: '/portal/admin',
  state_admin: '/portal/admin',
  auditor: '/portal/admin',
  district_admin: '/portal/department',
  department_officer: '/portal/department',
  // Area officers work a queue, not an analytics overview, so they land on
  // the officer workspace alongside field officers rather than the
  // department dashboard.
  area_officer: '/portal/officer',
  field_officer: '/portal/officer',
  citizen: '/portal',
};

export const homeRouteFor = (role: Role | 'citizen'): string =>
  HOME_ROUTES[role] ?? '/portal';

// ───────────────────────── 1. break-glass ─────────────────────────
function fromEnvSuperAdmin(subjectHash: string): StaffRecord | null {
  const email = (process.env.SUPER_ADMIN_EMAIL || '').trim();
  const phone = (process.env.SUPER_ADMIN_PHONE || '').trim();

  const matches =
    (email && hashEmail(email) === subjectHash) ||
    (phone && hashPhone(phone) === subjectHash);

  if (!matches) return null;
  return {
    id: 'break-glass',
    displayName: 'Super Admin',
    role: 'super_admin',
    scope: {},
    status: 'active',
    source: 'break-glass',
  };
}

// ───────────────────────── 2. database ─────────────────────────
/**
 * Role names as stored by db/seed.mjs, mapped onto the RBAC role ids.
 * Kept as an explicit table rather than a slugify() call: a rename in the
 * seed should fail loudly here, not silently downgrade someone to a citizen.
 */
const DB_ROLE_MAP: Record<string, Role> = {
  'Super Admin': 'super_admin',
  'State Admin': 'state_admin',
  'District Admin': 'district_admin',
  'Department Officer': 'department_officer',
  'Area Officer': 'area_officer',
  'Field Officer': 'field_officer',
  'Auditor': 'auditor',
};

async function fromDatabase(subjectHash: string): Promise<StaffRecord | null> {
  let client: (() => any) | null = null;
  try {
    ({ client } = await import('./store.postgres.js'));
  } catch {
    return null;
  }
  const sql = client?.();
  if (!sql) return null;

  try {
    /**
     * Both identity columns are hashed IN SQL and compared to the session
     * hash, because the hash is one-way — there is no way to look the user
     * up by address.
     *
     * The phone expression rebuilds E.164 the same way normalisePhone does
     * (last 10 digits, +91 prefix). If those two ever diverge, an operator
     * who signed in by SMS silently loses their role, so the seed stores
     * bare 10-digit numbers and this is the single place that reconciles it.
     */
    const rows = await sql.query(
      `SELECT u.id::text            AS id,
              u.full_name           AS full_name,
              u.status::text        AS status,
              u.state               AS state,
              u.district            AS district,
              r.role_name           AS role_name,
              d.name                AS department,
              -- Ward comes from the OFFICER row, not the user row: it is a
              -- posting, not a personal attribute, and an officer can be
              -- reposted to another ward without their identity changing.
              o.assigned_ward       AS ward,
              o.id::text            AS officer_id
         FROM users u
         JOIN roles r        ON r.id = u.role_id
         LEFT JOIN officers o    ON o.user_id = u.id AND o.deleted_at IS NULL
         LEFT JOIN departments d ON d.id = o.department_id
        WHERE u.deleted_at IS NULL
          AND (
                (u.email IS NOT NULL
                  AND encode(sha256(lower(btrim(u.email))::bytea), 'hex') = $1)
             OR (u.phone IS NOT NULL AND length(regexp_replace(u.phone, '[^0-9]', '', 'g')) >= 10
                  AND encode(sha256(
                        ('+91' || right(regexp_replace(u.phone, '[^0-9]', '', 'g'), 10))::bytea
                      ), 'hex') = $1)
              )
        LIMIT 1`,
      [subjectHash],
    );

    const row = Array.isArray(rows) ? rows[0] : rows?.rows?.[0];
    if (!row) return null;

    const role = DB_ROLE_MAP[row.role_name];
    // 'Citizen' and any unrecognised role name resolve to no staff access.
    if (!role) return null;

    return {
      id: row.id,
      displayName: row.full_name || 'Staff member',
      role,
      scope: scopeFor(role, {
        state: row.state || undefined,
        district: row.district || undefined,
        department: row.department || undefined,
        ward: row.ward || undefined,
        officerId: row.officer_id || undefined,
      }),
      status: row.status === 'active' ? 'active' : 'suspended',
      source: 'database',
    };
  } catch (err) {
    // A database that cannot answer must not be able to GRANT anything, and
    // must not take down the portal for the break-glass admin either.
    console.error('[staff] directory lookup failed; treating as no staff grant', err);
    return null;
  }
}

/**
 * Narrows a raw jurisdiction to the constraints that role actually observes.
 *
 * This matters: rbac.inScope treats every present field as a filter. If a
 * super admin's row happened to carry state='Delhi', giving them that scope
 * verbatim would silently confine the national administrator to one state.
 * Scope is a property of the ROLE first and the record second.
 */
function scopeFor(role: Role, raw: Scope): Scope {
  switch (role) {
    case 'super_admin':
    case 'auditor':
      return {};
    case 'state_admin':
      return { state: raw.state };
    case 'district_admin':
      return { state: raw.state, district: raw.district };
    case 'department_officer':
      return { state: raw.state, department: raw.department };
    // The narrowest geographic role: department AND district AND ward all
    // constrain at once. Dropping any one of them here would widen the
    // officer's reach without anything in the request looking wrong - e.g.
    // omitting `district` would let a Ward 12 officer in District A also see
    // District B's Ward 12, because ward identifiers repeat across districts.
    case 'area_officer':
      return {
        state: raw.state,
        district: raw.district,
        department: raw.department,
        ward: raw.ward,
      };
    case 'field_officer':
      return { officerId: raw.officerId };
    default:
      return {};
  }
}

// ───────────────────────── 3. environment directory ─────────────────────────
/**
 * STAFF_DIRECTORY: a JSON array, for a deployment with real staff but no
 * database yet.
 *
 *   STAFF_DIRECTORY='[{"email":"jane@gov.in","role":"district_admin",
 *                      "name":"Jane R.","state":"Delhi","district":"New Delhi"}]'
 *
 * Parsed once and cached; a malformed value logs and yields an empty
 * directory rather than throwing at import time (see the note in
 * server/index.ts about module-load failures on serverless).
 */
type EnvStaffEntry = {
  email?: string;
  phone?: string;
  role?: string;
  name?: string;
  state?: string;
  district?: string;
  department?: string;
  ward?: string;
  officerId?: string;
};

let envDirectoryCache: { raw: string; entries: EnvStaffEntry[] } | null = null;

function envDirectory(): EnvStaffEntry[] {
  const raw = process.env.STAFF_DIRECTORY || '';
  if (!raw.trim()) return [];
  if (envDirectoryCache?.raw === raw) return envDirectoryCache.entries;

  let entries: EnvStaffEntry[] = [];
  try {
    const parsed = JSON.parse(raw);
    entries = Array.isArray(parsed) ? parsed : [];
  } catch {
    console.error('[staff] STAFF_DIRECTORY is not valid JSON — ignoring it entirely.');
    entries = [];
  }
  envDirectoryCache = { raw, entries };
  return entries;
}

function fromEnvDirectory(subjectHash: string): StaffRecord | null {
  for (const [i, e] of envDirectory().entries()) {
    const match =
      (e.email && hashEmail(e.email) === subjectHash) ||
      (e.phone && hashPhone(e.phone) === subjectHash);
    if (!match) continue;

    if (!isRole(e.role)) {
      console.error(`[staff] STAFF_DIRECTORY entry ${i} has an unknown role "${e.role}" — ignored.`);
      return null;
    }
    return {
      id: `env-${i}`,
      displayName: e.name || 'Staff member',
      role: e.role,
      scope: scopeFor(e.role, {
        state: e.state, district: e.district,
        department: e.department, ward: e.ward, officerId: e.officerId,
      }),
      status: 'active',
      source: 'env',
    };
  }
  return null;
}

// ───────────────────────── 4. demo seed ─────────────────────────
/**
 * One loginable account per role, so the authorisation model can actually be
 * SEEN rather than described.
 *
 * These are phone identities because the OTP path needs no external account:
 * with AUTH_DEV_OTP=true the code comes back in the response, so a reviewer
 * can sign in as a Water Department officer in about ten seconds and watch
 * the scope filter remove every complaint outside Delhi Water.
 *
 * Guarded twice — production AND demo mode — because a demo account that
 * survives into production is a backdoor with documentation.
 */
export const DEMO_STAFF: Array<{ phone: string; record: Omit<StaffRecord, 'source'> }> = [
  { phone: '9000000001', record: { id: 'demo-super',    displayName: 'Demo Super Admin',        role: 'super_admin',        scope: {},                                                 status: 'active' } },
  { phone: '9000000002', record: { id: 'demo-state',    displayName: 'Demo Delhi State Admin',  role: 'state_admin',        scope: { state: 'Delhi' },                                 status: 'active' } },
  { phone: '9000000003', record: { id: 'demo-district', displayName: 'Demo New Delhi DM',       role: 'district_admin',     scope: { state: 'Delhi', district: 'New Delhi' },          status: 'active' } },
  { phone: '9000000004', record: { id: 'demo-dept',     displayName: 'Demo Water Dept Officer', role: 'department_officer', scope: { state: 'Delhi', department: 'Water Department' }, status: 'active' } },
  { phone: '9000000005', record: { id: 'demo-field',    displayName: 'Demo Field Officer',      role: 'field_officer',      scope: { officerId: 'off-1' },                             status: 'active' } },
  { phone: '9000000006', record: { id: 'demo-auditor',  displayName: 'Demo Read-only Auditor',  role: 'auditor',            scope: {},                                                 status: 'active' } },

  // Three area officers that make ward isolation demonstrable rather than
  // merely asserted. Electricity and Water sit in the SAME district on
  // purpose, differing only by ward - so signing in as one and finding the
  // other's complaint missing proves the ward dimension is doing the work,
  // not the district or department dimension that already existed. Transport
  // differs on district as well, covering the coarser boundary at the same
  // time.
  { phone: '9000000007', record: { id: 'demo-area-elec',  displayName: 'Demo Electricity Officer · Ward 12', role: 'area_officer', scope: { state: 'Delhi', district: 'District A', department: 'Electricity Board',  ward: 'Ward 12' }, status: 'active' } },
  { phone: '9000000008', record: { id: 'demo-area-water', displayName: 'Demo Water Officer · Ward 15',       role: 'area_officer', scope: { state: 'Delhi', district: 'District A', department: 'Water Department',   ward: 'Ward 15' }, status: 'active' } },
  { phone: '9000000009', record: { id: 'demo-area-trans', displayName: 'Demo Transport Officer · Ward 4',    role: 'area_officer', scope: { state: 'Delhi', district: 'District B', department: 'Transport Department', ward: 'Ward 4' }, status: 'active' } },
];

export const demoStaffAvailable = (): boolean => !isProduction() && demoModeEnabled();

function fromDemoSeed(subjectHash: string): StaffRecord | null {
  if (!demoStaffAvailable()) return null;
  for (const entry of DEMO_STAFF) {
    if (hashPhone(entry.phone) === subjectHash) {
      return { ...entry.record, source: 'demo-seed' };
    }
  }
  return null;
}

// ───────────────────────── public API ─────────────────────────

/**
 * The one function that answers "is this session staff?".
 *
 * Returns null for citizens and for anyone unknown — identically, so a
 * caller cannot distinguish "not staff" from "no such person".
 */
export async function resolveStaff(subjectHash: string | undefined): Promise<StaffRecord | null> {
  if (!subjectHash) return null;

  const found =
    fromEnvSuperAdmin(subjectHash) ??
    (await fromDatabase(subjectHash)) ??
    fromEnvDirectory(subjectHash) ??
    fromDemoSeed(subjectHash);

  if (!found) return null;
  // A suspended account keeps its row but loses every capability. Handled
  // here rather than at each call site, so no route can forget to check.
  if (found.status !== 'active') return null;
  return found;
}

/** Adapts a staff record into the shape the RBAC layer consumes. */
export const toPrincipal = (s: StaffRecord): Principal => ({
  id: s.id,
  role: s.role,
  scope: s.scope,
  displayName: s.displayName,
});

/** Operator-facing summary for /api/health. Never lists identities. */
export const staffDirectoryStatus = () => ({
  breakGlassConfigured: !!(process.env.SUPER_ADMIN_EMAIL || process.env.SUPER_ADMIN_PHONE),
  envDirectoryEntries: envDirectory().length,
  demoAccountsActive: demoStaffAvailable(),
});
