import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Building2, ChevronRight, AlertTriangle, ArrowLeft, Lock } from 'lucide-react';
import { Button } from '../components/Button';
import { PageBackground } from '../components/backgrounds/PageBackground';
import { adminLogin, isAuthError } from '../services/authService';
import { useAuth } from '../context/AuthContext';
import { useT } from '../i18n/I18nContext';

/**
 * Staff portal sign-in — employee ID and password.
 *
 * A genuinely separate door from the citizen one, not a tab on it. Three
 * reasons this is its own page rather than another `audience` branch of
 * LoginScreen:
 *
 *   1. The credentials are different in kind. A citizen proves a phone number
 *      they control; an officer proves a secret issued to them by an employer.
 *      Sharing one form means every future change has to be reasoned about
 *      twice, in a component that already branches on audience.
 *   2. A citizen should never be shown a password field for a government
 *      system. It invites them to try their own credentials against it, and
 *      every such attempt is a failed login the operator has to triage.
 *   3. The lockout, rate limit and error vocabulary differ. Merging them
 *      pushed staff-specific failure states into a screen that citizens see.
 *
 * What this page does NOT do is decide anything about authority. On success
 * it navigates to `identity.homeRoute`, which the server computed from the
 * staff directory — the same route every other sign-in path obeys. Someone
 * who authenticates here but holds no staff role lands on the citizen portal,
 * which is the correct outcome: knowing a password is not the same as being
 * an administrator.
 */
export function AdminLoginPage() {
  const t = useT();
  const navigate = useNavigate();
  const { status, identity, identityLoading, onSignedIn } = useAuth();

  const [employeeId, setEmployeeId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lockedFor, setLockedFor] = useState(0);

  const mountedAt = useRef(Date.now());
  /** Honeypot: hidden from people, irresistible to naive bots. */
  const [company, setCompany] = useState('');

  // Already signed in? Obey the server's routing rather than assuming this
  // door implies the admin portal.
  useEffect(() => {
    if (status !== 'authenticated' || identityLoading || !identity) return;
    navigate(identity.homeRoute, { replace: true });
  }, [status, identity, identityLoading, navigate]);

  useEffect(() => {
    if (lockedFor <= 0) return;
    const timer = setInterval(() => setLockedFor(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [lockedFor]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || lockedFor > 0) return;
    setError(null);
    setBusy(true);

    const res = await adminLogin(employeeId.trim(), password, {
      formElapsedMs: Date.now() - mountedAt.current,
      company,
    });
    setBusy(false);

    if (isAuthError(res)) {
      setError(res.message);
      if (typeof (res as any).retryAfterSec === 'number') {
        setLockedFor((res as any).retryAfterSec);
      }
      // Clear the password but keep the employee id: retyping a long
      // credential after a typo in the other field is its own small punishment.
      setPassword('');
      return;
    }

    onSignedIn({ identifier: res.identifier, channel: res.channel });
  };

  const canSubmit = employeeId.trim().length > 0 && password.length > 0 && !busy && lockedFor === 0;

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center p-4 sm:p-6 relative isolate overflow-hidden"
      style={{ background: 'var(--color-bg-main)' }}
    >
      <PageBackground variant="auth" />

      <motion.main
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
        className="surface bordered rounded-2xl p-7 sm:p-9 w-full max-w-md shadow-2xl relative z-10"
      >
        <header className="text-center mb-7">
          <div
            aria-hidden="true"
            className="w-14 h-14 rounded-xl grid place-items-center mx-auto mb-4 text-white shadow-lg
                       bg-gradient-to-br from-navy to-navy-light"
            style={{ background: 'linear-gradient(135deg, var(--color-navy), var(--color-navy-light))' }}
          >
            <Building2 size={28} strokeWidth={2} />
          </div>
          <h1 className="font-display font-bold text-2xl tracking-tight text-content">
            {t('adminLogin.title')}
          </h1>
          <p className="text-sm mt-1.5 text-content-3">{t('adminLogin.subtitle')}</p>
        </header>

        <div aria-live="polite" aria-atomic="true">
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2.5 p-3.5 rounded-xl mb-4 text-xs font-semibold"
              style={{
                background: 'var(--color-danger-pale)',
                border: '1px solid var(--color-danger)',
                color: 'var(--color-danger)',
              }}
            >
              <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                {error}
                {lockedFor > 0 && ` (${lockedFor}s)`}
              </span>
            </div>
          )}
        </div>

        <form className="space-y-4" onSubmit={submit} noValidate>
          <div>
            <label htmlFor="employeeId" className="block text-[13px] font-semibold mb-1.5 text-content">
              {t('adminLogin.employeeId')}
            </label>
            <input
              id="employeeId"
              name="employeeId"
              type="text"
              autoComplete="username"
              autoCapitalize="characters"
              spellCheck={false}
              required
              placeholder={t('adminLogin.employeeIdPlaceholder')}
              value={employeeId}
              onChange={e => { setEmployeeId(e.target.value); setError(null); }}
              className="w-full h-12 px-4 rounded-xl outline-none text-base font-mono transition-colors
                         border-2 focus:border-cta hover:border-[var(--color-content-3)]"
              style={{
                background: 'var(--color-surface)',
                color: 'var(--color-content)',
                borderColor: 'var(--color-border-strong)',
              }}
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-[13px] font-semibold mb-1.5 text-content">
              {t('adminLogin.password')}
            </label>
            <div className="relative">
              <Lock
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-content-3"
                size={17}
                aria-hidden="true"
              />
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={e => { setPassword(e.target.value); setError(null); }}
                className="w-full h-12 pl-11 pr-4 rounded-xl outline-none text-base transition-colors
                           border-2 focus:border-cta hover:border-[var(--color-content-3)]"
                style={{
                  background: 'var(--color-surface)',
                  color: 'var(--color-content)',
                  borderColor: 'var(--color-border-strong)',
                }}
              />
            </div>
          </div>

          {/* Honeypot. Off-screen rather than display:none, which some bots
              detect; never announced, never tab-reachable. */}
          <div aria-hidden="true" className="absolute w-px h-px overflow-hidden -left-[9999px]">
            <label htmlFor="company">Company</label>
            <input
              id="company"
              name="company"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={company}
              onChange={e => setCompany(e.target.value)}
            />
          </div>

          <Button type="submit" fullWidth size="lg" disabled={!canSubmit} loadingText={t('adminLogin.signingIn')}>
            {t('adminLogin.cta')}
            <ChevronRight size={18} aria-hidden="true" />
          </Button>
        </form>

        <div className="text-center mt-5">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="press inline-flex items-center gap-1.5 text-[12px] font-bold uppercase
                       tracking-wider text-content-3 hover:text-cta transition-colors"
          >
            <ArrowLeft size={13} aria-hidden="true" />
            {t('adminLogin.notStaff')}
          </button>
        </div>

        <p className="text-[11px] text-content-3 text-center mt-6 leading-relaxed">
          {t('adminLogin.notice')}
        </p>
      </motion.main>
    </div>
  );
}
