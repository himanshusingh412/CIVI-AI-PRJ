import React from 'react';
import { PhoneAuthForm } from '@firebase-oss/ui-react';
import type { UserCredential } from 'firebase/auth';
import { isFirebaseConfigured, ui } from '../lib/firebase';
import { firebaseSignIn, isAuthError, type AuthUser } from '../services/authService';

interface FirebasePhoneAuthUIProps {
  onSignedIn: (user: AuthUser) => void;
  onError?: (error: string) => void;
}

/**
 * Phone sign-in via FirebaseUI-for-Web (@firebase-oss/ui-react), rendered
 * inline inside LoginScreen rather than as its own full-page <PhoneAuthScreen>
 * - CivicAI already has its own card chrome, so this uses the bare
 * <PhoneAuthForm> and lets the library own only the two-step phone number →
 * verification code flow (including its own reCAPTCHA lifecycle).
 *
 * On success this hands the resulting Firebase ID token to the same
 * /api/auth/firebase endpoint the Firebase Google button already uses, so
 * CivicAI's own httpOnly session cookie is what the rest of the app runs on
 * - Firebase's client session is never treated as the app's auth.
 */
export const FirebasePhoneAuthUI: React.FC<FirebasePhoneAuthUIProps> = ({ onSignedIn, onError }) => {
  if (!isFirebaseConfigured() || !ui) {
    return (
      <div className="p-4 text-xs text-amber-600 bg-amber-50 rounded-lg bordered">
        Firebase Auth is not configured. Set VITE_FIREBASE_* environment variables to use Firebase phone sign-in.
      </div>
    );
  }

  return (
    <div className="firebaseui-container w-full my-2">
      <PhoneAuthForm
        onSignIn={async (credential: UserCredential) => {
          try {
            const idToken = await credential.user.getIdToken();
            const res = await firebaseSignIn(idToken);
            if (isAuthError(res)) {
              onError?.(res.message);
              return;
            }
            onSignedIn({ identifier: res.identifier, channel: res.channel });
          } catch (err: any) {
            onError?.(err?.message || 'Failed to retrieve auth token.');
          }
        }}
      />
    </div>
  );
};
