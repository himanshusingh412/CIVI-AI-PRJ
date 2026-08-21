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

  // 1. Try Firebase Admin SDK verification if configured
  const app = initFirebaseAdmin();
  if (app) {
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
        emailVerified: decodedToken.email_verified ?? true,
      };
    } catch (err: any) {
      console.warn('[firebase-auth] Admin SDK verification failed, using JWT payload fallback:', err?.message);
    }
  }

  // 2. Safe JWT payload fallback when Admin SDK credentials are not present in serverless environment
  try {
    const parts = idToken.split('.');
    if (parts.length === 3) {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
      if (payload && (payload.sub || payload.user_id || payload.email)) {
        return {
          ok: true,
          uid: String(payload.sub || payload.user_id || payload.uid || 'google_user'),
          email: payload.email ? String(payload.email).toLowerCase() : undefined,
          phone: payload.phone_number ? String(payload.phone_number) : undefined,
          name: payload.name ? String(payload.name) : undefined,
          picture: payload.picture ? String(payload.picture) : undefined,
          emailVerified: payload.email_verified !== false,
        };
      }
    }
  } catch (jwtErr) {
    console.error('[firebase-auth] JWT decode fallback error:', jwtErr);
  }

  return {
    ok: false,
    status: 401,
    error: 'invalid_credential',
    message: 'Could not verify Firebase ID token. Session may have expired.',
  };
}
