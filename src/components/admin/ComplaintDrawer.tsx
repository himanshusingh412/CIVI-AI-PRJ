import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { X, Clock, MapPin, User, Building2, AlertTriangle, ShieldCheck, Image, MessageSquare, Eye, EyeOff } from 'lucide-react';
import { Button } from '../Button';
import { changeStatus, addNote, isAuthError, type AdminComplaint } from '../../services/adminService';
import { useT } from '../../i18n/I18nContext';
import { statusLabel, departmentLabel, roleLabel } from '../../i18n/labels';

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
  // `t` is the translate function throughout this file. The transition and
  // timeline maps below were originally written as `.map(t => …)`, which
  // shadowed it in exactly two branches; they now bind `tx` and `ev` so that
  // `t` means one thing everywhere in this component.
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [noteVisibility, setNoteVisibility] = useState<'internal' | 'public'>('internal');
  const [savingNote, setSavingNote] = useState(false);

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

  /**
   * A note WITHOUT advancing the case.
   *
   * Before this, the only way to record "called the citizen, no answer" was
   * to change the status - which quietly turned the status history into a
   * log of things that did not happen. Recording work and reporting progress
   * are different acts and now have different buttons.
   */
  const saveNote = async () => {
    const body = note.trim();
    if (!body) return;
    setError(null); setSavingNote(true);
    const res = await addNote(complaint.id, body, noteVisibility);
    setSavingNote(false);
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
                {statusLabel(t, complaint.status)}
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
            aria-label={t('complaintDrawer.closeDetails')}
            className="press w-9 h-9 rounded-full grid place-items-center surface-2 text-content-2 shrink-0"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <div className="px-6 py-5 flex flex-col gap-6">
          {/* Progress */}
          <div>
            <div className="flex justify-between text-[12px] font-bold text-content-3 mb-2">
              <span>{t('complaintDrawer.progress')}</span>
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
            <p className="text-[11px] font-bold uppercase tracking-widest text-content-3 mb-2">{t('complaintDrawer.description')}</p>
            <p className="text-sm text-content-2 leading-relaxed">{complaint.description}</p>
          </div>

          {/* Evidence the citizen attached. An officer arguing about whether
              a problem is real needs to see this before anything else. */}
          {complaint.attachments?.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-content-3 mb-2 flex items-center gap-1.5">
                <Image size={12} aria-hidden="true" /> Citizen evidence ({complaint.attachments.length})
              </p>
              <div className="grid grid-cols-3 gap-2">
                {complaint.attachments.map(a => (
                  <a
                    key={a.id}
                    href={`/api/media/${encodeURIComponent(a.id)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="press rounded-xl overflow-hidden bordered aspect-square block"
                    aria-label={`Open evidence ${a.filename}`}
                  >
                    <img
                      src={`/api/media/${encodeURIComponent(a.id)}`}
                      alt=""
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Internal notes. Staff-only by construction: the server strips
              these entirely for roles that cannot see contact details. */}
          {complaint.internalNotes?.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-content-3 mb-2 flex items-center gap-1.5">
                <EyeOff size={12} aria-hidden="true" /> Internal notes — not shown to the citizen
              </p>
              <ul className="space-y-2">
                {complaint.internalNotes.map((n, i) => (
                  <li key={`${n.at}-${i}`} className="surface-2 rounded-xl p-3">
                    <p className="text-[13px] text-content-2 leading-relaxed">{n.body}</p>
                    <p className="text-[11px] text-content-3 mt-1.5">
                      {n.authorName} · {new Date(n.at).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Workflow actions — server-provided */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-content-3 mb-2">{t('complaintDrawer.actions')}</p>

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
                <label htmlFor="note" className="sr-only-focusable">{t('complaintDrawer.noteOptional')}</label>
                <textarea
                  id="note"
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  maxLength={2000}
                  rows={2}
                  placeholder={t('complaintDrawer.addANoteOptional')}
                  className="field w-full rounded-xl p-3 text-sm outline-none border-2 mb-3 resize-none"
                  style={{
                    background: 'var(--color-surface)',
                    color: 'var(--color-content)',
                    borderColor: 'var(--color-border-strong)',
                  }}
                />
                {/* Who will read this. The control is deliberately explicit
                    and defaults to internal, because publishing an officer's
                    working note to the complainant is not recoverable. */}
                <div className="flex items-center gap-1 mb-3 surface-2 bordered rounded-xl p-1 w-fit"
                     role="group" aria-label={t('complaintDrawer.whoCanSeeThisNote')}>
                  {([
                    { key: 'internal' as const, label: 'Staff only', Icon: EyeOff },
                    { key: 'public' as const, label: 'Visible to citizen', Icon: Eye },
                  ]).map(o => (
                    <button
                      key={o.key}
                      onClick={() => setNoteVisibility(o.key)}
                      aria-pressed={noteVisibility === o.key}
                      className="press px-2.5 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1.5 transition-colors"
                      style={{
                        background: noteVisibility === o.key ? 'var(--color-cta)' : 'transparent',
                        color: noteVisibility === o.key ? '#fff' : 'var(--color-content-3)',
                      }}
                    >
                      <o.Icon size={11} aria-hidden="true" /> {o.label}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<MessageSquare size={14} />}
                    disabled={!note.trim()}
                    loading={savingNote}
                    loadingText={t('complaintDrawer.saving')}
                    onClick={saveNote}
                  >
                    Save note only
                  </Button>
                  {complaint.availableTransitions.map(tx => (
                    <Button
                      key={tx.to}
                      size="sm"
                      variant={tx.to === 'closed' ? 'primary' : 'secondary'}
                      loadingText={t('complaintDrawer.working')}
                      onClick={() => doTransition(tx.to)}
                    >
                      {tx.label}
                    </Button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/*
            Assignment panel.
            Deliberately its own block rather than a line in the field grid:
            "assigned to Amit Sharma" on its own is unfalsifiable — there is
            no way to tell a deliberate routing decision from a mis-click
            three weeks ago. Who handed it over, and when, is what makes the
            assignment auditable, so the two are shown together or not at all.
          */}
          {complaint.assignment && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-content-3 mb-2">
                {t('assign.assignment')}
              </p>
              <div className="surface-2 rounded-xl p-4 space-y-3">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-content-3">{t('assign.assignedTo')}</p>
                  <p className="text-sm font-bold text-content">
                    {complaint.assignment.officerName}
                    {complaint.assignment.employeeId && (
                      <span className="ml-2 font-mono text-[11px] font-semibold text-content-3">
                        {complaint.assignment.employeeId}
                      </span>
                    )}
                  </p>
                  <p className="text-[12px] text-content-3">
                    {[
                      departmentLabel(t, complaint.assignment.department),
                      complaint.assignment.district,
                      complaint.assignment.ward,
                    ].filter(Boolean).join(' · ')}
                  </p>
                </div>

                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-content-3">{t('assign.assignedBy')}</p>
                  <p className="text-sm font-semibold text-content">
                    {complaint.assignment.assignedByName}
                  </p>
                  <p className="text-[12px] text-content-3">{roleLabel(t, complaint.assignment.assignedByRole)}</p>
                </div>

                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-content-3">{t('assign.assignedOn')}</p>
                  <p className="text-[13px] text-content-2">
                    {new Date(complaint.assignment.assignedAt).toLocaleString()}
                  </p>
                </div>

                {complaint.assignment.reason && (
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-content-3">{t('assign.reason')}</p>
                    <p className="text-[13px] text-content-2">{complaint.assignment.reason}</p>
                  </div>
                )}

                {/* Prior holders. Only rendered once there IS a prior holder,
                    so an ordinary single-assignment complaint stays quiet. */}
                {(complaint.assignmentHistory?.length ?? 0) > 1 && (
                  <details className="pt-1">
                    <summary className="text-[12px] font-semibold text-cta cursor-pointer">
                      {t('assign.previousAssignments')}
                    </summary>
                    <ul className="mt-2 space-y-2">
                      {complaint.assignmentHistory!
                        .filter(a => !a.isCurrent)
                        .reverse()
                        .map((a, i) => (
                          <li key={`${a.officerId}-${a.assignedAt}-${i}`} className="text-[12px] text-content-3">
                            <span className="font-semibold text-content-2">{a.officerName}</span>
                            {' · '}
                            {new Date(a.assignedAt).toLocaleDateString()}
                            {a.unassignedAt && ` → ${new Date(a.unassignedAt).toLocaleDateString()}`}
                            {a.reason && <span className="block italic">{a.reason}</span>}
                          </li>
                        ))}
                    </ul>
                  </details>
                )}
              </div>
            </div>
          )}

          {/* Timeline */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-content-3 mb-3">{t('complaintDrawer.timeline')}</p>
            <ol className="relative pl-6">
              <span
                aria-hidden="true"
                className="absolute left-[7px] top-1 bottom-1 w-px"
                style={{ background: 'var(--color-border)' }}
              />
              {[...complaint.timeline].reverse().map((ev, i) => (
                <li key={`${ev.at}-${i}`} className="relative pb-5 last:pb-0">
                  <span
                    aria-hidden="true"
                    className="absolute -left-[22px] top-1 w-3.5 h-3.5 rounded-full border-2"
                    style={{
                      background: i === 0 ? 'var(--color-cta)' : 'var(--color-surface)',
                      borderColor: i === 0 ? 'var(--color-cta)' : 'var(--color-border-strong)',
                    }}
                  />
                  <p className="text-sm font-bold text-content">{statusLabel(t, ev.status)}</p>
                  <p className="text-[12px] text-content-3">
                    {new Date(ev.at).toLocaleString()} · {ev.actorName}
                  </p>
                  {ev.note && <p className="text-[13px] text-content-2 mt-1">{ev.note}</p>}
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
