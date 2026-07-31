/**
 * Cross-verification: detecting that several citizens are reporting the
 * same real-world problem.
 *
 * Why this matters beyond deduplication: five reports of one broken
 * transformer is not five problems, it is one problem with five witnesses.
 * Treating them separately inflates the queue, splits the evidence, and
 * lets a widely-felt issue look like five low-priority ones. Linking them
 * is what turns volume into a signal.
 *
 * Scoring is deliberately explainable rather than learned. A citizen whose
 * complaint gets folded into another is entitled to know why, and a clerk
 * overriding the link needs to see the reasoning. Three independent
 * signals, each capped, no black box:
 *
 *   proximity  — same physical thing, so distance dominates
 *   wording    — token overlap, stopwords removed
 *   recency    — the same pothole reported 3 months apart is 2 problems
 *
 * A match must ALSO share a category. Two complaints 10m apart about
 * "water" and "streetlight" are neighbours, not duplicates.
 */

export interface DupCandidate {
  id: string;
  category: string;
  description: string;
  lat?: number | null;
  lng?: number | null;
  createdAt: string;
}

export interface DupScore {
  id: string;
  score: number;
  distanceM: number | null;
  wordOverlap: number;
  ageDays: number;
  reasons: string[];
}

/** Metres between two WGS84 points. */
export function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * Words carried by almost every civic complaint. Left in, they make any two
 * complaints look similar — "the road near the water supply is not working"
 * overlaps heavily with everything.
 */
const STOP = new Set([
  'the','a','an','is','are','was','were','in','on','at','to','of','for','and','or','not','no',
  'there','here','this','that','it','its','be','been','has','have','had','from','with','by',
  'near','please','sir','madam','kindly','complaint','issue','problem','area','since','days',
  'day','my','our','we','i','you','they','them','their','very','too','also','still','again',
]);

export function tokenise(text: string): Set<string> {
  return new Set(
    String(text ?? '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP.has(w)),
  );
}

/** Jaccard overlap, 0..1. Symmetric, so A-vs-B scores the same as B-vs-A. */
export function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let hit = 0;
  for (const w of a) if (b.has(w)) hit++;
  return hit / (a.size + b.size - hit);
}

/** Tunables kept together so the behaviour can be reasoned about at a glance. */
export const DUP = {
  /** Beyond this, two reports are about different things even if identical. */
  MAX_DISTANCE_M: 250,
  /** Same pothole, one season apart, is a new complaint — the fix failed. */
  MAX_AGE_DAYS: 30,
  /** Below this, present as "possibly related" rather than linking. */
  LINK_THRESHOLD: 0.62,
  SUGGEST_THRESHOLD: 0.4,
} as const;

/**
 * Score one incoming complaint against existing ones.
 *
 * Returns candidates sorted strongest first. Callers decide what to do with
 * the score; this function never mutates anything, which is what makes it
 * testable without a database.
 */
export function scoreDuplicates(
  incoming: Omit<DupCandidate, 'id'>,
  candidates: DupCandidate[],
  now = Date.now(),
): DupScore[] {
  const inTokens = tokenise(incoming.description);
  const out: DupScore[] = [];

  for (const c of candidates) {
    if (c.category !== incoming.category) continue;

    const ageDays = (now - new Date(c.createdAt).getTime()) / 86_400_000;
    if (ageDays > DUP.MAX_AGE_DAYS || ageDays < 0) continue;

    const hasGeo =
      typeof incoming.lat === 'number' && typeof incoming.lng === 'number' &&
      typeof c.lat === 'number' && typeof c.lng === 'number';
    const distanceM = hasGeo
      ? haversineM(incoming.lat as number, incoming.lng as number, c.lat as number, c.lng as number)
      : null;
    if (distanceM !== null && distanceM > DUP.MAX_DISTANCE_M) continue;

    const words = overlap(inTokens, tokenise(c.description));

    // Proximity decays linearly to zero at MAX_DISTANCE_M. When either
    // report has no GPS we cannot claim proximity, so it contributes a
    // neutral-low value rather than a free full score.
    const proximity = distanceM === null ? 0.35 : 1 - distanceM / DUP.MAX_DISTANCE_M;
    const recency = 1 - ageDays / DUP.MAX_AGE_DAYS;

    // Weights: location is the strongest evidence that two people mean the
    // same object; wording is suggestive but people describe things
    // differently; recency only breaks ties.
    const raw = 0.5 * proximity + 0.35 * words + 0.15 * recency;

    /**
     * Without coordinates, never auto-link — cap below the threshold so the
     * pair can be SUGGESTED but only a human can merge it.
     *
     * "No water supply in Sector 14" is a sentence thousands of people in
     * different cities would write verbatim. Wording alone is evidence that
     * two reports describe the same KIND of problem, never that they describe
     * the same instance of it. Merging on that would silently bury a real
     * complaint under someone else's, in a system whose entire promise to
     * the citizen is that their report is tracked.
     */
    const score = distanceM === null ? Math.min(raw, DUP.LINK_THRESHOLD - 0.01) : raw;

    const reasons: string[] = [];
    if (distanceM !== null) reasons.push(`${Math.round(distanceM)} m apart`);
    else reasons.push('location unknown — needs human confirmation');
    if (words > 0.2) reasons.push(`${Math.round(words * 100)}% wording overlap`);
    reasons.push(`reported ${ageDays < 1 ? 'today' : `${Math.round(ageDays)} d ago`}`);

    out.push({ id: c.id, score, distanceM, wordOverlap: words, ageDays, reasons });
  }

  return out.sort((a, b) => b.score - a.score);
}

export function classify(score: number): 'duplicate' | 'related' | 'distinct' {
  if (score >= DUP.LINK_THRESHOLD) return 'duplicate';
  if (score >= DUP.SUGGEST_THRESHOLD) return 'related';
  return 'distinct';
}
