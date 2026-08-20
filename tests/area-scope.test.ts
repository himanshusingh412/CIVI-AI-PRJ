import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inScope, visibleTo, can, type Principal } from '../server/rbac.js';

/**
 * Local-area (ward) isolation.
 *
 * Companion to rbac.test.ts, same house style: every case is written as the
 * ATTACK rather than the happy path, because "ward filtering works" is not
 * the property worth protecting — "a Ward 12 officer cannot read Ward 15"
 * is.
 *
 * Ward is the dimension most likely to regress silently. The three coarser
 * constraints (state, district, department) usually differ from each other
 * in test data, so a bug that drops one of them still gets caught by the
 * others. Ward is the opposite: the realistic case is two officers who match
 * on state AND district AND department and differ ONLY by ward. If ward
 * stops being enforced, every assertion that isn't specifically about ward
 * still passes. Hence the deliberate fixture design below.
 */

const officer = (scope: Principal['scope']): Principal =>
  ({ id: 'test-area', role: 'area_officer', scope, displayName: 'Area Officer' });

// ───────── the exact fixture from the spec ─────────
// Electricity and Water are pinned to the SAME state and district on
// purpose. The only thing separating them is ward, so these two officers
// are the load-bearing part of this file: if ward enforcement disappears,
// they see each other's work and the cross-department assertions alone
// would not reveal it.
const ELECTRICITY = officer({ state: 'Delhi', district: 'District A', department: 'Electricity Board', ward: 'Ward 12' });
const WATER       = officer({ state: 'Delhi', district: 'District A', department: 'Water Department',  ward: 'Ward 15' });
const TRANSPORT   = officer({ state: 'Delhi', district: 'District B', department: 'Transport Department', ward: 'Ward 4' });

const SUPER: Principal = { id: 'test-super', role: 'super_admin', scope: {}, displayName: 'Super Admin' };

const cElectricity = { state: 'Delhi', district: 'District A', department: 'Electricity Board',     ward: 'Ward 12' };
const cWater       = { state: 'Delhi', district: 'District A', department: 'Water Department',      ward: 'Ward 15' };
const cTransport   = { state: 'Delhi', district: 'District B', department: 'Transport Department',  ward: 'Ward 4'  };

/** Electricity, right department and district, WRONG ward. */
const cElectricityOtherWard = { state: 'Delhi', district: 'District A', department: 'Electricity Board', ward: 'Ward 99' };
/** Electricity, right department and ward, WRONG district. */
const cElectricityOtherDistrict = { state: 'Delhi', district: 'District B', department: 'Electricity Board', ward: 'Ward 12' };

const ALL = [cElectricity, cWater, cTransport, cElectricityOtherWard, cElectricityOtherDistrict];

// ───────────────────────── TEST 1 (spec §26) ─────────────────────────

test('the electricity area officer sees their own ward and nothing else', () => {
  assert.equal(inScope(ELECTRICITY, cElectricity), true, 'own department + district + ward must be visible');

  assert.equal(inScope(ELECTRICITY, cWater), false, 'water complaint must be hidden from an electricity officer');
  assert.equal(inScope(ELECTRICITY, cTransport), false, 'transport complaint must be hidden');
  assert.equal(inScope(ELECTRICITY, cElectricityOtherDistrict), false, 'same department in another district must be hidden');
  assert.equal(inScope(ELECTRICITY, cElectricityOtherWard), false, 'same department and district in another ward must be hidden');

  assert.deepEqual(visibleTo(ELECTRICITY, ALL), [cElectricity]);
});

test('the water area officer sees water only, though they share a district with electricity', () => {
  assert.equal(inScope(WATER, cWater), true);
  assert.equal(inScope(WATER, cElectricity), false, 'electricity must be hidden despite the shared district');
  assert.deepEqual(visibleTo(WATER, ALL), [cWater]);
});

test('the transport area officer is confined to their own district as well as their ward', () => {
  assert.equal(inScope(TRANSPORT, cTransport), true);
  assert.deepEqual(visibleTo(TRANSPORT, ALL), [cTransport]);
});

test('a super admin still sees every complaint across all wards', () => {
  assert.deepEqual(visibleTo(SUPER, ALL), ALL);
});

// ───────────────────── fail-closed / misconfiguration ─────────────────────

test('an area officer with no ward assigned sees nothing, rather than everything', () => {
  // The dangerous reading of "local-area officer with no local area" is the
  // wildcard one: an empty constraint matches every record, which would
  // silently promote a misconfigured ward officer to department-wide reach.
  // A missing posting must fail closed.
  const unposted = officer({ state: 'Delhi', district: 'District A', department: 'Electricity Board' });
  assert.equal(inScope(unposted, cElectricity), false);
  assert.deepEqual(visibleTo(unposted, ALL), []);
});

test('a complaint with no ward yet is invisible to area officers but not to their seniors', () => {
  // Un-warded complaints are the normal state of a brand new report. They
  // must not leak into a ward queue on a technicality, and must remain
  // reachable by the district staff whose job is to triage them.
  const untriaged = { state: 'Delhi', district: 'District A', department: 'Electricity Board' };
  assert.equal(inScope(ELECTRICITY, untriaged), false, 'no ward set → not yet in any ward officer’s queue');

  const districtAdmin: Principal = {
    id: 'test-dm', role: 'district_admin',
    scope: { state: 'Delhi', district: 'District A' }, displayName: 'DM',
  };
  assert.equal(inScope(districtAdmin, untriaged), true, 'district staff must still be able to triage it');
});

// ───────────────── no regression for the pre-existing roles ─────────────────

test('roles above ward level are unaffected by the new dimension', () => {
  // Adding a constraint to the model must not accidentally narrow the roles
  // that were never supposed to observe it.
  const districtAdmin: Principal = {
    id: 'test-dm', role: 'district_admin',
    scope: { state: 'Delhi', district: 'District A' }, displayName: 'DM',
  };
  // Sees both wards in their district, across departments.
  assert.deepEqual(
    visibleTo(districtAdmin, ALL),
    [cElectricity, cWater, cElectricityOtherWard],
  );

  const deptOfficer: Principal = {
    id: 'test-do', role: 'department_officer',
    scope: { state: 'Delhi', department: 'Electricity Board' }, displayName: 'DO',
  };
  // Sees their department in every ward and district of their state.
  assert.deepEqual(
    visibleTo(deptOfficer, ALL),
    [cElectricity, cElectricityOtherWard, cElectricityOtherDistrict],
  );
});

test('an area officer may move work forward but may not close a case', () => {
  // Closure requires citizen confirmation; no field-level role gets to
  // declare its own work finished.
  assert.equal(can(ELECTRICITY, 'complaint:update_status'), true);
  assert.equal(can(ELECTRICITY, 'complaint:assign'), true);
  assert.equal(can(ELECTRICITY, 'complaint:note'), true);
  assert.equal(can(ELECTRICITY, 'complaint:close'), false, 'area officers must not close cases');
  assert.equal(can(ELECTRICITY, 'user:manage'), false);
  assert.equal(can(ELECTRICITY, 'audit:read'), false);
});
