import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { ConfirmationResult, RecaptchaVerifier } from 'firebase/auth';
import { Smartphone, ChevronRight, AlertTriangle, ArrowLeft } from 'lucide-react';
import { Button } from './Button';
import {
  isFirebaseConfigured,
  initRecaptchaVerifier,
  sendFirebasePhoneOtp,
  confirmFirebasePhoneOtp,
} from '../lib/firebase';
import { firebaseSignIn, isAuthError, validatePhone, type AuthUser } from '../services/authService';
import { useI18n } from '../i18n/I18nContext';

interface FirebasePhoneAuthUIProps {
  onSignedIn: (user: AuthUser) => void;
  onError?: (error: string) => void;
}

/**
 * A Firebase test phone number and code, surfaced on screen if configured in env.
 */
const DEMO_PHONE = String((import.meta as any).env?.VITE_DEMO_PHONE ?? '').replace(/\D/g, '').slice(-10);
const DEMO_OTP = String((import.meta as any).env?.VITE_DEMO_OTP ?? '').trim();

const DemoCodeCallout: React.FC<{
  code: string;
  t: (k: any) => string;
  onUse?: () => void;
}> = ({ code, t, onUse }) => (
  <div
    className="mt-3 p-3 rounded-xl"
    style={{
      background: 'var(--color-warning-pale)',
      border: '1px dashed var(--color-warning)',
    }}
  >
    <p className="text-[11px] font-black uppercase tracking-widest mb-1" style={{ color: 'var(--color-warning)' }}>
      {t('auth.demoOtpTitle')}
    </p>
    <p className="text-[11px] mb-2" style={{ color: 'var(--color-warning)' }}>
      {t('auth.demoOtpBody')}
    </p>
    <div className="flex items-center gap-3 flex-wrap">
      <code
        className="text-xl font-bold font-mono tracking-[0.35em] px-3 py-1.5 rounded-lg"
        style={{ background: 'var(--color-surface)', color: 'var(--color-content)' }}
      >
        {code}
      </code>
      {onUse && (
        <button
          type="button"
          onClick={onUse}
          className="press text-[12px] font-bold uppercase tracking-wider hover:underline"
          style={{ color: 'var(--color-warning)' }}
        >
          {t('auth.otpCta')}
        </button>
      )}
    </div>
  </div>
);

function mapFirebaseError(err: any): string {
  const code = err?.code || '';
  const message = err?.message || '';

  if (code === 'auth/invalid-phone-number' || message.includes('invalid-phone-number')) {
    return 'Please enter a valid 10-digit mobile number.';
  }
  if (code === 'auth/too-many-requests' || message.includes('too-many-requests')) {
    return 'Too many attempts from this device. Please wait a few minutes before trying again.';
  }
  if (code === 'auth/quota-exceeded' || message.includes('quota-exceeded')) {
    return 'SMS verification limit reached for this project. Please try again later.';
  }
  if (code === 'auth/invalid-verification-code' || message.includes('invalid-verification-code')) {
    return 'Invalid verification code. Please check and try again.';
  }
  if (code === 'auth/code-expired' || message.includes('code-expired')) {
    return 'This verification code has expired. Please request a new code.';
  }
  if (code === 'auth/captcha-check-failed' || message.includes('captcha-check-failed')) {
    return 'reCAPTCHA verification failed. Please try again.';
  }
  if (code === 'auth/network-request-failed' || message.includes('network-request-failed')) {
    return 'Network error. Please check your connection and try again.';
  }
  if (code === 'auth/operation-not-allowed' || message.includes('operation-not-allowed')) {
    return 'Phone authentication is not enabled in Firebase Console.';
  }
  if (code === 'auth/unauthorized-domain' || message.includes('unauthorized-domain') || message.includes('authDomain')) {
    return 'Domain unauthorized in Firebase Console. Please add civi-ai-prj.vercel.app under Firebase > Authentication > Settings > Authorized Domains.';
  }

  return message || 'Unable to send verification code. Please try again.';
}

export const FirebasePhoneAuthUI: React.FC<FirebasePhoneAuthUIProps> = ({ onSignedIn, onError }) => {
  const { t } = useI18n();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  const confirmationRef = useRef<ConfirmationResult | null>(null);
  const recaptchaVerifierRef = useRef<RecaptchaVerifier | null>(null);
  const otpInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setInterval(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [resendIn]);

  useEffect(() => {
    if (step === 'code') {
      otpInputRef.current?.focus();
    }
  }, [step]);

  const cleanupRecaptcha = useCallback(() => {
    if (recaptchaVerifierRef.current) {
      try {
        recaptchaVerifierRef.current.clear();
      } catch {
        /* ignore clear errors */
      }
      recaptchaVerifierRef.current = null;
    }
    const container = document.getElementById('firebase-recaptcha-container');
    if (container) {
      container.innerHTML = '';
    }
  }, []);

  // Clean up recaptcha verifier on unmount
  useEffect(() => {
    return () => {
      cleanupRecaptcha();
    };
  }, [cleanupRecaptcha]);

  const getOrCreateRecaptchaVerifier = useCallback((): RecaptchaVerifier => {
    if (recaptchaVerifierRef.current) {
      return recaptchaVerifierRef.current;
    }
    const container = document.getElementById('firebase-recaptcha-container');
    if (container) {
      container.innerHTML = '';
    }
    const verifier = initRecaptchaVerifier('firebase-recaptcha-container', 'invisible');
    recaptchaVerifierRef.current = verifier;
    return verifier;
  }, []);

  if (!isFirebaseConfigured()) {
    return (
      <div className="p-4 text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800">
        Firebase Auth is not configured. Set VITE_FIREBASE_* environment variables to use Firebase real-time SMS OTP sign-in.
      </div>
    );
  }

  const handleSendOtp = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (loading) return;

    setError(null);
    onError?.('');

    const validation = validatePhone(phone);
    if (!validation.ok) {
      setError(validation.reason || 'Please enter a valid 10-digit mobile number.');
      return;
    }

    const digitsOnly = phone.replace(/\D/g, '').slice(-10);
    const e164Phone = `+91${digitsOnly}`;

    setLoading(true);

    try {
      const verifier = getOrCreateRecaptchaVerifier();
      const confirmation = await sendFirebasePhoneOtp(e164Phone, verifier);
      confirmationRef.current = confirmation;

      setStep('code');
      setResendIn(30);
      setLoading(false);
    } catch (err: any) {
      console.error('[Firebase Phone Auth] Error sending OTP:', err);
      cleanupRecaptcha();
      setLoading(false);

      const msg = mapFirebaseError(err);
      setError(msg);
      onError?.(msg);
    }
  };

  const handleVerifyOtp = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (loading) return;

    setError(null);

    if (!/^\d{6}$/.test(otp)) {
      setError('Enter the 6-digit verification code.');
      return;
    }

    if (!confirmationRef.current) {
      setError('Session expired. Please request a new code.');
      setStep('phone');
      return;
    }

    setLoading(true);
    try {
      const { idToken } = await confirmFirebasePhoneOtp(confirmationRef.current, otp);
      const res = await firebaseSignIn(idToken);
      setLoading(false);

      if (isAuthError(res)) {
        setError(res.message);
        onError?.(res.message);
        return;
      }

      onSignedIn({ identifier: res.identifier, channel: res.channel });
    } catch (err: any) {
      setLoading(false);
      console.error('[Firebase Phone Auth] Error confirming OTP:', err);
      const msg = mapFirebaseError(err);
      setError(msg);
      onError?.(msg);
    }
  };

  const handleBackToPhone = () => {
    cleanupRecaptcha();
    confirmationRef.current = null;
    setStep('phone');
    setOtp('');
    setError(null);
  };

  const phoneValid = validatePhone(phone).ok;
  const showDemoHint =
    !!DEMO_PHONE && !!DEMO_OTP && phone.replace(/\D/g, '').slice(-10) === DEMO_PHONE;

  return (
    <div className="w-full my-2">
      {/* Invisible reCAPTCHA container required by Firebase */}
      <div id="firebase-recaptcha-container" />

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 p-3.5 rounded-xl mb-4 text-xs font-semibold"
          style={{ background: 'var(--color-danger-pale)', border: '1px solid var(--color-danger)', color: 'var(--color-danger)' }}
        >
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {step === 'phone' ? (
        <form className="space-y-4" onSubmit={handleSendOtp} noValidate>
          <div>
            <label htmlFor="firebase-phone" className="block text-[13px] font-semibold mb-1.5 text-content">
              {t('auth.phoneLabel')}
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
                id="firebase-phone"
                name="phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                maxLength={14}
                required
                placeholder={t('auth.phonePlaceholder')}
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  setError(null);
                }}
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
              {t('auth.phoneHint')}
            </p>

            {showDemoHint && <DemoCodeCallout code={DEMO_OTP} t={t} />}
          </div>

          <Button
            type="submit"
            fullWidth
            size="lg"
            disabled={loading || !phoneValid}
            loadingText={t('auth.phoneSending')}
          >
            {t('auth.phoneCta')}
            <ChevronRight size={18} aria-hidden="true" />
          </Button>
        </form>
      ) : (
        <form className="space-y-4" onSubmit={handleVerifyOtp} noValidate>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="firebase-otp" className="block text-[13px] font-semibold text-content">
                {t('auth.otpLabel')}
              </label>
              <button
                type="button"
                onClick={handleBackToPhone}
                className="inline-flex items-center gap-1 text-xs font-medium text-cta hover:underline"
              >
                <ArrowLeft size={12} />
                {t('auth.changeNumber')}
              </button>
            </div>
            <input
              ref={otpInputRef}
              id="firebase-otp"
              name="otp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
              placeholder="000000"
              value={otp}
              onChange={(e) => {
                setOtp(e.target.value.replace(/\D/g, '').slice(0, 6));
                setError(null);
              }}
              className="w-full h-14 px-4 rounded-xl outline-none text-2xl tracking-[0.5em] font-bold
                         font-mono text-center border-2 focus:border-cta transition-colors"
              style={{
                background: 'var(--color-surface)',
                color: 'var(--color-content)',
                borderColor: 'var(--color-border-strong)',
              }}
            />
            <p className="text-xs mt-1.5 text-center text-content-3">
              {t('auth.otpHint')}
            </p>

            {showDemoHint && <DemoCodeCallout code={DEMO_OTP} t={t} onUse={() => setOtp(DEMO_OTP)} />}
          </div>

          <Button
            type="submit"
            fullWidth
            size="lg"
            disabled={loading || otp.length !== 6}
            loadingText={t('auth.otpVerifying')}
          >
            {t('auth.otpCta')}
            <ChevronRight size={18} aria-hidden="true" />
          </Button>

          <div className="text-center pt-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={resendIn > 0 || loading}
              onClick={(e) => handleSendOtp(e)}
            >
              {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend Firebase SMS'}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
};
