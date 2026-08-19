import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareNames, compareDates, compareAddresses, compareDocNumbers,
  parseDateCandidates, normaliseName, normaliseAddress, jaroWinkler,
} from '../server/matching.js';

/**
 * These tests encode policy, not just behaviour.
 *
 * Each case below is a real situation where getting it wrong has a cost to a
 * person: a rejected application, or a false accusation of a mismatch that
 * sends someone back to a counter for nothing. The assertions are written
 * against the VERDICT rather than the raw score, because the verdict is what
 * the citizen is shown.
 */

// ───────────────────────── names ─────────────────────────

test('identical names match regardless of case, spacing and titles', () => {
  assert.equal(compareNames('RAHUL KUMAR', 'rahul  kumar').verdict, 'match');
  assert.equal(compareNames('Shri Rahul Kumar', 'Rahul Kumar').verdict, 'match');
  assert.equal(compareNames('Dr. Priya  Sharma', 'priya sharma').verdict, 'match');
});

test('an abbreviated middle name is a near match, never a mismatch', () => {
  const r = compareNames('Rahul Kumar Singh', 'Rahul K. Singh');
  assert.equal(r.verdict, 'near_match');
  assert.ok(r.similarity >= 0.88, `similarity was ${r.similarity}`);
  assert.match(r.reason, /initial/i);
});

test('transliteration variants are recognised as the same person', () => {
  assert.ok(['match', 'near_match'].includes(compareNames('Mohammed Iqbal', 'Mohammad Iqbal').verdict));
  assert.ok(['match', 'near_match'].includes(compareNames('Lakshmi Nair', 'Laxmi Nair').verdict));
  assert.ok(['match', 'near_match'].includes(compareNames('Sheikh Abdul', 'Shaikh Abdool').verdict));
});

test('a dropped middle name is not treated as a different person', () => {
  const r = compareNames('Ramesh Chandra Verma', 'Ramesh Verma');
  assert.ok(['near_match', 'review'].includes(r.verdict), `got ${r.verdict}`);
});

test('genuinely different names are reported as mismatches', () => {
  assert.equal(compareNames('Rahul Kumar', 'Suresh Reddy').verdict, 'mismatch');
  assert.equal(compareNames('Anita Sharma', 'Kavita Joshi').verdict, 'mismatch');
});

test('similar-but-different names are sent for review rather than auto-accepted', () => {
  const r = compareNames('Krishnan Pillai', 'Kishore Pillai');
  assert.ok(['review', 'mismatch'].includes(r.verdict), `got ${r.verdict}`);
});

test('a missing value never produces a mismatch verdict', () => {
  assert.equal(compareNames('Rahul Kumar', '').verdict, 'missing');
  assert.equal(compareNames(null, null).verdict, 'missing');
});

test('normalisation output is exposed so the citizen can see what was compared', () => {
  const r = compareNames('Shri  RAHUL   Kumar', 'rahul kumar');
  assert.equal(r.normalisedA, 'rahul kumar');
  assert.equal(r.normalisedB, 'rahul kumar');
});

// ───────────────────────── dates ─────────────────────────

test('an ambiguous numeric date yields both readings', () => {
  const c = parseDateCandidates('12/03/2001');
  assert.equal(c.length, 2);
  assert.deepEqual(c.map(x => x.iso).sort(), ['2001-03-12', '2001-12-03']);
});

test('an ISO date is unambiguous and yields exactly one reading', () => {
  const c = parseDateCandidates('2001-03-12');
  assert.equal(c.length, 1);
  assert.equal(c[0].convention, 'YMD');
});

test('named months parse in either order', () => {
  assert.equal(parseDateCandidates('12 March 2001')[0].iso, '2001-03-12');
  assert.equal(parseDateCandidates('March 12, 2001')[0].iso, '2001-03-12');
  assert.equal(parseDateCandidates('12-Mar-2001')[0].iso, '2001-03-12');
});

test('the same date written two ways is a match, not a discrepancy', () => {
  assert.equal(compareDates('12/03/2001', '2001-03-12').verdict, 'match');
  assert.equal(compareDates('12 March 2001', '12/03/2001').verdict, 'match');
});

test('a day/month swap is flagged as ambiguous and NEVER silently resolved', () => {
  const r = compareDates('12/03/2001', '03/12/2001');
  assert.equal(r.verdict, 'ambiguous_format');
  // The whole point: it must not pick a winner.
  assert.match(r.reason, /cannot tell which/i);
  assert.doesNotMatch(r.reason, /is correct|should be/i);
});

test('the swap message quotes the actual values rather than saying "these two documents"', () => {
  // With four documents on screen and one conflicting pair, "these two
  // documents" is unreadable - the reader cannot tell which two.
  const r = compareDates('12/03/2001', '03/12/2001');
  assert.match(r.reason, /12\/03\/2001/);
  assert.match(r.reason, /03\/12\/2001/);
  assert.doesNotMatch(r.reason, /these two documents/i);
});

test('genuinely different dates are a mismatch and say how far apart', () => {
  const r = compareDates('12 March 2001', '21 March 2001');
  assert.equal(r.verdict, 'mismatch');
  assert.match(r.reason, /9 days apart/);
});

test('two-digit years use a documented cutoff rather than guessing', () => {
  assert.equal(parseDateCandidates('12/03/01')[0].iso.slice(0, 4), '2001');
  assert.equal(parseDateCandidates('12/03/85')[0].iso.slice(0, 4), '1985');
});

test('an unreadable date is sent for human review, not scored as a mismatch', () => {
  assert.equal(compareDates('sometime in 2001', '2001-03-12').verdict, 'review');
});

// ───────────────────────── addresses ─────────────────────────

test('address abbreviations are expanded before comparison', () => {
  assert.equal(normaliseAddress('Sec 14, MG Rd'), 'sector 14 mg road');
  assert.equal(compareAddresses('Sec 14, M.G. Rd', 'Sector 14, MG Road').verdict, 'match');
});

test('reordered address components still match', () => {
  const r = compareAddresses('Sector 14, Dwarka, New Delhi 110078', 'Dwarka, New Delhi, Sector 14 110078');
  assert.ok(['match', 'near_match'].includes(r.verdict), `got ${r.verdict}`);
});

test('a different PIN code is a mismatch whatever else matches', () => {
  const r = compareAddresses('Sector 14, Dwarka, New Delhi 110078', 'Sector 14, Dwarka, New Delhi 110075');
  assert.equal(r.verdict, 'mismatch');
  assert.match(r.reason, /PIN/);
});

// ───────────────────────── document numbers ─────────────────────────

test('document numbers ignore separators and case', () => {
  assert.equal(compareDocNumbers('ABCDE-1234-F', 'abcde1234f').verdict, 'match');
  assert.equal(compareDocNumbers('1234 5678 9012', '123456789012').verdict, 'match');
});

test('one differing digit is review, never near_match — an ID is not a name', () => {
  const r = compareDocNumbers('123456789012', '123456789013');
  assert.equal(r.verdict, 'review');
  assert.match(r.reason, /one character/i);
});

test('materially different ID numbers are a mismatch', () => {
  assert.equal(compareDocNumbers('ABCDE1234F', 'ZZZZZ9999Z').verdict, 'mismatch');
});

// ───────────────────────── similarity primitives ─────────────────────────

test('jaro-winkler rewards a shared prefix, which is what separates a variant from a different name', () => {
  const variant = jaroWinkler('krishnan', 'krishna');
  const different = jaroWinkler('krishnan', 'kishore');
  assert.ok(variant > different, `${variant} should exceed ${different}`);
  assert.ok(variant > 0.9);
});

test('normaliseName strips diacritics', () => {
  assert.equal(normaliseName('Nāir'), 'nair');
});
