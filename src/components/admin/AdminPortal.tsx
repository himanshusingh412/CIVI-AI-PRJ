import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line,
} from 'recharts';
import {
  ShieldAlert, Database, Search, RefreshCw, AlertTriangle, Activity,
  CheckCircle2, Clock, TrendingUp, FileWarning,
} from 'lucide-react';
import { Button } from '../Button';
import { Skeleton, StatCardSkeleton, SkeletonRegion } from '../Skeleton';
import { ComplaintDrawer } from './ComplaintDrawer';
import { useThemeTokens } from '../../hooks/useThemeTokens';
import {
  fetchMe, fetchComplaints, fetchAnalytics, fetchAudit, setDemoRole, getDemoRole,
  isAuthError, type AdminComplaint, type Analytics, type AuditEntry, type MeResponse,
} from '../../services/adminService';

const isDev = !!(import.meta as any).env?.DEV;

const DEMO_ROLES = [
  { key: 'super', label: 'Super Admin' },
  { key: 'state', label: 'State Admin' },
  { key: 'district', label: 'District Admin' },
  { key: 'dept', label: 'Dept Officer' },
  { key: 'field', label: 'Field Officer' },
  { key: 'auditor', label: 'Auditor' },
];

type Tab = 'overview' | 'complaints' | 'audit';

export function AdminPortal() {
  const chart = useThemeTokens();
  const [tab, setTab] = useState<Tab>('overview');
  const [me, setMe] = useState<MeResponse | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [complaints, setComplaints] = useState<AdminComplaint[]>([]);
  const [audit, setAudit] = useState<{ entries: AuditEntry[]; chain: { intact: boolean } } | null>(null);
  const [selected, setSelected] = useState<AdminComplaint | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(getDemoRole());

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [priority, setPriority] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [meRes, anRes, cRes] = await Promise.all([
      fetchMe(), fetchAnalytics(), fetchComplaints({ q, status, priority }),
    ]);

    if (isAuthError(meRes)) {
      setError(meRes.message);
      setLoading(false);
      return;
    }
    setMe(meRes);
    if (!isAuthError(anRes)) setAnalytics(anRes);
    if (!isAuthError(cRes)) setComplaints(cRes.complaints);

    // Auditors and admins can read the log; others get a 403 we simply ignore.
    const aRes = await fetchAudit(60);
    setAudit(isAuthError(aRes) ? null : { entries: aRes.entries, chain: aRes.chain });

    setLoading(false);
  }, [q, status, priority]);

  useEffect(() => { void load(); }, [load]);

  const switchRole = (r: string | null) => {
    setDemoRole(r);
    setRole(r);
    setSelected(null);
  };

  const toSeries = (rec: Record<string, number> | undefined) =>
    Object.entries(rec ?? {}).map(([name, value]) => ({ name, value }));

  const deptData = useMemo(() => toSeries(analytics?.byDepartment), [analytics]);
  const priorityData = useMemo(() => toSeries(analytics?.byPriority), [analytics]);
  const districtData = useMemo(() => toSeries(analytics?.byDistrict), [analytics]);

  if (error) {
    return (
      <div className="flex-1 grid place-items-center p-8">
        <div className="surface bordered rounded-2xl p-8 max-w-md text-center elev-2">
          <ShieldAlert size={40} className="mx-auto mb-4" style={{ color: 'var(--color-danger)' }} aria-hidden="true" />
          <h2 className="font-display font-bold text-lg text-content">Admin access required</h2>
          <p className="text-sm text-content-3 mt-2">{error}</p>
          {isDev && (
            <div className="mt-5">
              <p className="text-[12px] text-content-3 mb-2">Dev: preview a role</p>
              <div className="flex flex-wrap gap-2 justify-center">
                {DEMO_ROLES.map(r => (
                  <Button key={r.key} size="sm" variant="secondary" onClick={() => { switchRole(r.key); void load(); }}>
                    {r.label}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col gap-5 overflow-y-auto pr-1">
      {/* Non-durable storage is a correctness hazard, not a footnote. */}
      {me?.store && !me.store.durable && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-xl p-3.5 text-[13px] font-semibold"
          style={{ background: 'var(--color-warning-pale)', color: 'var(--color-warning)', border: '1px solid var(--color-warning)' }}
        >
          <Database size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{me.store.warning}</span>
        </div>
      )}

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display font-bold text-2xl text-content">Admin Portal</h1>
          <p className="text-sm text-content-3 mt-0.5">
            {me ? (
              <>
                {me.principal.displayName} ·{' '}
                <span className="font-mono text-[12px]">{me.principal.role}</span>
                {Object.keys(me.principal.scope).length > 0 && (
                  <> · scope: {Object.entries(me.principal.scope).map(([k, v]) => `${k}=${v}`).join(', ')}</>
                )}
              </>
            ) : 'Loading…'}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {isDev && (
            <div className="flex items-center gap-1 surface-2 bordered rounded-xl p-1" role="group" aria-label="Preview role">
              {DEMO_ROLES.map(r => (
                <button
                  key={r.key}
                  onClick={() => switchRole(r.key)}
                  aria-pressed={role === r.key}
                  className="press px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors"
                  style={{
                    background: role === r.key ? 'var(--color-cta)' : 'transparent',
                    color: role === r.key ? '#fff' : 'var(--color-content-3)',
                  }}
                >
                  {r.label}
                </button>
              ))}
            </div>
          )}
          <Button size="sm" variant="secondary" icon={<RefreshCw size={14} />} onClick={() => load()}>
            Refresh
          </Button>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex gap-1 surface-2 bordered rounded-xl p-1 w-fit" role="tablist">
        {(['overview', 'complaints', 'audit'] as Tab[]).map(t => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className="press px-4 py-1.5 rounded-lg text-xs font-bold capitalize transition-colors"
            style={{
              background: tab === t ? 'var(--color-cta)' : 'transparent',
              color: tab === t ? '#fff' : 'var(--color-content-3)',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.28, ease: [0.16, 1, 0.3, 1] } }}
          exit={{ opacity: 0, y: -6, transition: { duration: 0.16 } }}
          className="flex flex-col gap-5"
        >
          {tab === 'overview' && (
            <>
              {loading ? (
                <SkeletonRegion label="Loading statistics">
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {Array.from({ length: 8 }).map((_, i) => <StatCardSkeleton key={i} />)}
                  </div>
                </SkeletonRegion>
              ) : (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <Stat label="Total" value={analytics?.totals.total ?? 0} icon={<Activity size={18} />} tone="cta" />
                  <Stat label="Active" value={analytics?.totals.active ?? 0} icon={<TrendingUp size={18} />} tone="cta" />
                  <Stat label="Pending" value={analytics?.totals.pending ?? 0} icon={<Clock size={18} />} tone="warning" />
                  <Stat label="Resolved" value={analytics?.totals.resolved ?? 0} icon={<CheckCircle2 size={18} />} tone="success" />
                  <Stat label="Escalated" value={analytics?.totals.escalated ?? 0} icon={<AlertTriangle size={18} />} tone="danger" />
                  <Stat label="SLA breached" value={analytics?.totals.overdue ?? 0} icon={<FileWarning size={18} />} tone="danger" />
                  <Stat label="New today" value={analytics?.totals.today ?? 0} icon={<Activity size={18} />} tone="cta" />
                  <Stat
                    label="Avg resolution"
                    value={analytics ? `${analytics.avgResolutionHours}h` : '—'}
                    icon={<Clock size={18} />}
                    tone="cta"
                  />
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <ChartCard title="By department">
                  {loading ? <Skeleton className="h-[260px] w-full" /> : (
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={deptData} layout="vertical" margin={{ left: 12, right: 16 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={chart.grid} />
                        <XAxis type="number" hide />
                        <YAxis dataKey="name" type="category" width={130} axisLine={false} tickLine={false}
                               style={{ fontSize: 11, fill: chart.axis }} />
                        <Tooltip contentStyle={chart.tooltip} cursor={{ fill: chart.grid, fillOpacity: 0.25 }} />
                        <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={18}>
                          {deptData.map((_, i) => <Cell key={i} fill={chart.series[i % chart.series.length]} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </ChartCard>

                <ChartCard title="By priority">
                  {loading ? <Skeleton className="h-[260px] w-full" /> : (
                    <ResponsiveContainer width="100%" height={260}>
                      <PieChart>
                        <Pie data={priorityData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95} paddingAngle={3}>
                          {priorityData.map((d, i) => (
                            <Cell key={i} fill={chart.priority[d.name as keyof typeof chart.priority] ?? chart.series[i % chart.series.length]} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={chart.tooltip} />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </ChartCard>

                <ChartCard title="By district" className="lg:col-span-2">
                  {loading ? <Skeleton className="h-[240px] w-full" /> : (
                    <ResponsiveContainer width="100%" height={240}>
                      <LineChart data={districtData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chart.grid} />
                        <XAxis dataKey="name" axisLine={false} tickLine={false} style={{ fontSize: 11, fill: chart.axis }} />
                        <YAxis axisLine={false} tickLine={false} allowDecimals={false} style={{ fontSize: 11, fill: chart.axis }} />
                        <Tooltip contentStyle={chart.tooltip} />
                        <Line type="monotone" dataKey="value" stroke={chart.series[0]} strokeWidth={3}
                              dot={{ fill: chart.series[0], r: 4, strokeWidth: 2, stroke: chart.surface }} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </ChartCard>
              </div>
            </>
          )}

          {tab === 'complaints' && (
            <>
              <div className="flex flex-wrap gap-2 items-center">
                <div className="relative flex-1 min-w-[220px]">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-content-3" aria-hidden="true" />
                  <label htmlFor="admin-search" className="sr-only-focusable">Search complaints</label>
                  <input
                    id="admin-search"
                    value={q}
                    onChange={e => setQ(e.target.value)}
                    placeholder="Search ID, description, category…"
                    className="field w-full h-10 pl-9 pr-3 rounded-xl text-sm outline-none border-2"
                    style={{ background: 'var(--color-surface)', color: 'var(--color-content)', borderColor: 'var(--color-border-strong)' }}
                  />
                </div>
                <Select label="Status" value={status} onChange={setStatus}
                        options={['all', 'submitted', 'department_assigned', 'officer_assigned', 'work_in_progress', 'resolved', 'closed']} />
                <Select label="Priority" value={priority} onChange={setPriority}
                        options={['all', 'Critical', 'High', 'Medium', 'Low']} />
              </div>

              <div className="surface bordered rounded-2xl overflow-hidden elev-2">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <caption className="sr-only-focusable">Complaints visible to your role</caption>
                    <thead>
                      <tr className="surface-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
                        {['ID', 'Category', 'District', 'Department', 'Priority', 'Status', 'SLA'].map(h => (
                          <th key={h} scope="col" className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-content-3">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {loading ? (
                        Array.from({ length: 4 }).map((_, i) => (
                          <tr key={i}>
                            {Array.from({ length: 7 }).map((__, j) => (
                              <td key={j} className="px-4 py-3"><Skeleton className="h-3 w-20" /></td>
                            ))}
                          </tr>
                        ))
                      ) : complaints.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-14 text-center">
                            <p className="font-semibold text-content">No complaints in your scope</p>
                            <p className="text-[13px] text-content-3 mt-1">
                              Your role only sees records inside its jurisdiction. Try a different role or clear the filters.
                            </p>
                          </td>
                        </tr>
                      ) : complaints.map(c => {
                        const overdue = Date.parse(c.slaDeadline) < Date.now() && !c.isTerminal;
                        return (
                          <tr
                            key={c.id}
                            tabIndex={0}
                            onClick={() => setSelected(c)}
                            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(c); } }}
                            className="cursor-pointer transition-colors hover:bg-[var(--color-surface-2)] focus-visible:bg-[var(--color-surface-2)]"
                            style={{ borderBottom: '1px solid var(--color-border)' }}
                          >
                            <td className="px-4 py-3 font-mono text-[12px] font-bold text-content">{c.id}</td>
                            <td className="px-4 py-3 text-content-2">{c.category}</td>
                            <td className="px-4 py-3 text-content-2">{c.district}</td>
                            <td className="px-4 py-3 text-content-2">{c.department ?? '—'}</td>
                            <td className="px-4 py-3">
                              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full text-white"
                                    style={{ background: `var(--color-priority-${c.priority.toLowerCase()})` }}>
                                {c.priority}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-[12px] font-semibold text-content-2">{c.statusLabel}</td>
                            <td className="px-4 py-3 text-[12px] font-semibold"
                                style={{ color: overdue ? 'var(--color-danger)' : 'var(--color-content-3)' }}>
                              {overdue ? 'Breached' : new Date(c.slaDeadline).toLocaleDateString()}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {tab === 'audit' && (
            <div className="surface bordered rounded-2xl overflow-hidden elev-2">
              {audit === null ? (
                <p className="p-8 text-center text-sm text-content-3">
                  Your role cannot read the audit log.
                </p>
              ) : (
                <>
                  <div className="px-4 py-3 surface-2 flex items-center gap-2"
                       style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <span className="text-[11px] font-bold uppercase tracking-wide text-content-3">
                      Hash chain
                    </span>
                    <span
                      className="text-[11px] font-bold px-2 py-0.5 rounded-full text-white"
                      style={{ background: audit.chain.intact ? 'var(--color-success)' : 'var(--color-danger)' }}
                    >
                      {audit.chain.intact ? 'Intact' : 'TAMPERED'}
                    </span>
                  </div>
                  <ul className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
                    {audit.entries.length === 0 && (
                      <li className="p-8 text-center text-sm text-content-3">No activity recorded yet.</li>
                    )}
                    {audit.entries.map(e => (
                      <li key={e.id} className="px-4 py-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="font-mono text-[11px] text-content-3">#{e.seq}</span>
                        <span className="text-[13px] font-bold text-content">{e.action}</span>
                        <span className="text-[12px] text-content-2">{e.targetId}</span>
                        <span className="text-[12px] text-content-3">
                          {e.actorRole} · {new Date(e.at).toLocaleString()}
                        </span>
                        {e.detail && (
                          <code className="text-[11px] text-content-3">{JSON.stringify(e.detail)}</code>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      <AnimatePresence>
        {selected && (
          <ComplaintDrawer
            complaint={selected}
            onClose={() => setSelected(null)}
            onUpdated={c => {
              setSelected(c);
              setComplaints(prev => prev.map(x => (x.id === c.id ? c : x)));
              void load();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

const TONE: Record<string, string> = {
  cta: 'var(--color-cta)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  danger: 'var(--color-danger)',
};

function Stat({ label, value, icon, tone }: { label: string; value: number | string; icon: React.ReactNode; tone: string }) {
  return (
    <div className="surface bordered rounded-2xl p-4 elev-2 lift flex flex-col gap-2">
      <div className="w-9 h-9 rounded-xl grid place-items-center text-white" style={{ background: TONE[tone] }}>
        {icon}
      </div>
      <span className="text-[11px] font-bold uppercase tracking-wide text-content-3">{label}</span>
      <span className="text-2xl font-display font-bold text-content leading-none">{value}</span>
    </div>
  );
}

function ChartCard({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`surface bordered rounded-2xl p-5 elev-2 ${className}`}>
      <h3 className="font-display font-bold text-sm text-content mb-4">{title}</h3>
      {children}
    </section>
  );
}

function Select({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: string[];
}) {
  const id = `filter-${label.toLowerCase()}`;
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-[12px] font-bold text-content-3">{label}</label>
      <select
        id={id}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="field h-10 px-3 rounded-xl text-sm outline-none border-2"
        style={{ background: 'var(--color-surface)', color: 'var(--color-content)', borderColor: 'var(--color-border-strong)' }}
      >
        {options.map(o => <option key={o} value={o}>{o === 'all' ? 'All' : o.replace(/_/g, ' ')}</option>)}
      </select>
    </div>
  );
}
