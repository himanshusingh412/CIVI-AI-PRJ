import { AdminPortal } from '../components/admin/AdminPortal';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { LoginScreen } from '../components/LoginScreen';
import { LoadingScreen } from '../components/LoadingScreen';
import { PageBackground } from '../components/backgrounds/PageBackground';
import { RequireAdmin } from './RequireAdmin';
import { Moon, Sun, LogOut } from 'lucide-react';

/**
 * The admin application, mounted at /portal/admin.
 *
 * Structurally separate from the citizen app: its own chrome, its own
 * navigation, no shared sidebar. The only thing the two portals share is
 * the backend — which is the point.
 */
export function AdminPortalPage() {
  const { status, user, onSignedIn, signOut, signingOut } = useAuth();
  const { isDark, toggleTheme } = useTheme();

  if (status === 'loading') return <LoadingScreen label="Restoring your session…" />;

  // Staff still authenticate through the same identity provider; the
  // difference is what the session is then authorised to do.
  // `audience="staff"` suppresses the citizen/staff chooser: arriving at this
  // URL already answered that question.
  if (status !== 'authenticated') return <LoginScreen onSignedIn={onSignedIn} audience="staff" />;

  return (
    <RequireAdmin>
      <div
        className="relative isolate min-h-screen flex flex-col"
        style={{ background: 'var(--color-bg-main)', color: 'var(--color-content)' }}
      >
        {/* Staff live in this screen for a whole shift, so the admin variant
            is deliberately the flattest and dimmest of the four. */}
        <PageBackground variant="admin" />
        <header
          className="h-16 glass border-b px-4 sm:px-8 flex items-center justify-between shrink-0"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div className="min-w-0">
            <h1 className="font-display font-bold text-lg tracking-tight text-gradient-premium">
              CivicAI
            </h1>
            <p className="text-[11px] font-bold uppercase tracking-widest text-content-3 truncate">
              Grievance Administration
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={toggleTheme}
              aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
              className="w-10 h-10 rounded-xl bordered surface-2 grid place-items-center
                         text-content-3 hover:text-cta transition-colors"
            >
              {isDark ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
            </button>
            <button
              onClick={() => void signOut()}
              disabled={signingOut}
              aria-label="Sign out"
              aria-busy={signingOut || undefined}
              className="w-10 h-10 rounded-xl grid place-items-center text-content-3
                         hover:text-danger transition-colors disabled:opacity-50"
            >
              <LogOut size={17} aria-hidden="true" />
            </button>
          </div>
        </header>

        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 overflow-y-auto p-4 sm:p-6 focus:outline-none"
        >
          <ErrorBoundary scope="admin">
            <AdminPortal />
          </ErrorBoundary>
        </main>
      </div>
    </RequireAdmin>
  );
}
