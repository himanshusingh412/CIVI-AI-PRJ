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
 * The redirect after sign-in mostly goes to `identity.homeRoute`, which the
 * SERVER computed from the session's role. The browser does not look at the
 * role and decide; it asks and obeys. That distinction matters more than it
 * looks: if the client picked the destination, "which portal am I in" would
 * be client state, and every subsequent screen would be tempted to trust it.
 * Asking the server keeps exactly one authority for the question.
 *
 * The one deliberate exception is the citizen door. `homeRoute` answers
 * "what is this account authorised to administer", which is the right
 * question on the STAFF door — that's what /staff is for. It is the wrong
 * question on the CITIZEN door: someone who holds a staff or admin role too
 * (most obviously the break-glass SUPER_ADMIN_EMAIL/PHONE account) still
 * gets bounced into /portal/admin the moment they sign in at /login, even
 * though they came in through the self-service entrance and never asked for
 * the admin console. Worse, it fires on mere page load — an already
 * signed-in admin who simply visits /login (a bookmark, a stray click) is
 * redirected away before the form even renders, which reads as "clicking
 * citizen login sends me to admin."
 *
 * So: the citizen door always lands on the citizen portal, full stop. This
 * is routing, not authorisation — every /portal/* screen still re-checks
 * capability against the session server-side, so nothing here weakens the
 * RBAC model in staff.ts. It only decides where a browser tab points.
 */
export function SignInPage({ audience }: { audience: Audience }) {
  const { status, identity, identityLoading, onSignedIn } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (status !== 'authenticated') return;
    if (identityLoading || !identity) return;
    const destination = audience === 'citizen' ? '/portal' : identity.homeRoute;
    navigate(destination, { replace: true });
  }, [status, identity, identityLoading, navigate, audience]);

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
