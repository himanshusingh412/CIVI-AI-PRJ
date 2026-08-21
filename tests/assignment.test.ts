import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignableOfficers, resolveAssignee, _demoOfficers } from '../server/officers.js';
import type { Principal } from '../server/rbac.js';

/**
 * Assignment authorisation.
 *
 * Assignment is not merely routing in this system — it GRANTS ACCESS.
 * rbac.inScope() lets a field officer read complaints where
 * `assignedOfficerId` matches their scope, so writing an officer id onto a
 * complaint hands that complaint to whoever holds the id. The endpoint used
 * to take both the id and the display name straight from the request body
 * with no validation of either, which made "assign" an unaudited
 * permission-granting operation.
 *
 * These tests are written as the attack, matching rbac.test.ts.
 *
 * The demo roster is only populated outside production with demo mode on;
 * both hold under `npm test`, and the assertion below fails loudly rather
 * than letting every case pass vacuously against an empty roster.
 */

const superAdmin: Principal = {
  id: 'test-super', role: 'super_admin', scope: {}, displayName: 'Super Admin',
};

const elecWard12: Principal = {
  id: 'test-elec', role: 'area_officer', displayName: 'Electricity Ward 12',
  scope: { state: 'Delhi', district: 'District A', department: 'Electricity Board', ward: 'Ward 12' },
};

const waterWard15: Principal = {
  id: 'test-water', role: 'area_officer', displayName: 'Water Ward 15',
  scope: { state: 'Delhi', district: 'District A', department: 'Water Department', ward: 'Ward 15' },
};

/** The Ward 12 electricity complaint the demo seed creates. */
const elecComplaint = {
  state: 'Delhi', district: 'District A', department: 'Electricity Board', ward: 'Ward 12',
};

test('the demo roster is actually populated (guards against vacuous passes)', async () => {
  const all = await assignableOfficers(superAdmin);
  assert.ok(all.length >= 4, `expected a populated roster, got ${all.length}`);
});

// ───────────────────── the directory is scope-filtered ─────────────────────

test('an area officer is only offered officers from their own ward', async () => {
  const offered = await assignableOfficers(elecWard12);
  assert.ok(offered.length > 0, 'should be offered at least their own ward colleagues');
  for (const o of offered) {
    assert.equal(o.department, 'Electricity Board');
    assert.equal(o.district, 'District A');
    assert.equal(o.ward, 'Ward 12');
  }
  // Water's Ward 15 officer shares a district and must still be absent —
  // that pairing is what proves ward is doing the filtering.
  assert.ok(!offered.some(o => o.id === 'off-water-15'));
});

test('inactive officers are never offered', async () => {
  const offered = await assignableOfficers(elecWard12);
  assert.ok(
    !offered.some(o => o.id === 'off-elec-12x'),
    'a suspended officer must not appear in an assignment dropdown',
  );
  // …but they DO exist on the roster, so this is a filter, not a gap.
  assert.ok(_demoOfficers.some(o => o.id === 'off-elec-12x'));
});

// ───────────────────────── the endpoint's guard ─────────────────────────

test('a fabricated officer id is refused', async () => {
  const r = await resolveAssignee(superAdmin, 'off-does-not-exist', elecComplaint);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'unknown_officer');
});

test('a suspended officer is refused, and distinguishably so', async () => {
  const r = await resolveAssignee(superAdmin, 'off-elec-12x', elecComplaint);
  assert.equal(r.ok, false);
  // A different reason from "unknown": the operator needs to tell
  // "you typed the wrong id" apart from "that person is on leave".
  assert.equal(r.reason, 'inactive_officer');
});

test('an admin cannot assign to an officer outside their own scope', async () => {
  // The Water/Ward 15 officer tries to hand work to an Electricity/Ward 12
  // officer. Both are real and active; the assigner simply may not reach them.
  const r = await resolveAssignee(waterWard15, 'off-elec-12', elecComplaint);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'out_of_scope');
});

test('a wide-scoped admin still cannot assign an officer who does not cover the complaint', async () => {
  // Super admin may reach everyone, so the ASSIGNER check passes — this is
  // the second guard: the officer must actually cover the complaint. Without
  // it a Ward 12 electricity fault could be handed to a Ward 4 transport
  // officer: authorised, but nonsense, and it would then disappear from the
  // queue of everyone able to act on it.
  const r = await resolveAssignee(superAdmin, 'off-trans-4', elecComplaint);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'out_of_scope');
});

test('a valid in-ward officer resolves, and the name comes from the roster', async () => {
  const r = await resolveAssignee(superAdmin, 'off-elec-12', elecComplaint);
  assert.equal(r.ok, true);
  assert.equal(r.officer?.id, 'off-elec-12');
  // The display name is READ, never accepted from the caller — the endpoint
  // no longer takes officerName from the request body at all.
  assert.equal(r.officer?.name, 'Ravi Chandra');
  assert.equal(r.officer?.employeeId, 'EMP-2012');
});
