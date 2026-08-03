import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Building2, CheckCircle2, ChevronRight, ShieldCheck, Smartphone, User } from 'lucide-react';
import { Button } from './Button';
import { PageBackground } from './backgrounds/PageBackground';
import { useTheme } from '../context/ThemeContext';
import {
  requestOtp,
  verifyOtp,
  googleSignIn,
  validatePhone,
  isAuthError,
  type AuthUser,
} from '../services/authService';

/**
 * Build-time fallback. The authoritative value comes from GET /api/config at
 * runtime, so rotating the client ID never requires a rebuild — and a
 * production deploy doesn't need the var present at build time.
 */
const BUILD_TIME_CLIENT_ID = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID ?? '';

type Step = 'identify' | 'otp';

/**
 * Which door the person came through.
 *
 * This is a routing hint, NOT an authorisation claim. Picking "staff" grants
 * nothing — it navigates to /portal/admin, where RequireAdmin and the
 * server's RBAC decide what the session may actually do. Anyone can click
 * it; that is fine, because the button is not what protects the portal.
 */
export type Audience = 'citizen' | 'staff';

export function LoginScreen({
  onSignedIn,
  /**
   * Set by the admin portal, which already knows who it is serving. Left
   * undefined on the citizen portal, which is what makes the chooser render.
   */
  audience: fixedAudience,
}: {
  onSignedIn: (u: AuthUser) => void;
  audience?: Audience;
}) {
  const { isDark } = useTheme();
  const navigate = useNavigate();
  const [audience, setAudience] = useState<Audience | null>(fixedAudience ?? null);

  const [googleClientId, setGoogleClientId] = useState<string>(BUILD_TIME_CLIENT_ID);
  const [configLoading, setConfigLoading] = useState(!BUILD_TIME_CLIENT_ID);

  const [step, setStep] = useState<Step>('identify');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [maskedIdentifier, setMasked] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  /**
   * The one-time code, when the server chose to hand it back.
   *
   * It only ever does so when SMS delivery is in console mode AND
   * NODE_ENV is not production (see server/auth.ts). That gate is the
   * security boundary and is not relaxed here — this only displays what the
   * server already decided was safe to return.
   */
  const [devCode, setDevCode] = useState<string | null>(null);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [lockedFor, setLockedFor] = useState(0);
  const [googleReady, setGoogleReady] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  const googleBtnRef = useRef<HTMLDivElement>(null);
  const otpInputRef = useRef<HTMLInputElement>(null);
  const mountedAt = useRef(Date.now());
  const mounted = useRef(true);
  /** Honeypot: hidden from humans, irresistible to naive bots. */
  const [honeypot, setHoneypot] = useState('');

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Pull the live client ID from the server; ignore failures and keep the
  // build-time fallback so the SMS path always stays usable.
  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const res = await fetch('/api/config', { credentials: 'same-origin', signal: ac.signal });
        if (!res.ok) return;
        const cfg = await res.json();
        if (!mounted.current) return;
        if (typeof cfg?.googleClientId === 'string' && cfg.googleClientId) {
          setGoogleClientId(cfg.googleClientId);
        }
      } catch {
        /* offline or backend down — fallback already in place */
      } finally {
        if (mounted.current) setConfigLoading(false);
      }
    })();
    return () => ac.abort();
  }, []);

  // ── countdown tickers ──
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setInterval(() => setResendIn(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [resendIn]);

  useEffect(() => {
    if (lockedFor <= 0) return;
    const t = setInterval(() => {
      setLockedFor(s => {
        const next = Math.max(0, s - 1);
        if (next === 0) setError(null);
        return next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [lockedFor]);

  // Move focus to the code field when advancing — keyboard users shouldn't
  // have to hunt for it after the step changes.
  useEffect(() => {
    if (step === 'otp') otpInputRef.current?.focus();
  }, [step]);

  const completeSignIn = useCallback(
    (identifier: string, channel: 'phone' | 'google') => {
      onSignedIn({ identifier, channel });
    },
    [onSignedIn],
  );

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
  </svg>
);

  // ── Google Identity Services ──
  const handleGoogleCredential = useCallback(
    async (response: { credential?: string }) => {
      if (!response?.credential) return;
      setError(null);
      setInfo(null);
      setGoogleBusy(true);

      const res = await googleSignIn(response.credential);
      if (!mounted.current) return;
      setGoogleBusy(false);

      if (isAuthError(res)) {
        setError(res.message);
        return;
      }
      completeSignIn(res.identifier, res.channel);
    },
    [completeSignIn],
  );

  const handleDemoGoogleSignIn = async () => {
    setError(null);
    setInfo(null);
    setGoogleBusy(true);
    const res = await googleSignIn('demo_google_credential');
    if (!mounted.current) return;
    setGoogleBusy(false);
    if (isAuthError(res)) {
      setError(res.message);
      return;
    }
    completeSignIn(res.identifier, res.channel);
  };

  useEffect(() => {
    if (!googleClientId || step !== 'identify') return;

    let cancelled = false;
    let timer: number | undefined;

    const render = () => {
      if (cancelled) return;
      const g = (window as any).google;
      if (!g?.accounts?.id || !googleBtnRef.current) {
        timer = window.setTimeout(render, 200);
        return;
      }
      try {
        g.accounts.id.initialize({
          client_id: googleClientId,
          callback: handleGoogleCredential,
          auto_select: false,
          cancel_on_tap_outside: true,
          use_fedcm_for_prompt: true,
        });
        googleBtnRef.current.innerHTML = '';
        g.accounts.id.renderButton(googleBtnRef.current, {
          theme: isDark ? 'filled_black' : 'outline',
          size: 'large',
          width: 340,
          text: 'continue_with',
          shape: 'pill',
          logo_alignment: 'center',
        });
        setGoogleReady(true);
      } catch (err) {
        console.error('[auth] Google button failed to render', err);
      }
    };

    render();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [step, isDark, googleClientId, handleGoogleCredential]);

  // ── SMS OTP ──
  const phoneValid = validatePhone(phone).ok;

  const handleRequestOtp = async () => {
    setError(null);
    setInfo(null);

    const check = validatePhone(phone);
    if (!check.ok) {
      setError(check.reason!);
      return;
    }

    const res = await requestOtp(phone, {
      formElapsedMs: Date.now() - mountedAt.current,
      company: honeypot,
    });
    if (!mounted.current) return;

    if (isAuthError(res)) {
      setError(res.message);
      if (res.retryAfterSec) {
        if (res.error === 'locked_out' || res.error === 'otp_limit') setLockedFor(res.retryAfterSec);
        else setResendIn(res.retryAfterSec);
      }
      return;
    }

    setMasked(res.maskedIdentifier);
    setStep('otp');
    setOtp('');
    setAttemptsLeft(null);
    setResendIn(30);
    setDevCode(res.devOtp ?? null);
    setInfo(res.message);
  };

  const handleVerifyOtp = async () => {
    setError(null);
    if (!/^\d{6}$/.test(otp)) {
      setError('Enter the 6-digit code.');
      return;
    }

    const res = await verifyOtp(phone, otp);
    if (!mounted.current) return;

    if (isAuthError(res)) {
      setError(res.message);
      if (typeof res.attemptsRemaining === 'number') setAttemptsLeft(res.attemptsRemaining);
      if (res.error === 'locked_out' && res.retryAfterSec) {
        setLockedFor(res.retryAfterSec);
        setStep('identify');
        setAttemptsLeft(null);
      }
      setOtp('');
      return;
    }

    completeSignIn(res.identifier, res.channel);
  };

  const backToPhone = () => {
    setStep('identify');
    setOtp('');
    setError(null);
    setInfo(null);
    setAttemptsLeft(null);
  };

  /**
   * Step 0 — who are you here as?
   *
   * Rendered only on the citizen portal. The staff option is a plain link to
   * /portal/admin rather than a different auth path: both audiences
   * authenticate through the same identity provider, and the difference is
   * entirely what the resulting session is authorised to do.
   */
  if (audience === null) {
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
              className="float-y w-14 h-14 rounded-xl grid place-items-center mx-auto mb-4 text-white shadow-lg bg-gradient-to-br from-cta to-saffron"
            >
              <ShieldCheck size={28} strokeWidth={2} />
            </div>
            <h1 className="font-display font-bold text-2xl tracking-tight text-content">Welcome to CivicAI</h1>
            <p className="text-sm mt-1.5 text-content-3">How would you like to continue?</p>
          </header>

          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => setAudience('citizen')}
              className="press w-full flex items-center gap-4 p-4 rounded-xl bordered surface-2 text-left
                         hover:border-[var(--color-cta)] transition-colors"
            >
              <span
                aria-hidden="true"
                className="w-11 h-11 shrink-0 rounded-xl grid place-items-center text-white bg-gradient-to-br from-cta to-cta-hover"
              >
                <User size={20} />
              </span>
              <span className="min-w-0">
                <span className="block font-display font-bold text-[15px] text-content">I'm a citizen</span>
                <span className="block text-[13px] text-content-3 mt-0.5">
                  Report an issue and track your complaints
                </span>
              </span>
              <ChevronRight size={18} className="ml-auto shrink-0 text-content-3" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => navigate('/portal/admin')}
              className="press w-full flex items-center gap-4 p-4 rounded-xl bordered surface-2 text-left
                         hover:border-[var(--color-saffron)] transition-colors"
            >
              <span
                aria-hidden="true"
                className="w-11 h-11 shrink-0 rounded-xl grid place-items-center text-white bg-gradient-to-br from-saffron to-saffron-light"
              >
                <Building2 size={20} />
              </span>
              <span className="min-w-0">
                <span className="block font-display font-bold text-[15px] text-content">I'm government staff</span>
                <span className="block text-[13px] text-content-3 mt-0.5">
                  Triage, assign and resolve grievances
                </span>
              </span>
              <ChevronRight size={18} className="ml-auto shrink-0 text-content-3" aria-hidden="true" />
            </button>
          </div>

          <p className="text-[12px] text-content-3 text-center mt-6 leading-relaxed">
            Staff access is granted by role, not by this choice. Signing in here does not
            create or elevate an account.
          </p>
        </motion.main>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center p-4 sm:p-6 relative isolate overflow-hidden"
      style={{ background: 'var(--color-bg-main)' }}
    >
      {/* The front door. Replaces the two CSS blur blobs that used to sit
          here: they animated `filter` on a 45vw element, which is a
          full-viewport repaint every frame — more expensive than the
          shader that replaced them, and it only existed in one theme. */}
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
            className="float-y w-14 h-14 rounded-xl grid place-items-center mx-auto mb-4 text-white shadow-lg bg-gradient-to-br from-cta to-saffron"
          >
            <ShieldCheck size={28} strokeWidth={2} />
          </div>
          <h1 className="font-display font-bold text-2xl tracking-tight text-content">
            {audience === 'staff' ? 'Staff sign-in' : 'Sign in to CivicAI'}
          </h1>
          <p className="text-sm mt-1.5 text-content-3">
            {step === 'identify'
              ? 'Continue with Google, or use a one-time SMS code'
              : 'Enter the code we texted you'}
          </p>

          {/* Escape hatch back to the chooser. On the admin portal this links
              to the citizen app instead, because there is no chooser there. */}
          {step === 'identify' && (
            <button
              type="button"
              onClick={() => { setDevCode(null); fixedAudience ? navigate('/') : setAudience(null); }}
              className="press inline-flex items-center gap-1.5 mt-3 text-[12px] font-bold uppercase
                         tracking-wider text-content-3 hover:text-cta transition-colors"
            >
              <ArrowLeft size={13} aria-hidden="true" />
              {fixedAudience ? 'Citizen sign-in' : 'Change'}
            </button>
          )}
        </header>

        {/* Live region so screen readers announce errors and status changes */}
        <div aria-live="polite" aria-atomic="true">
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2.5 p-3.5 rounded-xl mb-5"
              style={{ background: 'var(--color-danger-pale)', border: '1px solid var(--color-danger)' }}
            >
              <AlertTriangle size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--color-danger)' }} aria-hidden="true" />
              <p className="text-[13px] font-semibold" style={{ color: 'var(--color-danger)' }}>
                {error}
                {lockedFor > 0 && (
                  <span className="block mt-1 font-mono text-xs font-bold">
                    Unlocks in {Math.floor(lockedFor / 60)}:{String(lockedFor % 60).padStart(2, '0')}
                  </span>
                )}
              </p>
            </div>
          )}
          {info && !error && (
            <div
              role="status"
              className="flex items-start gap-2.5 p-3.5 rounded-xl mb-5"
              style={{ background: 'var(--color-success-pale)', border: '1px solid var(--color-success)' }}
            >
              <CheckCircle2 size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--color-success)' }} aria-hidden="true" />
              <p className="text-[13px] font-semibold" style={{ color: 'var(--color-success)' }}>{info}</p>
            </div>
          )}
        </div>

        {step === 'identify' ? (
          <>
            {/* Primary: Google */}
            {configLoading ? (
              <div className="h-11 rounded-full skeleton mb-1" role="status" aria-label="Loading sign-in options" />
            ) : googleClientId ? (
              <div className="mb-1">
                <div ref={googleBtnRef} className="flex justify-center min-h-[44px]" aria-busy={googleBusy || undefined} />
                {!googleReady && (
                  <button
                    type="button"
                    onClick={handleDemoGoogleSignIn}
                    disabled={googleBusy}
                    className="w-full h-11 flex items-center justify-center gap-3 px-4 rounded-full font-medium text-sm transition-all hover:opacity-90 active:scale-[0.98] shadow-sm"
                    style={{
                      background: isDark ? '#1e293b' : '#ffffff',
                      color: isDark ? '#f8fafc' : '#0f172a',
                      border: `1px solid ${isDark ? '#334155' : '#cbd5e1'}`,
                    }}
                  >
                    <GoogleIcon />
                    <span>Continue with Google</span>
                  </button>
                )}
                {googleBusy && (
                  <p className="text-xs text-center mt-2 text-content-3" role="status">Signing you in…</p>
                )}
              </div>
            ) : (
              <div className="mb-1">
                <button
                  type="button"
                  onClick={handleDemoGoogleSignIn}
                  disabled={googleBusy}
                  className="w-full h-11 flex items-center justify-center gap-3 px-4 rounded-full font-medium text-sm transition-all hover:opacity-90 active:scale-[0.98] shadow-sm"
                  style={{
                    background: isDark ? '#1e293b' : '#ffffff',
                    color: isDark ? '#f8fafc' : '#0f172a',
                    border: `1px solid ${isDark ? '#334155' : '#cbd5e1'}`,
                  }}
                >
                  <GoogleIcon />
                  <span>Continue with Google</span>
                </button>
                {googleBusy && (
                  <p className="text-xs text-center mt-2 text-content-3" role="status">Signing you in…</p>
                )}
              </div>
            )}

            {/* Divider */}
            <div className="flex items-center gap-3 my-5" aria-hidden="true">
              <span className="h-px flex-1" style={{ background: 'var(--color-border)' }} />
              <span className="text-[11px] font-bold uppercase tracking-widest text-content-3">or</span>
              <span className="h-px flex-1" style={{ background: 'var(--color-border)' }} />
            </div>

            <form
              className="space-y-5"
              noValidate
              onSubmit={e => { e.preventDefault(); void handleRequestOtp(); }}
            >
              {/* Honeypot — visually hidden, never announced, never tabbable */}
              <div aria-hidden="true" className="absolute w-px h-px overflow-hidden -left-[9999px]">
                <label htmlFor="company">Company (leave blank)</label>
                <input
                  id="company"
                  name="company"
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={honeypot}
                  onChange={e => setHoneypot(e.target.value)}
                />
              </div>

              <div>
                <label htmlFor="phone" className="block text-[13px] font-semibold mb-1.5 text-content">
                  Mobile number
                </label>
                <div className="relative">
                  <Smartphone className="absolute left-3.5 top-1/2 -translate-y-1/2 text-content-3" size={18} aria-hidden="true" />
                  {/* +91 shown as fixed chrome rather than pre-filled text:
                      a prefix inside the value gets selected and deleted by
                      people typing over it, then fails validation. */}
                  <span
                    aria-hidden="true"
                    className="absolute left-10 top-1/2 -translate-y-1/2 text-base font-semibold text-content-3 tabular-nums"
                  >
                    +91
                  </span>
                  <input
                    id="phone"
                    name="phone"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    maxLength={14}
                    required
                    aria-describedby="phone-hint"
                    aria-invalid={!!error || undefined}
                    disabled={lockedFor > 0}
                    placeholder="93057 27103"
                    value={phone}
                    onChange={e => { setPhone(e.target.value); setError(null); }}
                    className="w-full h-12 pl-[4.75rem] pr-4 rounded-xl outline-none text-base transition-colors
                               border-2 focus:border-cta hover:border-[var(--color-content-3)]
                               disabled:opacity-60 disabled:cursor-not-allowed"
                    style={{
                      background: 'var(--color-surface)',
                      color: 'var(--color-content)',
                      borderColor: 'var(--color-border-strong)',
                    }}
                  />
                </div>
                <p id="phone-hint" className="text-xs mt-1.5 text-content-3">
                  Enter any 10-digit mobile number. We'll text a 6-digit verification code.
                </p>
              </div>

              <Button
                type="submit"
                fullWidth
                size="lg"
                disabled={lockedFor > 0 || !phoneValid}
                loadingText="Sending code…"
                onClick={() => handleRequestOtp()}
              >
                {lockedFor > 0 ? 'Temporarily locked' : 'Text me a code'}
                <ChevronRight size={18} aria-hidden="true" />
              </Button>

              <p className="text-xs text-center text-content-3">
                Limits: 5 codes per 15 minutes · 6 verification attempts
              </p>
            </form>
          </>
        ) : (
          <form
            className="space-y-5"
            noValidate
            onSubmit={e => { e.preventDefault(); void handleVerifyOtp(); }}
          >
            {/*
              No SMS provider configured, so the server printed the code to
              its console instead of sending it. Showing it here saves digging
              through terminal output to sign in.

              Deliberately loud rather than subtle: a panel that looks like
              part of the product is one that survives to production. The
              server only returns this code when delivery is in console mode
              and NODE_ENV is not production — set RESEND_API_KEY and it
              disappears on its own, with no code change.
            */}
            {devCode && (
              <div
                className="rounded-xl p-4"
                style={{
                  background: 'var(--color-warning-pale)',
                  border: '1px dashed var(--color-warning)',
                }}
              >
                <p className="text-[11px] font-black uppercase tracking-widest mb-2"
                   style={{ color: 'var(--color-warning)' }}>
                  SMS not configured · development only
                </p>
                <div className="flex items-center gap-3 flex-wrap">
                  <code
                    className="font-mono text-2xl font-bold tracking-[0.35em] select-all"
                    style={{ color: 'var(--color-content)' }}
                  >
                    {devCode}
                  </code>
                  <button
                    type="button"
                    onClick={() => { setOtp(devCode); otpInputRef.current?.focus(); }}
                    className="press ml-auto px-3 py-1.5 rounded-lg text-[12px] font-bold bordered surface
                               text-content-2 hover:text-cta transition-colors"
                  >
                    Use this code
                  </button>
                </div>
                <p className="text-[11px] mt-2" style={{ color: 'var(--color-warning)' }}>
                  Set MSG91_AUTH_KEY or TWILIO_* in .env to receive real SMS instead.
                </p>
              </div>
            )}

            <div>
              <label htmlFor="otp" className="block text-[13px] font-semibold mb-1.5 text-content">
                6-digit code
              </label>
              <input
                ref={otpInputRef}
                id="otp"
                name="otp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                aria-describedby="otp-hint"
                aria-invalid={!!error || undefined}
                placeholder="000000"
                value={otp}
                onChange={e => { setOtp(e.target.value.replace(/\D/g, '').slice(0, 6)); setError(null); }}
                className="w-full h-14 px-4 rounded-xl outline-none text-2xl tracking-[0.5em] font-bold
                           font-mono text-center border-2 focus:border-cta transition-colors"
                style={{
                  background: 'var(--color-surface)',
                  color: 'var(--color-content)',
                  borderColor: 'var(--color-border-strong)',
                }}
              />
              <p id="otp-hint" className="text-xs mt-1.5 text-center text-content-3">
                Sent to <span className="font-mono font-semibold text-content">{maskedIdentifier}</span> · valid 5 minutes
              </p>
            </div>

            {attemptsLeft !== null && attemptsLeft > 0 && (
              <div className="flex flex-col items-center gap-2" role="status">
                <div className="flex items-center gap-1" aria-hidden="true">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <span
                      key={i}
                      className="h-1.5 w-5 rounded-full"
                      style={{ background: i < attemptsLeft ? 'var(--color-success)' : 'var(--color-danger)' }}
                    />
                  ))}
                </div>
                <span className="text-xs font-semibold text-content-3">{attemptsLeft} of 6 attempts left</span>
              </div>
            )}

            <Button
              type="submit"
              fullWidth
              size="lg"
              disabled={otp.length !== 6}
              loadingText="Verifying…"
              onClick={() => handleVerifyOtp()}
            >
              Verify and continue
              <ChevronRight size={18} aria-hidden="true" />
            </Button>

            <div className="flex items-center justify-center gap-4 pt-1">
              <Button
                variant="ghost"
                size="sm"
                disabled={resendIn > 0}
                loadingText="Resending…"
                onClick={() => handleRequestOtp()}
              >
                {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
              </Button>
              <span aria-hidden="true" style={{ color: 'var(--color-border-strong)' }}>|</span>
              <Button variant="ghost" size="sm" onClick={backToPhone}>
                Change email
              </Button>
            </div>
          </form>
        )}

        <footer
          className="flex items-center gap-2 justify-center mt-7 pt-5"
          style={{ borderTop: '1px solid var(--color-border)' }}
        >
          <ShieldCheck size={14} style={{ color: 'var(--color-success)' }} aria-hidden="true" />
          <span className="text-xs font-semibold text-content-3">
            Government-verified · Codes are hashed, never stored in plain text
          </span>
        </footer>
      </motion.main>
    </div>
  );
}
