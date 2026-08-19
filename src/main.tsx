import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
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
// The citizen dashboard (recharts + react-leaflet under the hood) is the
// heaviest single screen in the app. It must not be part of the eagerly
// loaded entry bundle - a first-time citizen landing on the public home
// page has no use for a charting or mapping library, and this product
// exists partly for people on constrained mobile data.
const App = lazy(() => import('./App.tsx'));
const AdminPortalPage = lazy(() =>
  import('./portals/AdminPortalPage.tsx').then(m => ({ default: m.AdminPortalPage })));
const DepartmentPortalPage = lazy(() =>
  import('./portals/DepartmentPortalPage.tsx').then(m => ({ default: m.DepartmentPortalPage })));
const OfficerPortalPage = lazy(() =>
  import('./portals/OfficerPortalPage.tsx').then(m => ({ default: m.OfficerPortalPage })));
/**
 * The assistant is lazy for a different reason than the staff portals: it is
 * a full second application surface (its own layout, voice, conversation
 * store), and most visits to /portal never open it.
 */
const AssistantPage = lazy(() =>
  import('./pages/AssistantPage.tsx').then(m => ({ default: m.AssistantPage })));
const DocumentVerificationPage = lazy(() =>
  import('./pages/DocumentVerificationPage.tsx').then(m => ({ default: m.DocumentVerificationPage })));
const ReportWizardPage = lazy(() =>
  import('./pages/ReportWizardPage.tsx').then(m => ({ default: m.ReportWizardPage })));
const NotificationSettingsPage = lazy(() =>
  import('./pages/NotificationSettingsPage.tsx').then(m => ({ default: m.NotificationSettingsPage })));

function CitizenPortal() {
  const { status } = useAuth();
  // SplashGate has to be the OUTER boundary here, not RequireAuth. RequireAuth
  // has its own early-return LoadingScreen for status === "loading" (used by
  // every other authenticated route, which has no splash of its own) - if it
  // sat outside SplashGate, it would already have resolved past "loading" by
  // the render where SplashGate first mounts, so SplashGate would initialise
  // straight into its "done" phase and its boot sequence would never show.
  // Mounting SplashGate first means it sees loading=true on its very first
  // render, the same render RequireAuth is still refusing to reveal anything -
  // exactly the window the splash exists to cover.
  return (
    <SplashGate loading={status === 'loading'}>
      <RequireAuth>
        {/*
         * Not <LoadingScreen> here. SplashGate above is already a full-screen
         * fixed overlay that stays mounted and visible for a minimum of
         * 900ms plus a 720ms fade-out (see SplashGate.tsx) - comfortably
         * longer than this chunk takes to download on any real connection.
         * A second full LoadingScreen as this Suspense fallback would mount
         * underneath that overlay for the entire exit window, and because
         * this one renders in normal document flow at the same top-of-
         * viewport position the fixed splash occupies, the two visibly
         * double-expose - two "CivicAI" wordmarks and two status lines
         * overlapping mid-transition. This plain background-matched div just
         * avoids a flash of white if the chunk is ever unusually slow.
         */}
        <Suspense fallback={<div style={{ minHeight: '100vh', background: 'var(--color-bg-main)' }} />}>
          <App />
        </Suspense>
      </RequireAuth>
    </SplashGate>
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
                    path="/portal/assistant"
                    element={
                      <RequireAuth>
                        <Suspense fallback={<LoadingScreen label="Opening the assistant…" />}>
                          <AssistantPage />
                        </Suspense>
                      </RequireAuth>
                    }
                  />
                  <Route
                    path="/portal/settings"
                    element={
                      <RequireAuth>
                        <Suspense fallback={<LoadingScreen label="Opening your settings…" />}>
                          <NotificationSettingsPage />
                        </Suspense>
                      </RequireAuth>
                    }
                  />
                  <Route
                    path="/portal/report"
                    element={
                      <RequireAuth>
                        <Suspense fallback={<LoadingScreen label="Opening the complaint form…" />}>
                          <ReportWizardPage />
                        </Suspense>
                      </RequireAuth>
                    }
                  />
                  <Route
                    path="/portal/documents"
                    element={
                      <RequireAuth>
                        <Suspense fallback={<LoadingScreen label="Opening document verification…" />}>
                          <DocumentVerificationPage />
                        </Suspense>
                      </RequireAuth>
                    }
                  />
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
