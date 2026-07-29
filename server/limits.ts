/**
 * Hard guards so AI usage can never overflow quota or budget.
 * Every AI call must pass through `withGuards()`.
 */

export const LIMITS = {
  // input shaping
  MAX_INPUT_CHARS: 2000,       // per user message
  MAX_HISTORY_MESSAGES: 12,    // conversation turns sent to the model
  MAX_HISTORY_CHARS: 6000,     // total context ceiling

  // output shaping
  MAX_OUTPUT_TOKENS: 512,

  // throughput
  MAX_CONCURRENT: 4,           // simultaneous in-flight AI calls
  QUEUE_TIMEOUT_MS: 8000,      // give up waiting for a slot

  // budget (free tier is 500/day — we stop well below it)
  DAILY_REQUEST_BUDGET: 400,
  PER_SESSION_DAILY: 60,

  // resilience
  REQUEST_TIMEOUT_MS: 20_000,
} as const;

// ───────────────────────── daily budget ─────────────────────────
type Counter = { count: number; day: string };
const today = () => new Date().toISOString().slice(0, 10);

let globalCounter: Counter = { count: 0, day: today() };
const sessionCounters = new Map<string, Counter>();

export function budgetStatus() {
  rollover();
  return {
    day: globalCounter.day,
    used: globalCounter.count,
    limit: LIMITS.DAILY_REQUEST_BUDGET,
    remaining: Math.max(0, LIMITS.DAILY_REQUEST_BUDGET - globalCounter.count),
  };
}

function rollover() {
  const d = today();
  if (globalCounter.day !== d) globalCounter = { count: 0, day: d };
}

/** Returns null if allowed, or a reason string if the call must be blocked. */
export function checkBudget(sessionKey: string): string | null {
  rollover();
  if (globalCounter.count >= LIMITS.DAILY_REQUEST_BUDGET) {
    return `Daily AI budget reached (${LIMITS.DAILY_REQUEST_BUDGET} requests). Resets at midnight UTC.`;
  }
  const d = today();
  let sc = sessionCounters.get(sessionKey);
  if (!sc || sc.day !== d) {
    sc = { count: 0, day: d };
    sessionCounters.set(sessionKey, sc);
  }
  if (sc.count >= LIMITS.PER_SESSION_DAILY) {
    return `You've reached your daily AI limit (${LIMITS.PER_SESSION_DAILY} requests). Try again tomorrow.`;
  }
  return null;
}

function consumeBudget(sessionKey: string) {
  rollover();
  globalCounter.count += 1;
  const sc = sessionCounters.get(sessionKey);
  if (sc) sc.count += 1;
}

// ───────────────────────── concurrency gate ─────────────────────────
let inFlight = 0;
const waiters: Array<{ resolve: () => void; reject: (e: Error) => void; timer: NodeJS.Timeout }> = [];

function acquire(): Promise<void> {
  if (inFlight < LIMITS.MAX_CONCURRENT) {
    inFlight += 1;
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const i = waiters.findIndex(w => w.timer === timer);
      if (i >= 0) waiters.splice(i, 1);
      reject(new Error('busy'));
    }, LIMITS.QUEUE_TIMEOUT_MS);
    waiters.push({ resolve, reject, timer });
  });
}

function release() {
  const next = waiters.shift();
  if (next) {
    clearTimeout(next.timer);
    next.resolve();
  } else {
    inFlight = Math.max(0, inFlight - 1);
  }
}

export function concurrencyStatus() {
  return { inFlight, queued: waiters.length, max: LIMITS.MAX_CONCURRENT };
}

// ───────────────────────── the guard wrapper ─────────────────────────
export class GuardError extends Error {
  constructor(public code: 'budget' | 'busy' | 'timeout', message: string) {
    super(message);
  }
}

/** Runs `fn` only if budget + concurrency allow, with a hard timeout. */
export async function withGuards<T>(sessionKey: string, fn: () => Promise<T>): Promise<T> {
  const blocked = checkBudget(sessionKey);
  if (blocked) throw new GuardError('budget', blocked);

  try {
    await acquire();
  } catch {
    throw new GuardError('busy', 'The assistant is busy right now. Please try again in a moment.');
  }

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new GuardError('timeout', 'The AI took too long to respond.')), LIMITS.REQUEST_TIMEOUT_MS),
  );

  try {
    consumeBudget(sessionKey);
    return await Promise.race([fn(), timeout]);
  } finally {
    release();
  }
}

// ───────────────────────── input shaping ─────────────────────────
export function clampText(s: unknown, max: number = LIMITS.MAX_INPUT_CHARS): string {
  return String(s ?? '').slice(0, max).trim();
}

export type ChatTurn = { role: 'user' | 'assistant'; content: string };

/** Trims history to the last N turns and a total character ceiling. */
export function clampHistory(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  const turns = raw
    .filter(t => t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string')
    .slice(-LIMITS.MAX_HISTORY_MESSAGES)
    .map(t => ({ role: t.role as 'user' | 'assistant', content: clampText(t.content, 800) }));

  let total = 0;
  const kept: ChatTurn[] = [];
  for (let i = turns.length - 1; i >= 0; i--) {
    total += turns[i].content.length;
    if (total > LIMITS.MAX_HISTORY_CHARS) break;
    kept.unshift(turns[i]);
  }
  return kept;
}
