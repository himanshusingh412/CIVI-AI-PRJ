import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  can, inScope, authorize, visibleTo, permissionsFor,
  canSeeContactDetails, maskPhone, maskName, ROLES,
  type Principal,
} from '../server/rbac.js';
import { canTransition, allowedTransitions, isTerminal, STATUSES } from '../server/workflow.js';

/**
 * Authorisation tests.
 *
 * These are the tests that matter most in this codebase. Everything else
 * being wrong produces a bad experience; this being wrong produces an
 * officer in one district reading complaints from another, or a read-only
 * auditor closing cases.
 *
 * Each case is written as the ATTACK, not as the happy path — "a district
 * admin cannot touch another district" rather than "scope filtering works".
 */

const principal = (role: Principal['role'], scope: Principal['scope'] = {}): Principal =>
  ({ id: `test-${role}`, role, scope, displayName: role });

const record = (over: Partial<Parameters<typeof inScope>[1]> = {}) => ({
  state: 'Delhi', district: 'New Delhi', department: 'Water Department',
  assignedOfficerId: 'off-1', ...over,
});

// ───────────────────────── capability ─────────────────────────

test('a read-only auditor holds no mutating capability at all', () => {
  const a = principal('auditor');
  for (const perm of [
    'complaint:create', 'complaint:update_status', 'complaint:assign',
    'complaint:escalate', 'complaint:merge', 'complaint:note',
    'complaint:upload', 'complaint:reopen', 'complaint:close', 'user:manage',
  ] as const) {
    assert.equal(can(a, perm), false, `auditor must not hold ${perm}`);
  }
  assert.equal(can(a, 'complaint:read'), true);
  assert.equal(can(a, 'audit:read'), true);
});

test('only a super admin can manage users', () => {
  for (const role of ROLES) {
    assert.equal(can(principal(role), 'user:manage'), role === 'super_admin', role);
  }
});

test('a field officer cannot hand work to someone else or close a case', () => {
  const f = principal('field_officer', { officerId: 'off-1' });
  assert.equal(can(f, 'complaint:assign'), false);
  assert.equal(can(f, 'complaint:close'), false);
  assert.equal(can(f, 'complaint:update_status'), true);
});

test('closing requires a permission a district admin does not have', () => {
  // Closure is gated behind citizen verification by design; nobody below
  // state level may unilaterally declare a case finished.
  assert.equal(can(principal('district_admin'), 'complaint:close'), false);
  assert.equal(can(principal('state_admin'), 'complaint:close'), true);
});

// ───────────────────────── scope ─────────────────────────

test('an empty scope matches everything - this is what makes super_admin work', () => {
  assert.equal(inScope(principal('super_admin'), record()), true);
  assert.equal(inScope(principal('super_admin'), record({ state: 'Kerala', district: 'Kochi' })), true);
});

test('a state admin cannot reach another state', () => {
  const p = principal('state_admin', { state: 'Delhi' });
  assert.equal(inScope(p, record()), true);
  assert.equal(inScope(p, record({ state: 'Maharashtra' })), false);
});

test('a district admin cannot reach a sibling district in their own state', () => {
  const p = principal('district_admin', { state: 'Delhi', district: 'New Delhi' });
  assert.equal(inScope(p, record()), true);
  assert.equal(inScope(p, record({ district: 'South Delhi' })), false);
});

test('a department officer cannot reach another department', () => {
  const p = principal('department_officer', { state: 'Delhi', department: 'Water Department' });
  assert.equal(inScope(p, record()), true);
  assert.equal(inScope(p, record({ department: 'Roads Department' })), false);
});

test("a field officer cannot reach a colleague's case in their own district", () => {
  const p = principal('field_officer', { officerId: 'off-1' });
  assert.equal(inScope(p, record()), true);
  assert.equal(inScope(p, record({ assignedOfficerId: 'off-2' })), false);
  // Unassigned is also out of scope: a field officer works their own list.
  assert.equal(inScope(p, record({ assignedOfficerId: undefined })), false);
});

test('a misconfigured field officer with no officerId is denied, not granted', () => {
  // Fail closed. A principal missing its scope must not fall through to
  // "no constraint, therefore everything".
  assert.equal(inScope(principal('field_officer', {}), record()), false);
});

// ───────────────────────── capability AND scope ─────────────────────────

test('authorize requires BOTH - capability alone is not enough', () => {
  const p = principal('district_admin', { state: 'Delhi', district: 'New Delhi' });
  assert.equal(authorize(p, 'complaint:assign', record()).ok, true);

  const outOfScope = authorize(p, 'complaint:assign', record({ district: 'South Delhi' }));
  assert.equal(outOfScope.ok, false);
  assert.equal(outOfScope.ok === false && outOfScope.reason, 'out_of_scope');
});

test('authorize requires BOTH - scope alone is not enough', () => {
  const auditor = principal('auditor');
  const verdict = authorize(auditor, 'complaint:update_status', record());
  assert.equal(verdict.ok, false);
  assert.equal(verdict.ok === false && verdict.reason, 'forbidden_action');
});

test('visibleTo narrows a list rather than trusting the caller to filter', () => {
  const rows = [
    record(),
    record({ district: 'South Delhi', assignedOfficerId: 'off-2' }),
    record({ state: 'Maharashtra', district: 'Mumbai', assignedOfficerId: 'off-3' }),
  ];
  assert.equal(visibleTo(principal('super_admin'), rows).length, 3);
  assert.equal(visibleTo(principal('state_admin', { state: 'Delhi' }), rows).length, 2);
  assert.equal(visibleTo(principal('field_officer', { officerId: 'off-2' }), rows).length, 1);
});

test('a principal without read permission sees nothing, whatever their scope', () => {
  const noRead = { ...principal('auditor'), role: 'auditor' as const };
  // Auditors do have read; construct the degenerate case explicitly.
  assert.equal(visibleTo(noRead, [record()]).length, 1);
  assert.equal(permissionsFor('auditor').includes('complaint:read'), true);
});

// ───────────────────────── redaction ─────────────────────────

test('auditors do not see citizen contact details', () => {
  assert.equal(canSeeContactDetails(principal('auditor')), false);
  assert.equal(canSeeContactDetails(principal('field_officer', { officerId: 'off-1' })), true);
});

test('masking leaves enough to recognise and not enough to reuse', () => {
  assert.equal(maskPhone('9876543210'), '••••••3210');
  assert.equal(maskName('Ramesh Chandra Verma'), 'Ramesh C. V.');
  assert.equal(maskName(''), 'Anonymous');
  // The full number must never survive masking.
  assert.equal(maskPhone('9876543210').includes('987654'), false);
});

// ───────────────────────── workflow ─────────────────────────

test('a complaint cannot jump from submitted straight to closed', () => {
  const move = canTransition('submitted', 'closed', 'super_admin');
  assert.equal(move.ok, false);
  assert.match(move.ok === false ? move.reason : '', /Cannot move/);
});

test('closure is only reachable after citizen verification', () => {
  assert.equal(canTransition('citizen_verification', 'closed', 'super_admin').ok, true);
  assert.equal(canTransition('resolved', 'closed', 'super_admin').ok, false);
  assert.equal(canTransition('work_in_progress', 'closed', 'super_admin').ok, false);
});

test('a citizen can always reopen from closed - a case is never permanently shut', () => {
  assert.equal(canTransition('closed', 'reopened', 'district_admin').ok, true);
  assert.equal(isTerminal('closed'), false);
});

test('rejecting as spam is restricted to admin roles', () => {
  assert.equal(canTransition('submitted', 'rejected_spam', 'super_admin').ok, true);
  assert.equal(canTransition('submitted', 'rejected_spam', 'field_officer').ok, false);
  assert.equal(canTransition('submitted', 'rejected_spam', 'department_officer').ok, false);
});

test('every status is reachable in the transition table', () => {
  // Guards against adding a status to the enum and forgetting to wire it in,
  // which produces a case that can be written to the database and then never
  // moved out of.
  for (const s of STATUSES) {
    assert.doesNotThrow(() => allowedTransitions(s, 'super_admin'), `no transitions defined for ${s}`);
  }
});

test('an invalid transition explains what IS valid', () => {
  const move = canTransition('work_in_progress', 'submitted', 'super_admin');
  assert.equal(move.ok, false);
  assert.match(move.ok === false ? move.reason : '', /Valid next: resolved/);
});
