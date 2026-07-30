import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, CheckCircle2, ChevronRight, Mail, ShieldCheck } from 'lucide-react';
import { Button } from './Button';
import { useTheme } from '../context/ThemeContext';
import {
  requestOtp,
  verifyOtp,
  googleSignIn,
  validateEmail,
  isAuthError,
  type AuthUser,
} from '../services/authService';

const GOOGLE_CLIENT_ID = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID ?? '';

type Step = 'identify' | 'otp';

export function LoginScreen({ onSignedIn }: { onSignedIn: (u: AuthUser) => void }) {
  const { isDark } = useTheme();

  const [step, setStep] = useState<Step>('identify');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [maskedIdentifier, setMasked] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
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
    (identifier: string, channel: 'email' | 'google') => {
      onSignedIn({ identifier, channel });
    },
    [onSignedIn],
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

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || step !== 'identify') return;

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
          client_id: GOOGLE_CLIENT_ID,
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
  }, [step, isDark, handleGoogleCredential]);

  // ── email OTP ──
  const emailValid = validateEmail(email).ok;

  const handleRequestOtp = async () => {
    setError(null);
    setInfo(null);

    const check = validateEmail(email);
    if (!check.ok) {
      setError(check.reason!);
      return;
    }

    const res = await requestOtp(email, {
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
    setInfo(res.devOtp ? `${res.message} · dev code: ${res.devOtp}` : res.message);
  };

  const handleVerifyOtp = async () => {
    setError(null);
    if (!/^\d{6}$/.test(otp)) {
      setError('Enter the 6-digit code.');
      return;
    }

    const res = await verifyOtp(email, otp);
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

  const backToEmail = () => {
    setStep('identify');
    setOtp('');
    setError(null);
    setInfo(null);
    setAttemptsLeft(null);
  };

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center p-4 sm:p-6 relative overflow-hidden"
      style={{ background: 'var(--color-bg-main)' }}
    >
      <div aria-hidden="true" className="aurora-bg opacity-40">
        <div className="aurora-blob absolute -top-[15%] -left-[10%] w-[45%] h-[45%] bg-cta" />
        <div className="aurora-blob absolute -bottom-[15%] -right-[10%] w-[45%] h-[45%] bg-saffron" style={{ animationDelay: '5s' }} />
      </div>

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
          <h1 className="font-display font-bold text-2xl tracking-tight text-content">Sign in to CivicAI</h1>
          <p className="text-sm mt-1.5 text-content-3">
            {step === 'identify'
              ? 'Continue with Google, or use a one-time email code'
              : 'Enter the code we emailed you'}
          </p>
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
            {GOOGLE_CLIENT_ID ? (
              <div className="mb-1">
                <div ref={googleBtnRef} className="flex justify-center min-h-[44px]" aria-busy={googleBusy || undefined} />
                {!googleReady && (
                  <div className="h-11 rounded-full skeleton" aria-hidden="true" />
                )}
                {googleBusy && (
                  <p className="text-xs text-center mt-2 text-content-3" role="status">Signing you in…</p>
                )}
              </div>
            ) : (
              <div
                className="rounded-xl p-3.5 mb-1 text-[13px]"
                style={{ background: 'var(--color-info-pale)', color: 'var(--color-info)', border: '1px solid var(--color-info)' }}
              >
                Google sign-in isn't configured yet. Add <code className="font-mono">VITE_GOOGLE_CLIENT_ID</code> to
                your <code className="font-mono">.env</code> to enable it. You can still sign in with an email code below.
              </div>
            )}

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
                <label htmlFor="email" className="block text-[13px] font-semibold mb-1.5 text-content">
                  Email address
                </label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-content-3" size={18} aria-hidden="true" />
                  <input
                    id="email"
                    name="email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    maxLength={254}
                    required
                    aria-describedby="email-hint"
                    aria-invalid={!!error || undefined}
                    disabled={lockedFor > 0}
                    placeholder="you@example.com"
                    value={email}
                    onChange={e => { setEmail(e.target.value); setError(null); }}
                    className="w-full h-12 pl-11 pr-4 rounded-xl outline-none text-base transition-colors
                               border-2 focus:border-cta hover:border-[var(--color-content-3)]
                               disabled:opacity-60 disabled:cursor-not-allowed"
                    style={{
                      background: 'var(--color-surface)',
                      color: 'var(--color-content)',
                      borderColor: 'var(--color-border-strong)',
                    }}
                  />
                </div>
                <p id="email-hint" className="text-xs mt-1.5 text-content-3">
                  We'll email a 6-digit code. No password needed.
                </p>
              </div>

              <Button
                type="submit"
                fullWidth
                size="lg"
                disabled={lockedFor > 0 || !emailValid}
                loadingText="Sending code…"
                onClick={() => handleRequestOtp()}
              >
                {lockedFor > 0 ? 'Temporarily locked' : 'Email me a code'}
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
              <Button variant="ghost" size="sm" onClick={backToEmail}>
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
