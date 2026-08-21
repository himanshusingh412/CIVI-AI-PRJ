import { AlertTriangle, CheckCircle2, FlaskConical, MinusCircle, HelpCircle } from 'lucide-react';
import { useConfig, type IntegrationMode } from '../context/ConfigContext';
import { useT } from '../i18n/I18nContext';

/**
 * The only component permitted to render an integration's status.
 *
 * Wording is deliberate and non-negotiable:
 *
 *   Live                  the credentials exist and the adapter calls the
 *                         real provider. It does NOT claim the call was
 *                         tested against production today.
 *   Demo                  simulated on purpose. Saying so out loud is the
 *                         entire value of this badge.
 *   Configuration needed  switched on, credentials missing. Never dressed up
 *                         as working.
 *   Off / Unknown         disabled by flag, or the server never answered.
 *
 * "Connected" is avoided everywhere because it implies a verified session
 * that this system does not establish.
 */

type Tone = { bg: string; fg: string; label: string; Icon: typeof CheckCircle2 };

const TONES: Record<IntegrationMode | 'unknown', Tone> = {
  live: {
    bg: 'var(--color-success-pale)', fg: 'var(--color-success)',
    label: 'Live', Icon: CheckCircle2,
  },
  demo: {
    bg: 'var(--color-info-pale)', fg: 'var(--color-info)',
    label: 'Demo', Icon: FlaskConical,
  },
  config_required: {
    bg: 'var(--color-warning-pale)', fg: 'var(--color-warning)',
    label: 'Configuration needed', Icon: AlertTriangle,
  },
  disabled: {
    bg: 'var(--color-surface-2)', fg: 'var(--color-content-3)',
    label: 'Off', Icon: MinusCircle,
  },
  unknown: {
    bg: 'var(--color-surface-2)', fg: 'var(--color-content-3)',
    label: 'Unknown', Icon: HelpCircle,
  },
};

export function IntegrationBadge({
  integrationKey,
  showLabel = false,
  size = 'sm',
}: {
  integrationKey: string;
  /** Prefix the badge with the integration's own name. */
  showLabel?: boolean;
  size?: 'sm' | 'xs';
}) {
  const { modeOf, integration } = useConfig();
  const mode = modeOf(integrationKey);
  const tone = TONES[mode];
  const info = integration(integrationKey);
  const { Icon } = tone;

  const dims = size === 'xs'
    ? 'text-[10px] h-5 px-1.5 gap-1'
    : 'text-[11px] h-6 px-2 gap-1.5';

  return (
    <span
      className={`inline-flex items-center rounded-full font-bold uppercase tracking-wide ${dims}`}
      style={{ background: tone.bg, color: tone.fg }}
      // The detail sentence is written for an operator, so it is the tooltip
      // rather than body copy — visible on demand, never in the way.
      title={info?.detail ?? 'Status unavailable — the backend did not respond.'}
    >
      <Icon size={size === 'xs' ? 10 : 12} aria-hidden="true" />
      {showLabel && info ? `${info.label}: ` : ''}
      {tone.label}
    </span>
  );
}

/**
 * Banner shown when the whole deployment is running in Demo Mode.
 *
 * Sits at the top of staff surfaces, not citizen ones: a citizen filing a
 * real complaint should see a working product, while an operator or a judge
 * needs to know at a glance that some providers are simulated.
 */
export function DemoModeBanner() {
  const t = useT();
  const { config, loading } = useConfig();
  if (loading || !config.demoMode) return null;

  const simulated = config.integrations.filter(i => i.mode === 'demo');
  if (!simulated.length) return null;

  return (
    <div
      role="status"
      className="w-full px-4 sm:px-6 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]"
      style={{ background: 'var(--color-info-pale)', color: 'var(--color-info)' }}
    >
      <FlaskConical size={13} aria-hidden="true" className="shrink-0" />
      <span className="font-bold uppercase tracking-widest">{t('integrationBadge.demoMode')}</span>
      <span className="opacity-90">
        Simulated providers: {simulated.map(i => i.label).join(', ')}. Complaint
        data, roles and workflow are real.
      </span>
    </div>
  );
}
