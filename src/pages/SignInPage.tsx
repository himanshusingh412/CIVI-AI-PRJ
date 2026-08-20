import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FirebaseUIProvider } from '@firebase-oss/ui-react';
import { LoginScreen, type Audience } from '../components/LoginScreen';
import { LoadingScreen } from '../components/LoadingScreen';
import { useAuth } from '../context/AuthContext';
import { ui as firebaseUi } from '../lib/firebase';

/**
 * Sign-in, for one audience at a time.
 *
 * The redirect after sign-in is the interesting part: it goes to
 * `identity.homeRoute`, which the SERVER computed from the session's role -
 * always, regardless of which door (/login or /staff) was used to get here.
 * The browser does not look at the role and decide; it asks and obeys.
 *
 * That distinction matters more than it looks. If the client picked the
 * destination, then "which portal am I in" would be client state, and every
 * subsequent screen would be tempted to trust it. Asking the server keeps
 * exactly one authority for the question - deliberately including the case
 * where an account with a staff/admin role signs in through the citizen
 * door and lands in its real portal anyway, rather than the self-service
 * one it didn't come here to use. (An earlier revision special-cased the
 * citizen door to always land on /portal; that was reverted because it's
 * not what's wanted here - see LoginScreen.tsx for how the two doors stay
 * visually distinguishable without changing where sign-in actually lands.)
 */
export function SignInPage({ audience }: { audience: Audience }) {
  const { status, identity, identityLoading, onSignedIn } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (status !== 'authenticated') return;
    if (identityLoading || !identity) return;
    navigate(identity.homeRoute, { replace: true });
  }, [status, identity, identityLoading, navigate]);

  if (status === 'loading') return <LoadingScreen label="Restoring your session…" />;
  // Authenticated but the role has not come back yet — hold rather than
  // flashing the login form at someone who is already signed in.
  if (status === 'authenticated') return <LoadingScreen label="Signing you in…" />;

  const screen = <LoginScreen onSignedIn={onSignedIn} audience={audience} />;

  // FirebaseUIProvider is scoped to the sign-in pages rather than the whole
  // app - it's the only place FirebasePhoneAuthUI's <PhoneAuthForm> renders,
  // and firebaseUi is null whenever VITE_FIREBASE_* isn't set, so there's
  // nothing to provide for the (default, unconfigured) demo path.
  return firebaseUi ? (
    <FirebaseUIProvider ui={firebaseUi}>{screen}</FirebaseUIProvider>
  ) : (
    screen
  );
}
