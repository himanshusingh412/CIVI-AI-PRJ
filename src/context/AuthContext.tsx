import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchSession,
  refreshSession,
  logout as apiLogout,
  isAuthError,
  type AuthUser,
} from '../services/authService';
import { fetchIdentity, type Identity } from '../services/identityService';

type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  /**
   * Role, jurisdiction and home route — resolved by the server from the
   * session's verified subject. Null while it is still being fetched, and
   * for anonymous visitors.
   *
   * Deliberately separate from `user`: `user` is "the session exists",
   * `identity` is "and this is what it is allowed to be". Merging them
   * would make it easy to write `if (user)` and accidentally mean
   * "is authorised".
   */
  identity: Identity | null;
  identityLoading: boolean;
  /** Called by the login screen once the server has issued a session. */
  onSignedIn: (user: AuthUser) => void;
  signOut: () => Promise<void>;
  signingOut: boolean;
  refreshIdentity: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/** Refresh a few minutes before the 1h server TTL so the session never lapses mid-use. */
const REFRESH_INTERVAL_MS = 12 * 60_000;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [identityLoading, setIdentityLoading] = useState(false);

  // Guards against setState after unmount (React 18 StrictMode double-invokes effects).
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // ── Bootstrap: restore an existing session on first paint (persistent login) ──
  useEffect(() => {
    const ac = new AbortController();

    (async () => {
      try {
        const res = await fetchSession(ac.signal);
        if (!mounted.current) return;

        if (isAuthError(res)) {
          setUser(null);
          setStatus('anonymous');
        } else {
          setUser({ identifier: res.session.identifier, channel: res.session.channel });
          setStatus('authenticated');
        }
      } catch {
        // AbortError on unmount — nothing to do.
      }
    })();

    return () => ac.abort();
  }, []);

  // ── Silent refresh while authenticated ──
  useEffect(() => {
    if (status !== 'authenticated') return;

    const ac = new AbortController();

    const tick = async () => {
      // Skip refreshing a backgrounded tab; we refresh on focus instead.
      if (document.visibilityState === 'hidden') return;
      try {
        const res = await refreshSession(ac.signal);
        if (!mounted.current) return;
        if (isAuthError(res)) {
          // Session is genuinely gone — drop to the login screen.
          if (res.error !== 'network') {
            setUser(null);
            setStatus('anonymous');
          }
        } else {
          setUser({ identifier: res.identifier, channel: res.channel });
        }
      } catch {
        /* aborted */
      }
    };

    const interval = setInterval(tick, REFRESH_INTERVAL_MS);
    const onFocus = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onFocus);

    return () => {
      ac.abort();
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [status]);

  const loadIdentity = useCallback(async (signal?: AbortSignal) => {
    setIdentityLoading(true);
    try {
      const res = await fetchIdentity(signal);
      if (!mounted.current) return;
      setIdentity(isAuthError(res) ? null : res);
    } finally {
      if (mounted.current) setIdentityLoading(false);
    }
  }, []);

  // ── Identity follows the session, never the other way round ──
  useEffect(() => {
    if (status !== 'authenticated') {
      setIdentity(null);
      return;
    }
    const ac = new AbortController();
    void loadIdentity(ac.signal);
    return () => ac.abort();
  }, [status, loadIdentity]);

  const onSignedIn = useCallback((next: AuthUser) => {
    setUser(next);
    setStatus('authenticated');
  }, []);

  const signOut = useCallback(async () => {
    setSigningOut(true);
    try {
      await apiLogout();
    } finally {
      if (mounted.current) {
        setSigningOut(false);
        setUser(null);
        setIdentity(null);
        setStatus('anonymous');
      }
    }
  }, []);

  const refreshIdentity = useCallback(() => loadIdentity(), [loadIdentity]);

  const value = useMemo(
    () => ({
      status, user, identity, identityLoading,
      onSignedIn, signOut, signingOut, refreshIdentity,
    }),
    [status, user, identity, identityLoading, onSignedIn, signOut, signingOut, refreshIdentity],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an <AuthProvider>');
  return ctx;
}
