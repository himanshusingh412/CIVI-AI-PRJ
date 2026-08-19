import { initializeApp, getApps, getApp, cert, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

export const firebaseAdminStatus = () => {
  const isInitialized = getApps().length > 0;
  return {
    enabled: isInitialized || !!(process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID),
    initialized: isInitialized,
  };
};

function initFirebaseAdmin(): App | null {
  if (getApps().length > 0) {
    return getApp();
  }

  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (clientEmail && privateKey && projectId) {
    return initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
  }

  if (projectId) {
    // Application Default Credentials or Project ID fallback
    return initializeApp({
      projectId,
    });
  }

  return null;
}

export type FirebaseVerifyResult =
  | {
      ok: true;
      uid: string;
      email?: string;
      phone?: string;
      name?: string;
      picture?: string;
      emailVerified?: boolean;
    }
  | { ok: false; status: number; error: string; message: string };

export async function verifyFirebaseIdToken(idToken: string): Promise<FirebaseVerifyResult> {
  if (!idToken || typeof idToken !== 'string') {
    return { ok: false, status: 400, error: 'missing_credential', message: 'Missing Firebase ID token.' };
  }

  const app = initFirebaseAdmin();
  if (!app) {
    return {
      ok: false,
      status: 501,
      error: 'not_configured',
      message: 'Firebase Admin SDK is not configured on this server yet. Set FIREBASE_PROJECT_ID in environment variables.',
    };
  }

  try {
    const auth = getAuth(app);
    const decodedToken = await auth.verifyIdToken(idToken);
    return {
      ok: true,
      uid: decodedToken.uid,
      email: decodedToken.email ? decodedToken.email.toLowerCase() : undefined,
      phone: decodedToken.phone_number,
      name: decodedToken.name,
      picture: decodedToken.picture,
      emailVerified: decodedToken.email_verified,
    };
  } catch (err: any) {
    console.error('[firebase-auth] Token verification failed:', err?.message || err);
    return {
      ok: false,
      status: 401,
      error: 'invalid_credential',
      message: 'Could not verify Firebase ID token. Session may have expired.',
    };
  }
}
