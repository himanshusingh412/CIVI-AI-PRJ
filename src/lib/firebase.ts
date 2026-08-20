import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type Auth,
  type User,
  type ConfirmationResult,
} from 'firebase/auth';

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

if (typeof window !== 'undefined') {
  try {
    if (isFirebaseConfigured()) {
      app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
      auth = getAuth(app);
      // Automatically use device default language preference
      auth.useDeviceLanguage();
    }
  } catch (err) {
    console.warn('[firebase] Initialization warning:', err);
  }
}

/**
 * Disable app verification (reCAPTCHA) for automated testing or development with test numbers.
 */
export function setAppVerificationDisabledForTesting(disabled: boolean) {
  if (auth) {
    auth.settings.appVerificationDisabledForTesting = disabled;
  }
}

export { app, auth };

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

/**
 * Initialize a RecaptchaVerifier instance for Firebase Phone Auth.
 */
export function initRecaptchaVerifier(containerId: string, size: 'invisible' | 'normal' = 'invisible'): RecaptchaVerifier {
  if (!auth) {
    throw new Error('Firebase Auth is not configured.');
  }
  return new RecaptchaVerifier(auth, containerId, {
    size,
    callback: () => {
      // reCAPTCHA solved
    },
    'expired-callback': () => {
      console.warn('[firebase] reCAPTCHA expired, please try again.');
    },
  });
}

/**
 * Send a real-time SMS OTP to a phone number via Firebase Auth.
 */
export async function sendFirebasePhoneOtp(phoneNumber: string, appVerifier: RecaptchaVerifier): Promise<ConfirmationResult> {
  if (!auth) {
    throw new Error('Firebase Auth is not configured.');
  }
  return await signInWithPhoneNumber(auth, phoneNumber, appVerifier);
}

/**
 * Confirm the OTP code sent via real-time SMS.
 */
export async function confirmFirebasePhoneOtp(confirmationResult: ConfirmationResult, code: string) {
  const result = await confirmationResult.confirm(code);
  const idToken = await result.user.getIdToken();
  return { user: result.user, idToken };
}

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
