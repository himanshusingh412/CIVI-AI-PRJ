import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { useTheme } from '../../context/ThemeContext';

/**
 * The single decision point for every animated background in the product.
 *
 * Backgrounds are the easiest way to make an app feel expensive and the
 * easiest way to make it unusable. This component exists so that judgement
 * lives in ONE place rather than being re-litigated at four call sites.
 *
 * Two rules it enforces:
 *
 *  1. The shader is decoration, never substance. It is `aria-hidden`, it is
 *     `pointer-events-none`, and every piece of text in the app sits on an
 *     opaque `--color-surface` card above it. Contrast ratios measured
 *     against the token palette therefore still hold — the background
 *     cannot change the contrast of text it never touches.
 *
 *  2. It must earn its place on the device it's running on. This is a
 *     government grievance portal; a large share of its users are on
 *     low-end Android over metered data. A WebGL shader is the wrong
 *     default there, so the animated layer is opt-IN per device and the
 *     static gradient is what most phones will actually get.
 *
 * The static gradient is not a degraded fallback — it renders first and
 * always, and the canvas fades in over it only where it's warranted. So
 * there is no flash of empty background while the chunk loads, and no
 * layout difference between the two paths.
 */

const Aurora = lazy(() => import('./Aurora'));
const Threads = lazy(() => import('./Threads'));

export type BackgroundVariant = 'auth' | 'app' | 'admin' | 'empty';

type Capability = 'pending' | 'animated' | 'static';

interface NetworkInformation {
  saveData?: boolean;
  effectiveType?: string;
}

/**
 * Decide whether this device should run a shader at all.
 *
 * Deliberately conservative. Each rejection below corresponds to a real
 * population, not a hypothetical one:
 *   - reduced motion      → vestibular disorders; a WCAG 2.1 obligation
 *   - Save-Data / 2g / 3g → metered mobile data
 *   - small viewport      → phones, where the GPU is also the battery
 *   - <4 cores / <4 GB    → entry-level Android
 *   - no WebGL2           → older devices and locked-down browsers
 */
function probeCapability(needsWebGL2: boolean): Capability {
  if (typeof window === 'undefined') return 'static';

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 'static';
  if (window.matchMedia('(max-width: 767px)').matches) return 'static';

  const nav = navigator as Navigator & {
    connection?: NetworkInformation;
    deviceMemory?: number;
  };

  if (nav.connection?.saveData) return 'static';
  if (nav.connection?.effectiveType && /(^|-)(2g|3g)$/.test(nav.connection.effectiveType)) return 'static';
  if (typeof nav.deviceMemory === 'number' && nav.deviceMemory < 4) return 'static';
  if (typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency < 4) return 'static';

  // Probe an actual context rather than sniffing. Aurora's shader is
  // `#version 300 es`, so it genuinely requires WebGL2 and will render
  // nothing on a WebGL1-only device; Threads is GLSL 1 and does not.
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext(needsWebGL2 ? 'webgl2' : 'webgl') ??
      (needsWebGL2 ? null : canvas.getContext('experimental-webgl'))) as WebGLRenderingContext | null;
    if (!gl) return 'static';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    return 'static';
  }

  return 'animated';
}

function useCapability(needsWebGL2: boolean): Capability {
  const [capability, setCapability] = useState<Capability>('pending');

  useEffect(() => {
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const widthQuery = window.matchMedia('(max-width: 767px)');

    // Defer the probe past first paint. Creating a WebGL context is not
    // free, and nothing here should compete with rendering the actual page.
    const run = () => setCapability(probeCapability(needsWebGL2));
    // Widen to `any` up front: narrowing `window` with an `in` check makes
    // TS treat the else-branch window as `never`, which is not the case.
    const w = window as any;
    const hasIdle = typeof w.requestIdleCallback === 'function';
    const idle: number = hasIdle ? w.requestIdleCallback(run, { timeout: 1200 }) : window.setTimeout(run, 200);

    // Someone enabling "reduce motion" mid-session, or rotating a tablet
    // across the breakpoint, should take effect immediately.
    const recheck = () => setCapability(probeCapability(needsWebGL2));
    motionQuery.addEventListener('change', recheck);
    widthQuery.addEventListener('change', recheck);

    return () => {
      if (hasIdle && typeof w.cancelIdleCallback === 'function') w.cancelIdleCallback(idle);
      else clearTimeout(idle);
      motionQuery.removeEventListener('change', recheck);
      widthQuery.removeEventListener('change', recheck);
    };
  }, [needsWebGL2]);

  return capability;
}

/* ── Per-surface tuning ───────────────────────────────────────────────
   Each variant states its intent, because "which background goes where"
   is a product decision and should be readable as one.                */

interface VariantSpec {
  /** Aurora is reserved for the front door; everywhere else uses Threads. */
  kind: 'aurora' | 'threads';
  /** Opacity of the whole canvas layer, per theme. */
  opacity: { light: number; dark: number };
  /** Shape of the fade so the effect never crowds the content column. */
  mask: string;
  /** Static gradient shown before/instead of the canvas, per theme. */
  still: { light: string; dark: string };
  aurora?: { light: string[]; dark: string[]; amplitude: number; blend: number; speed: number };
  threads?: { light: [number, number, number]; dark: [number, number, number]; amplitude: number; distance: number };
}

const VARIANTS: Record<BackgroundVariant, VariantSpec> = {
  /**
   * Auth — the front door, and the only screen with no data on it. It can
   * afford the richest treatment in the product, so this is where Aurora
   * goes. Colour stops are the brand palette, not React Bits' violet/lime
   * default, and speed is roughly a third of stock: a slow drift reads as
   * confident, a fast one reads as a screensaver.
   */
  auth: {
    kind: 'aurora',
    /**
     * Dark ran visibly flatter than light. The cause was the colour stops,
     * not the opacity: `#0369A1 / #C2410C / #312E81` are mid-dark hues, and
     * Aurora multiplies colour by intensity before compositing, so on a
     * #0A0F1D page they resolved to near-black and the effect vanished.
     * Raising opacity alone would just have made a dark smear.
     *
     * Fixed by brightening the stops and pulling opacity back — a luminous
     * colour at lower alpha reads as light, which is what an aurora is.
     */
    opacity: { light: 0.5, dark: 0.55 },
    mask: 'radial-gradient(115% 85% at 50% 0%, #000 30%, transparent 78%)',
    still: {
      light:
        'radial-gradient(120% 80% at 50% -10%, #E0F2FE 0%, rgba(255,247,237,0.85) 45%, transparent 75%)',
      dark: 'radial-gradient(120% 80% at 50% -10%, rgba(56,189,248,0.30) 0%, rgba(249,115,22,0.16) 45%, transparent 75%)',
    },
    aurora: {
      light: ['#BAE6FD', '#FED7AA', '#C7D2FE'],
      dark: ['#38BDF8', '#FB923C', '#818CF8'],
      amplitude: 0.7,
      blend: 0.6,
      speed: 0.35,
    },
  },

  /**
   * Citizen app shell — someone is reading a complaint status here, so the
   * background gets the quietest settings that are still perceptibly alive.
   * Threads' woven lines suit a civic product: orderly, not showy.
   */
  app: {
    kind: 'threads',
    opacity: { light: 0.16, dark: 0.3 },
    mask: 'linear-gradient(to bottom, #000 0%, #000 55%, transparent 100%)',
    still: {
      light: 'radial-gradient(100% 60% at 100% 0%, rgba(3,105,161,0.06) 0%, transparent 70%)',
      dark: 'radial-gradient(100% 60% at 100% 0%, rgba(56,189,248,0.10) 0%, transparent 70%)',
    },
    threads: {
      light: [0.06, 0.09, 0.16],
      dark: [0.45, 0.6, 0.78],
      amplitude: 0.85,
      distance: 0.35,
    },
  },

  /**
   * Admin — staff sit in this screen all day triaging complaints. Flatter
   * (higher `distance`, lower `amplitude`) so the lines settle into a calm
   * horizontal weave rather than drifting, and dimmer than the citizen
   * shell. The goal is texture, not motion.
   */
  admin: {
    kind: 'threads',
    opacity: { light: 0.12, dark: 0.22 },
    mask: 'linear-gradient(to bottom, #000 0%, transparent 65%)',
    still: {
      light: 'linear-gradient(180deg, rgba(3,105,161,0.05) 0%, transparent 40%)',
      dark: 'linear-gradient(180deg, rgba(56,189,248,0.08) 0%, transparent 40%)',
    },
    threads: {
      light: [0.06, 0.09, 0.16],
      dark: [0.45, 0.6, 0.78],
      amplitude: 0.5,
      distance: 0.85,
    },
  },

  /**
   * Empty states — a small panel, not a page. Brighter than the shell
   * because it has to carry an otherwise blank box, and confined to its
   * own container so it cannot bleed into the surrounding layout.
   */
  empty: {
    kind: 'threads',
    /**
     * Measured, not guessed. At the 0.22 / 0.34 this started at, a Threads
     * line core dropped `--color-content-3` — which is exactly what empty
     * states are written in — to 4.18:1 in light mode, under the AA 4.5
     * floor. These values keep the worst case near 4.9:1 both themes.
     * See the contrast audit in the accompanying notes before raising them.
     */
    opacity: { light: 0.15, dark: 0.28 },
    mask: 'radial-gradient(70% 100% at 50% 50%, #000 20%, transparent 85%)',
    still: {
      light: 'radial-gradient(60% 80% at 50% 50%, rgba(3,105,161,0.07) 0%, transparent 70%)',
      dark: 'radial-gradient(60% 80% at 50% 50%, rgba(56,189,248,0.10) 0%, transparent 70%)',
    },
    threads: {
      light: [0.06, 0.09, 0.16],
      dark: [0.45, 0.6, 0.78],
      amplitude: 1.1,
      distance: 0,
    },
  },
};

export interface PageBackgroundProps {
  variant: BackgroundVariant;
  /**
   * The parent must be `relative isolate`. `isolate` matters: it makes the
   * parent a stacking context, which is what lets this layer sit at -z-10 —
   * above the parent's own background but below all of its content —
   * without needing a z-index on every sibling.
   */
  className?: string;
}

export function PageBackground({ variant, className = '' }: PageBackgroundProps) {
  const spec = VARIANTS[variant];
  const { isDark } = useTheme();
  const capability = useCapability(spec.kind === 'aurora');

  const theme = isDark ? 'dark' : 'light';

  const layerStyle = useMemo(
    () => ({
      opacity: spec.opacity[theme],
      maskImage: spec.mask,
      WebkitMaskImage: spec.mask,
    }),
    [spec, theme],
  );

  return (
    <div
      aria-hidden="true"
      role="presentation"
      className={`pointer-events-none absolute inset-0 -z-10 overflow-hidden ${className}`}
    >
      {/* Always painted. Cheap, themed, and identical in shape to the
          animated layer, so promoting or demoting a device is invisible. */}
      <div className="absolute inset-0" style={{ background: spec.still[theme] }} />

      {capability === 'animated' && (
        <Suspense fallback={null}>
          <div
            className="absolute inset-0 transition-opacity duration-700 ease-out"
            style={layerStyle}
          >
            {spec.kind === 'aurora' && spec.aurora ? (
              <Aurora
                colorStops={spec.aurora[theme]}
                amplitude={spec.aurora.amplitude}
                blend={spec.aurora.blend}
                speed={spec.aurora.speed}
              />
            ) : spec.threads ? (
              <Threads
                color={spec.threads[theme]}
                amplitude={spec.threads.amplitude}
                distance={spec.threads.distance}
                enableMouseInteraction={false}
              />
            ) : null}
          </div>
        </Suspense>
      )}
    </div>
  );
}

export default PageBackground;
