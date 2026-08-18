import { Link } from 'react-router-dom';
import { Moon, Sun, LogOut } from 'lucide-react';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { PageBackground } from '../components/backgrounds/PageBackground';
import { DemoModeBanner } from '../components/IntegrationBadge';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

/**
 * Shared chrome for every staff surface.
 *
 * Extracted from AdminPortalPage once there were three of these. The header,
 * theme toggle and sign-out were identical in all of them, and three copies
 * of a sign-out button is three chances for one of them to forget to clear
 * the session.
 *
 * The background variant is fixed to 'admin' — the flattest and dimmest of
 * the four. Staff live in these screens for a whole shift; the visual
 * budget belongs to the data, not the chrome.
 */
export function StaffShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  const { signOut, signingOut } = useAuth();
  const { isDark, toggleTheme } = useTheme();

  return (
    <div
      className="relative isolate min-h-screen flex flex-col"
      style={{ background: 'var(--color-bg-main)', color: 'var(--color-content)' }}
    >
      <PageBackground variant="admin" />
      <DemoModeBanner />

      <header
        className="h-16 glass border-b px-4 sm:px-8 flex items-center justify-between shrink-0"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <Link to="/" className="min-w-0" aria-label="CivicAI home">
          <h1 className="font-display font-bold text-lg tracking-tight text-gradient-premium">
            {title}
          </h1>
          <p className="text-[11px] font-bold uppercase tracking-widest text-content-3 truncate">
            {subtitle}
          </p>
        </Link>

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
        <ErrorBoundary scope="staff">{children}</ErrorBoundary>
      </main>
    </div>
  );
}
