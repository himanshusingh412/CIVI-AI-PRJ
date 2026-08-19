import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  type Auth,
  type User,
} from 'firebase/auth';
import { initializeUI, countryCodes, type FirebaseUIStore } from '@firebase-oss/ui-core';

const firebaseConfig = {
  apiKey: (import.meta as any).env?.VITE_FIREBASE_API_KEY || '',
  authDomain: (import.meta as any).env?.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: (import.meta as any).env?.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: (import.meta as any).env?.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: (import.meta as any).env?.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: (import.meta as any).env?.VITE_FIREBASE_APP_ID || '',
};

export const isFirebaseConfigured = (): boolean => {
  return !!(
    firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId
  );
};

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
/**
 * FirebaseUI-for-Web's instance (@firebase-oss/ui-core). Only <PhoneAuthForm>
 * consumes this today (see FirebasePhoneAuthUI.tsx), but it's created once
 * here alongside `app`/`auth` so every screen shares a single instance
 * instead of each caller standing up its own.
 */
let ui: FirebaseUIStore | null = null;

if (typeof window !== 'undefined') {
  try {
    if (isFirebaseConfigured()) {
      app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
      auth = getAuth(app);
      // Automatically use device default language preference
      auth.useDeviceLanguage();
      ui = initializeUI({
        app,
        behaviors: [
          countryCodes({
            defaultCountry: 'IN',
            allowedCountries: ['IN', 'US', 'GB'],
          }),
        ],
      });
    }
  } catch (err) {
    console.warn('[firebase] Initialization warning:', err);
  }
}

export { app, auth, ui };

export const googleProvider = new GoogleAuthProvider();

export async function signInWithGoogleFirebase() {
  if (!auth) {
    throw new Error('Firebase Auth is not configured. Please set VITE_FIREBASE_* environment variables.');
  }
  const result = await signInWithPopup(auth, googleProvider);
  const idToken = await result.user.getIdToken();
  return { user: result.user, idToken };
}

export async function signInWithEmailFirebase(email: string, pass: string) {
  if (!auth) {
    throw new Error('Firebase Auth is not configured. Please set VITE_FIREBASE_* environment variables.');
  }
  const result = await signInWithEmailAndPassword(auth, email, pass);
  const idToken = await result.user.getIdToken();
  return { user: result.user, idToken };
}

export async function signUpWithEmailFirebase(email: string, pass: string) {
  if (!auth) {
    throw new Error('Firebase Auth is not configured. Please set VITE_FIREBASE_* environment variables.');
  }
  const result = await createUserWithEmailAndPassword(auth, email, pass);
  const idToken = await result.user.getIdToken();
  return { user: result.user, idToken };
}

// Phone auth (reCAPTCHA + signInWithPhoneNumber + code confirmation) used to
// be hand-rolled here. It's now handled by @firebase-oss/ui-react's
// <PhoneAuthForm>, wired up in FirebasePhoneAuthUI.tsx - that library owns
// its own reCAPTCHA lifecycle via the `ui` instance above, so there's
// nothing left for this file to do for phone sign-in.

export async function signOutFirebase() {
  if (auth) {
    await firebaseSignOut(auth);
  }
}

export function subscribeToAuthChanges(callback: (user: User | null) => void) {
  if (!auth) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(auth, callback);
}
