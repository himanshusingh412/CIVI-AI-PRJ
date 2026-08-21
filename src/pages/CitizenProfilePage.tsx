import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, Check, CheckCircle2, FileText, Info,
  Lock, Moon, ShieldCheck, Sun, Trash2, Upload, X, XCircle, User,
  Mail, Phone, MapPin, Building2, Calendar, Award, Sparkles, FileSearch, Shield
} from 'lucide-react';
import { Button } from '../components/Button';
import { IntegrationBadge } from '../components/IntegrationBadge';
import { LanguagePicker } from '../components/LanguagePicker';
import { useTheme } from '../context/ThemeContext';
import { useI18n } from '../i18n/I18nContext';
import { useAuth } from '../context/AuthContext';
import { useLiveComplaints } from '../hooks/useLiveComplaints';
import {
  getSession, uploadDocument, removeDocument, clearDocuments, forgetEverything,
  verifyDocuments, startDigiLocker, listDigiLockerDocuments, importDigiLockerDocuments,
  type DocumentSession, type SessionDocument, type Severity, type DigiLockerDoc,
} from '../services/documentService';

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

interface CitizenProfilePageProps {
  initialTab?: 'profile' | 'documents';
}

export function CitizenProfilePage({ initialTab = 'profile' }: CitizenProfilePageProps) {
  const { t } = useI18n();
  const { isDark, toggleTheme } = useTheme();
  const { user, identity, identityLoading } = useAuth();
  const { complaints, loading: complaintsLoading, error: complaintsError, refresh: refreshComplaints } = useLiveComplaints({ mineOnly: true });
  const [params, setParams] = useSearchParams();

  const [activeTab, setActiveTab] = useState<'profile' | 'documents'>(initialTab);
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
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load your document session.'); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  /** The DigiLocker round trip comes back as a query parameter. */
  useEffect(() => {
    const status = params.get('digilocker');
    if (!status) return;
    setActiveTab('documents');
    if (status === 'authorised') {
      setNotice('DigiLocker authorised. Choose which documents to share.');
      void (async () => {
        try { setLocker((await listDigiLockerDocuments()).documents); }
        catch (e) { setError(e instanceof Error ? e.message : 'Could not list your documents.'); }
      })();
    } else if (status === 'failed') {
      setError(t('documentVerification.digilockerAuthorisationDidNotComplete'));
    } else if (status === 'expired') {
      setError(t('documentVerification.thatAuthorisationRequestExpiredPlease'));
    }
    params.delete('digilocker');
    setParams(params, { replace: true });
  }, [params, setParams, t]);

  const withBusy = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setError(null);
    try { await fn(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.'); }
    finally { setBusy(null); }
  };

  const handleFiles = (files: FileList | null) => {
    if (!files?.length) return;
    void withBusy('upload', async () => {
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

  // Real, dynamic stats derived strictly from authenticated user's complaints
  const totalComplaints = complaints.length;
  const pendingComplaints = complaints.filter(c => c.status !== 'closed' && c.status !== 'resolved' && c.status !== 'rejected').length;
  const resolvedComplaints = complaints.filter(c => c.status === 'closed' || c.status === 'resolved').length;

  // Real authenticated user information with localized fallbacks
  const displayName = identity?.displayName || (user?.identifier ? user.identifier.split('@')[0] : t('profile.notProvided'));
  const rawIdentifier = user?.identifier || identity?.identifier || '';
  const isPhone = user?.channel === 'phone' || (!rawIdentifier.includes('@') && Boolean(rawIdentifier));
  const isEmail = user?.channel === 'google' || rawIdentifier.includes('@');

  const phoneValue = isPhone ? rawIdentifier : ((identity?.scope?.phone as string) || t('profile.notProvided'));
  const emailValue = isEmail ? rawIdentifier : ((identity?.scope?.email as string) || t('profile.notProvided'));

  // Auth method label
  const authMethodLabel = user?.channel === 'phone'
    ? t('profile.authPhone')
    : user?.channel === 'google'
      ? t('profile.authGoogle')
      : t('profile.authSession');

  // Verification status label
  const isVerified = Boolean(user || identity);
  const verificationBadgeText = isVerified ? t('profile.authenticatedAccount') : t('profile.unverified');

  // Real jurisdiction & location from scope / profile, fallback to "Not provided"
  const stateVal = (identity?.scope?.state as string) || (identity?.scope?.stateName as string) || t('profile.notProvided');
  const districtVal = (identity?.scope?.district as string) || (identity?.scope?.districtName as string) || t('profile.notProvided');
  const wardVal = (identity?.scope?.ward as string) || t('profile.notProvided');
  const localBodyVal = (identity?.scope?.department as string) || (identity?.scope?.localBody as string) || t('profile.notProvided');

  // Formatted location string for hero tag
  const locationTagString = [districtVal, stateVal].filter(v => v !== t('profile.notProvided')).join(', ') || t('profile.notProvided');

  // Citizen ID derived dynamically
  const citizenIdCode = rawIdentifier
    ? `#CIV-${rawIdentifier.replace(/\D/g, '').slice(-6) || '10482'}`
    : '#CIV-10482';

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--color-bg-main)', color: 'var(--color-content)' }}>
      <a href="#profile-main" className="sr-only-focusable">{t('nav.skipToMain')}</a>

      {/* Header */}
      <header className="h-14 shrink-0 glass border-b flex items-center gap-2 px-3 sm:px-5"
              style={{ borderColor: 'var(--color-border)' }}>
        <Link to="/portal" className="press w-9 h-9 rounded-xl grid place-items-center text-content-3 hover:text-cta transition-colors"
              aria-label="Back to CivicAI Portal">
          <ArrowLeft size={17} aria-hidden="true" />
        </Link>
        <div className="min-w-0">
          <h1 className="font-display font-bold text-[15px] leading-none truncate">{t('profile.title')}</h1>
          <p className="text-[10px] font-bold uppercase tracking-widest text-content-3 truncate">
            {t('profile.subtitle')}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <span className="hidden sm:inline-flex"><IntegrationBadge integrationKey="digilocker" size="xs" /></span>
          <LanguagePicker compact />
          <button onClick={toggleTheme}
                  aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
                  className="press hidden sm:grid w-9 h-9 rounded-xl place-items-center text-content-3 hover:text-cta transition-colors">
            {isDark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
          </button>
        </div>
      </header>

      <main id="profile-main" tabIndex={-1} className="flex-1 focus:outline-none">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">

          {/* Citizen Hero Card */}
          <section className="rounded-3xl p-5 sm:p-6 bordered surface shadow-sm flex flex-col sm:flex-row items-start sm:items-center gap-5 relative overflow-hidden">
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-gradient-to-br from-cta via-saffron to-amber-500 text-white font-bold text-2xl sm:text-3xl grid place-items-center uppercase shadow-md shrink-0">
              {displayName !== t('profile.notProvided') ? displayName.charAt(0) : <User size={28} />}
            </div>
            
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display font-bold text-xl sm:text-2xl tracking-tight text-content truncate">
                  {displayName}
                </h2>
                <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full"
                      style={{ background: 'var(--color-success-pale)', color: 'var(--color-success)' }}>
                  <ShieldCheck size={13} /> {verificationBadgeText}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-content-2 pt-1 font-mono">
                {rawIdentifier && (
                  <span className="flex items-center gap-1.5">
                    {rawIdentifier.includes('@') ? <Mail size={13} className="text-cta" /> : <Phone size={13} className="text-saffron" />}
                    {rawIdentifier}
                  </span>
                )}
                <span className="flex items-center gap-1 text-content-3">
                  <MapPin size={13} className="text-content-3" /> {locationTagString}
                </span>
                <span className="flex items-center gap-1 text-content-3">
                  <Award size={13} className="text-amber-500" /> {t('profile.citizenId')} {citizenIdCode}
                </span>
              </div>
            </div>

            {/* Quick Action button */}
            <div className="w-full sm:w-auto shrink-0 flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setActiveTab('documents')}>
                <FileSearch size={14} /> {t('profile.myDocuments')}
              </Button>
            </div>
          </section>

          {/* Navigation Tabs */}
          <div className="flex border-b" style={{ borderColor: 'var(--color-border)' }}>
            <button
              onClick={() => setActiveTab('profile')}
              className={`px-5 py-3 text-xs font-bold uppercase tracking-wider flex items-center gap-2 border-b-2 transition-all ${
                activeTab === 'profile'
                  ? 'border-cta text-cta'
                  : 'border-transparent text-content-3 hover:text-content'
              }`}
            >
              <User size={15} /> {t('profile.tabProfile')}
            </button>
            <button
              onClick={() => setActiveTab('documents')}
              className={`px-5 py-3 text-xs font-bold uppercase tracking-wider flex items-center gap-2 border-b-2 transition-all ${
                activeTab === 'documents'
                  ? 'border-cta text-cta'
                  : 'border-transparent text-content-3 hover:text-content'
              }`}
            >
              <ShieldCheck size={15} /> {t('profile.tabDocuments')}
            </button>
          </div>

          {/* Notifications / Errors */}
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

          {/* TAB 1: CITIZEN PROFILE DETAILS */}
          {activeTab === 'profile' && (
            <div className="space-y-6">
              {/* Grievance Stats Cards */}
              <div className="grid grid-cols-3 gap-3">
                {complaintsLoading ? (
                  <>
                    <div className="rounded-2xl bordered surface p-4 text-center animate-pulse space-y-2">
                      <div className="h-8 w-12 bg-content-3/20 rounded mx-auto"></div>
                      <div className="h-3 w-20 bg-content-3/20 rounded mx-auto"></div>
                    </div>
                    <div className="rounded-2xl bordered surface p-4 text-center animate-pulse space-y-2">
                      <div className="h-8 w-12 bg-content-3/20 rounded mx-auto"></div>
                      <div className="h-3 w-20 bg-content-3/20 rounded mx-auto"></div>
                    </div>
                    <div className="rounded-2xl bordered surface p-4 text-center animate-pulse space-y-2">
                      <div className="h-8 w-12 bg-content-3/20 rounded mx-auto"></div>
                      <div className="h-3 w-20 bg-content-3/20 rounded mx-auto"></div>
                    </div>
                  </>
                ) : complaintsError ? (
                  <div className="col-span-3 rounded-2xl bordered surface p-4 text-center text-xs text-danger space-y-2">
                    <p>{t('profile.loadError')}</p>
                    <Button size="xs" variant="secondary" onClick={() => void refreshComplaints()}>
                      {t('profile.retry')}
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="rounded-2xl bordered surface p-4 text-center">
                      <span className="block text-2xl sm:text-3xl font-black font-display text-cta">{totalComplaints}</span>
                      <span className="block text-[11px] font-bold text-content-3 uppercase tracking-wider mt-1">{t('profile.totalComplaints')}</span>
                    </div>
                    <div className="rounded-2xl bordered surface p-4 text-center">
                      <span className="block text-2xl sm:text-3xl font-black font-display text-saffron">{pendingComplaints}</span>
                      <span className="block text-[11px] font-bold text-content-3 uppercase tracking-wider mt-1">{t('profile.awaitingAction')}</span>
                    </div>
                    <div className="rounded-2xl bordered surface p-4 text-center">
                      <span className="block text-2xl sm:text-3xl font-black font-display style-success" style={{ color: 'var(--color-success)' }}>{resolvedComplaints}</span>
                      <span className="block text-[11px] font-bold text-content-3 uppercase tracking-wider mt-1">{t('profile.resolvedCases')}</span>
                    </div>
                  </>
                )}
              </div>

              {!complaintsLoading && !complaintsError && totalComplaints === 0 && (
                <div className="rounded-xl p-3 text-center text-xs text-content-3 bordered surface">
                  {t('profile.noComplaintsYet')}
                </div>
              )}

              {/* Citizen Personal & Jurisdiction Details Grid */}
              <div className="grid sm:grid-cols-2 gap-4">
                {/* Personal Information */}
                <div className="rounded-2xl bordered surface p-5 space-y-4">
                  <h3 className="font-display font-bold text-[15px] text-content flex items-center gap-2">
                    <User size={16} className="text-cta" /> {t('profile.personalDetails')}
                  </h3>
                  <dl className="space-y-3 text-xs">
                    <div className="flex justify-between py-1.5 border-b" style={{ borderColor: 'var(--color-border)' }}>
                      <dt className="text-content-3">{t('profile.fullName')}</dt>
                      <dd className="font-bold text-content">{displayName}</dd>
                    </div>
                    <div className="flex justify-between py-1.5 border-b" style={{ borderColor: 'var(--color-border)' }}>
                      <dt className="text-content-3">{t('profile.phone')}</dt>
                      <dd className="font-mono font-bold text-content">{phoneValue}</dd>
                    </div>
                    <div className="flex justify-between py-1.5 border-b" style={{ borderColor: 'var(--color-border)' }}>
                      <dt className="text-content-3">{t('profile.email')}</dt>
                      <dd className="font-mono font-bold text-content">{emailValue}</dd>
                    </div>
                    <div className="flex justify-between py-1.5 border-b" style={{ borderColor: 'var(--color-border)' }}>
                      <dt className="text-content-3">{t('profile.authMethod')}</dt>
                      <dd className="font-bold uppercase tracking-wider text-cta text-[10px]">{authMethodLabel}</dd>
                    </div>
                  </dl>
                </div>

                {/* Jurisdiction & Address Details */}
                <div className="rounded-2xl bordered surface p-5 space-y-4">
                  <h3 className="font-display font-bold text-[15px] text-content flex items-center gap-2">
                    <MapPin size={16} className="text-saffron" /> {t('profile.jurisdictionLocation')}
                  </h3>
                  <dl className="space-y-3 text-xs">
                    <div className="flex justify-between py-1.5 border-b" style={{ borderColor: 'var(--color-border)' }}>
                      <dt className="text-content-3">{t('profile.state')}</dt>
                      <dd className="font-bold text-content">{stateVal}</dd>
                    </div>
                    <div className="flex justify-between py-1.5 border-b" style={{ borderColor: 'var(--color-border)' }}>
                      <dt className="text-content-3">{t('profile.district')}</dt>
                      <dd className="font-bold text-content">{districtVal}</dd>
                    </div>
                    <div className="flex justify-between py-1.5 border-b" style={{ borderColor: 'var(--color-border)' }}>
                      <dt className="text-content-3">{t('profile.ward')}</dt>
                      <dd className="font-bold text-content">{wardVal}</dd>
                    </div>
                    <div className="flex justify-between py-1.5 border-b" style={{ borderColor: 'var(--color-border)' }}>
                      <dt className="text-content-3">{t('profile.localBody')}</dt>
                      <dd className="font-bold text-content">{localBodyVal}</dd>
                    </div>
                  </dl>
                </div>
              </div>

              {/* Verified Identity Status Card */}
              <div className="rounded-2xl p-5 border flex items-start gap-4"
                   style={{ background: 'var(--color-surface-2)', borderColor: 'var(--color-border)' }}>
                <Shield className="w-6 h-6 shrink-0 mt-0.5" style={{ color: 'var(--color-success)' }} />
                <div className="text-xs space-y-1">
                  <h4 className="font-bold text-content text-[13.5px]">
                    {t('profile.identityStatus')}: {verificationBadgeText}
                  </h4>
                  <p className="text-content-2 leading-relaxed">
                    {t('profile.authNotice')}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: MERGED DOCUMENT VERIFICATION & DIGILOCKER */}
          {activeTab === 'documents' && (
            <div className="space-y-6">
              <section>
                <h2 className="font-display font-bold text-xl sm:text-2xl tracking-tight">
                  Find document mismatches before applying
                </h2>
                <p className="text-[14px] text-content-2 mt-2 leading-relaxed max-w-2xl">
                  Applications are commonly rejected weeks later because two documents
                  disagree - usually a name spelled differently, or a date of birth in
                  the other format. Add your documents or connect DigiLocker to compare them automatically.
                </p>
              </section>

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

              {/* Adding documents & DigiLocker */}
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
                  <p className="text-[13.5px] font-bold text-content mt-2">Upload a Document</p>
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
                    loading={busy === 'upload'} loadingText="Reading file..."
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
                      : 'Walks the authorisation flow against sample documents. Not connected to DigiLocker API.'}
                  </p>
                  <Button
                    className="mt-3" size="sm" variant="secondary"
                    loading={busy === 'digilocker'} loadingText="Opening DigiLocker..."
                    onClick={() => void withBusy('digilocker', async () => {
                      const started = await startDigiLocker();
                      window.location.href = started.authorizeUrl;
                    })}
                  >
                    Connect DigiLocker
                  </Button>
                </div>
              </section>

              {/* DigiLocker picker */}
              {locker && (
                <section className="rounded-2xl bordered surface p-4">
                  <h3 className="font-display font-bold text-[15px] text-content">
                    Choose what to share from DigiLocker
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

              {/* Documents list */}
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

              {/* Report */}
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
                </section>
              )}
            </div>
          )}

        </div>
      </main>
    </div>
  );
}

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
        </p>
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
        <dl className="space-y-1.5">
          {finding.values.map(v => (
            <div key={v.documentId} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <dt className="text-[11.5px] text-content-3 min-w-[9rem]">{v.documentLabel}</dt>
              <dd className="text-[13.5px] font-semibold text-content font-mono">{v.raw ?? 'not present'}</dd>
            </div>
          ))}
        </dl>
      </div>
    </article>
  );
}
