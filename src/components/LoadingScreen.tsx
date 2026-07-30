import { useEffect, useMemo, useRef, useState } from 'react';
import { ShieldCheck, Droplet, Zap, Trash2, MapPin, Activity } from 'lucide-react';

/**
 * Immersive 3D boot splash.
 *
 * Composition (back → front): ambient aurora → particle field →
 * parallax glass shards → orbit rings → lit 3D cube → copy.
 *
 * Performance contract:
 * - Only transform/opacity/filter animate; nothing triggers layout.
 * - Particle positions come from a seeded PRNG, so they're deterministic
 *   across renders instead of reshuffling on every state change.
 * - Pointer parallax is rAF-throttled and writes CSS custom properties
 *   rather than re-rendering React.
 * - The whole thing is inert under prefers-reduced-motion (see index.css).
 */

const FACES = [
  { cls: 'front', Icon: ShieldCheck },
  { cls: 'back', Icon: Activity },
  { cls: 'right', Icon: Droplet },
  { cls: 'left', Icon: Zap },
  { cls: 'top', Icon: MapPin },
  { cls: 'bottom', Icon: Trash2 },
] as const;

const MESSAGES = [
  'Restoring your session…',
  'Verifying secure channel…',
  'Loading your dashboard…',
  'Almost there…',
];

/** Deterministic PRNG so particle layout is stable between renders. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const PARTICLE_COUNT = 26;
const SHARDS = [
  { top: '18%', left: '12%', w: 84, h: 84, depth: 2.2, rot: '-12deg' },
  { top: '62%', left: '16%', w: 52, h: 52, depth: 3.4, rot: '8deg' },
  { top: '24%', left: '78%', w: 64, h: 64, depth: 2.8, rot: '16deg' },
  { top: '68%', left: '82%', w: 96, h: 96, depth: 1.6, rot: '-6deg' },
];

export function LoadingScreen({ label, exiting = false }: { label?: string; exiting?: boolean }) {
  const [messageIndex, setMessageIndex] = useState(0);
  const sceneRef = useRef<HTMLDivElement>(null);

  const particles = useMemo(() => {
    const rand = seeded(20260731);
    return Array.from({ length: PARTICLE_COUNT }, () => ({
      left: `${(rand() * 100).toFixed(2)}%`,
      top: `${(rand() * 100).toFixed(2)}%`,
      size: 2 + Math.round(rand() * 4),
      dur: `${(10 + rand() * 10).toFixed(1)}s`,
      delay: `${(rand() * -12).toFixed(1)}s`,
      dx: `${(rand() * 40 - 20).toFixed(0)}px`,
      opacity: (0.25 + rand() * 0.45).toFixed(2),
      warm: rand() > 0.65,
    }));
  }, []);

  useEffect(() => {
    if (label) return;
    const t = setInterval(
      () => setMessageIndex(i => (i + 1) % MESSAGES.length),
      1900,
    );
    return () => clearInterval(t);
  }, [label]);

  // Pointer parallax — writes CSS vars directly, never re-renders.
  useEffect(() => {
    const el = sceneRef.current;
    if (!el) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    let frame = 0;
    const onMove = (e: PointerEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const nx = e.clientX / window.innerWidth - 0.5;
        const ny = e.clientY / window.innerHeight - 0.5;
        el.style.setProperty('--px', (nx * 26).toFixed(2));
        el.style.setProperty('--py', (ny * 26).toFixed(2));
      });
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      ref={sceneRef}
      className={`min-h-screen w-full grid place-items-center relative overflow-hidden ${exiting ? 'splash-exit' : ''}`}
      style={{ background: 'var(--color-bg-main)', zIndex: 'var(--z-splash)' as any }}
      role="status"
      aria-live="polite"
      aria-label={label ?? 'Loading CivicAI'}
    >
      {/* Ambient gradient wash */}
      <div aria-hidden="true" className="aurora-bg opacity-60">
        <div className="aurora-blob absolute -top-[22%] -left-[16%] w-[48%] h-[48%] bg-cta" />
        <div className="aurora-blob absolute -bottom-[22%] -right-[16%] w-[48%] h-[48%] bg-saffron"
             style={{ animationDelay: '5s' }} />
        <div className="aurora-blob absolute top-[35%] left-[60%] w-[30%] h-[30%]"
             style={{ background: 'var(--color-chart-4)', animationDelay: '9s' }} />
      </div>

      {/* Particle field */}
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
        {particles.map((p, i) => (
          <span
            key={i}
            className="particle"
            style={{
              left: p.left,
              top: p.top,
              width: p.size,
              height: p.size,
              background: p.warm ? 'var(--color-saffron)' : 'var(--color-cta)',
              ['--p-dur' as any]: p.dur,
              ['--p-delay' as any]: p.delay,
              ['--p-dx' as any]: p.dx,
              ['--p-opacity' as any]: p.opacity,
            }}
          />
        ))}
      </div>

      {/* Parallax glass shards */}
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
        {SHARDS.map((s, i) => (
          <div
            key={i}
            className="glass-shard"
            style={{
              top: s.top,
              left: s.left,
              width: s.w,
              height: s.h,
              ['--depth' as any]: s.depth,
              ['--rot' as any]: s.rot,
            }}
          />
        ))}
      </div>

      <div className="relative z-10 flex flex-col items-center px-6">
        {/* 3D scene */}
        <div
          className="scene-3d relative grid place-items-center"
          style={{ width: 260, height: 220 }}
          aria-hidden="true"
        >
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

        <h1
          className="fade-up font-display font-bold text-2xl tracking-tight mt-9 text-gradient-premium"
          style={{ animationDelay: '60ms' }}
        >
          CivicAI
        </h1>

        {/* Fixed height stops the layout jumping as messages rotate. */}
        <div className="h-6 mt-1.5 flex items-center justify-center">
          <p
            key={label ?? messageIndex}
            className="fade-up text-sm font-semibold text-content-3 text-center"
          >
            {label ?? MESSAGES[messageIndex]}
          </p>
        </div>

        <div
          className="fade-up progress-track mt-6"
          style={{ animationDelay: '180ms' }}
          aria-hidden="true"
        />

        <p
          className="fade-up flex items-center gap-1.5 text-[12px] font-semibold mt-7 text-content-3"
          style={{ animationDelay: '240ms' }}
        >
          <ShieldCheck size={13} style={{ color: 'var(--color-success)' }} aria-hidden="true" />
          Government-verified · Encrypted session
        </p>
      </div>
    </div>
  );
}
