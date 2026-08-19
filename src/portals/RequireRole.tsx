import { Navigate, Link } from 'react-router-dom';
import { ShieldAlert, ArrowLeft } from 'lucide-react';
import { LoadingScreen } from '../components/LoadingScreen';
import { useAuth } from '../context/AuthContext';
import { ROLE_LABELS, type IdentityRole } from '../services/identityService';

/**
 * Route gate for a set of roles.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * This is a RENDERING gate, not a security boundary.
 * ─────────────────────────────────────────────────────────────────────────
 * It exists so an unauthorised visitor sees a clean refusal instead of a
 * dashboard that renders empty and throws in the console. The actual
 * enforcement is `requirePermission` on every /api/admin route, which
 * re-checks capability AND jurisdiction server-side on every single call.
 *
 * If you ever find yourself relying on this component to keep data safe,
 * something upstream is already wrong: the data would have had to cross the
 * network before this could hide it.
 *
 * The refusal is deliberately uninformative. "Not signed in", "signed in but
 * not staff" and "staff, wrong role" all produce the same screen — confirming
 * that a portal exists at this path and that you *almost* qualify is itself
 * useful to someone probing it.
 */
export function RequireRole({
  allow,
  children,
  /** Where an anonymous visitor is sent to authenticate. */
  signInPath = '/staff',
}: {
  allow: readonly IdentityRole[];
  children: React.ReactNode;
  signInPath?: string;
}) {
  const { status, identity, identityLoading } = useAuth();

  if (status === 'loading') return <LoadingScreen label="Restoring your session…" />;
  if (status === 'anonymous') return <Navigate to={signInPath} replace />;
  if (identityLoading || !identity) return <LoadingScreen label="Verifying access…" />;

  if (!allow.includes(identity.role)) return <AccessRefused />;

  return (
    <>
      {/* Staff context bar. Mixing up the two portals is how someone posts an
          internal note where the citizen can read it, so the bar is loud,
          always present, and names the exact role and jurisdiction in force. */}
      {identity.isStaff && (
        <div
          className="w-full px-4 sm:px-8 py-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[12px] font-bold"
          style={{ background: 'var(--color-cta)', color: '#fff' }}
        >
          <span className="uppercase tracking-widest">Staff portal</span>
          <span className="truncate opacity-90 font-semibold">
            {identity.displayName} · {ROLE_LABELS[identity.role]}
            {Object.entries(identity.scope).filter(([, v]) => v).length > 0 && (
              <>
                {' · '}
                {Object.entries(identity.scope)
                  .filter(([, v]) => v)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(' · ')}
              </>
            )}
          </span>
          <Link to="/portal" className="underline underline-offset-2 shrink-0 py-1.5 -my-1.5">
            Citizen view
          </Link>
        </div>
      )}
      {children}
    </>
  );
}

function AccessRefused() {
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
          to="/portal"
          className="press inline-flex items-center gap-2 mt-6 h-11 px-5 rounded-xl
                     text-sm font-semibold text-white bg-cta hover:bg-cta-hover transition-colors"
        >
          <ArrowLeft size={15} aria-hidden="true" /> Back to CivicAI
        </Link>
      </div>
    </div>
  );
}

/** Roles that may open each staff surface. Single source of truth for routing. */
export const ROLE_GROUPS = {
  admin: ['super_admin', 'state_admin', 'auditor'] as const,
  department: ['district_admin', 'department_officer', 'super_admin', 'state_admin'] as const,
  officer: ['field_officer', 'department_officer', 'district_admin', 'super_admin', 'state_admin'] as const,
};

/**
 * Plain authentication gate for the citizen portal.
 *
 * Separate from RequireRole because "is signed in" and "holds a role" are
 * different questions, and a citizen holds no role at all. Folding them into
 * one component would mean expressing "any authenticated person" as a list
 * of every role — exactly the kind of allow-list that silently stops
 * matching the day a role is added.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  if (status === 'loading') return <LoadingScreen label="Restoring your session…" />;
  if (status === 'anonymous') return <Navigate to="/login" replace />;
  return <>{children}</>;
}
