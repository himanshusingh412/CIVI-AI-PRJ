import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Building2, ChevronRight, AlertTriangle, ArrowLeft, Lock, Smartphone, CheckCircle2, KeyRound } from 'lucide-react';
import { Button } from '../components/Button';
import { PageBackground } from '../components/backgrounds/PageBackground';
import {
  adminLogin,
  requestOtp,
  verifyOtp,
  googleSignIn,
  firebaseSignIn,
  validatePhone,
  isAuthError,
} from '../services/authService';
import { isFirebaseConfigured, signInWithGoogleFirebase } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import { useT } from '../i18n/I18nContext';
import { useTheme } from '../context/ThemeContext';

const BUILD_TIME_CLIENT_ID = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID ?? '';

type AuthMethod = 'employeeId' | 'phone';
type OtpStep = 'identify' | 'otp';

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
  </svg>
);

export function AdminLoginPage() {
  const t = useT();
  const { isDark } = useTheme();
  const navigate = useNavigate();
  const { status, identity, identityLoading, onSignedIn } = useAuth();

  const [method, setMethod] = useState<AuthMethod>('employeeId');

  // Employee ID State
  const [employeeId, setEmployeeId] = useState('');
  const [password, setPassword] = useState('');

  // Phone OTP State
  const [otpStep, setOtpStep] = useState<OtpStep>('identify');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [maskedIdentifier, setMasked] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const [resendIn, setResendIn] = useState(0);

  // Common State
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lockedFor, setLockedFor] = useState(0);

  // Google State
  const [googleClientId, setGoogleClientId] = useState<string>(BUILD_TIME_CLIENT_ID);
  const [configLoading, setConfigLoading] = useState(!BUILD_TIME_CLIENT_ID);
  const [googleReady, setGoogleReady] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  const googleBtnRef = useRef<HTMLDivElement>(null);
  const otpInputRef = useRef<HTMLInputElement>(null);
  const mountedAt = useRef(Date.now());
  const mounted = useRef(true);
  const [company, setCompany] = useState('');

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Redirect if authenticated
  useEffect(() => {
    if (status !== 'authenticated' || identityLoading || !identity) return;
    navigate(identity.homeRoute, { replace: true });
  }, [status, identity, identityLoading, navigate]);

  // Locked countdown
  useEffect(() => {
    if (lockedFor <= 0) return;
    const timer = setInterval(() => setLockedFor(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [lockedFor]);

  // Resend countdown
  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setInterval(() => setResendIn(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [resendIn]);

  // Fetch Google Client ID
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
        /* fallback */
      } finally {
        if (mounted.current) setConfigLoading(false);
      }
    })();
    return () => ac.abort();
  }, []);

  const completeSignIn = useCallback(
    (identifier: string, channel: 'phone' | 'google' | 'password') => {
      onSignedIn({ identifier, channel: channel as any });
    },
    [onSignedIn],
  );

  // Google Handlers
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

  const handleFirebaseGoogleSignIn = async () => {
    setError(null);
    setInfo(null);
    setGoogleBusy(true);
    try {
      const { idToken } = await signInWithGoogleFirebase();
      const res = await firebaseSignIn(idToken);
      if (!mounted.current) return;
      setGoogleBusy(false);
      if (isAuthError(res)) {
        setError(res.message);
        return;
      }
      completeSignIn(res.identifier, res.channel);
    } catch (err: any) {
      if (!mounted.current) return;
      setGoogleBusy(false);
      setError(err?.message || 'Firebase sign in failed.');
    }
  };

  useEffect(() => {
    if (!googleClientId) return;

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
  }, [isDark, googleClientId, handleGoogleCredential]);

  // Employee ID Submit
  const submitEmployeeId = async (e: React.FormEvent) => {
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
      setPassword('');
      return;
    }

    onSignedIn({ identifier: res.identifier, channel: res.channel });
  };

  // Phone OTP Handlers
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
      company,
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
    setOtpStep('otp');
    setOtp('');
    setAttemptsLeft(null);
    setResendIn(30);
    setDevCode(res.devOtp ?? null);
    setInfo(res.message);
  };

  const handleVerifyOtp = async () => {
    setError(null);
    if (!/^\d{6}$/.test(otp)) {
      setError('Enter the 6-digit verification code.');
      return;
    }

    const res = await verifyOtp(phone, otp);
    if (!mounted.current) return;

    if (isAuthError(res)) {
      setError(res.message);
      if (typeof res.attemptsRemaining === 'number') setAttemptsLeft(res.attemptsRemaining);
      if (res.error === 'locked_out' && res.retryAfterSec) {
        setLockedFor(res.retryAfterSec);
        setOtpStep('identify');
        setAttemptsLeft(null);
      }
      setOtp('');
      return;
    }

    completeSignIn(res.identifier, res.channel);
  };

  const canSubmitEmployeeId = employeeId.trim().length > 0 && password.length > 0 && !busy && lockedFor === 0;

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
        <header className="text-center mb-6">
          <div
            aria-hidden="true"
            className="w-14 h-14 rounded-xl grid place-items-center mx-auto mb-4 text-white shadow-lg
                       bg-gradient-to-br from-navy to-navy-light"
            style={{ background: 'linear-gradient(135deg, var(--color-navy), var(--color-navy-light))' }}
          >
            <Building2 size={28} strokeWidth={2} />
          </div>
          <h1 className="font-display font-bold text-2xl tracking-tight text-content">
            Staff & Admin Sign-in
          </h1>
          <p className="text-sm mt-1.5 text-content-3">
            For officers, department admins and system administrators
          </p>
        </header>

        {/* Error / Info banner */}
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
          {info && !error && (
            <div
              role="status"
              className="flex items-start gap-2.5 p-3.5 rounded-xl mb-4 text-xs font-semibold"
              style={{
                background: 'var(--color-success-pale)',
                border: '1px solid var(--color-success)',
                color: 'var(--color-success)',
              }}
            >
              <CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{info}</span>
            </div>
          )}
        </div>

        {/* Google Sign-in Section */}
        <div className="mb-5">
          {configLoading ? (
            <div className="h-11 rounded-full skeleton" role="status" />
          ) : googleClientId ? (
            <div>
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
            </div>
          ) : isFirebaseConfigured() ? (
            <button
              type="button"
              onClick={handleFirebaseGoogleSignIn}
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
          ) : (
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
        </div>

        {/* OR Divider */}
        <div className="flex items-center gap-3 my-5" aria-hidden="true">
          <span className="h-px flex-1" style={{ background: 'var(--color-border)' }} />
          <span className="text-[11px] font-bold uppercase tracking-widest text-content-3">OR</span>
          <span className="h-px flex-1" style={{ background: 'var(--color-border)' }} />
        </div>

        {/* Tab Selector for Login Method */}
        <div className="grid grid-cols-2 gap-1 p-1 mb-5 rounded-xl border surface-2" style={{ borderColor: 'var(--color-border)' }}>
          <button
            type="button"
            onClick={() => { setMethod('employeeId'); setError(null); }}
            className={`py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
              method === 'employeeId'
                ? 'surface shadow-sm text-cta border'
                : 'text-content-3 hover:text-content'
            }`}
            style={method === 'employeeId' ? { borderColor: 'var(--color-border-strong)' } : {}}
          >
            <KeyRound size={14} />
            <span>Employee ID</span>
          </button>
          <button
            type="button"
            onClick={() => { setMethod('phone'); setError(null); }}
            className={`py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
              method === 'phone'
                ? 'surface shadow-sm text-cta border'
                : 'text-content-3 hover:text-content'
            }`}
            style={method === 'phone' ? { borderColor: 'var(--color-border-strong)' } : {}}
          >
            <Smartphone size={14} />
            <span>Mobile OTP</span>
          </button>
        </div>

        {/* Form Body based on selected Tab */}
        {method === 'employeeId' ? (
          <form className="space-y-4" onSubmit={submitEmployeeId} noValidate>
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
                placeholder="EMP-0001"
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
                  placeholder="123456"
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

            <Button type="submit" fullWidth size="lg" disabled={!canSubmitEmployeeId} loadingText={t('adminLogin.signingIn')}>
              {t('adminLogin.cta')}
              <ChevronRight size={18} aria-hidden="true" />
            </Button>
          </form>
        ) : otpStep === 'identify' ? (
          <form
            className="space-y-4"
            noValidate
            onSubmit={e => { e.preventDefault(); void handleRequestOtp(); }}
          >
            <div>
              <label htmlFor="phone" className="block text-[13px] font-semibold mb-1.5 text-content">
                Mobile number
              </label>
              <div className="relative">
                <Smartphone className="absolute left-3.5 top-1/2 -translate-y-1/2 text-content-3" size={18} aria-hidden="true" />
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
                  disabled={lockedFor > 0}
                  placeholder="93057 27103"
                  value={phone}
                  onChange={e => { setPhone(e.target.value); setError(null); }}
                  className="w-full h-12 pl-[4.75rem] pr-4 rounded-xl outline-none text-base transition-colors
                             border-2 focus:border-cta hover:border-[var(--color-content-3)]"
                  style={{
                    background: 'var(--color-surface)',
                    color: 'var(--color-content)',
                    borderColor: 'var(--color-border-strong)',
                  }}
                />
              </div>
              <p className="text-xs mt-1.5 text-content-3">
                Enter your registered mobile number. We'll text a 6-digit code.
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
          </form>
        ) : (
          <form
            className="space-y-4"
            noValidate
            onSubmit={e => { e.preventDefault(); void handleVerifyOtp(); }}
          >
            {devCode && (
              <div
                className="rounded-xl p-3.5"
                style={{
                  background: 'var(--color-warning-pale)',
                  border: '1px dashed var(--color-warning)',
                }}
              >
                <p className="text-[10px] font-black uppercase tracking-widest mb-1.5" style={{ color: 'var(--color-warning)' }}>
                  Development OTP Mode
                </p>
                <div className="flex items-center gap-3 flex-wrap">
                  <code className="font-mono text-xl font-bold tracking-[0.35em]" style={{ color: 'var(--color-content)' }}>
                    {devCode}
                  </code>
                  <button
                    type="button"
                    onClick={() => { setOtp(devCode); otpInputRef.current?.focus(); }}
                    className="press ml-auto px-2.5 py-1 rounded-lg text-xs font-bold bordered surface text-content-2"
                  >
                    Use this code
                  </button>
                </div>
              </div>
            )}

            <div>
              <label htmlFor="otp" className="block text-[13px] font-semibold mb-1.5 text-content">
                6-digit verification code
              </label>
              <input
                ref={otpInputRef}
                id="otp"
                name="otp"
                type="text"
                inputMode="numeric"
                maxLength={6}
                required
                placeholder="000000"
                value={otp}
                onChange={e => { setOtp(e.target.value.replace(/\D/g, '').slice(0, 6)); setError(null); }}
                className="w-full h-12 px-4 rounded-xl outline-none text-xl tracking-[0.4em] font-bold
                           font-mono text-center border-2 focus:border-cta"
                style={{
                  background: 'var(--color-surface)',
                  color: 'var(--color-content)',
                  borderColor: 'var(--color-border-strong)',
                }}
              />
            </div>

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
          </form>
        )}

        <div className="text-center mt-6">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="press inline-flex items-center gap-1.5 text-[12px] font-bold uppercase
                       tracking-wider text-content-3 hover:text-cta transition-colors"
          >
            <ArrowLeft size={13} aria-hidden="true" />
            Back to Home
          </button>
        </div>

        <p className="text-[11px] text-content-3 text-center mt-5 leading-relaxed">
          Authorised personnel only. Access is logged and audited.
        </p>
      </motion.main>
    </div>
  );
}
