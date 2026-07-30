import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
  /** Optional label so nested boundaries identify themselves in logs. */
  scope?: string;
  fallback?: (reset: () => void) => ReactNode;
};

type State = { error: Error | null };

/**
 * Catches render/lifecycle crashes so one broken subtree cannot blank the
 * whole app. Without this, any thrown error in React 18 unmounts the entire
 * tree and the user sees a white screen with no way to recover.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Replace with your telemetry sink (Sentry etc.) in production.
    console.error(`[ErrorBoundary${this.props.scope ? `:${this.props.scope}` : ''}]`, error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback(this.reset);

    return (
      <div
        role="alert"
        className="min-h-[60vh] flex items-center justify-center p-6"
        style={{ background: 'var(--color-bg-main)', color: 'var(--color-content)' }}
      >
        <div
          className="max-w-md w-full rounded-2xl p-8 text-center"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
        >
          <div
            aria-hidden="true"
            className="w-14 h-14 rounded-2xl grid place-items-center mx-auto mb-5 text-2xl"
            style={{ background: 'var(--color-danger-pale)', color: 'var(--color-danger)' }}
          >
            !
          </div>
          <h1 className="font-display font-bold text-xl mb-2">Something went wrong</h1>
          <p className="text-sm mb-6" style={{ color: 'var(--color-content-3)' }}>
            This section failed to load. You can retry, or reload the page if the problem persists.
          </p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={this.reset}
              className="h-11 px-5 rounded-xl font-semibold text-sm text-white bg-cta hover:bg-cta-hover transition-colors"
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="h-11 px-5 rounded-xl font-semibold text-sm transition-colors"
              style={{
                background: 'var(--color-surface-2)',
                color: 'var(--color-content-2)',
                border: '1px solid var(--color-border-strong)',
              }}
            >
              Reload page
            </button>
          </div>
        </div>
      </div>
    );
  }
}
