import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, Check, CheckCircle2, FileText, Info, Loader2,
  Lock, Moon, ShieldCheck, Sun, Trash2, Upload, X, XCircle,
} from 'lucide-react';
import { Button } from '../components/Button';
import { IntegrationBadge } from '../components/IntegrationBadge';
import { LanguagePicker } from '../components/LanguagePicker';
import { useTheme } from '../context/ThemeContext';
import { useI18n } from '../i18n/I18nContext';
import {
  getSession, uploadDocument, removeDocument, clearDocuments, forgetEverything,
  verifyDocuments, startDigiLocker, listDigiLockerDocuments, importDigiLockerDocuments,
  type DocumentSession, type SessionDocument, type Severity, type DigiLockerDoc,
} from '../services/documentService';

/**
 * /portal/documents - AI Document Verification.
 *
 * =========================================================================
 * The one thing this screen must get right
 * =========================================================================
 * It is telling someone that their own government documents disagree with
 * each other. That is alarming news, and the natural failure is to deliver
 * it either too casually (buried among six green ticks) or too harshly
 * (a red banner that reads like an accusation).
 *
 * So the hierarchy is fixed: the verdict first, in plain words, with the
 * blocking problem at the top and the harmless spelling variants collapsed
 * below it. Every finding shows the RAW values side by side, because the
 * citizen is the only person in the loop who knows which one is right - and
 * they cannot judge that from a similarity score.
 *
 * Three phrases this page never uses: "verified" as a synonym for approved,
 * "invalid" about a document, and any sentence that picks which value is
 * correct.
 * =========================================================================
 */

const SEVERITY_STYLE: Record<Severity, { bg: string; fg: string; Icon: typeof Check; word: string }> = {
  ok:       { bg: 'var(--color-success-pale)', fg: 'var(--color-success)', Icon: CheckCircle2,  word: 'Matches' },
  info:     { bg: 'var(--color-info-pale)',    fg: 'var(--color-info)',    Icon: Info,          word: 'Minor difference' },
  warning:  { bg: 'var(--color-warning-pale)', fg: 'var(--color-warning)', Icon: AlertTriangle, word: 'Worth checking' },
  critical: { bg: 'var(--color-danger-pale)',  fg: 'var(--color-danger)',  Icon: XCircle,       word: 'Fix before applying' },
};

const OVERALL: Record<string, { title: string; tone: Severity }> = {
  verified:           { title: 'Your documents agree with each other', tone: 'ok' },
  review_recommended: { title: 'A few things are worth checking',      tone: 'warning' },
  action_required:    { title: 'Sort this out before you apply',       tone: 'critical' },
  insufficient:       { title: 'Add another document to compare',      tone: 'info' },
};

const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';

export function DocumentVerificationPage() {
  const { t } = useI18n();
  const { isDark, toggleTheme } = useTheme();
  const [params, setParams] = useSearchParams();

  const [session, setSession] = useState<DocumentSession | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [locker, setLocker] = useState<DigiLockerDoc[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try { setSession(await getSession()); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load your session.'); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  /** The DigiLocker round trip comes back as a query parameter. */
  useEffect(() => {
    const status = params.get('digilocker');
    if (!status) return;
    if (status === 'authorised') {
      setNotice('DigiLocker authorised. Choose which documents to share.');
      void (async () => {
        try { setLocker((await listDigiLockerDocuments()).documents); }
        catch (e) { setError(e instanceof Error ? e.message : 'Could not list your documents.'); }
      })();
    } else if (status === 'failed') {
      setError('DigiLocker authorisation did not complete. Nothing was shared.');
    } else if (status === 'expired') {
      setError('That authorisation request expired. Please start again.');
    }
    params.delete('digilocker');
    setParams(params, { replace: true });
  }, [params, setParams]);

  const withBusy = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setError(null);
    try { await fn(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.'); }
    finally { setBusy(null); }
  };

  const handleFiles = (files: FileList | null) => {
    if (!files?.length) return;
    void withBusy('upload', async () => {
      // Sequential, not parallel: each upload runs an extraction, and firing
      // six model calls at once is how a rate limit turns into five silent
      // failures the citizen cannot distinguish from unreadable documents.
      for (const file of Array.from(files)) {
        const res = await uploadDocument(file);
        setSession(res);
      }
    });
  };

  const report = session?.report ?? null;
  const docs = session?.documents ?? [];
  const overall = report ? OVERALL[report.overall] : null;
  const blocking = report?.findings.filter(f => f.severity === 'critical' || f.severity === 'warning') ?? [];
  const minor = report?.findings.filter(f => f.severity === 'info') ?? [];
  const agreeing = report?.findings.filter(f => f.severity === 'ok') ?? [];

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--color-bg-main)', color: 'var(--color-content)' }}>
      <a href="#doc-main" className="sr-only-focusable">{t('nav.skipToMain')}</a>

      <header className="h-14 shrink-0 glass border-b flex items-center gap-2 px-3 sm:px-5"
              style={{ borderColor: 'var(--color-border)' }}>
        <Link to="/portal" className="press w-9 h-9 rounded-xl grid place-items-center text-content-3 hover:text-cta transition-colors"
              aria-label="Back to CivicAI">
          <ArrowLeft size={17} aria-hidden="true" />
        </Link>
        <div className="min-w-0">
          <h1 className="font-display font-bold text-[15px] leading-none truncate">Document verification</h1>
          <p className="text-[10px] font-bold uppercase tracking-widest text-content-3 truncate">
            Check before you apply
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          <span className="hidden sm:inline-flex"><IntegrationBadge integrationKey="ocr" size="xs" /></span>
          <LanguagePicker compact />
          <button onClick={toggleTheme}
                  aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
                  className="press hidden sm:grid w-9 h-9 rounded-xl place-items-center text-content-3 hover:text-cta transition-colors">
            {isDark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
          </button>
        </div>
      </header>

      <main id="doc-main" tabIndex={-1} className="flex-1 focus:outline-none">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-5">

          {/* Why this exists. Two sentences, then out of the way. */}
          <section>
            <h2 className="font-display font-bold text-xl sm:text-2xl tracking-tight">
              Find the problem before the department does
            </h2>
            <p className="text-[14px] text-content-2 mt-2 leading-relaxed max-w-2xl">
              Applications are commonly rejected weeks later because two documents
              disagree - usually a name spelled differently, or a date of birth in
              the other format. Add the documents you plan to submit and CivicAI
              will compare them with each other.
            </p>
          </section>

          {/* Privacy is a promise this page has to make explicitly, because
              the ask is "upload your identity documents to a government site". */}
          <section className="rounded-2xl p-4 flex items-start gap-3"
                   style={{ background: 'var(--color-surface-2)' }}>
            <Lock size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--color-success)' }} aria-hidden="true" />
            <div className="text-[12.5px] text-content-2 leading-relaxed">
              <strong className="text-content">Nothing here is stored.</strong>{' '}
              Your files are read, compared, and discarded. Nothing is written to
              any database, and everything is dropped automatically after{' '}
              {session?.limits.expiresInMinutes ?? 30} minutes. CivicAI never
              changes your documents.
              {docs.length > 0 && (
                <button
                  onClick={() => void withBusy('forget', async () => {
                    setSession(await forgetEverything());
                    setLocker(null); setPicked(new Set());
                    setNotice('Everything has been discarded.');
                  })}
                  className="ml-2 font-bold underline underline-offset-2"
                  style={{ color: 'var(--color-danger)' }}
                >
                  Discard everything now
                </button>
              )}
            </div>
          </section>

          {notice && (
            <div role="status" className="rounded-xl p-3 text-[13px] flex items-start gap-2"
                 style={{ background: 'var(--color-info-pale)', color: 'var(--color-info)' }}>
              <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span className="flex-1">{notice}</span>
              <button onClick={() => setNotice(null)} aria-label="Dismiss"><X size={14} aria-hidden="true" /></button>
            </div>
          )}
          {error && (
            <div role="alert" className="rounded-xl p-3 text-[13px] flex items-start gap-2"
                 style={{ background: 'var(--color-danger-pale)', color: 'var(--color-danger)' }}>
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span className="flex-1">{error}</span>
              <button onClick={() => setError(null)} aria-label="Dismiss"><X size={14} aria-hidden="true" /></button>
            </div>
          )}

          {/* ---------------- adding documents ---------------- */}
          <section className="grid sm:grid-cols-2 gap-3">
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
              className="rounded-2xl border-2 border-dashed p-5 text-center transition-colors"
              style={{
                borderColor: dragging ? 'var(--color-cta)' : 'var(--color-border-strong)',
                background: dragging ? 'var(--color-info-pale)' : 'var(--color-surface)',
              }}
            >
              <Upload size={20} className="mx-auto" style={{ color: 'var(--color-cta)' }} aria-hidden="true" />
              <p className="text-[13.5px] font-bold text-content mt-2">Upload a document</p>
              <p className="text-[11.5px] text-content-3 mt-1 leading-relaxed">
                JPG, PNG or PDF, up to 8&nbsp;MB. A clear photo of the whole page works.
              </p>
              <input
                ref={fileRef} type="file" accept={ACCEPT} multiple className="sr-only"
                id="doc-file-input"
                aria-label="Upload a document (JPG, PNG or PDF, up to 8 MB)"
                onChange={e => { handleFiles(e.target.files); e.target.value = ''; }}
              />
              <Button
                className="mt-3" size="sm" variant="secondary"
                loading={busy === 'upload'} loadingText="Reading..."
                onClick={() => fileRef.current?.click()}
              >
                Choose files
              </Button>
            </div>

            <div className="rounded-2xl bordered surface p-5 text-center flex flex-col">
              <ShieldCheck size={20} className="mx-auto" style={{ color: 'var(--color-saffron)' }} aria-hidden="true" />
              <p className="text-[13.5px] font-bold text-content mt-2 flex items-center justify-center gap-2">
                DigiLocker
                <IntegrationBadge integrationKey="digilocker" size="xs" />
              </p>
              <p className="text-[11.5px] text-content-3 mt-1 leading-relaxed flex-1">
                {session?.digilocker.mode === 'live'
                  ? 'Pull issued documents straight from your locker. CivicAI never sees your password.'
                  : 'Walks the real authorisation flow against sample documents. Not connected to DigiLocker.'}
              </p>
              <Button
                className="mt-3" size="sm" variant="secondary"
                loading={busy === 'digilocker'} loadingText="Opening..."
                onClick={() => void withBusy('digilocker', async () => {
                  const started = await startDigiLocker();
                  // Full navigation, not a fetch: the real flow hands the
                  // citizen to the government's own domain, and reproducing
                  // that is the point.
                  window.location.href = started.authorizeUrl;
                })}
              >
                Connect DigiLocker
              </Button>
            </div>
          </section>

          {/* ---------------- DigiLocker picker ---------------- */}
          {locker && (
            <section className="rounded-2xl bordered surface p-4">
              <h3 className="font-display font-bold text-[15px] text-content">
                Choose what to share
              </h3>
              <p className="text-[12px] text-content-3 mt-1 leading-relaxed">
                Only the documents you tick are imported. CivicAI does not read the rest.
              </p>
              <ul className="mt-3 space-y-1.5">
                {locker.map(d => (
                  <li key={d.id}>
                    <label className="flex items-center gap-3 rounded-xl p-2.5 cursor-pointer transition-colors"
                           style={{ background: picked.has(d.id) ? 'var(--color-info-pale)' : 'var(--color-surface-2)' }}>
                      <input
                        type="checkbox" checked={picked.has(d.id)}
                        onChange={e => setPicked(prev => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(d.id); else next.delete(d.id);
                          return next;
                        })}
                        className="w-4 h-4 shrink-0"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-semibold text-content truncate">{d.name}</span>
                        <span className="block text-[11px] text-content-3 truncate">
                          {d.issuer} - issued {new Date(d.issuedOn).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2 mt-3">
                <Button
                  size="sm" disabled={!picked.size}
                  loading={busy === 'import'} loadingText="Importing..."
                  onClick={() => void withBusy('import', async () => {
                    const res = await importDigiLockerDocuments([...picked]);
                    setSession(res); setLocker(null); setPicked(new Set());
                    setNotice(`Imported ${res.imported} document${res.imported === 1 ? '' : 's'}.`);
                  })}
                >
                  Import {picked.size || ''} selected
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setLocker(null); setPicked(new Set()); }}>
                  Cancel
                </Button>
              </div>
            </section>
          )}

          {/* ---------------- the documents in play ---------------- */}
          {docs.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-content-3">
                  Comparing {docs.length} of {session?.limits.maxDocuments} documents
                </h3>
                <button
                  onClick={() => void withBusy('clear', async () => { setSession(await clearDocuments()); })}
                  className="text-[11.5px] font-bold text-content-3 hover:text-danger transition-colors"
                >
                  Remove all
                </button>
              </div>
              <ul className="grid sm:grid-cols-2 gap-2">
                {docs.map(d => <DocumentCard key={d.id} doc={d} onRemove={async () => {
                  await withBusy(`rm-${d.id}`, async () => { setSession(await removeDocument(d.id)); });
                }} />)}
              </ul>

              <Button
                className="mt-4" fullWidth
                loading={busy === 'verify'} loadingText="Comparing your documents..."
                disabled={docs.length < 2}
                onClick={() => void withBusy('verify', async () => { setSession(await verifyDocuments()); })}
              >
                {docs.length < 2 ? 'Add one more document to compare' : 'Check for problems'}
              </Button>
            </section>
          )}

          {/* ---------------- the report ---------------- */}
          {report && overall && (
            <section aria-live="polite">
              <div className="rounded-2xl p-5" style={{ background: SEVERITY_STYLE[overall.tone].bg }}>
                <div className="flex items-start gap-3">
                  {(() => { const I = SEVERITY_STYLE[overall.tone].Icon; return (
                    <I size={22} className="mt-0.5 shrink-0" style={{ color: SEVERITY_STYLE[overall.tone].fg }} aria-hidden="true" />
                  ); })()}
                  <div className="min-w-0">
                    <h3 className="font-display font-bold text-[17px]" style={{ color: SEVERITY_STYLE[overall.tone].fg }}>
                      {overall.title}
                    </h3>
                    <p className="text-[13px] mt-1 leading-relaxed" style={{ color: SEVERITY_STYLE[overall.tone].fg }}>
                      {report.summary}
                    </p>
                    {report.aiExplanation && (
                      <p className="text-[13px] mt-2.5 leading-relaxed text-content-2">
                        {report.aiExplanation}
                      </p>
                    )}
                  </div>
                </div>
                {report.simulated && (
                  <p className="text-[11px] mt-3 pt-3 border-t leading-relaxed"
                     style={{ borderColor: 'currentColor', color: SEVERITY_STYLE[overall.tone].fg, opacity: 0.85 }}>
                    One or more of these documents carries simulated data rather than
                    values read from a real file. Findings below demonstrate the
                    checks; they are not a statement about your real documents.
                  </p>
                )}
              </div>

              {blocking.length > 0 && (
                <div className="mt-4 space-y-3">
                  {blocking.map(f => <Finding key={f.field} finding={f} />)}
                </div>
              )}

              {minor.length > 0 && (
                <details className="mt-3 rounded-2xl bordered surface overflow-hidden">
                  <summary className="px-4 py-3 text-[13px] font-semibold text-content-2 cursor-pointer">
                    {minor.length} minor difference{minor.length === 1 ? '' : 's'} most departments accept
                  </summary>
                  <div className="px-4 pb-4 space-y-3">
                    {minor.map(f => <Finding key={f.field} finding={f} />)}
                  </div>
                </details>
              )}

              {agreeing.length > 0 && (
                <p className="text-[12px] text-content-3 mt-3 flex items-center gap-1.5">
                  <Check size={13} style={{ color: 'var(--color-success)' }} aria-hidden="true" />
                  {agreeing.map(f => f.label).join(', ')}{' '}
                  {agreeing.length === 1 ? 'matches' : 'match'} across your documents.
                </p>
              )}

              <p className="text-[11px] text-content-3 mt-4 leading-relaxed">
                This is a consistency check between the documents you provided. It is
                not an eligibility decision, an authenticity check, or a guarantee
                that an application will be accepted.
              </p>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

// ---------------------------- pieces ----------------------------

function DocumentCard({ doc, onRemove }: { doc: SessionDocument; onRemove: () => void }) {
  const filled = Object.entries(doc.fields).filter(([, v]) => v).length;
  return (
    <li className="rounded-xl bordered surface p-3 flex items-start gap-3">
      <span aria-hidden="true" className="w-9 h-9 rounded-lg grid place-items-center shrink-0"
            style={{ background: 'var(--color-surface-2)', color: 'var(--color-cta)' }}>
        <FileText size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-bold text-content truncate">{doc.label}</p>
        <p className="text-[11px] text-content-3 mt-0.5">
          {doc.typeLabel}
          {' - '}
          {doc.source === 'digilocker' ? 'from DigiLocker' : `${filled} field${filled === 1 ? '' : 's'} read`}
          {doc.simulated && ' - simulated'}
        </p>
        {doc.error && (
          <p className="text-[11px] mt-1 leading-snug" style={{ color: 'var(--color-warning)' }}>
            {doc.error}
          </p>
        )}
        {!doc.error && doc.confidence < 0.6 && (
          <p className="text-[11px] mt-1 leading-snug" style={{ color: 'var(--color-warning)' }}>
            Read with low confidence - a clearer photo would give a better result.
          </p>
        )}
      </div>
      <button onClick={onRemove} aria-label={`Remove ${doc.label}`}
              className="w-7 h-7 rounded-lg grid place-items-center text-content-3 hover:text-danger transition-colors shrink-0">
        <Trash2 size={13} aria-hidden="true" />
      </button>
    </li>
  );
}

function Finding({ finding }: { finding: import('../services/documentService').FieldFinding }) {
  const style = SEVERITY_STYLE[finding.severity];
  const { Icon } = style;
  return (
    <article className="rounded-2xl bordered surface overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-2" style={{ background: style.bg }}>
        <Icon size={15} style={{ color: style.fg }} aria-hidden="true" />
        <h4 className="font-display font-bold text-[14px]" style={{ color: style.fg }}>
          {finding.label}
        </h4>
        <span className="ml-auto text-[10px] font-bold uppercase tracking-wide" style={{ color: style.fg }}>
          {style.word}
        </span>
      </div>

      <div className="p-4">
        {/* The raw values, side by side. The citizen is the only person here
            who knows which is right, and they cannot tell from a score. */}
        <dl className="space-y-1.5">
          {finding.values.map(v => (
            <div key={v.documentId} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <dt className="text-[11.5px] text-content-3 min-w-[9rem]">{v.documentLabel}</dt>
              <dd className="text-[13.5px] font-semibold text-content font-mono">{v.raw ?? 'not present'}</dd>
            </div>
          ))}
        </dl>

        {finding.conflictBetween && (
          <p className="text-[11px] font-bold uppercase tracking-wide text-content-3 mt-3">
            {finding.conflictBetween.a} vs {finding.conflictBetween.b}
          </p>
        )}
        <p className="text-[13px] text-content-2 mt-1.5 leading-relaxed">{finding.headline}</p>

        {finding.corroboration && (
          <p className="text-[12.5px] mt-2.5 rounded-xl p-2.5 leading-relaxed"
             style={{ background: 'var(--color-success-pale)', color: 'var(--color-success)' }}>
            {finding.corroboration}
          </p>
        )}

        {finding.severity !== 'ok' && (
          <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
            <p className="text-[10px] font-bold uppercase tracking-widest text-content-3 mb-1">
              What to do
            </p>
            <p className="text-[12.5px] text-content-2 leading-relaxed">{finding.recommendation}</p>
          </div>
        )}
      </div>
    </article>
  );
}
