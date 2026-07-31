import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import App from './App.tsx';
/**
 * Lazy so the admin bundle never ships to citizens. Without this the two
 * portals are only separate by route — the code still lands in every
 * visitor's initial download.
 */
const AdminPortalPage = lazy(() =>
  import('./portals/AdminPortalPage.tsx').then(m => ({ default: m.AdminPortalPage })));
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { ThemeProvider } from './context/ThemeContext.tsx';
import { I18nProvider } from './i18n/I18nContext.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { SplashGate } from './components/SplashGate.tsx';
import { LoadingScreen } from './components/LoadingScreen.tsx';
import './index.css';

/**
 * Two portals, one backend.
 *
 *   /              citizen portal
 *   /portal/admin  staff portal — never linked from public navigation
 *
 * They are separate route trees rather than a view flag inside one app, so
 * the admin bundle and its chrome cannot leak into the citizen surface, and
 * the URL itself is the boundary.
 */
function CitizenRoot() {
  const { status } = useAuth();
  return (
    <SplashGate loading={status === 'loading'}>
      <App />
    </SplashGate>
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found in index.html');

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary scope="root">
      <ThemeProvider>
        <I18nProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<CitizenRoot />} />
              <Route
                path="/portal/admin"
                element={
                  <Suspense fallback={<LoadingScreen label="Loading staff portal…" />}>
                    <AdminPortalPage />
                  </Suspense>
                }
              />
              {/* Unknown paths fall back to the citizen portal, never to admin. */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
        </I18nProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
);
