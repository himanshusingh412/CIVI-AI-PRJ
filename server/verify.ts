import {
  compareNames, compareDates, compareAddresses, compareDocNumbers, compareGeneric,
  parseDateCandidates,
  type FieldComparison, type MatchVerdict,
} from './matching.js';
import { generateJson, Type } from './providers.js';
import { DOCUMENT_LABELS, type DocumentType, type ExtractedFields } from './ocr.js';

/**
 * Cross-document verification: the feature this whole subsystem exists for.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * What it is for
 * ─────────────────────────────────────────────────────────────────────────
 * Government applications in India are commonly rejected weeks after
 * submission because two of the attached documents disagree — usually a
 * name spelled differently or a date of birth in the other convention. The
 * citizen finds out by post, has already paid the fee and taken the day off,
 * and starts again. The information needed to prevent that was sitting in
 * their own hands the whole time.
 *
 * So this runs BEFORE submission and answers one question: is there anything
 * in these documents that will get this application refused?
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Three rules it will not break
 * ─────────────────────────────────────────────────────────────────────────
 *  1. It never edits a document. Not the file, not the extracted values.
 *     Every output is advice addressed to the citizen.
 *  2. It never decides which of two conflicting values is correct. It says
 *     they conflict and hands the judgement to the person who knows.
 *  3. It never says "verified" to mean "this application will be accepted".
 *     It has checked internal consistency; it has not checked eligibility,
 *     authenticity, or anything the department will actually look at.
 */

export type Severity = 'ok' | 'info' | 'warning' | 'critical';

/**
 * "A, B and C" rather than "A and B and C". Small, but this text is read by
 * someone under stress about their paperwork, and stacked conjunctions make
 * a sentence bounce.
 */
function listJoin(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export type VerifiableDocument = {
  id: string;
  label: string;
  documentType: DocumentType;
  fields: ExtractedFields;
  confidence: number;
  simulated: boolean;
  error?: string;
};

export type FieldFinding = {
  field: keyof ExtractedFields;
  label: string;
  severity: Severity;
  /** What each document said, side by side. */
  values: Array<{ documentId: string; documentLabel: string; raw: string | null; normalised: string | null }>;
  comparisons: FieldComparison[];
  headline: string;
  recommendation: string;
  /**
   * Evidence from a THIRD document that settles an otherwise unresolvable
   * disagreement. Null when nothing corroborates.
   */
  corroboration: string | null;
  /**
   * Which two documents actually disagree. With four documents listed and
   * one pairwise conflict, "these two documents" is unreadable - the UI needs
   * to name them.
   */
  conflictBetween: { a: string; b: string } | null;
  /** True when the citizen must do something before submitting. */
  requiresUserAction: boolean;
};

export type VerificationReport = {
  overall: 'verified' | 'review_recommended' | 'action_required' | 'insufficient';
  summary: string;
  documents: Array<{
    id: string; label: string; documentType: DocumentType; typeLabel: string;
    confidence: number; simulated: boolean; error?: string;
  }>;
  findings: FieldFinding[];
  /** Optional narrative from the model. Absent when no provider answered. */
  aiExplanation: string | null;
  aiSuggestions: string[];
  provider: string;
  degraded: boolean;
  generatedAt: string;
  /** True when ANY input document was simulated rather than read. */
  simulated: boolean;
};

// ───────────────────────── field policy ─────────────────────────

/**
 * How much a disagreement on each field actually matters.
 *
 * `identity` fields are what a verifying officer uses to decide two documents
 * describe the same human being; a real conflict there stops an application.
 * `mutable` fields legitimately change over a lifetime — people move house,
 * documents are reissued — so a difference is worth noticing and is not by
 * itself a problem.
 */
const FIELD_POLICY: Record<keyof ExtractedFields, {
  label: string;
  kind: 'identity' | 'mutable' | 'metadata';
  compare: (a: string | null, b: string | null) => FieldComparison;
}> = {
  name:             { label: 'Name',                kind: 'identity', compare: (a, b) => compareNames(a, b) },
  dob:              { label: 'Date of birth',       kind: 'identity', compare: (a, b) => compareDates(a, b, 'dob') },
  fatherName:       { label: "Father's name",       kind: 'identity', compare: (a, b) => compareNames(a, b) },
  motherName:       { label: "Mother's name",       kind: 'identity', compare: (a, b) => compareNames(a, b) },
  gender:           { label: 'Gender',              kind: 'identity', compare: (a, b) => compareGeneric('gender', a, b) },
  documentNumber:   { label: 'Document number',     kind: 'metadata', compare: (a, b) => compareDocNumbers(a, b) },
  address:          { label: 'Address',             kind: 'mutable',  compare: (a, b) => compareAddresses(a, b) },
  issueDate:        { label: 'Issue date',          kind: 'metadata', compare: (a, b) => compareDates(a, b, 'issueDate') },
  expiryDate:       { label: 'Expiry date',         kind: 'metadata', compare: (a, b) => compareDates(a, b, 'expiryDate') },
  issuingAuthority: { label: 'Issuing authority',   kind: 'metadata', compare: (a, b) => compareGeneric('issuingAuthority', a, b) },
};

/**
 * Document numbers are the one field where DIFFERENCE IS EXPECTED: a PAN
 * number and an Aadhaar number are supposed to be different, so comparing
 * them across document types is meaningless. They are only compared between
 * two documents of the SAME type (two copies of one certificate, say).
 */
const COMPARE_ONLY_WITHIN_TYPE: ReadonlySet<keyof ExtractedFields> =
  new Set(['documentNumber', 'issueDate', 'expiryDate', 'issuingAuthority']);

function severityFor(field: keyof ExtractedFields, verdicts: MatchVerdict[]): Severity {
  const kind = FIELD_POLICY[field].kind;
  const worst = (v: MatchVerdict) => verdicts.includes(v);

  if (worst('mismatch')) {
    if (kind === 'identity') return 'critical';
    // A different address between an old ID and a new certificate is the
    // normal consequence of moving house, not evidence of a problem.
    return 'warning';
  }
  if (worst('ambiguous_format')) {
    // Unresolvable by the system and consequential if wrong — this is the
    // day/month swap, and it is the single most valuable thing this feature
    // catches. It is never downgraded to "probably fine".
    return kind === 'identity' ? 'critical' : 'warning';
  }
  if (worst('review')) return 'warning';
  if (worst('near_match')) return 'info';
  return 'ok';
}

// ───────────────────────── comparison ─────────────────────────

/**
 * Look for a third document that resolves an ambiguous date.
 *
 * This is the most useful thing the report can say, and the first version
 * missed it entirely. If an Aadhaar says 12/03/2001 and a PAN says
 * 03/12/2001, those two alone cannot be resolved — but a marksheet printed
 * "12 March 2001" settles it, because a spelled-out month has exactly one
 * reading. Telling the citizen "your third document already answers this"
 * turns a scary blocking finding into a two-minute fix.
 *
 * It stops short of declaring the conflict resolved. One corroborating
 * document is strong evidence about which CONVENTION was used; it is not
 * proof that the outlying document is the wrong one, and the citizen is
 * still the one who decides.
 */
function corroborateDate(
  field: keyof ExtractedFields,
  docs: VerifiableDocument[],
): string | null {
  const readings = docs
    .filter(d => d.fields[field]?.trim())
    .map(d => ({ doc: d, candidates: parseDateCandidates(d.fields[field] as string) }));

  const unambiguous = readings.filter(r => r.candidates.length === 1);
  const ambiguous = readings.filter(r => r.candidates.length > 1);
  if (!unambiguous.length || !ambiguous.length) return null;

  // Every unambiguous document must agree, or they are the disagreement.
  const distinct = new Set(unambiguous.map(u => u.candidates[0].iso));
  if (distinct.size !== 1) return null;

  const settled = unambiguous[0].candidates[0].iso;
  const [y, m, d] = settled.split('-').map(Number);
  const pretty = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });

  const supporting = listJoin(unambiguous.map(u => u.doc.label));
  const agreeing = ambiguous.filter(a => a.candidates.some(c => c.iso === settled)).map(a => a.doc.label);
  const conflicting = ambiguous.filter(a => !a.candidates.some(c => c.iso === settled)).map(a => a.doc.label);

  if (conflicting.length) {
    return `${supporting} spells the date out as ${pretty}, which does not match ` +
      `${listJoin(conflicting)} under either reading.`;
  }
  if (!agreeing.length) return null;

  return `${supporting} spells the date out as ${pretty}. Read that way, ` +
    `${listJoin(agreeing)} agree${agreeing.length === 1 ? 's' : ''} too — so the difference is ` +
    'most likely a day/month format convention rather than a wrong date. Confirm it before you rely on it.';
}

function buildFinding(
  field: keyof ExtractedFields,
  docs: VerifiableDocument[],
): FieldFinding | null {
  const policy = FIELD_POLICY[field];

  const present = docs.filter(d => d.fields[field]?.trim());
  // Nothing to say about a field only one document carries. Reporting it
  // would bury the two real findings under eight "only one document has
  // this" rows.
  if (present.length < 2) return null;

  const comparisons: FieldComparison[] = [];
  for (let i = 0; i < present.length; i++) {
    for (let j = i + 1; j < present.length; j++) {
      if (
        COMPARE_ONLY_WITHIN_TYPE.has(field) &&
        present[i].documentType !== present[j].documentType
      ) continue;

      const c = policy.compare(present[i].fields[field], present[j].fields[field]);
      comparisons.push({
        ...c,
        // Carry the document labels so the UI can say WHICH pair disagreed.
        field: `${field}:${present[i].id}|${present[j].id}`,
      });
    }
  }
  if (!comparisons.length) return null;

  const verdicts = comparisons.map(c => c.verdict);
  const severity = severityFor(field, verdicts);

  const worstComparison =
    comparisons.find(c => c.verdict === 'mismatch') ??
    comparisons.find(c => c.verdict === 'ambiguous_format') ??
    comparisons.find(c => c.verdict === 'review') ??
    comparisons.find(c => c.verdict === 'near_match') ??
    comparisons[0];

  const values = present.map(d => {
    const raw = d.fields[field];
    const own = comparisons.find(c => c.field.includes(d.id));
    return {
      documentId: d.id,
      documentLabel: d.label,
      raw,
      normalised: own
        ? (own.field.startsWith(`${field}:${d.id}`) ? own.normalisedA : own.normalisedB)
        : null,
    };
  });

  /**
   * Decode the document ids the worst comparison was built from. buildFinding
   * encodes them into `field` as `name:idA|idB` precisely so this mapping is
   * possible without threading labels through every compare function.
   */
  let conflictBetween: { a: string; b: string } | null = null;
  if (worstComparison.verdict !== 'match' && worstComparison.verdict !== 'missing') {
    const [, pair] = worstComparison.field.split(':');
    const [idA, idB] = (pair ?? '').split('|');
    const labelA = present.find(d => d.id === idA)?.label;
    const labelB = present.find(d => d.id === idB)?.label;
    if (labelA && labelB) conflictBetween = { a: labelA, b: labelB };
  }

  const isDateField = field === 'dob' || field === 'issueDate' || field === 'expiryDate';
  const corroboration =
    isDateField && verdicts.includes('ambiguous_format') ? corroborateDate(field, present) : null;

  return {
    field,
    label: policy.label,
    severity,
    values,
    comparisons,
    headline: worstComparison.reason,
    recommendation: recommendationFor(field, severity, policy.kind),
    corroboration,
    conflictBetween,
    requiresUserAction: severity === 'critical' || severity === 'warning',
  };
}

function recommendationFor(
  field: keyof ExtractedFields,
  severity: Severity,
  kind: 'identity' | 'mutable' | 'metadata',
): string {
  if (severity === 'ok') return 'No action needed.';
  if (severity === 'info') {
    return 'Most departments accept this, but if the form has a "name as per document" field, copy it from the document you are applying with.';
  }

  if (field === 'dob') {
    return (
      'Confirm your correct date of birth from your birth certificate or school leaving ' +
      'certificate, then apply for a correction on whichever document is wrong BEFORE you ' +
      'submit this application. CivicAI cannot tell you which one is wrong, and will not change either.'
    );
  }
  if (field === 'name') {
    return (
      'Departments usually require the name to match your identity document exactly. ' +
      'Either apply for a name correction on the document that differs, or attach an ' +
      'affidavit declaring both names refer to you — your local office can tell you which they accept.'
    );
  }
  if (field === 'address' || kind === 'mutable') {
    return (
      'If you have moved, this is expected — submit the most recent proof of address and ' +
      'be ready to explain the older one. If you have not moved, get the outdated document corrected.'
    );
  }
  if (field === 'documentNumber') {
    return 'Check the number against the physical document. If the document is right, the scan was misread — try a clearer photo.';
  }
  return 'Check both documents and correct whichever is wrong before you submit.';
}

// ───────────────────────── AI narrative ─────────────────────────

const AI_SYSTEM = `You explain document discrepancies to Indian citizens applying for government services.

Hard rules — breaking any of these causes real harm:
- NEVER state which document is correct. You do not know.
- NEVER tell the citizen to alter, edit or fabricate a document.
- NEVER promise that an application will be accepted or rejected.
- Do not invent procedures, offices, form numbers, fees or timelines. If you do not know the exact process, say to ask at the issuing office.
- Write at a reading level suited to someone who is not a lawyer. Short sentences. No jargon.
- Be calm and practical. This person is trying to get something done, not to be lectured.`;

const AI_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    explanation: { type: Type.STRING },
    suggestions: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ['explanation', 'suggestions'],
};

async function narrate(findings: FieldFinding[]): Promise<{ explanation: string | null; suggestions: string[]; provider: string; degraded: boolean }> {
  const notable = findings.filter(f => f.severity !== 'ok');
  if (!notable.length) {
    return {
      explanation: 'Every field these documents share agrees. Nothing here should hold up an application.',
      suggestions: [],
      provider: 'none',
      degraded: false,
    };
  }

  const digest = notable
    .map(f =>
      `- ${f.label} (${f.severity}): ${f.values.map(v => `${v.documentLabel} says "${v.raw}"`).join('; ')}. ` +
      `System note: ${f.headline}` +
      (f.corroboration ? ` Corroborating evidence: ${f.corroboration}` : ''))
    .join('\n');

  const blocking = notable.filter(f => f.severity === 'critical' || f.severity === 'warning');
  const cosmetic = notable.length - blocking.length;

  /**
   * Used when no model answered. It has to be accurate on its own: an
   * earlier version said "3 fields differ" when two of the three were
   * harmless spelling variants, which reads as three problems and sends
   * someone to a government office over nothing.
   */
  const fallback = {
    explanation: blocking.length
      ? `${blocking.length} thing${blocking.length > 1 ? 's need' : ' needs'} your attention before you apply` +
        (cosmetic
          ? `, plus ${cosmetic} minor spelling difference${cosmetic > 1 ? 's' : ''} that most departments accept.`
          : '.')
      : `Only minor spelling differences were found. Most departments accept these, ` +
        `but check the box below before you submit.`,
    suggestions: blocking.map(f => f.recommendation),
  };

  const result = await generateJson<{ explanation: string; suggestions: string[] }>({
    system: AI_SYSTEM,
    prompt:
      `A citizen uploaded documents before applying for a government service. ` +
      `These differences were found:\n\n${digest}\n\n` +
      `Write "explanation": two or three sentences telling them plainly what differs and why it matters. ` +
      `Write "suggestions": one concrete next step per difference, in the same order. ` +
      `Do not say which document is correct.`,
    schema: AI_SCHEMA,
    jsonHint: '{"explanation":string,"suggestions":string[]}',
    fallback,
  });

  return {
    explanation: String(result.data.explanation ?? fallback.explanation).slice(0, 1200),
    suggestions: (Array.isArray(result.data.suggestions) ? result.data.suggestions : fallback.suggestions)
      .slice(0, 10)
      .map(s => String(s).slice(0, 400)),
    provider: result.provider,
    degraded: result.degraded,
  };
}

// ───────────────────────── entry point ─────────────────────────

export async function verifyDocuments(docs: VerifiableDocument[]): Promise<VerificationReport> {
  const now = new Date().toISOString();
  const simulated = docs.some(d => d.simulated);

  const documentSummaries = docs.map(d => ({
    id: d.id, label: d.label, documentType: d.documentType,
    typeLabel: DOCUMENT_LABELS[d.documentType] ?? 'Document',
    confidence: d.confidence, simulated: d.simulated, error: d.error,
  }));

  if (docs.length < 2) {
    return {
      overall: 'insufficient',
      summary:
        'Add at least two documents. There is nothing to cross-check against a single one — ' +
        'this feature compares your documents with each other.',
      documents: documentSummaries,
      findings: [],
      aiExplanation: null,
      aiSuggestions: [],
      provider: 'none',
      degraded: false,
      generatedAt: now,
      simulated,
    };
  }

  const findings = (Object.keys(FIELD_POLICY) as Array<keyof ExtractedFields>)
    .map(field => buildFinding(field, docs))
    .filter((f): f is FieldFinding => f !== null)
    // Worst first: someone scanning this screen must hit the blocking
    // problem before the cosmetic one.
    .sort((a, b) => {
      const rank: Record<Severity, number> = { critical: 0, warning: 1, info: 2, ok: 3 };
      return rank[a.severity] - rank[b.severity];
    });

  const hasCritical = findings.some(f => f.severity === 'critical');
  const hasWarning = findings.some(f => f.severity === 'warning');

  const overall: VerificationReport['overall'] =
    hasCritical ? 'action_required' : hasWarning ? 'review_recommended' : 'verified';

  const { explanation, suggestions, provider, degraded } = await narrate(findings);

  const compared = findings.length;
  const summary =
    overall === 'action_required'
      ? 'Something here will very likely get your application rejected. Sort it out before you submit.'
      : overall === 'review_recommended'
        ? 'Nothing is clearly wrong, but a few things are worth a second look before you submit.'
        : compared === 0
          ? 'These documents share no fields to compare. Add documents that carry your name or date of birth.'
          // Deliberately narrow: this is a consistency check, not an approval.
          : 'Your documents agree with each other. This does not guarantee approval — it means nothing here contradicts anything else.';

  return {
    overall,
    summary,
    documents: documentSummaries,
    findings,
    aiExplanation: explanation,
    aiSuggestions: suggestions,
    provider,
    degraded,
    generatedAt: now,
    simulated,
  };
}
