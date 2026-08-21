#!/usr/bin/env node
/**
 * Provision one staff member for the admin portal.
 *
 *   npm run staff:new        (or: npx tsx scripts/make-staff.mjs)
 *
 * Run under tsx, not bare node: it imports the same hashing code the server
 * uses, so the hash it prints can never drift from the hash the server
 * verifies.
 *
 * Creating a staff account needs TWO environment variables to agree:
 *
 *   STAFF_DIRECTORY    grants the role, department, district and ward
 *   ADMIN_CREDENTIALS  holds the employee ID and password hash
 *
 * They are joined by `subject`. Get it wrong and the failure is quiet and
 * baffling: the password works, a session is issued, and the person lands on
 * the citizen portal with no role — because authentication succeeded and
 * authorisation found nobody. That is the correct behaviour (proving who you
 * are is not the same as being granted anything), but it is a miserable thing
 * to debug from two hand-edited JSON blobs.
 *
 * So this script emits BOTH entries from one set of answers, with a subject
 * derived from the employee ID. They cannot disagree.
 *
 * Nothing is written to disk and the password is never echoed.
 */
import { hashPassword } from '../server/adminAuth.ts';
import { makeAsker, askNewPassword } from './lib/prompt.mjs';

const ROLES = [
  ['super_admin', 'everything, nationwide'],
  ['state_admin', 'one state'],
  ['district_admin', 'one district'],
  ['department_officer', 'one department, statewide'],
  ['area_officer', 'one department + district + ward'],
  ['field_officer', 'only complaints assigned to them personally'],
  ['auditor', 'read-only, nationwide'],
];

const { ask, close: closeAsker } = makeAsker();

console.log('\nProvision a CivicAI staff account\n');
console.log('Roles:');
for (const [id, desc] of ROLES) console.log(`  ${id.padEnd(20)} ${desc}`);
console.log('');

const role = await ask('Role');
if (!ROLES.some(([id]) => id === role)) {
  console.error(`\nUnknown role "${role}".`);
  closeAsker();
  process.exit(1);
}

const employeeId = await ask('Employee ID (what they type at /admin/login)', 'EMP-1000');
const name = await ask('Full name');

// Scope questions, asked only where the role actually observes them. Asking
// for a ward when provisioning a state admin invites someone to fill it in,
// and server/staff.ts would then discard it — leaving the operator convinced
// they configured something they did not.
const needsState = role !== 'super_admin' && role !== 'auditor' && role !== 'field_officer';
const needsDistrict = role === 'district_admin' || role === 'area_officer';
const needsDepartment = role === 'department_officer' || role === 'area_officer';
const needsWard = role === 'area_officer';

const state = needsState ? await ask('State', 'Delhi') : '';
const district = needsDistrict ? await ask('District') : '';
const department = needsDepartment ? await ask('Department (exact name, e.g. "Electricity Board")') : '';
const ward = needsWard ? await ask('Ward / local area (e.g. "Ward 12")') : '';

// Closed BEFORE the password prompts: readline keeps its own listener on
// stdin and would echo the keystrokes askNewPassword is trying to hide.
closeAsker();

const password = await askNewPassword();

/*
 * The join key. Synthetic and derived from the employee ID rather than asking
 * for a real email: it never receives mail, it only has to be stable and
 * identical in both entries, and inventing one here removes the single most
 * common way to get this wrong.
 */
const subject = `${employeeId.toLowerCase()}@staff.civicai.local`;

const staffEntry = { email: subject, role, name };
if (state) staffEntry.state = state;
if (district) staffEntry.district = district;
if (department) staffEntry.department = department;
if (ward) staffEntry.ward = ward;

const credEntry = { employeeId, subject, passwordHash: await hashPassword(password) };

console.log(`
─────────────────────────────────────────────────────────────
1. Append to STAFF_DIRECTORY  (grants the role and scope)
─────────────────────────────────────────────────────────────
${JSON.stringify(staffEntry, null, 2)}

─────────────────────────────────────────────────────────────
2. Append to ADMIN_CREDENTIALS  (the password)
─────────────────────────────────────────────────────────────
${JSON.stringify(credEntry, null, 2)}

─────────────────────────────────────────────────────────────
Both are JSON ARRAYS. Add each object to the existing array for
its variable — do not replace the whole value with one object.

Both are SERVER-side. Never prefix either with VITE_, which
would compile them into the browser bundle.

${name} then signs in at /admin/login with employee ID
"${employeeId}" and the password you just set.
─────────────────────────────────────────────────────────────
`);
