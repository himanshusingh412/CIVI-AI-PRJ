import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { hashPassword, verifyAdminLogin } from '../server/adminAuth.js';
import { resolveStaff } from '../server/staff.js';

/**
 * Provisioning a staff member: does the credential actually reach the role?
 *
 * ─────────────────────────────────────────────────────────────────────────
 * The failure this file exists to catch
 * ─────────────────────────────────────────────────────────────────────────
 * A staff account is TWO environment entries that have to agree:
 *
 *   ADMIN_CREDENTIALS  employeeId + passwordHash + subject
 *   STAFF_DIRECTORY    subject (as `email` or `phone`) + role + scope
 *
 * joined only by `subject`. When they disagree, nothing errors. The password
 * is correct, a session is minted, the browser is redirected — and the person
 * lands on the CITIZEN portal with no role, because authentication succeeded
 * and authorisation found nobody. That is the right behaviour (proving who
 * you are is not the same as being granted anything), but from the outside it
 * looks exactly like "the admin portal is broken", and there is no log line
 * that says so.
 *
 * scripts/make-staff.mjs exists to make the two entries impossible to
 * mistype, by emitting both from one set of answers. These tests pin the
 * contract that script relies on, in both directions: the join WORKS when the
 * subjects match, and it silently grants NOTHING when they do not.
 *
 * The subject is hashed on the way into the session
 * (auth.issueSession: sha256(subject.trim().toLowerCase())) and looked up by
 * that hash (staff.hashEmail: the same expression). This mirrors both, so a
 * change to either canonicalisation breaks the test rather than the portal.
 */

const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex');
const subjectHashOf = (subject: string) => sha256(subject.trim().toLowerCase());

const PASSWORD = 'ward-twelve-electricity-2026';

/** Exactly the shape scripts/make-staff.mjs prints, for an area officer. */
async function provision(employeeId: string) {
  const subject = `${employeeId.toLowerCase()}@staff.civicai.local`;
  return {
    subject,
    staffEntry: {
      email: subject,
      role: 'area_officer',
      name: 'Ravi Kumar',
      state: 'Delhi',
      district: 'District A',
      department: 'Electricity Board',
      ward: 'Ward 12',
    },
    credEntry: {
      employeeId,
      subject,
      passwordHash: await hashPassword(PASSWORD),
    },
  };
}

/** Restores the environment even when an assertion throws. */
async function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>) {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('a matched credential + directory pair logs in AND resolves to its scope', async () => {
  const { subject, staffEntry, credEntry } = await provision('EMP-3001');

  await withEnv(
    {
      ADMIN_CREDENTIALS: JSON.stringify([credEntry]),
      STAFF_DIRECTORY: JSON.stringify([staffEntry]),
      // Keep the break-glass and demo paths out of it: this must pass on the
      // env-directory path alone, which is the one a real deployment uses
      // before it has a database.
      SUPER_ADMIN_EMAIL: undefined,
      SUPER_ADMIN_PHONE: undefined,
    },
    async () => {
      const login = await verifyAdminLogin('EMP-3001', PASSWORD);
      assert.equal(login.ok, true, 'the password should authenticate');
      assert.equal(login.subject, subject, 'login must return the join key, not the employee id');

      const staff = await resolveStaff(subjectHashOf(login.subject!));
      assert.ok(staff, 'a matched pair must resolve to a staff record, not to a citizen');
      assert.equal(staff!.role, 'area_officer');
      assert.equal(staff!.source, 'env');

      // Every dimension survives the round trip. Losing `ward` here would not
      // break any test that only checks the role, but it would silently widen
      // this officer to the whole district.
      assert.deepEqual(staff!.scope, {
        state: 'Delhi',
        district: 'District A',
        department: 'Electricity Board',
        ward: 'Ward 12',
      });
    },
  );
});

test('a mismatched subject authenticates but grants nothing at all', async () => {
  const { staffEntry, credEntry } = await provision('EMP-3002');
  // The realistic typo: the directory entry was written by hand against a
  // real-looking address while the credential kept the synthetic one.
  const drifted = { ...staffEntry, email: 'ravi.kumar@delhi.gov.in' };

  await withEnv(
    {
      ADMIN_CREDENTIALS: JSON.stringify([credEntry]),
      STAFF_DIRECTORY: JSON.stringify([drifted]),
      SUPER_ADMIN_EMAIL: undefined,
      SUPER_ADMIN_PHONE: undefined,
    },
    async () => {
      const login = await verifyAdminLogin('EMP-3002', PASSWORD);
      assert.equal(login.ok, true, 'authentication does not depend on the directory');

      const staff = await resolveStaff(subjectHashOf(login.subject!));
      assert.equal(staff, null, 'a drifted subject must grant NO role — not a partial one');
    },
  );
});

test('an unknown role in the directory grants nothing rather than a default', async () => {
  const { staffEntry, credEntry } = await provision('EMP-3003');
  const typo = { ...staffEntry, role: 'area-officer' }; // hyphen, not underscore

  await withEnv(
    {
      ADMIN_CREDENTIALS: JSON.stringify([credEntry]),
      STAFF_DIRECTORY: JSON.stringify([typo]),
      SUPER_ADMIN_EMAIL: undefined,
      SUPER_ADMIN_PHONE: undefined,
    },
    async () => {
      const login = await verifyAdminLogin('EMP-3003', PASSWORD);
      assert.equal(login.ok, true);
      // Deny by default. A role string that does not parse must not fall back
      // to the first role in the list, or to citizen-with-admin-pages.
      assert.equal(await resolveStaff(subjectHashOf(login.subject!)), null);
    },
  );
});

test('a malformed STAFF_DIRECTORY revokes access instead of throwing', async () => {
  const { credEntry } = await provision('EMP-3004');

  await withEnv(
    {
      ADMIN_CREDENTIALS: JSON.stringify([credEntry]),
      STAFF_DIRECTORY: '[{"email": "broken",',
      SUPER_ADMIN_EMAIL: undefined,
      SUPER_ADMIN_PHONE: undefined,
    },
    async () => {
      const login = await verifyAdminLogin('EMP-3004', PASSWORD);
      assert.equal(login.ok, true);
      // Fail CLOSED: unparseable configuration must not be treated as
      // "no constraints", and must not crash the route either.
      assert.equal(await resolveStaff(subjectHashOf(login.subject!)), null);
    },
  );
});

test('the scope a role does not observe is dropped, not honoured', async () => {
  // make-staff.mjs does not ask a state admin for a ward, but a hand-edited
  // directory can still carry one. rbac.inScope treats every present field as
  // a filter, so an ignored-looking extra would quietly confine this admin to
  // one ward of one state.
  const { credEntry, subject } = await provision('EMP-3005');
  const overSpecified = {
    email: subject,
    role: 'state_admin',
    name: 'Meera S.',
    state: 'Delhi',
    district: 'District A',
    department: 'Water Department',
    ward: 'Ward 15',
  };

  await withEnv(
    {
      ADMIN_CREDENTIALS: JSON.stringify([credEntry]),
      STAFF_DIRECTORY: JSON.stringify([overSpecified]),
      SUPER_ADMIN_EMAIL: undefined,
      SUPER_ADMIN_PHONE: undefined,
    },
    async () => {
      const login = await verifyAdminLogin('EMP-3005', PASSWORD);
      const staff = await resolveStaff(subjectHashOf(login.subject!));
      assert.ok(staff);
      assert.equal(staff!.role, 'state_admin');
      assert.deepEqual(staff!.scope, { state: 'Delhi' }, 'scope is a property of the ROLE first');
    },
  );
});

test('employee ids are matched case-insensitively but subjects are not invented', async () => {
  const { credEntry, staffEntry, subject } = await provision('EMP-3006');

  await withEnv(
    {
      ADMIN_CREDENTIALS: JSON.stringify([credEntry]),
      STAFF_DIRECTORY: JSON.stringify([staffEntry]),
      SUPER_ADMIN_EMAIL: undefined,
      SUPER_ADMIN_PHONE: undefined,
    },
    async () => {
      // Someone typing emp-3006 at 6am should get in.
      const login = await verifyAdminLogin('  emp-3006  ', PASSWORD);
      assert.equal(login.ok, true);
      assert.equal(login.subject, subject);
      assert.ok(await resolveStaff(subjectHashOf(login.subject!)));

      // But a near-miss employee id must not.
      const near = await verifyAdminLogin('EMP-30060', PASSWORD);
      assert.equal(near.ok, false);
      assert.equal(near.reason, 'invalid_credentials');
    },
  );
});
