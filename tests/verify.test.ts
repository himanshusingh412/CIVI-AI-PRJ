import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyDocuments, type VerifiableDocument } from '../server/verify.js';
import { EMPTY_FIELDS } from '../server/ocr.js';

/**
 * The verification report, end to end.
 *
 * matching.test.ts checks the arithmetic. These check the JUDGEMENT: what
 * gets escalated to blocking, what gets filed under "most departments accept
 * this", and — most importantly — what the report refuses to conclude.
 *
 * No AI provider is configured under test, so `narrate` takes its
 * deterministic fallback path. That is deliberate: the report has to be
 * correct and readable without a model, because in production the model is
 * sometimes down.
 */

const doc = (
  id: string,
  label: string,
  fields: Partial<typeof EMPTY_FIELDS>,
  documentType: VerifiableDocument['documentType'] = 'identity_card',
): VerifiableDocument => ({
  id, label, documentType,
  fields: { ...EMPTY_FIELDS, ...fields },
  confidence: 1, simulated: false,
});

test('a single document cannot be verified against anything', async () => {
  const r = await verifyDocuments([doc('a', 'Aadhaar', { name: 'Rahul Kumar' })]);
  assert.equal(r.overall, 'insufficient');
  assert.equal(r.findings.length, 0);
  assert.match(r.summary, /at least two/i);
});

test('documents that agree are reported as consistent, NOT as approved', async () => {
  const r = await verifyDocuments([
    doc('a', 'Aadhaar', { name: 'Rahul Kumar Singh', dob: '12/03/2001' }),
    doc('b', 'Voter ID', { name: 'Rahul Kumar Singh', dob: '12/03/2001' }, 'voter_id'),
  ]);
  assert.equal(r.overall, 'verified');
  // The distinction this product must never blur.
  assert.match(r.summary, /does not guarantee approval/i);
  assert.doesNotMatch(r.summary, /approved|accepted|eligible/i);
});

test('a date-of-birth swap is critical and blocks', async () => {
  const r = await verifyDocuments([
    doc('a', 'Aadhaar', { dob: '12/03/2001' }),
    doc('b', 'PAN', { dob: '03/12/2001' }, 'pan_card'),
  ]);
  assert.equal(r.overall, 'action_required');
  const dob = r.findings.find(f => f.field === 'dob');
  assert.equal(dob?.severity, 'critical');
  assert.equal(dob?.requiresUserAction, true);
  // It must not pick a winner.
  assert.match(dob!.recommendation, /cannot tell you which one is wrong/i);
});

test('a third document with a spelled-out month corroborates the reading', async () => {
  const r = await verifyDocuments([
    doc('a', 'Aadhaar', { dob: '12/03/2001' }),
    doc('b', 'PAN', { dob: '03/12/2001' }, 'pan_card'),
    doc('c', 'Class X Marksheet', { dob: '12 March 2001' }, 'educational_certificate'),
  ]);
  const dob = r.findings.find(f => f.field === 'dob');
  assert.ok(dob?.corroboration, 'a corroborating document should have been found');
  assert.match(dob!.corroboration!, /12 March 2001/);
  // Still not resolved — evidence, not a verdict.
  assert.equal(dob?.severity, 'critical');
});

test('an abbreviated name is informational, not blocking', async () => {
  const r = await verifyDocuments([
    doc('a', 'Aadhaar', { name: 'Rahul Kumar Singh' }),
    doc('b', 'PAN', { name: 'Rahul K. Singh' }, 'pan_card'),
  ]);
  assert.equal(r.overall, 'verified');
  assert.equal(r.findings.find(f => f.field === 'name')?.severity, 'info');
});

test('a different address is a warning, not a critical - people move house', async () => {
  const r = await verifyDocuments([
    doc('a', 'Aadhaar', { address: 'Sector 14, Dwarka, New Delhi 110078' }),
    doc('b', 'Driving Licence', { address: 'Sector 9, Rohini, New Delhi 110085' }, 'driving_licence'),
  ]);
  assert.equal(r.overall, 'review_recommended');
  const addr = r.findings.find(f => f.field === 'address');
  assert.equal(addr?.severity, 'warning');
  assert.match(addr!.recommendation, /if you have moved/i);
});

test('a different name IS critical - that is an identity question', async () => {
  const r = await verifyDocuments([
    doc('a', 'Aadhaar', { name: 'Rahul Kumar' }),
    doc('b', 'PAN', { name: 'Suresh Reddy' }, 'pan_card'),
  ]);
  assert.equal(r.overall, 'action_required');
  assert.equal(r.findings.find(f => f.field === 'name')?.severity, 'critical');
});

test('document numbers are not compared across different document types', async () => {
  // A PAN number and an Aadhaar number are SUPPOSED to be different.
  // Comparing them would produce a permanent false mismatch on every user.
  const r = await verifyDocuments([
    doc('a', 'Aadhaar', { documentNumber: '4321 8765 2109' }),
    doc('b', 'PAN', { documentNumber: 'BKJPS4321M' }, 'pan_card'),
  ]);
  assert.equal(r.findings.find(f => f.field === 'documentNumber'), undefined);
  assert.equal(r.overall, 'verified');
});

test('the same document type WITH different numbers is reported', async () => {
  const r = await verifyDocuments([
    doc('a', 'PAN (old copy)', { documentNumber: 'BKJPS4321M' }, 'pan_card'),
    doc('b', 'PAN (new copy)', { documentNumber: 'ZZZZZ9999Z' }, 'pan_card'),
  ]);
  const num = r.findings.find(f => f.field === 'documentNumber');
  assert.ok(num, 'same-type numbers should be compared');
  assert.equal(num?.severity, 'warning');
});

test('a field only one document carries is not reported at all', async () => {
  // Otherwise the two real findings drown under eight "only one document has
  // this" rows.
  const r = await verifyDocuments([
    doc('a', 'Aadhaar', { name: 'Rahul Kumar', motherName: 'Sunita Devi' }),
    doc('b', 'PAN', { name: 'Rahul Kumar' }, 'pan_card'),
  ]);
  assert.equal(r.findings.find(f => f.field === 'motherName'), undefined);
});

test('findings are ordered worst first', async () => {
  const r = await verifyDocuments([
    doc('a', 'Aadhaar', {
      name: 'Rahul Kumar Singh', dob: '12/03/2001',
      address: 'Sector 14, Dwarka, New Delhi 110078',
    }),
    doc('b', 'PAN', {
      name: 'Rahul K. Singh', dob: '03/12/2001',
      address: 'Sector 9, Rohini, New Delhi 110085',
    }, 'pan_card'),
  ]);
  const rank = { critical: 0, warning: 1, info: 2, ok: 3 } as const;
  const order = r.findings.map(f => rank[f.severity]);
  assert.deepEqual(order, [...order].sort((x, y) => x - y), 'severities must be non-decreasing');
  assert.equal(r.findings[0].severity, 'critical');
});

test('a simulated document is flagged all the way through to the report', async () => {
  const r = await verifyDocuments([
    { ...doc('a', 'Aadhaar', { name: 'Rahul Kumar' }), simulated: true },
    doc('b', 'PAN', { name: 'Rahul Kumar' }, 'pan_card'),
  ]);
  assert.equal(r.simulated, true);
});

test('the fallback narration does not call a spelling variant a problem', async () => {
  const r = await verifyDocuments([
    doc('a', 'Aadhaar', { name: 'Rahul Kumar Singh' }),
    doc('b', 'PAN', { name: 'Rahul K. Singh' }, 'pan_card'),
  ]);
  // An earlier version said "1 field differs", which reads as a problem and
  // sends someone to a government office over nothing.
  assert.match(r.aiExplanation ?? '', /minor spelling differences/i);
  assert.equal(r.aiSuggestions.length, 0);
});

test('no recommendation ever tells the citizen to alter a document', async () => {
  const r = await verifyDocuments([
    doc('a', 'Aadhaar', { name: 'Rahul Kumar', dob: '12/03/2001', address: 'A road, Delhi 110078' }),
    doc('b', 'PAN', { name: 'Suresh Reddy', dob: '03/12/2001', address: 'B road, Delhi 110085' }, 'pan_card'),
  ]);
  for (const f of r.findings) {
    assert.doesNotMatch(f.recommendation, /\b(edit|alter|change the document|forge|amend it yourself)\b/i,
      `${f.label} recommended altering a document`);
  }
});
