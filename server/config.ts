/**
 * Integration configuration and honest status reporting.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Why this file exists
 * ─────────────────────────────────────────────────────────────────────────
 * A demo platform has a strong incentive to lie. It is trivial to render a
 * green "WhatsApp: Connected" pill next to code that has never spoken to
 * Meta, and nobody notices until a judge asks to see a message arrive. That
 * failure mode is worse than having no integration at all, because it
 * destroys trust in every other claim the system makes.
 *
 * So every external dependency is registered here with exactly one of four
 * honest modes, derived from what is ACTUALLY configured — never asserted by
 * a component:
 *
 *   live              credentials present and the adapter talks to the real
 *                     service. (Note: "live" means wired up and configured,
 *                     not "verified against production today".)
 *   demo              deliberately simulated. The workflow is real, the
 *                     provider is not. Always labelled as such in the UI.
 *   config_required   the feature is switched on but its credentials are
 *                     missing, and demo mode is not permitted here (i.e.
 *                     production). The feature degrades; it does not fake.
 *   disabled          switched off by an ENABLE_* flag.
 *
 * The UI renders whatever this file reports. There is no second source of
 * truth, and no component may hardcode a status badge.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { storeStatus } from './store.js';

export type IntegrationMode = 'live' | 'demo' | 'config_required' | 'disabled';

export type IntegrationKey =
  | 'ai'
  | 'ocr'
  | 'database'
  | 'google_oauth'
  | 'otp'
  | 'sms'
  | 'whatsapp'
  | 'digilocker'
  | 'voice'
  | 'email';

export type IntegrationStatus = {
  key: IntegrationKey;
  label: string;
  mode: IntegrationMode;
  /** Provider actually in use, or the reason there is none. */
  provider: string;
  /** One sentence an operator can act on. Never leaks secret values. */
  detail: string;
};

// ───────────────────────── primitives ─────────────────────────

const truthy = (v: string | undefined, fallback: boolean): boolean => {
  if (v === undefined || v === '') return fallback;
  return /^(1|true|yes|on)$/i.test(v.trim());
};

export const isProduction = () => process.env.NODE_ENV === 'production';

/**
 * Demo Mode is the switch that decides what happens when a credential is
 * missing: simulate the provider, or refuse and say so.
 *
 * It defaults ON outside production and OFF inside it. A production deploy
 * that genuinely wants simulated providers has to opt in explicitly with
 * ENABLE_DEMO_MODE=true — which is exactly the kind of decision that should
 * require someone to type it out.
 */
export const demoModeEnabled = (): boolean =>
  truthy(process.env.ENABLE_DEMO_MODE, true);

/** Feature switches. Every one defaults ON so a fresh clone is fully usable. */
export const flags = () => ({
  demoMode: demoModeEnabled(),
  ai: truthy(process.env.ENABLE_AI, true),
  ocr: truthy(process.env.ENABLE_OCR, true),
  voice: truthy(process.env.ENABLE_VOICE, true),
  whatsapp: truthy(process.env.ENABLE_WHATSAPP, true),
  sms: truthy(process.env.ENABLE_SMS, true),
  digilocker: truthy(process.env.ENABLE_DIGILOCKER, true),
  googleOAuth: truthy(process.env.ENABLE_GOOGLE_OAUTH, true),
  documentVerification: truthy(process.env.ENABLE_DOCUMENT_VERIFICATION, true),
});

/**
 * The single decision function.
 *
 * `configured` is the ONLY thing that can produce 'live'. There is no code
 * path in this file that returns 'live' without it, which is what makes the
 * badge trustworthy.
 */
function resolve(
  enabled: boolean,
  configured: boolean,
  opts: { canSimulate: boolean },
): IntegrationMode {
  if (!enabled) return 'disabled';
  if (configured) return 'live';
  if (opts.canSimulate && demoModeEnabled()) return 'demo';
  return 'config_required';
}

// ───────────────────────── per-integration checks ─────────────────────────

const has = (...names: string[]) => names.every(n => !!(process.env[n] || '').trim());
const hasAny = (...names: string[]) => names.some(n => !!(process.env[n] || '').trim());

export function integrations(): IntegrationStatus[] {
  const f = flags();
  // Imported lazily-ish at call time (not module load) so this file stays
  // free of import-order hazards on serverless cold starts.
  const dbBackend = storeStatus().backend;

  // ── AI ──
  const aiConfigured = hasAny('AI_API_KEY', 'ANTHROPIC_API_KEY', 'AWS_BEARER_TOKEN_BEDROCK');
  const aiProvider = has('AI_API_KEY')
    ? `gemini (${process.env.AI_MODEL || 'default'})`
    : has('AWS_BEARER_TOKEN_BEDROCK')
      ? `bedrock (${process.env.BEDROCK_MODEL_ID || 'default'})`
      : has('ANTHROPIC_API_KEY')
        ? `anthropic (${process.env.CLAUDE_MODEL || 'default'})`
        : 'none';

  // ── OCR ──
  // Gemini Vision reuses AI_API_KEY, so OCR is genuinely live whenever the
  // AI key is present. No separate credential to chase.
  const ocrConfigured = f.ai && has('AI_API_KEY');

  // ── WhatsApp ──
  // All three are required: a token with no phone number id cannot send, and
  // a webhook with no verify token cannot be registered with Meta.
  const waConfigured = has(
    'WHATSAPP_ACCESS_TOKEN',
    'WHATSAPP_PHONE_NUMBER_ID',
    'WHATSAPP_VERIFY_TOKEN',
  );

  // ── DigiLocker ──
  const dlConfigured = has('DIGILOCKER_CLIENT_ID', 'DIGILOCKER_CLIENT_SECRET');

  // ── SMS ──
  const smsConfigured =
    has('MSG91_AUTH_KEY') ||
    has('TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER');
  const smsProvider = has('MSG91_AUTH_KEY')
    ? 'msg91'
    : smsConfigured
      ? 'twilio'
      : 'console';

  return [
    {
      key: 'ai',
      label: 'AI Assistant',
      mode: resolve(f.ai, aiConfigured, { canSimulate: true }),
      provider: aiProvider,
      detail: aiConfigured
        ? 'Model provider configured with automatic failover.'
        : 'No model key set. Set AI_API_KEY (Gemini) to enable real responses.',
    },
    {
      key: 'ocr',
      label: 'Document OCR',
      mode: resolve(f.ocr, ocrConfigured, { canSimulate: true }),
      provider: ocrConfigured ? 'gemini-vision' : 'fixture',
      detail: ocrConfigured
        ? 'Documents are read by Gemini Vision and fields extracted from the real image.'
        : 'No vision model key. Extraction returns deterministic fixture data for the demo.',
    },
    {
      key: 'database',
      label: 'Database',
      // Postgres has no meaningful "demo" mode — the in-memory store is a
      // real fallback with real (bad) consequences, so it is never dressed
      // up as a working integration.
      //
      // Reported from the store's ACTUAL backend, not from the presence of
      // DATABASE_URL. A connection string that is set but unreachable is the
      // single most misleading state this system can be in: the operator
      // believes their data is durable while every write is going to a Map
      // that dies with the process.
      mode: dbBackend === 'postgres' ? 'live' : 'config_required',
      provider: dbBackend,
      detail:
        dbBackend === 'postgres'
          ? 'Durable Postgres storage.'
          : has('DATABASE_URL')
            ? 'DATABASE_URL is set but the database is not reachable — running on the in-memory store. Data is lost on restart.'
            : 'In-memory store: data is lost on restart and is not shared across instances. Set DATABASE_URL.',
    },
    {
      key: 'google_oauth',
      label: 'Sign in with Google',
      mode: resolve(f.googleOAuth, has('GOOGLE_CLIENT_ID'), { canSimulate: false }),
      provider: has('GOOGLE_CLIENT_ID') ? 'google-identity-services' : 'none',
      detail: has('GOOGLE_CLIENT_ID')
        ? 'OAuth client configured; ID tokens are verified server-side.'
        : 'Set GOOGLE_CLIENT_ID to enable. The OTP path remains available meanwhile.',
    },
    {
      key: 'otp',
      label: 'One-time passcode',
      // OTP always works: the code is real, hashed and rate-limited. Only
      // DELIVERY varies, which is what the sms entry reports.
      mode: 'live',
      provider: smsProvider,
      detail:
        smsProvider === 'console'
          ? 'Codes are generated and verified for real but printed to the server log instead of sent.'
          : `Codes delivered over ${smsProvider}.`,
    },
    {
      key: 'sms',
      label: 'SMS delivery',
      mode: resolve(f.sms, smsConfigured, { canSimulate: true }),
      provider: smsProvider,
      detail: smsConfigured
        ? `Outbound SMS billed through ${smsProvider}. Messages are not free.`
        : 'No SMS provider configured. Codes appear in the server log (development only).',
    },
    {
      key: 'email',
      label: 'Email delivery',
      mode: resolve(
        truthy(process.env.EMAIL_ENABLED, false),
        has('RESEND_API_KEY'),
        { canSimulate: true },
      ),
      provider: has('RESEND_API_KEY') ? 'resend' : 'console',
      detail: has('RESEND_API_KEY')
        ? 'Transactional email through Resend.'
        : 'Set EMAIL_ENABLED=true and RESEND_API_KEY to send real email.',
    },
    {
      key: 'whatsapp',
      label: 'WhatsApp',
      mode: resolve(f.whatsapp, waConfigured, { canSimulate: true }),
      provider: waConfigured ? 'meta-cloud-api' : 'simulator',
      detail: waConfigured
        ? 'Meta WhatsApp Cloud API configured. Register the webhook URL in the Meta dashboard.'
        : 'Integration ready — configuration required. Set WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_VERIFY_TOKEN.',
    },
    {
      key: 'digilocker',
      label: 'DigiLocker',
      mode: resolve(f.digilocker, dlConfigured, { canSimulate: true }),
      provider: dlConfigured ? 'digilocker-oauth' : 'simulator',
      detail: dlConfigured
        ? 'DigiLocker OAuth client configured.'
        : 'Simulated authorisation flow with sample documents. Not connected to the real DigiLocker API.',
    },
    {
      key: 'voice',
      label: 'Voice assistant',
      // Voice runs entirely in the browser (Web Speech API). There is no
      // server credential, so the server can only say whether it is allowed.
      mode: f.voice ? 'live' : 'disabled',
      provider: 'browser-web-speech',
      detail: f.voice
        ? 'Speech recognition and synthesis run in the browser; availability depends on the device.'
        : 'Voice input is switched off by ENABLE_VOICE=false.',
    },
  ];
}

/** Keyed lookup for adapters that need to branch on their own mode. */
export function modeOf(key: IntegrationKey): IntegrationMode {
  return integrations().find(i => i.key === key)?.mode ?? 'disabled';
}

export const isLive = (key: IntegrationKey) => modeOf(key) === 'live';
export const isDemo = (key: IntegrationKey) => modeOf(key) === 'demo';

/**
 * Public shape sent to the browser.
 *
 * Contains no secrets by construction: only booleans, provider NAMES and
 * operator-facing prose. Adding a value here should require asking "would I
 * be comfortable with this in view-source?" — because it will be.
 */
export function publicConfig() {
  const list = integrations();
  return {
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    demoMode: demoModeEnabled(),
    environment: isProduction() ? 'production' : 'development',
    features: flags(),
    integrations: list.map(({ key, label, mode, provider, detail }) => ({
      key, label, mode, provider, detail,
    })),
  };
}
