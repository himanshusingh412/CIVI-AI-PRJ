import { useEffect, useState } from 'react';
import { LoadingScreen } from './LoadingScreen';

/**
 * Bridges the splash and the app so the handoff is continuous.
 *
 * Two problems this solves:
 * 1. A cut. Unmounting the splash the instant auth resolves swaps two full
 *    screens in one frame. Here the splash stays mounted on top and plays
 *    its exit while the app is already painted underneath.
 * 2. A flash. If auth resolves in 80ms the splash would appear and vanish,
 *    which reads as a glitch. MIN_VISIBLE_MS holds it just long enough to
 *    register as intentional.
 */
const MIN_VISIBLE_MS = 900;
const EXIT_MS = 720; // must match --dur-splash

export function SplashGate({ loading, children }: { loading: boolean; children: React.ReactNode }) {
  const [phase, setPhase] = useState<'splash' | 'exiting' | 'done'>(loading ? 'splash' : 'done');
  const [mountedAt] = useState(() => Date.now());

  useEffect(() => {
    if (loading || phase === 'done' || phase === 'exiting') return;

    const elapsed = Date.now() - mountedAt;
    const wait = Math.max(0, MIN_VISIBLE_MS - elapsed);

    const startExit = setTimeout(() => {
      setPhase('exiting');
      const finish = setTimeout(() => setPhase('done'), EXIT_MS);
      // Stored on the timeout itself so the outer cleanup can reach it.
      (startExit as any)._finish = finish;
    }, wait);

    return () => {
      clearTimeout(startExit);
      if ((startExit as any)._finish) clearTimeout((startExit as any)._finish);
    };
  }, [loading, phase, mountedAt]);

  return (
    <>
      {/* App renders underneath as soon as it's ready, so by the time the
          splash finishes fading the content is already composited. */}
      {phase !== 'splash' && children}

      {phase !== 'done' && (
        <div className="fixed inset-0" style={{ zIndex: 'var(--z-splash)' as any }}>
          <LoadingScreen exiting={phase === 'exiting'} />
        </div>
      )}
    </>
  );
}
