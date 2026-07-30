import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { X, Clock, MapPin, User, Building2, AlertTriangle, ShieldCheck } from 'lucide-react';
import { Button } from '../Button';
import { changeStatus, isAuthError, type AdminComplaint } from '../../services/adminService';

const PRIORITY_TOKEN: Record<string, string> = {
  Critical: 'var(--color-priority-critical)',
  High: 'var(--color-priority-high)',
  Medium: 'var(--color-priority-medium)',
  Low: 'var(--color-priority-low)',
};

/**
 * Complaint detail + workflow actions.
 *
 * The action buttons come from `availableTransitions`, which the SERVER
 * computes for the caller's role — the client never derives what's allowed.
 * A rejected transition still surfaces the server's reason rather than a
 * generic failure, because "you can't do that yet" and "that's not your
 * jurisdiction" need different responses from the user.
 */
export function ComplaintDrawer({
  complaint,
  onClose,
  onUpdated,
}: {
  complaint: AdminComplaint;
  onClose: () => void;
  onUpdated: (c: AdminComplaint) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');

  // Escape closes — a drawer without a keyboard exit is a trap.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const overdue = Date.parse(complaint.slaDeadline) < Date.now() && !complaint.isTerminal;

  const doTransition = async (to: string) => {
    setError(null);
    const res = await changeStatus(complaint.id, to, note.trim() || undefined);
    if (isAuthError(res)) { setError(res.message); return; }
    setNote('');
    onUpdated(res.complaint);
  };

  return (
    <div
      className="fixed inset-0 flex justify-end"
      style={{ zIndex: 'var(--z-modal)' as any, background: 'var(--color-overlay)' }}
      onClick={onClose}
    >
      <motion.aside
        role="dialog"
        aria-modal="true"
        aria-label={`Complaint ${complaint.id}`}
        initial={{ x: 40, opacity: 0 }}
        animate={{ x: 0, opacity: 1, transition: { type: 'spring', stiffness: 340, damping: 34 } }}
        exit={{ x: 40, opacity: 0, transition: { duration: 0.18 } }}
        onClick={e => e.stopPropagation()}
        className="surface h-full w-full max-w-xl overflow-y-auto elev-4 flex flex-col"
      >
        <header
          className="sticky top-0 surface px-6 py-5 flex items-start justify-between gap-4 border-b"
          style={{ borderColor: 'var(--color-border)', zIndex: 1 }}
        >
          <div className="min-w-0">
            <p className="font-mono text-[12px] font-bold text-content-3">{complaint.id}</p>
            <h2 className="font-display font-bold text-xl text-content mt-0.5 truncate">
              {complaint.category}
            </h2>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span
                className="text-[11px] font-bold px-2 py-0.5 rounded-full text-white"
                style={{ background: PRIORITY_TOKEN[complaint.priority] }}
              >
                {complaint.priority}
              </span>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full surface-2 text-content-2">
                {complaint.statusLabel}
              </span>
              {overdue && (
                <span
                  className="text-[11px] font-bold px-2 py-0.5 rounded-full text-white flex items-center gap-1"
                  style={{ background: 'var(--color-danger)' }}
                >
                  <AlertTriangle size={11} aria-hidden="true" /> SLA breached
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close details"
            className="press w-9 h-9 rounded-full grid place-items-center surface-2 text-content-2 shrink-0"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <div className="px-6 py-5 flex flex-col gap-6">
          {/* Progress */}
          <div>
            <div className="flex justify-between text-[12px] font-bold text-content-3 mb-2">
              <span>Progress</span>
              <span>{complaint.progress}%</span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-surface-3)' }}>
              <motion.div
                className="h-full rounded-full"
                style={{ background: 'linear-gradient(90deg, var(--color-cta), var(--color-saffron))' }}
                initial={{ width: 0 }}
                animate={{ width: `${complaint.progress}%` }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-3">
            <Field icon={<User size={13} />} label="Citizen" value={complaint.citizenName} />
            <Field icon={<Clock size={13} />} label="Contact" value={complaint.citizenPhone} mono />
            <Field icon={<Building2 size={13} />} label="Department" value={complaint.department ?? 'Unassigned'} />
            <Field icon={<User size={13} />} label="Officer" value={complaint.assignedOfficerName ?? 'Unassigned'} />
            <Field icon={<MapPin size={13} />} label="District" value={`${complaint.district}, ${complaint.state}`} />
            <Field
              icon={<Clock size={13} />}
              label="SLA deadline"
              value={new Date(complaint.slaDeadline).toLocaleString()}
              danger={overdue}
            />
          </dl>

          <div className="surface-2 rounded-xl p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-content-3 mb-2">Description</p>
            <p className="text-sm text-content-2 leading-relaxed">{complaint.description}</p>
          </div>

          {/* Workflow actions — server-provided */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-content-3 mb-2">Actions</p>

            {error && (
              <div
                role="alert"
                className="state-error text-[13px] font-semibold rounded-xl p-3 mb-3"
                style={{ background: 'var(--color-danger-pale)', color: 'var(--color-danger)', border: '1px solid var(--color-danger)' }}
              >
                {error}
              </div>
            )}

            {complaint.availableTransitions.length === 0 ? (
              <p className="text-sm text-content-3 flex items-center gap-2">
                <ShieldCheck size={14} aria-hidden="true" />
                No actions available to your role from this state.
              </p>
            ) : (
              <>
                <label htmlFor="note" className="sr-only-focusable">Note (optional)</label>
                <textarea
                  id="note"
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  maxLength={2000}
                  rows={2}
                  placeholder="Add a note (optional)…"
                  className="field w-full rounded-xl p-3 text-sm outline-none border-2 mb-3 resize-none"
                  style={{
                    background: 'var(--color-surface)',
                    color: 'var(--color-content)',
                    borderColor: 'var(--color-border-strong)',
                  }}
                />
                <div className="flex flex-wrap gap-2">
                  {complaint.availableTransitions.map(t => (
                    <Button
                      key={t.to}
                      size="sm"
                      variant={t.to === 'closed' ? 'primary' : 'secondary'}
                      loadingText="Working…"
                      onClick={() => doTransition(t.to)}
                    >
                      {t.label}
                    </Button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Timeline */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-content-3 mb-3">Timeline</p>
            <ol className="relative pl-6">
              <span
                aria-hidden="true"
                className="absolute left-[7px] top-1 bottom-1 w-px"
                style={{ background: 'var(--color-border)' }}
              />
              {[...complaint.timeline].reverse().map((t, i) => (
                <li key={`${t.at}-${i}`} className="relative pb-5 last:pb-0">
                  <span
                    aria-hidden="true"
                    className="absolute -left-[22px] top-1 w-3.5 h-3.5 rounded-full border-2"
                    style={{
                      background: i === 0 ? 'var(--color-cta)' : 'var(--color-surface)',
                      borderColor: i === 0 ? 'var(--color-cta)' : 'var(--color-border-strong)',
                    }}
                  />
                  <p className="text-sm font-bold text-content">{t.status}</p>
                  <p className="text-[12px] text-content-3">
                    {new Date(t.at).toLocaleString()} · {t.actorName}
                  </p>
                  {t.note && <p className="text-[13px] text-content-2 mt-1">{t.note}</p>}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </motion.aside>
    </div>
  );
}

function Field({
  icon, label, value, mono, danger,
}: { icon: React.ReactNode; label: string; value: string; mono?: boolean; danger?: boolean }) {
  return (
    <div className="surface-2 rounded-xl p-3">
      <dt className="text-[11px] font-bold uppercase tracking-wide text-content-3 flex items-center gap-1.5">
        {icon} {label}
      </dt>
      <dd
        className={`text-[13px] font-semibold mt-1 ${mono ? 'font-mono' : ''}`}
        style={{ color: danger ? 'var(--color-danger)' : 'var(--color-content)' }}
      >
        {value}
      </dd>
    </div>
  );
}
