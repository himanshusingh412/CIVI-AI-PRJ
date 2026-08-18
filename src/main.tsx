import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import App from './App.tsx';
import { LandingPage } from './pages/LandingPage.tsx';
import { SignInPage } from './pages/SignInPage.tsx';
import { RequireAuth } from './portals/RequireRole.tsx';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { ThemeProvider } from './context/ThemeContext.tsx';
import { ConfigProvider } from './context/ConfigContext.tsx';
import { I18nProvider } from './i18n/I18nContext.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { SplashGate } from './components/SplashGate.tsx';
import { LoadingScreen } from './components/LoadingScreen.tsx';
import './index.css';

/**
 * Route map.
 *
 *   /                   public landing page — no account required
 *   /login              citizen sign-in
 *   /staff              staff sign-in (same identity provider, different door)
 *   /portal             citizen portal
 *   /portal/officer     field officer workspace
 *   /portal/department  district / department administration
 *   /portal/admin       system administration
 *
 * Two properties this layout is designed to hold:
 *
 *  1. The staff bundles are lazy, so an ordinary citizen never downloads the
 *     administration code. Without the lazy boundary the portals would be
 *     "separate" by URL only, while the JavaScript still landed in every
 *     visitor's initial payload.
 *
 *  2. Routing is NOT authorisation. Each gate below decides what to RENDER;
 *     every screen behind it then fetches through endpoints that re-check
 *     capability and jurisdiction server-side. Someone who edits the URL
 *     gets a screen that refuses to fill itself, not a leak.
 *
 * Unknown paths fall back to the public landing page, never to a portal.
 */
const AdminPortalPage = lazy(() =>
  import('./portals/AdminPortalPage.tsx').then(m => ({ default: m.AdminPortalPage })));
const DepartmentPortalPage = lazy(() =>
  import('./portals/DepartmentPortalPage.tsx').then(m => ({ default: m.DepartmentPortalPage })));
const OfficerPortalPage = lazy(() =>
  import('./portals/OfficerPortalPage.tsx').then(m => ({ default: m.OfficerPortalPage })));

function CitizenPortal() {
  const { status } = useAuth();
  return (
    <RequireAuth>
      <SplashGate loading={status === 'loading'}>
        <App />
      </SplashGate>
    </RequireAuth>
  );
}

const staffRoute = (label: string, element: React.ReactNode) => (
  <Suspense fallback={<LoadingScreen label={label} />}>{element}</Suspense>
);

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found in index.html');

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary scope="root">
      <ThemeProvider>
        <I18nProvider>
          <ConfigProvider>
            <AuthProvider>
              <BrowserRouter>
                <Routes>
                  <Route path="/" element={<LandingPage />} />
                  <Route path="/login" element={<SignInPage audience="citizen" />} />
                  <Route path="/staff" element={<SignInPage audience="staff" />} />

                  <Route path="/portal" element={<CitizenPortal />} />
                  <Route
                    path="/portal/officer"
                    element={staffRoute('Loading officer workspace…', <OfficerPortalPage />)}
                  />
                  <Route
                    path="/portal/department"
                    element={staffRoute('Loading department portal…', <DepartmentPortalPage />)}
                  />
                  <Route
                    path="/portal/admin"
                    element={staffRoute('Loading staff portal…', <AdminPortalPage />)}
                  />

                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </BrowserRouter>
            </AuthProvider>
          </ConfigProvider>
        </I18nProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
);
