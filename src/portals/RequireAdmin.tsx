import { useEffect, useState } from 'react';
import { ShieldAlert, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { LoadingScreen } from '../components/LoadingScreen';
import { fetchMe, isAuthError, type MeResponse } from '../services/adminService';

/**
 * Gate for /portal/admin.
 *
 * This is a RENDERING gate, not a security boundary. It exists so an
 * unauthorised visitor sees a clean refusal instead of a broken dashboard —
 * the actual enforcement is `requirePermission` on every /api/admin route,
 * which re-checks capability and jurisdiction server-side on every call.
 *
 * Deliberately gives nothing away: the same message for "not signed in",
 * "signed in but not staff", and "wrong role". Confirming that an admin
 * portal exists at this path and that you *almost* qualify is itself
 * information an attacker can use.
 */
export function RequireAdmin({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<'checking' | 'allowed' | 'denied'>('checking');
  const [me, setMe] = useState<MeResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetchMe();
      if (cancelled) return;
      if (isAuthError(res)) {
        setState('denied');
      } else {
        setMe(res);
        setState('allowed');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (state === 'checking') return <LoadingScreen label="Verifying access…" />;

  if (state === 'denied') {
    return (
      <div
        className="min-h-screen grid place-items-center p-6"
        style={{ background: 'var(--color-bg-main)' }}
      >
        <div className="surface bordered rounded-2xl elev-3 p-10 max-w-md text-center">
          <div
            aria-hidden="true"
            className="w-14 h-14 rounded-2xl grid place-items-center mx-auto mb-5"
            style={{ background: 'var(--color-danger-pale)', color: 'var(--color-danger)' }}
          >
            <ShieldAlert size={26} />
          </div>
          <h1 className="font-display font-bold text-xl text-content">Not available</h1>
          <p className="text-sm text-content-3 mt-2 leading-relaxed">
            This area is restricted. If you believe you should have access,
            contact your department administrator.
          </p>
          <Link
            to="/"
            className="press inline-flex items-center gap-2 mt-6 h-11 px-5 rounded-xl
                       text-sm font-semibold text-white bg-cta hover:bg-cta-hover transition-colors"
          >
            <ArrowLeft size={15} aria-hidden="true" /> Back to CivicAI
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Staff context bar — makes it unmistakable which portal you're in.
          Mixing the two up is how someone posts an internal note publicly. */}
      <div
        className="w-full px-4 sm:px-8 py-2 flex items-center justify-between gap-4 text-[12px] font-bold"
        style={{ background: 'var(--color-cta)', color: '#fff' }}
      >
        <span className="uppercase tracking-widest">Staff portal</span>
        <span className="truncate opacity-90">
          {me?.principal.displayName} · {me?.principal.role}
        </span>
        <Link to="/" className="underline underline-offset-2 shrink-0">
          Citizen view
        </Link>
      </div>
      {children}
    </>
  );
}
