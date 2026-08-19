import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import {
  AlertTriangle, CheckCircle2, ChevronRight, Clock, Inbox, MapPin,
  RefreshCw, Search, Timer, TrendingUp,
} from 'lucide-react';
import { Button } from '../Button';
import { StatCardSkeleton, SkeletonRegion } from '../Skeleton';
import { ComplaintDrawer } from '../admin/ComplaintDrawer';
import {
  fetchMe, fetchComplaints, isAuthError,
  type AdminComplaint, type MeResponse,
} from '../../services/adminService';

/**
 * The officer's working queue.
 *
 * =========================================================================
 * Why this is not the admin dashboard with a filter on it
 * =========================================================================
 * An administrator's question is "how is the department doing?" - a
 * distribution, over time, in aggregate. An officer's question is "what do I
 * have to do in the next four hours, and which of it is already late?"
 *
 * Those want opposite layouts. Charts answer the first and are noise in the
 * second: an officer with eleven open cases does not need a pie chart of
 * them. So this screen has no charts at all. It has a queue, ordered by how
 * close each case is to breaching, with the clock visible on every row.
 *
 * Scope is not enforced here and must not appear to be. Every row on this
 * screen arrived through GET /api/admin/complaints, which the server has
 * already narrowed to this principal's jurisdiction - a field officer's own
 * assignments, a department officer's department. The filters below are for
 * the officer's convenience, not for hiding anything.
 * =========================================================================
 */

type Filter = 'open' | 'overdue' | 'today' | 'all';

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'open',    label: 'Open' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'today',   label: 'Due in 24h' },
  { key: 'all',     label: 'Everything' },
];

const PRIORITY_TOKEN: Record<string, string> = {
  Critical: 'var(--color-priority-critical)',
  High: 'var(--color-priority-high)',
  Medium: 'var(--color-priority-medium)',
  Low: 'var(--color-priority-low)',
};

const HOUR = 3600_000;

export function OfficerWorkspace() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [rows, setRows] = useState<AdminComplaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('open');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<AdminComplaint | null>(null);

  /**
   * A clock that ticks once a minute, so every countdown on the page moves
   * together. Per-row timers would be dozens of intervals doing the same
   * arithmetic, and they would drift out of step with each other.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const [meRes, cRes] = await Promise.all([fetchMe(), fetchComplaints({})]);
    if (isAuthError(meRes)) { setError(meRes.message); setLoading(false); return; }
    setMe(meRes);
    if (!isAuthError(cRes)) setRows(cRes.complaints);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const stats = useMemo(() => {
    const open = rows.filter(r => !r.isTerminal);
    return {
      open: open.length,
      overdue: open.filter(r => Date.parse(r.slaDeadline) < now).length,
      soon: open.filter(r => {
        const due = Date.parse(r.slaDeadline);
        return due >= now && due - now < 24 * HOUR;
      }).length,
      resolved: rows.filter(r => ['resolved', 'citizen_verification', 'closed'].includes(r.status)).length,
    };
  }, [rows, now]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows
      .filter(r => {
        if (filter === 'open') return !r.isTerminal;
        if (filter === 'overdue') return !r.isTerminal && Date.parse(r.slaDeadline) < now;
        if (filter === 'today') {
          const due = Date.parse(r.slaDeadline);
          return !r.isTerminal && due >= now && due - now < 24 * HOUR;
        }
        return true;
      })
      .filter(r =>
        !needle ||
        r.id.toLowerCase().includes(needle) ||
        r.category.toLowerCase().includes(needle) ||
        r.description.toLowerCase().includes(needle) ||
        (r.district ?? '').toLowerCase().includes(needle))
      /**
       * Ordered by deadline, soonest first, with terminal cases last.
       * Deliberately NOT by priority: a Critical case with three days left is
       * less urgent right now than a Medium one breaching in an hour, and
       * sorting by priority is how the second one gets missed.
       */
      .sort((a, b) => {
        if (a.isTerminal !== b.isTerminal) return a.isTerminal ? 1 : -1;
        return Date.parse(a.slaDeadline) - Date.parse(b.slaDeadline);
      });
  }, [rows, filter, q, now]);

  const applyUpdate = (updated: AdminComplaint) => {
    setRows(list => list.map(r => (r.id === updated.id ? updated : r)));
    setSelected(updated);
  };

  if (error) {
    return (
      <div className="grid place-items-center py-16">
        <div className="surface bordered rounded-2xl p-8 max-w-md text-center elev-2">
          <AlertTriangle size={32} className="mx-auto mb-3" style={{ color: 'var(--color-danger)' }} aria-hidden="true" />
          <h2 className="font-display font-bold text-lg text-content">Could not load your queue</h2>
          <p className="text-sm text-content-3 mt-2">{error}</p>
          <Button className="mt-5" size="sm" variant="secondary" onClick={load}>Try again</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display font-bold text-2xl text-content">Your queue</h1>
          <p className="text-sm text-content-3 mt-0.5">
            {me
              ? `${me.principal.displayName} · ${Object.entries(me.principal.scope)
                  .filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(' · ') || 'all jurisdictions'}`
              : 'Loading…'}
          </p>
        </div>
        <Button size="sm" variant="secondary" icon={<RefreshCw size={14} />} onClick={load}>
          Refresh
        </Button>
      </header>

      {/* Counts, ordered by how alarming they are rather than alphabetically. */}
      <SkeletonRegion label="Queue summary">
        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton />
          </div>
        ) : (
        <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="Overdue"      value={stats.overdue}  Icon={AlertTriangle} tone="var(--color-danger)"  emphasise={stats.overdue > 0} />
          <Stat label="Due in 24h"   value={stats.soon}     Icon={Timer}         tone="var(--color-warning)" />
          <Stat label="Open"         value={stats.open}     Icon={Inbox}         tone="var(--color-cta)" />
          <Stat label="Resolved"     value={stats.resolved} Icon={CheckCircle2}  tone="var(--color-success)" />
        </dl>
        )}
      </SkeletonRegion>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 surface-2 bordered rounded-xl p-1" role="tablist" aria-label="Queue filter">
          {FILTERS.map(f => (
            <button
              key={f.key}
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => setFilter(f.key)}
              className="press px-3 py-1.5 rounded-lg text-[12px] font-bold transition-colors"
              style={{
                background: filter === f.key ? 'var(--color-cta)' : 'transparent',
                color: filter === f.key ? '#fff' : 'var(--color-content-3)',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="relative flex-1 min-w-[12rem]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-content-3" aria-hidden="true" />
          <label htmlFor="queue-search" className="sr-only">Search your queue</label>
          <input
            id="queue-search" value={q} onChange={e => setQ(e.target.value)}
            placeholder="Reference, category, area…"
            className="w-full h-10 pl-9 pr-3 rounded-xl text-[13px] bordered surface text-content
                       placeholder:text-[var(--color-content-3)] focus:outline-none focus:border-[var(--color-cta)]
                       focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-cta)_18%,transparent)]"
          />
        </div>
      </div>

      <SkeletonRegion label="Complaint queue">
        {loading ? (
          <div className="h-64 rounded-2xl surface-2" />
        ) : visible.length === 0 ? (
          <div className="surface bordered rounded-2xl p-10 text-center">
            <CheckCircle2 size={28} className="mx-auto mb-3" style={{ color: 'var(--color-success)' }} aria-hidden="true" />
            <p className="text-[14px] font-semibold text-content">
              {filter === 'overdue' ? 'Nothing is overdue.'
                : filter === 'today' ? 'Nothing is due in the next 24 hours.'
                : q ? 'Nothing matches that search.'
                : 'Your queue is clear.'}
            </p>
            <p className="text-[12.5px] text-content-3 mt-1">
              Only cases inside your jurisdiction appear here.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {visible.map(r => (
              <li key={r.id}>
                <button
                  onClick={() => setSelected(r)}
                  className="press w-full text-left surface bordered rounded-2xl p-3.5 flex items-start gap-3
                             hover:border-[var(--color-cta)] transition-colors"
                >
                  {/*
                    Priority carries a WORD, not just a dot. Critical and High
                    are adjacent oranges in this palette and are nearly
                    identical to a red-green colour-blind reader - and even
                    with perfect vision, a coloured dot with no legend is a
                    code the officer has to have memorised. The dot stays as a
                    fast scanning cue; the word is what actually says it.
                  */}
                  <span
                    className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded mt-0.5 shrink-0 text-white"
                    style={{ background: PRIORITY_TOKEN[r.priority] }}
                  >
                    {r.priority}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-mono text-[11.5px] font-bold text-content-3">{r.id}</span>
                      <span className="text-[13.5px] font-bold text-content">{r.category}</span>
                      <span className="text-[11px] font-bold px-1.5 py-0.5 rounded surface-2 text-content-2">
                        {r.statusLabel}
                      </span>
                    </span>
                    <span className="block text-[12.5px] text-content-3 mt-1 line-clamp-2 leading-snug">
                      {r.description}
                    </span>
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
                      <span className="text-[11.5px] text-content-3 flex items-center gap-1">
                        <MapPin size={11} aria-hidden="true" /> {r.district}
                      </span>
                      {r.escalationLevel > 0 && (
                        <span className="text-[11px] font-bold flex items-center gap-1" style={{ color: 'var(--color-warning)' }}>
                          <TrendingUp size={11} aria-hidden="true" /> Escalated ×{r.escalationLevel}
                        </span>
                      )}
                      <SlaClock deadline={r.slaDeadline} now={now} terminal={r.isTerminal} />
                    </span>
                  </span>
                  <ChevronRight size={16} className="text-content-3 shrink-0 mt-1" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </SkeletonRegion>

      <AnimatePresence>
        {selected && (
          <ComplaintDrawer
            complaint={selected}
            onClose={() => setSelected(null)}
            onUpdated={applyUpdate}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * The SLA countdown.
 *
 * Reads as time REMAINING while there is any, and as time ELAPSED once
 * breached — "4h left" and "2d overdue" are the two things an officer
 * actually needs, and a single signed number would make them read the same
 * shape and mean opposite things.
 */
function SlaClock({ deadline, now, terminal }: { deadline: string; now: number; terminal: boolean }) {
  const due = Date.parse(deadline);
  if (!Number.isFinite(due)) return null;

  if (terminal) {
    return <span className="text-[11.5px] text-content-3 flex items-center gap-1"><Clock size={11} aria-hidden="true" /> Closed</span>;
  }

  const diff = due - now;
  const overdue = diff < 0;
  const mins = Math.floor(Math.abs(diff) / 60_000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  const text = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;

  return (
    <span
      className="text-[11.5px] font-bold flex items-center gap-1"
      style={{ color: overdue ? 'var(--color-danger)' : diff < 4 * HOUR ? 'var(--color-warning)' : 'var(--color-content-3)' }}
    >
      <Clock size={11} aria-hidden="true" />
      {overdue ? `${text} overdue` : `${text} left`}
    </span>
  );
}

function Stat({
  label, value, Icon, tone, emphasise,
}: { label: string; value: number; Icon: typeof Inbox; tone: string; emphasise?: boolean }) {
  return (
    <div
      className="surface bordered rounded-2xl p-4"
      style={emphasise ? { borderColor: tone } : undefined}
    >
      <Icon size={15} style={{ color: tone }} aria-hidden="true" />
      <dd className="font-display font-bold text-2xl mt-2 text-content">{value}</dd>
      <dt className="text-[11px] font-bold uppercase tracking-wide text-content-3 mt-0.5">{label}</dt>
    </div>
  );
}
