import React, { forwardRef, useCallback, useRef, useState } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

export type ButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  loadingText?: string;
  fullWidth?: boolean;
  icon?: React.ReactNode;
  /** May return a promise — the button auto-manages its own loading state. */
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void | Promise<unknown>;
};

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-cta text-white hover:bg-cta-hover shadow-sm hover:shadow-md ' +
    'disabled:bg-[var(--color-border-strong)] disabled:text-[var(--color-content-3)] disabled:shadow-none',
  secondary:
    'bg-[var(--color-surface)] text-[var(--color-content)] border border-[var(--color-border-strong)] ' +
    'hover:border-cta hover:text-cta disabled:opacity-50',
  ghost:
    'bg-transparent text-[var(--color-content-2)] hover:bg-[var(--color-surface-2)] ' +
    'hover:text-[var(--color-content)] disabled:opacity-50',
  danger:
    'bg-danger text-white hover:brightness-110 shadow-sm disabled:opacity-50',
};

const SIZES: Record<Size, string> = {
  sm: 'h-9 px-3 text-xs gap-1.5 rounded-lg',
  md: 'h-11 px-5 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-6 text-[15px] gap-2 rounded-xl',
};

/**
 * Accessible button with built-in async handling.
 *
 * - Concurrent clicks are impossible: the handler is latched while in flight.
 * - `aria-busy` + `aria-disabled` announce state to screen readers.
 * - Keyboard focus is always visible (`:focus-visible` ring from index.css).
 * - A rejected handler never leaves the button stuck spinning.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    loadingText,
    fullWidth = false,
    icon,
    onClick,
    disabled,
    children,
    className = '',
    type = 'button',
    ...rest
  },
  ref,
) {
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      if (inFlight.current || loading || disabled) {
        e.preventDefault();
        return;
      }
      const result = onClick?.(e);
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        inFlight.current = true;
        setBusy(true);
        (result as Promise<unknown>).finally(() => {
          inFlight.current = false;
          setBusy(false);
        });
      }
    },
    [onClick, loading, disabled],
  );

  const isLoading = loading || busy;
  const isDisabled = disabled || isLoading;

  return (
    <button
      ref={ref}
      type={type}
      onClick={handleClick}
      disabled={isDisabled}
      aria-busy={isLoading || undefined}
      aria-disabled={isDisabled || undefined}
      className={[
        'inline-flex items-center justify-center font-semibold relative overflow-hidden',
        // Spring-ish press: scales down fast, releases with overshoot.
        'transition-[transform,background-color,border-color,box-shadow,opacity]',
        'duration-[160ms] ease-[cubic-bezier(0.34,1.56,0.64,1)]',
        'active:scale-[0.97]',
        'disabled:cursor-not-allowed disabled:active:scale-100',
        VARIANTS[variant],
        SIZES[size],
        fullWidth ? 'w-full' : '',
        className,
      ].join(' ')}
      {...rest}
    >
      {isLoading ? (
        <>
          <span
            aria-hidden="true"
            className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin shrink-0"
          />
          {loadingText ?? children}
        </>
      ) : (
        <>
          {icon}
          {children}
        </>
      )}
    </button>
  );
});
