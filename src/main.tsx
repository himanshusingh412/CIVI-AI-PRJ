import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { ThemeProvider } from './context/ThemeContext.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { SplashGate } from './components/SplashGate.tsx';
import './index.css';

/**
 * Sits inside AuthProvider so it can read the bootstrap status, and hands
 * it to SplashGate — which owns the splash→app crossfade.
 */
function Root() {
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
        <AuthProvider>
          <Root />
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
);
