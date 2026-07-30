import { useEffect, useState } from 'react';
import { ShieldCheck, Droplet, Zap, Trash2, MapPin, Activity } from 'lucide-react';

/**
 * 3D boot splash shown while the session is restored.
 *
 * Design notes:
 * - The cube is real CSS 3D (perspective + preserve-3d), not a faked
 *   isometric image, so it stays crisp at any DPI and costs no JS.
 * - Only transform/opacity animate, keeping the whole scene on the
 *   compositor — no layout or paint work per frame.
 * - Fully reduced-motion safe: the scene freezes at a readable angle
 *   instead of spinning (see index.css).
 * - Announced politely to screen readers via a single role="status".
 */

const FACES = [
  { cls: 'front', Icon: ShieldCheck },
  { cls: 'back', Icon: Activity },
  { cls: 'right', Icon: Droplet },
  { cls: 'left', Icon: Zap },
  { cls: 'top', Icon: MapPin },
  { cls: 'bottom', Icon: Trash2 },
] as const;

/** Rotating reassurance copy — only appears if boot takes a noticeable beat. */
const MESSAGES = [
  'Restoring your session…',
  'Securing the connection…',
  'Almost there…',
];

export function LoadingScreen({ label }: { label?: string }) {
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    if (label) return;
    const t = setInterval(
      () => setMessageIndex(i => Math.min(i + 1, MESSAGES.length - 1)),
      2200,
    );
    return () => clearInterval(t);
  }, [label]);

  return (
    <div
      className="min-h-screen w-full grid place-items-center relative overflow-hidden"
      style={{ background: 'var(--color-bg-main)' }}
      role="status"
      aria-live="polite"
      aria-label={label ?? 'Loading CivicAI'}
    >
      {/* Ambient depth — decorative only */}
      <div aria-hidden="true" className="aurora-bg opacity-50">
        <div className="aurora-blob absolute -top-[20%] -left-[15%] w-[46%] h-[46%] bg-cta" />
        <div
          className="aurora-blob absolute -bottom-[20%] -right-[15%] w-[46%] h-[46%] bg-saffron"
          style={{ animationDelay: '5s' }}
        />
      </div>

      <div className="relative z-10 flex flex-col items-center">
        {/* 3D scene */}
        <div className="scene-3d relative grid place-items-center" style={{ width: 260, height: 220 }} aria-hidden="true">
          <div className="orbit-ring" />
          <div className="orbit-ring slow" />
          <div className="cube-3d">
            {FACES.map(({ cls, Icon }) => (
              <div key={cls} className={`cube-face ${cls}`}>
                <Icon size={30} strokeWidth={2} />
              </div>
            ))}
          </div>
        </div>
        <div className="cube-shadow" aria-hidden="true" />

        {/* Wordmark + status. Staggered 60ms apart for a settled entrance. */}
        <h1
          className="fade-up font-display font-bold text-2xl tracking-tight mt-9 text-gradient-premium"
          style={{ animationDelay: '60ms' }}
        >
          CivicAI
        </h1>
        <p
          className="fade-up text-sm font-semibold mt-1.5 text-content-3"
          style={{ animationDelay: '120ms' }}
        >
          {label ?? MESSAGES[messageIndex]}
        </p>

        <div
          className="fade-up progress-track mt-6"
          style={{ animationDelay: '180ms' }}
          aria-hidden="true"
        />

        <p
          className="fade-up flex items-center gap-1.5 text-[11px] font-semibold mt-7 text-content-3"
          style={{ animationDelay: '240ms' }}
        >
          <ShieldCheck size={13} style={{ color: 'var(--color-success)' }} aria-hidden="true" />
          Government-verified · Encrypted session
        </p>
      </div>
    </div>
  );
}
