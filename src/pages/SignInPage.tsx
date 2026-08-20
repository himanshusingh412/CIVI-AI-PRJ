import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { LoginScreen, type Audience } from '../components/LoginScreen';
import { LoadingScreen } from '../components/LoadingScreen';
import { useAuth } from '../context/AuthContext';

/**
 * Sign-in, for one audience at a time.
 *
 * The redirect after sign-in is the interesting part: it goes to
 * `identity.homeRoute`, which the SERVER computed from the session's role -
 * always, regardless of which door (/login or /staff) was used to get here.
 * The browser does not look at the role and decide; it asks and obeys.
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

  return <LoginScreen onSignedIn={onSignedIn} audience={audience} />;
}
