import React, { useState, useEffect, useRef } from 'react';
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

interface FirebasePhoneAuthUIProps {
  onSignedIn: (user: AuthUser) => void;
  onError?: (error: string) => void;
}

export const FirebasePhoneAuthUI: React.FC<FirebasePhoneAuthUIProps> = ({ onSignedIn, onError }) => {
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

  // Clean up recaptcha verifier on unmount
  useEffect(() => {
    return () => {
      if (recaptchaVerifierRef.current) {
        try {
          recaptchaVerifierRef.current.clear();
        } catch {
          /* ignore */
        }
      }
    };
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
    setError(null);
    onError?.('');

    const validation = validatePhone(phone);
    if (!validation.ok) {
      setError(validation.reason || 'Invalid phone number');
      return;
    }

    const getOrCreateRecaptchaVerifier = (): RecaptchaVerifier => {
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
    };

    setLoading(true);
    try {
      const verifier = getOrCreateRecaptchaVerifier();

      // Format to E.164 format (+91XXXXXXXXXX)
      const digitsOnly = phone.replace(/\D/g, '').slice(-10);
      const e164Phone = `+91${digitsOnly}`;

      const confirmation = await sendFirebasePhoneOtp(e164Phone, verifier);
      confirmationRef.current = confirmation;

      setStep('code');
      setResendIn(30);
      setLoading(false);
    } catch (err: any) {
      setLoading(false);
      if (recaptchaVerifierRef.current) {
        try {
          recaptchaVerifierRef.current.clear();
        } catch {
          /* ignore */
        }
        recaptchaVerifierRef.current = null;
      }
      const container = document.getElementById('firebase-recaptcha-container');
      if (container) container.innerHTML = '';

      console.error('[Firebase Phone Auth] Error sending OTP:', err);
      let msg = err?.message || 'Failed to send SMS OTP via Firebase.';
      if (err?.code === 'auth/operation-not-allowed' || msg.includes('region enabled')) {
        /*
         * This is a DEPLOYMENT misconfiguration (SMS region policy), not
         * anything the person signing in did or can fix. The previous copy
         * put "Go to Firebase Console -> Authentication -> Settings" on a
         * citizen's screen: it names internal infrastructure, reads as if
         * they had got something wrong, and prescribes an action only an
         * operator can take. The actionable detail belongs in the console
         * where an operator will actually see it; the screen gets a plain
         * statement and a route that still works.
         */
        console.error(
          '[Firebase Phone Auth] SMS delivery refused for this region. ' +
          'Firebase Console → Authentication → Settings → SMS region policy: ' +
          'allow India (IN), or register a test phone number.',
        );
        msg = 'SMS sign-in is temporarily unavailable. Please continue with Google, or try again shortly.';
      } else if (msg.includes('already been rendered')) {
        msg = 'Verification reset — please tap “Send Real-Time OTP” again.';
      } else if (err?.code === 'auth/invalid-phone-number') {
        msg = 'That mobile number doesn’t look right. Enter a 10-digit Indian number.';
      } else if (err?.code === 'auth/too-many-requests') {
        msg = 'Too many attempts from this device. Please wait a few minutes before trying again.';
      } else if (err?.code === 'auth/quota-exceeded') {
        msg = 'SMS sign-in is busy right now. Please continue with Google, or try again shortly.';
      }
      setError(msg);
      onError?.(msg);
    }
  };

  const handleVerifyOtp = async (e?: React.FormEvent) => {
    e?.preventDefault();
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
      const msg = err?.code === 'auth/invalid-verification-code'
        ? 'Invalid verification code. Please check and try again.'
        : err?.message || 'Verification failed.';
      setError(msg);
      onError?.(msg);
    }
  };

  const handleBackToPhone = () => {
    setStep('phone');
    setOtp('');
    setError(null);
  };

  const phoneValid = validatePhone(phone).ok;

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
              Mobile number (Firebase Real-Time OTP)
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
                placeholder="93057 27103"
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
              Enter your mobile number to receive a real-time SMS OTP via Firebase.
            </p>
          </div>

          <Button
            type="submit"
            fullWidth
            size="lg"
            disabled={loading || !phoneValid}
            loadingText="Sending SMS via Firebase…"
          >
            Send Real-Time OTP
            <ChevronRight size={18} aria-hidden="true" />
          </Button>
        </form>
      ) : (
        <form className="space-y-4" onSubmit={handleVerifyOtp} noValidate>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="firebase-otp" className="block text-[13px] font-semibold text-content">
                Firebase 6-digit code
              </label>
              <button
                type="button"
                onClick={handleBackToPhone}
                className="inline-flex items-center gap-1 text-xs font-medium text-cta hover:underline"
              >
                <ArrowLeft size={12} />
                Change number
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
              Enter the SMS verification code sent to your phone.
            </p>
          </div>

          <Button
            type="submit"
            fullWidth
            size="lg"
            disabled={loading || otp.length !== 6}
            loadingText="Verifying Firebase OTP…"
          >
            Verify & Sign In
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
