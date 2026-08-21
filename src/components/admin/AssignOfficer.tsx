import { useEffect, useState } from 'react';
import { UserPlus, ChevronRight, AlertTriangle } from 'lucide-react';
import { Button } from '../Button';
import {
  fetchOfficers, assignOfficer, isAuthError,
  type AdminComplaint, type AssignableOfficer,
} from '../../services/adminService';
import { useT } from '../../i18n/I18nContext';

/**
 * Assign or reassign a complaint.
 *
 * The dropdown is populated from GET /api/admin/officers, narrowed by THIS
 * complaint's department, district and ward. Two reasons it is fetched rather
 * than filtered from some roster already in memory:
 *
 *   1. The server applies the same rbac.inScope() check that the assign
 *      endpoint applies, so every option shown is one the submit will
 *      accept. A locally filtered list would eventually disagree with the
 *      server and offer choices that fail on click.
 *   2. Holding the full roster client-side would mean shipping the staffing
 *      of every department and ward to anyone who opens devtools.
 *
 * A `reason` is required when REASSIGNING and absent on a first assignment:
 * the interesting question about a handover is why the previous officer
 * stopped holding it, and there is no previous officer the first time.
 */
export function AssignOfficer({
  complaint,
  onAssigned,
}: {
  complaint: AdminComplaint;
  onAssigned: (c: AdminComplaint) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [officers, setOfficers] = useState<AssignableOfficer[] | null>(null);
  const [officerId, setOfficerId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isReassignment = !!complaint.assignment;

  useEffect(() => {
    if (!open || officers) return;
    let cancelled = false;
    (async () => {
      const res = await fetchOfficers({
        department: complaint.department,
        district: complaint.district,
        ward: complaint.ward,
      });
      if (cancelled) return;
      if (isAuthError(res)) { setError(res.message); setOfficers([]); return; }
      setOfficers(res.officers);
    })();
    return () => { cancelled = true; };
  }, [open, officers, complaint.department, complaint.district, complaint.ward]);

  const submit = async () => {
    if (!officerId || busy) return;
    setBusy(true);
    setError(null);
    const res = await assignOfficer(complaint.id, officerId, reason.trim() || undefined);
    setBusy(false);
    if (isAuthError(res)) { setError(res.message); return; }
    setOpen(false);
    setOfficerId('');
    setReason('');
    // The roster is re-fetched next time: an officer may have been made
    // unavailable since it was cached.
    setOfficers(null);
    onAssigned(res.complaint);
  };

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <UserPlus size={14} aria-hidden="true" />
        {isReassignment ? t('assign.reassign') : t('assign.assign')}
      </Button>
    );
  }

  const canSubmit = !!officerId && !busy && (!isReassignment || reason.trim().length > 0);

  return (
    <div className="surface-2 rounded-xl p-4 space-y-3">
      <p className="text-[11px] font-bold uppercase tracking-widest text-content-3">
        {isReassignment ? t('assign.reassign') : t('assign.assign')}
      </p>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 p-2.5 rounded-lg text-[12px] font-semibold"
          style={{
            background: 'var(--color-danger-pale)',
            border: '1px solid var(--color-danger)',
            color: 'var(--color-danger)',
          }}
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <div>
        <label htmlFor="assign-officer" className="block text-[12px] font-semibold mb-1 text-content">
          {t('assign.selectOfficer')}
        </label>
        <select
          id="assign-officer"
          value={officerId}
          onChange={e => setOfficerId(e.target.value)}
          disabled={!officers}
          className="w-full h-10 px-3 rounded-lg border-2 text-sm outline-none focus:border-cta"
          style={{
            background: 'var(--color-surface)',
            color: 'var(--color-content)',
            borderColor: 'var(--color-border-strong)',
          }}
        >
          <option value="">
            {!officers ? '…' : officers.length ? t('assign.selectOfficer') : t('assign.noOfficersAvailable')}
          </option>
          {(officers ?? [])
            // The officer currently holding it is not a reassignment target.
            .filter(o => o.id !== complaint.assignment?.officerId)
            .map(o => (
              <option key={o.id} value={o.id}>
                {o.name}{o.employeeId ? ` · ${o.employeeId}` : ''}{o.ward ? ` · ${o.ward}` : ''}
              </option>
            ))}
        </select>
      </div>

      {isReassignment && (
        <div>
          <label htmlFor="assign-reason" className="block text-[12px] font-semibold mb-1 text-content">
            {t('assign.reason')}
          </label>
          <input
            id="assign-reason"
            type="text"
            value={reason}
            onChange={e => setReason(e.target.value)}
            maxLength={300}
            placeholder={t('assign.reasonPlaceholder')}
            className="w-full h-10 px-3 rounded-lg border-2 text-sm outline-none focus:border-cta"
            style={{
              background: 'var(--color-surface)',
              color: 'var(--color-content)',
              borderColor: 'var(--color-border-strong)',
            }}
          />
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={submit} disabled={!canSubmit} loadingText={t('assign.saving')}>
          {t('assign.confirm')}
          <ChevronRight size={14} aria-hidden="true" />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setError(null); }}>
          {t('assign.cancel')}
        </Button>
      </div>
    </div>
  );
}
