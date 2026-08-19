/**
 * Normalisation and fuzzy comparison for document fields.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * The problem this solves
 * ─────────────────────────────────────────────────────────────────────────
 * A citizen's name is spelled three different ways across three government
 * documents, and that is normal, not fraud. Transliteration from Devanagari
 * has no single correct answer; clerks abbreviate middle names; "Mohammed"
 * and "Mohammad" are the same person. An application gets rejected weeks
 * later over exactly this, and nobody told them at the counter.
 *
 * So the job here is NOT to decide whether two documents match. It is to
 * measure how far apart they are and hand that measurement to a human with
 * enough context to judge it. Every function in this file returns a score
 * and a reason; none of them returns a verdict on the person.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Two rules that shape the whole file
 * ─────────────────────────────────────────────────────────────────────────
 *  1. Never guess which value is correct. When 12/03/2001 meets 03/12/2001,
 *     the honest output is "these two could be the same date written in two
 *     conventions, or two different dates" — not a silent pick.
 *  2. Normalisation is lossy and must be visible. Every comparison reports
 *     the normalised forms it actually compared, so a citizen can see why
 *     the system thinks two strings are the same.
 */

// ───────────────────────── text normalisation ─────────────────────────

/**
 * Honorifics and salutations carried on Indian documents. Stripped before
 * comparison because a PAN card says "RAHUL KUMAR" while a school
 * certificate says "Shri Rahul Kumar", and that difference is a form field,
 * not a discrepancy.
 */
const HONORIFICS = new Set([
  'mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'shri', 'sri', 'smt', 'smti',
  'kumari', 'km', 'sh', 'late', 'col', 'capt', 'maj', 'adv',
]);

/** Common spelling variants that are the same name, not a mismatch. */
const NAME_EQUIVALENTS: Record<string, string> = {
  mohammad: 'mohammed', mohd: 'mohammed', md: 'mohammed', muhammad: 'mohammed',
  mohamad: 'mohammed', mahammad: 'mohammed',
  kumaar: 'kumar', kumaresh: 'kumaresh',
  laxmi: 'lakshmi', lakshmy: 'lakshmi',
  krishnan: 'krishna', krishnaa: 'krishna',
  sanjay: 'sanjay', sanjai: 'sanjay',
  anjali: 'anjali', anjaly: 'anjali',
  suresh: 'suresh', sureshh: 'suresh',
  abdul: 'abdul', abdool: 'abdul',
  syed: 'sayed', saiyed: 'sayed', sayyed: 'sayed',
  chandra: 'chandra', chandhra: 'chandra',
  reddy: 'reddy', reddi: 'reddy',
  shaikh: 'sheikh', shekh: 'sheikh', shaik: 'sheikh',
};

/**
 * Strip diacritics so "Nāir" and "Nair" compare equal.
 * NFD splits a letter into base + combining mark; the range below is the
 * combining-diacritical block.
 */
const stripDiacritics = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '');

export function normaliseText(raw: string): string {
  return stripDiacritics(String(raw ?? ''))
    .toLowerCase()
    // Punctuation becomes a space rather than nothing: "RAHUL.KUMAR" is two
    // tokens, and deleting the dot would fuse them into one.
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function nameTokens(raw: string): string[] {
  return normaliseText(raw)
    .split(' ')
    .filter(t => t && !HONORIFICS.has(t))
    .map(t => NAME_EQUIVALENTS[t] ?? t);
}

export const normaliseName = (raw: string): string => nameTokens(raw).join(' ');

/** Document numbers: case and separators carry no meaning. */
export const normaliseDocNumber = (raw: string): string =>
  String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Address abbreviations, expanded so "Sec 14, MG Rd" and
 * "Sector 14, M.G. Road" reach the same normal form.
 */
const ADDRESS_EXPANSIONS: Record<string, string> = {
  rd: 'road', st: 'street', ln: 'lane', blk: 'block', sec: 'sector',
  apt: 'apartment', bldg: 'building', flr: 'floor', opp: 'opposite',
  nr: 'near', hno: 'house number', 'h no': 'house number', dist: 'district',
  teh: 'tehsil', po: 'post office', ps: 'police station', vill: 'village',
  colo: 'colony', cly: 'colony', ngr: 'nagar', mkt: 'market', xing: 'crossing',
  ext: 'extension', ph: 'phase', pkt: 'pocket',
};

export function normaliseAddress(raw: string): string {
  const expanded = normaliseText(raw)
    .split(' ')
    .map(t => ADDRESS_EXPANSIONS[t] ?? t)
    .filter(Boolean);

  /**
   * Collapse runs of single letters into one token: "m g road" → "mg road".
   *
   * normaliseText turns punctuation into spaces, so "M.G. Road" arrives here
   * as three tokens while "MG Road" arrives as two — and the two spellings
   * then failed to match despite being the same road. Initialisms are
   * everywhere in Indian addresses (M.G. Road, A.B. Road, C.P.), so this is
   * the common case rather than an edge one.
   */
  const collapsed: string[] = [];
  for (const token of expanded) {
    const prev = collapsed[collapsed.length - 1];
    if (token.length === 1 && prev && prev.length <= 3 && /^[a-z]+$/.test(prev) && /^[a-z]$/.test(token)) {
      collapsed[collapsed.length - 1] = prev + token;
    } else {
      collapsed.push(token);
    }
  }
  return collapsed.join(' ').trim();
}

/** Indian PIN code, if the address carries one. Compared separately: two
 *  addresses with different PINs are different places whatever else matches. */
export function extractPin(raw: string): string | null {
  const m = String(raw ?? '').match(/\b([1-9]\d{5})\b/);
  return m ? m[1] : null;
}

// ───────────────────────── string similarity ─────────────────────────

/** Levenshtein distance, iterative with a single row — O(min(a,b)) space. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr.slice();
  }
  return prev[b.length];
}

/**
 * Jaro-Winkler. Chosen over plain Levenshtein for names specifically: it
 * rewards a shared prefix, which is exactly the signal that distinguishes a
 * transliteration variant ("Krishnan"/"Krishna") from a different name
 * ("Krishnan"/"Kishore") at the same edit distance.
 */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;

  const matchWindow = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatched = new Array<boolean>(a.length).fill(false);
  const bMatched = new Array<boolean>(b.length).fill(false);

  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bMatched[j] || a[i] !== b[j]) continue;
      aMatched[i] = true;
      bMatched[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatched[i]) continue;
    while (!bMatched[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  transpositions /= 2;

  const jaro =
    (matches / a.length + matches / b.length + (matches - transpositions) / matches) / 3;

  // Winkler bonus: up to 4 leading characters, scaling factor 0.1.
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] !== b[i]) break;
    prefix++;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

// ───────────────────────── field comparison ─────────────────────────

export type MatchVerdict =
  | 'match'            // same value once normalised
  | 'near_match'       // different spelling, almost certainly the same
  | 'review'           // plausibly the same, a human should look
  | 'mismatch'         // materially different
  | 'ambiguous_format' // could be identical, written two different ways
  | 'missing';         // one side has no value to compare

export type FieldComparison = {
  field: string;
  a: string | null;
  b: string | null;
  /** What was actually compared, after normalisation. Shown to the citizen. */
  normalisedA: string | null;
  normalisedB: string | null;
  similarity: number;   // 0..1
  verdict: MatchVerdict;
  /** Plain-language reason, safe to display verbatim. */
  reason: string;
};

const missing = (field: string, a: string | null, b: string | null): FieldComparison => ({
  field, a, b, normalisedA: null, normalisedB: null, similarity: 0,
  verdict: 'missing',
  reason: !a && !b
    ? 'Neither document lists this field.'
    : `Only one document lists this field, so there is nothing to compare.`,
});

/**
 * Name comparison, token-aware.
 *
 * A plain string distance handles "Rahul Kumar" vs "Rahul Kumer" fine and
 * handles "Rahul Kumar Singh" vs "Rahul K. Singh" terribly — the second pair
 * is almost certainly one person, but three characters of a nine-character
 * token are missing and the raw score collapses. Comparing token by token,
 * with an explicit rule for initials, is what makes that case legible.
 */
export function compareNames(a: string | null, b: string | null): FieldComparison {
  if (!a?.trim() || !b?.trim()) return missing('name', a ?? null, b ?? null);

  const ta = nameTokens(a);
  const tb = nameTokens(b);
  const na = ta.join(' ');
  const nb = tb.join(' ');

  const base = { field: 'name', a, b, normalisedA: na, normalisedB: nb };

  if (na === nb) {
    return { ...base, similarity: 1, verdict: 'match',
      reason: 'The names are the same once spacing, case and titles are ignored.' };
  }

  // Align the shorter token list against the longer one, best match wins.
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const used = new Set<number>();
  let score = 0;
  let initialsUsed = 0;
  let fuzzyUsed = 0;

  type MatchKind = 'exact' | 'initial' | 'fuzzy';

  for (const token of short) {
    let bestIdx = -1;
    let best = 0;
    let kind: MatchKind = 'exact';

    for (let i = 0; i < long.length; i++) {
      if (used.has(i)) continue;
      const other = long[i];

      let s = 0;
      let k: MatchKind = 'exact';
      if (token === other) {
        s = 1;
      } else if (
        // "k" against "kumar": an initial standing in for a full token.
        (token.length === 1 && other.startsWith(token)) ||
        (other.length === 1 && token.startsWith(other))
      ) {
        s = 0.85;
        k = 'initial';
      } else {
        const jw = jaroWinkler(token, other);
        if (jw >= 0.86) { s = jw * 0.95; k = 'fuzzy'; }
      }

      if (s > best) { best = s; bestIdx = i; kind = k; }
    }

    if (bestIdx >= 0) {
      used.add(bestIdx);
      score += best;
      if (kind === 'initial') initialsUsed++;
      if (kind === 'fuzzy') fuzzyUsed++;
    }
  }

  const unmatchedInLong = long.length - used.size;
  /**
   * Denominator is the LONGER list, so extra tokens cost something. But a
   * dropped middle name is a weak signal on Indian documents — plenty of
   * forms have no middle-name field at all — so unmatched tokens are
   * discounted rather than treated as evidence of a different person.
   */
  const similarity = score / (short.length + unmatchedInLong * 0.45);

  if (similarity >= 0.97) {
    return { ...base, similarity, verdict: 'match',
      reason: 'The names match.' };
  }
  if (similarity >= 0.88) {
    const bits: string[] = [];
    if (initialsUsed) bits.push(`${initialsUsed} name${initialsUsed > 1 ? 's are' : ' is'} abbreviated to an initial`);
    if (fuzzyUsed) bits.push('spelling differs slightly');
    if (unmatchedInLong) bits.push(`one document carries ${unmatchedInLong} extra name part${unmatchedInLong > 1 ? 's' : ''}`);
    return { ...base, similarity, verdict: 'near_match',
      reason: bits.length
        ? `Very likely the same person — ${bits.join(', ')}.`
        : 'Very likely the same person.' };
  }
  if (similarity >= 0.7) {
    return { ...base, similarity, verdict: 'review',
      reason: 'These names are similar but not the same. Check them before you submit.' };
  }
  return { ...base, similarity, verdict: 'mismatch',
    reason: 'These names are materially different.' };
}

// ───────────────────────── dates ─────────────────────────

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

export type DateReading = {
  /** ISO yyyy-mm-dd. */
  iso: string;
  /** How the source was read to get here. */
  convention: 'DMY' | 'MDY' | 'YMD' | 'named-month';
};

const valid = (y: number, m: number, d: number) => {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/**
 * Every plausible reading of a date string — plural on purpose.
 *
 * "12/03/2001" is 12 March in India and 3 December in the United States, and
 * a document does not say which convention its clerk used. Returning both
 * and letting the comparison notice the collision is the only honest option;
 * picking one silently is how a system tells someone their date of birth is
 * wrong when it is not.
 */
export function parseDateCandidates(raw: string): DateReading[] {
  const s = String(raw ?? '').trim();
  if (!s) return [];
  const out: DateReading[] = [];
  const push = (r: DateReading) => { if (!out.some(o => o.iso === r.iso)) out.push(r); };

  // 12 March 2001 / March 12, 2001 / 12-Mar-2001
  const named = s.toLowerCase().match(/(\d{1,2})[\s\-/,]*([a-z]{3,9})[\s\-/,]*(\d{4})/);
  if (named && MONTHS[named[2]]) {
    const d = Number(named[1]), m = MONTHS[named[2]], y = Number(named[3]);
    if (valid(y, m, d)) push({ iso: iso(y, m, d), convention: 'named-month' });
  }
  const namedFirst = s.toLowerCase().match(/([a-z]{3,9})[\s\-/,]*(\d{1,2})[\s\-/,]*(\d{4})/);
  if (namedFirst && MONTHS[namedFirst[1]]) {
    const m = MONTHS[namedFirst[1]], d = Number(namedFirst[2]), y = Number(namedFirst[3]);
    if (valid(y, m, d)) push({ iso: iso(y, m, d), convention: 'named-month' });
  }

  // yyyy-mm-dd — unambiguous, so it is read one way only.
  const ymd = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (ymd) {
    const y = Number(ymd[1]), m = Number(ymd[2]), d = Number(ymd[3]);
    if (valid(y, m, d)) push({ iso: iso(y, m, d), convention: 'YMD' });
    return out;
  }

  // n/n/yyyy — genuinely ambiguous.
  const num = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (num) {
    const p1 = Number(num[1]), p2 = Number(num[2]);
    let y = Number(num[3]);
    // Two-digit years: 00-30 → 2000s, else 1900s. Documented rather than
    // clever — a 1931 birth year read as 2031 is worse than an explicit rule.
    if (y < 100) y = y <= 30 ? 2000 + y : 1900 + y;

    if (valid(y, p2, p1)) push({ iso: iso(y, p2, p1), convention: 'DMY' });
    if (valid(y, p1, p2)) push({ iso: iso(y, p1, p2), convention: 'MDY' });
  }

  return out;
}

const prettyDate = (isoStr: string) => {
  const [y, m, d] = isoStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
};

/**
 * The raw numeric parts of a slash/dash/dot date, before any interpretation.
 *
 * Needed because two ambiguous dates cannot be compared through their
 * resolved candidates alone: "12/03/2001" and "03/12/2001" produce the SAME
 * candidate set, so a naive cross-product finds a match and reports two
 * possibly-different dates as identical. Comparing the written parts is what
 * distinguishes "the same string twice" from "the digits are swapped".
 */
function numericParts(raw: string): { p1: number; p2: number; y: number } | null {
  const m = String(raw ?? '').trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (!m) return null;
  let y = Number(m[3]);
  if (y < 100) y = y <= 30 ? 2000 + y : 1900 + y;
  return { p1: Number(m[1]), p2: Number(m[2]), y };
}

export function compareDates(a: string | null, b: string | null, field = 'dob'): FieldComparison {
  if (!a?.trim() || !b?.trim()) return missing(field, a ?? null, b ?? null);

  const ca = parseDateCandidates(a);
  const cb = parseDateCandidates(b);
  const base = {
    field, a, b,
    normalisedA: ca[0]?.iso ?? null,
    normalisedB: cb[0]?.iso ?? null,
  };

  if (!ca.length || !cb.length) {
    return { ...base, similarity: 0, verdict: 'review' as const,
      reason: 'One of these dates could not be read reliably. Check it by eye.' };
  }

  const pa = numericParts(a);
  const pb = numericParts(b);

  // ── both written in the same ambiguous numeric form ──
  if (pa && pb) {
    if (pa.p1 === pb.p1 && pa.p2 === pb.p2 && pa.y === pb.y) {
      return { ...base, similarity: 1, verdict: 'match' as const,
        reason: 'Both documents give the same date.' };
    }
    /**
     * The day/month swap — the single most common real discrepancy on Indian
     * paperwork, and deliberately NOT resolved here. 12/03 against 03/12 is
     * either one date recorded twice under different conventions, or two
     * different dates. The system says which situation it is and stops.
     * Guessing would mean telling someone their date of birth is wrong when
     * it is not, or waving through a genuine error.
     */
    if (
      pa.p1 === pb.p2 && pa.p2 === pb.p1 && pa.y === pb.y &&
      pa.p1 !== pa.p2 && pa.p1 <= 12 && pa.p2 <= 12
    ) {
      return {
        ...base, similarity: 0.5, verdict: 'ambiguous_format' as const,
        reason:
          `The day and month are swapped: one document reads "${a.trim()}" and another ` +
          `reads "${b.trim()}". That can mean the same date written in two different ` +
          'formats, or two different dates. CivicAI cannot tell which — please confirm ' +
          'your correct date of birth.',
      };
    }
  }

  const unambiguousA = ca.length === 1;
  const unambiguousB = cb.length === 1;

  // ── both readable exactly one way ──
  if (unambiguousA && unambiguousB) {
    if (ca[0].iso === cb[0].iso) {
      return { ...base, normalisedA: ca[0].iso, normalisedB: cb[0].iso, similarity: 1,
        verdict: 'match' as const, reason: `Both documents give ${prettyDate(ca[0].iso)}.` };
    }
  }

  /**
   * One side unambiguous (ISO, or a named month), the other not. The
   * unambiguous document is what settles the reading — this is the good
   * case, and it is why asking for one document with a spelled-out month
   * resolves so many of these.
   */
  if (unambiguousA !== unambiguousB) {
    const fixed = unambiguousA ? ca[0] : cb[0];
    const other = unambiguousA ? cb : ca;
    const hit = other.find(o => o.iso === fixed.iso);
    if (hit) {
      return {
        ...base, normalisedA: fixed.iso, normalisedB: fixed.iso, similarity: 1,
        verdict: 'match' as const,
        reason:
          `Both resolve to ${prettyDate(fixed.iso)} — the other document reads as ` +
          `${hit.convention} (day-month-year), which the unambiguous one confirms.`,
      };
    }
  }

  // ── both ambiguous, and the candidate sets overlap ──
  if (!unambiguousA && !unambiguousB) {
    const overlap = ca.filter(x => cb.some(y => y.iso === x.iso));
    if (overlap.length) {
      return {
        ...base, similarity: 0.5, verdict: 'ambiguous_format' as const,
        reason:
          `"${a.trim()}" and "${b.trim()}" could be the same day written in two different ` +
          'formats, or two different days. Neither document says which convention it uses, ' +
          'so CivicAI cannot tell — please confirm the correct date.',
      };
    }
  }

  const days = Math.abs(Date.parse(ca[0].iso) - Date.parse(cb[0].iso)) / 86_400_000;
  return {
    ...base, similarity: 0, verdict: 'mismatch' as const,
    reason:
      `These are different dates — ${prettyDate(ca[0].iso)} and ${prettyDate(cb[0].iso)}, ` +
      `${Math.round(days)} day${Math.round(days) === 1 ? '' : 's'} apart.`,
  };
}

// ───────────────────────── addresses & numbers ─────────────────────────

export function compareAddresses(a: string | null, b: string | null): FieldComparison {
  if (!a?.trim() || !b?.trim()) return missing('address', a ?? null, b ?? null);

  const na = normaliseAddress(a);
  const nb = normaliseAddress(b);
  const base = { field: 'address', a, b, normalisedA: na, normalisedB: nb };

  if (na === nb) {
    return { ...base, similarity: 1, verdict: 'match',
      reason: 'The addresses match once abbreviations are expanded.' };
  }

  const pinA = extractPin(a);
  const pinB = extractPin(b);
  if (pinA && pinB && pinA !== pinB) {
    return { ...base, similarity: 0.2, verdict: 'mismatch',
      reason: `Different PIN codes (${pinA} and ${pinB}) — these are different localities.` };
  }

  // Token overlap suits addresses better than edit distance: reordered
  // components ("Sector 14, Dwarka" / "Dwarka, Sector 14") are the same place.
  const sa = new Set(na.split(' ').filter(Boolean));
  const sb = new Set(nb.split(' ').filter(Boolean));
  const shared = [...sa].filter(t => sb.has(t)).length;
  const similarity = shared / Math.max(sa.size, sb.size, 1);

  if (similarity >= 0.85) {
    return { ...base, similarity, verdict: 'near_match',
      reason: pinA && pinB && pinA === pinB
        ? 'Same PIN code and nearly the same address — most likely one address written two ways.'
        : 'Nearly the same address — most likely one address written two ways.' };
  }
  if (similarity >= 0.55) {
    return { ...base, similarity, verdict: 'review',
      reason: 'These addresses partly overlap. Check whether one is out of date.' };
  }
  return { ...base, similarity, verdict: 'mismatch',
    reason: 'These addresses are materially different.' };
}

export function compareDocNumbers(
  a: string | null, b: string | null, field = 'documentNumber',
): FieldComparison {
  if (!a?.trim() || !b?.trim()) return missing(field, a ?? null, b ?? null);

  const na = normaliseDocNumber(a);
  const nb = normaliseDocNumber(b);
  const base = { field, a, b, normalisedA: na, normalisedB: nb };

  if (na === nb) {
    return { ...base, similarity: 1, verdict: 'match', reason: 'The numbers are identical.' };
  }

  const dist = levenshtein(na, nb);
  const similarity = 1 - dist / Math.max(na.length, nb.length, 1);

  /**
   * Deliberately harsh. Identity numbers are not names: one wrong digit is a
   * different person, not a spelling variant. A single-character difference
   * is reported as a likely transcription error to be checked, never as a
   * near-match to be accepted.
   */
  if (dist === 1) {
    return { ...base, similarity, verdict: 'review',
      reason: 'These numbers differ by one character — most likely a typing or scanning error. Check the original document.' };
  }
  return { ...base, similarity, verdict: 'mismatch',
    reason: 'These are different document numbers.' };
}

export function compareGeneric(field: string, a: string | null, b: string | null): FieldComparison {
  if (!a?.trim() || !b?.trim()) return missing(field, a ?? null, b ?? null);
  const na = normaliseText(a);
  const nb = normaliseText(b);
  const base = { field, a, b, normalisedA: na, normalisedB: nb };
  if (na === nb) return { ...base, similarity: 1, verdict: 'match', reason: 'These values match.' };

  const similarity = jaroWinkler(na, nb);
  if (similarity >= 0.93) {
    return { ...base, similarity, verdict: 'near_match', reason: 'Nearly identical.' };
  }
  if (similarity >= 0.75) {
    return { ...base, similarity, verdict: 'review', reason: 'Similar but not identical — worth a look.' };
  }
  return { ...base, similarity, verdict: 'mismatch', reason: 'These values are different.' };
}
