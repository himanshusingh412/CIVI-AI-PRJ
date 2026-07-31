import { store, type Complaint } from './store.js';
import { publish } from './events.js';

/**
 * SLA enforcement.
 *
 * Until now SLA was computed on READ: the dashboard coloured a row red when
 * you happened to look at it. Nothing happened if nobody looked. A deadline
 * that only exists while someone is watching the screen is not a deadline,
 * and "triggers alerts for delays" was not true of the system.
 *
 * This sweeps on a timer and makes breaches consequential — escalating the
 * complaint and emitting an event — independently of anyone's browser.
 *
 * DEPLOYMENT NOTE: on Vercel's serverless runtime there is no long-lived
 * process, so this interval only runs while a container happens to be warm.
 * Production should call `runSlaSweep()` from a scheduled function (Vercel
 * Cron / GitHub Actions) instead of relying on the timer. The sweep is
 * idempotent precisely so it is safe to invoke either way.
 */

/** Hours past the deadline at which each escalation level trips. */
export const ESCALATION_STEPS_H = [0, 24, 72, 168] as const; // breach, +1d, +3d, +1w

/** Statuses that stop the clock. A closed complaint cannot breach. */
const TERMINAL = new Set(['resolved', 'closed', 'rejected']);

export interface SlaBreach {
  id: string;
  hoursOver: number;
  fromLevel: number;
  toLevel: number;
}

/**
 * Which escalation level a complaint SHOULD be at, given how late it is.
 * Derived from elapsed time rather than incremented, so a sweep that is
 * missed (or runs twice) still converges on the same answer.
 */
export function levelFor(hoursOver: number): number {
  let level = 0;
  for (let i = 0; i < ESCALATION_STEPS_H.length; i++) {
    if (hoursOver >= ESCALATION_STEPS_H[i]) level = i;
  }
  return level;
}

export function findBreaches(complaints: Complaint[], now = Date.now()): SlaBreach[] {
  const out: SlaBreach[] = [];
  for (const c of complaints) {
    if (TERMINAL.has(String(c.status))) continue;
    if (!c.slaDeadline) continue;

    const hoursOver = (now - new Date(c.slaDeadline).getTime()) / 3_600_000;
    if (hoursOver < 0) continue;

    const target = levelFor(hoursOver);
    const current = c.escalationLevel ?? 0;
    // Only report an INCREASE. Re-running the sweep must not re-alert, or a
    // one-minute interval would emit thousands of duplicate notifications.
    if (target > current) {
      out.push({ id: c.id, hoursOver, fromLevel: current, toLevel: target });
    }
  }
  return out;
}

export async function runSlaSweep(now = Date.now()): Promise<SlaBreach[]> {
  const complaints = await store.list();
  const breaches = findBreaches(complaints, now);

  for (const b of breaches) {
    const overdue = b.hoursOver < 1
      ? 'just now'
      : b.hoursOver < 48
        ? `${Math.round(b.hoursOver)} h overdue`
        : `${Math.round(b.hoursOver / 24)} days overdue`;

    await store.update(b.id, {
      escalationLevel: b.toLevel,
      publicUpdates: [{
        at: new Date(now).toISOString(),
        body: `Escalated to level ${b.toLevel} — resolution target missed (${overdue}).`,
      }],
    } as Partial<Complaint>);

    publish({ type: 'sla_breach', id: b.id, level: b.toLevel, hoursOver: Math.round(b.hoursOver) });
  }

  if (breaches.length) {
    console.log(`[sla] escalated ${breaches.length} complaint(s) past their deadline`);
  }
  return breaches;
}

let timer: NodeJS.Timeout | null = null;

export function startSlaScheduler(intervalMs = 5 * 60_000) {
  if (timer) return;
  // unref() so an idle sweep timer never keeps the process alive on its own —
  // otherwise Ctrl+C appears to hang for up to the full interval.
  timer = setInterval(() => { void runSlaSweep().catch(e => console.error('[sla] sweep failed', e)); }, intervalMs);
  timer.unref?.();
  console.log(`[sla] breach sweep every ${Math.round(intervalMs / 60000)} min`);
}

export function stopSlaScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
