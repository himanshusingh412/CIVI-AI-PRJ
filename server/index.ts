import 'dotenv/config';
import express from 'express';
import { createRateLimiter, ipOf } from './rateLimit.js';
import {
  requestOtp,
  verifyOtp,
  revokeSession,
  refreshSession,
  requireAuth,
  issueSession,
  sessionStats,
  parseIdentifier,
  GENERIC_OTP_SENT,
  AUTH_LIMITS,
} from './auth.js';
import { generateJson, providerStatus, Type } from './providers.js';
import { emailStatus } from './email.js';
import { verifyGoogleCredential, googleAuthStatus } from './google.js';
import {
  csrfProtection,
  securityHeaders,
  setSessionCookies,
  clearSessionCookies,
  tokenFromRequest,
  constantTime,
  checkNotBot,
  botStatus,
  safeError,
} from './security.js';
import {
  withGuards,
  GuardError,
  budgetStatus,
  concurrencyStatus,
  clampText,
  LIMITS,
} from './limits.js';
import { handleChat } from './chat.js';
import { adminRouter } from './admin.js';
import { sseHandler, subscriberCount } from './events.js';
import { scoreDuplicates, classify } from './duplicates.js';
import { runSlaSweep, startSlaScheduler } from './sla.js';
import { mediaRouter, serveMedia } from './media.js';
import { complaintsRouter } from './complaints.js';
import { smsStatus } from './sms.js';
import { seedDemoData, storeStatus, initStore, store } from './store.js';

const PORT = Number(process.env.PORT || 8787);
const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(securityHeaders);
app.use(express.json({ limit: '64kb' }));

// Reject malformed JSON with a clean 400 instead of an Express stack trace.
app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ error: 'bad_request', message: 'Malformed request body.' });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'too_large', message: 'Request body is too large.' });
  }
  return next(err);
});

// ───────────────────────── rate limiters ─────────────────────────
const globalLimiter = createRateLimiter({ name: 'global', windowMs: 60_000, max: 120 });
const otpRequestLimiter = createRateLimiter({ name: 'otp-request', windowMs: 15 * 60_000, max: 10 });
const otpVerifyLimiter = createRateLimiter({ name: 'otp-verify', windowMs: 15 * 60_000, max: 20 });
const googleLimiter = createRateLimiter({ name: 'google', windowMs: 15 * 60_000, max: 20 });

const sessionKey = (req: express.Request) => {
  const t = tokenFromRequest(req);
  return t ? `t:${t.slice(0, 20)}` : `ip:${ipOf(req)}`;
};

const aiLimiter = createRateLimiter({ name: 'ai', windowMs: 60_000, max: 10, keyFn: sessionKey });
const chatLimiter = createRateLimiter({ name: 'chat', windowMs: 60_000, max: 15, keyFn: sessionKey });

const isServerless = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

/**
 * Lazy, once-only boot.
 *
 * This used to be `await initStore()` at module top level. Two problems,
 * both of which only bite on serverless:
 *
 *   1. Top-level await requires ESM output. If the platform's bundler emits
 *      CJS, the module fails to PARSE — so `export default app` never runs
 *      and every route returns an empty response. Nothing is logged from
 *      inside the app because the app never loaded.
 *   2. Even in ESM, it makes module import slow and failure-prone at exactly
 *      the moment a request is waiting.
 *
 * Now nothing async happens at import time. The promise is created on first
 * use and reused, so concurrent cold-start requests share one init instead
 * of racing to connect N times.
 */
let bootPromise: Promise<void> | null = null;

function boot(): Promise<void> {
  if (!bootPromise) {
    bootPromise = (async () => {
      try {
        await initStore();
      } catch (err) {
        console.error('[server] store init failed; continuing with the in-memory store', err);
      }
      if (!isServerless) {
        // A setInterval on serverless is pointless — the container is frozen
        // between requests. Production drives the sweep with a cron hitting
        // POST /api/admin/sla/sweep.
        startSlaScheduler();
        try { await seedDemoData(); } catch { /* demo data is optional */ }
      }
    })();
  }
  return bootPromise;
}

/** Every API request waits for boot; after the first, this is a no-op await. */
app.use('/api', (_req, _res, next) => {
  boot().then(() => next(), next);
});

app.use('/api', globalLimiter);
app.use('/api', csrfProtection);

/** Uniform latency floor for auth endpoints, to blunt timing oracles. */
const AUTH_TIME_FLOOR_MS = 450;

// ───────────────────────── auth ─────────────────────────
app.post('/api/auth/request-otp', otpRequestLimiter, async (req, res) => {
  try {
    const identifier = String(req.body?.identifier || '').slice(0, 254);

    const result = await constantTime(AUTH_TIME_FLOOR_MS, async () => {
      const human = await checkNotBot(req.body, ipOf(req));
      if (!human.ok) {
        // Byte-for-byte identical to a real success (including the masked
        // address) so a bot cannot detect that it was filtered. The only
        // difference is that no code was actually generated or sent.
        const parsed = parseIdentifier(identifier);
        return {
          ok: true as const,
          channel: 'phone' as const,
          maskedIdentifier: parsed.ok ? parsed.display : '',
          expiresInSec: Math.floor(AUTH_LIMITS.OTP_TTL_MS / 1000),
          message: GENERIC_OTP_SENT,
          _blocked: true,
        };
      }
      return requestOtp(identifier);
    });

    if ((result as any)._blocked) {
      const { _blocked, ...clean } = result as any;
      return res.json(clean);
    }
    if (result.ok === false) {
      if (result.retryAfterSec) res.setHeader('Retry-After', String(result.retryAfterSec));
      return res.status(result.status).json(result);
    }
    return res.json(result);
  } catch (err) {
    return safeError(res, err);
  }
});

app.post('/api/auth/verify-otp', otpVerifyLimiter, async (req, res) => {
  try {
    const result = await constantTime(AUTH_TIME_FLOOR_MS, () =>
      verifyOtp(
        String(req.body?.identifier || '').slice(0, 254),
        String(req.body?.otp || '').slice(0, 10),
      ),
    );

    if (result.ok === false) {
      if (result.retryAfterSec) res.setHeader('Retry-After', String(result.retryAfterSec));
      return res.status(result.status).json(result);
    }

    const csrf = setSessionCookies(res, result.token, result.expiresInSec);
    return res.json({
      ok: true,
      identifier: result.identifier,
      channel: result.channel,
      expiresInSec: result.expiresInSec,
      csrfToken: csrf,
    });
  } catch (err) {
    return safeError(res, err);
  }
});

app.post('/api/auth/google', googleLimiter, async (req, res) => {
  try {
    const result = await constantTime(AUTH_TIME_FLOOR_MS, () =>
      verifyGoogleCredential(String(req.body?.credential || '')),
    );
    if (result.ok === false) return res.status(result.status).json(result);

    // Google asserts the address; an unverified one must not grant a session.
    if (!result.emailVerified) {
      return res.status(403).json({
        error: 'unverified',
        message: 'Your Google account email is not verified. Please verify it with Google and try again.',
      });
    }

    const session = issueSession(result.maskedEmail, 'google', result.email);
    const csrf = setSessionCookies(res, session.token, session.expiresInSec);
    return res.json({
      ok: true,
      identifier: session.identifier,
      channel: session.channel,
      expiresInSec: session.expiresInSec,
      csrfToken: csrf,
    });
  } catch (err) {
    return safeError(res, err);
  }
});

app.post('/api/auth/refresh', (req, res) => {
  try {
    const rotated = refreshSession(tokenFromRequest(req));
    if (!rotated) {
      clearSessionCookies(res);
      return res.status(401).json({ error: 'unauthorized', message: 'Your session has expired. Please sign in again.' });
    }
    const csrf = setSessionCookies(res, rotated.token, rotated.expiresInSec);
    return res.json({
      ok: true,
      identifier: rotated.identifier,
      channel: rotated.channel,
      expiresInSec: rotated.expiresInSec,
      csrfToken: csrf,
    });
  } catch (err) {
    return safeError(res, err);
  }
});

app.post('/api/auth/logout', (req, res) => {
  revokeSession(tokenFromRequest(req));
  clearSessionCookies(res);
  // Always 200 — logging out must be idempotent and never leak session state.
  res.json({ ok: true });
});

app.get('/api/auth/session', requireAuth, (req, res) => {
  const s = (req as any).session;
  res.json({
    ok: true,
    session: { identifier: s.identifier, channel: s.channel, expiresAt: s.expiresAt },
  });
});

// ───────────────────────── guard error helper ─────────────────────────
function sendGuardError(res: express.Response, err: unknown, fallbackBody: object) {
  if (err instanceof GuardError) {
    const status = err.code === 'budget' ? 429 : err.code === 'busy' ? 503 : 504;
    return res.status(status).json({ error: err.code, message: err.message, ...fallbackBody });
  }
  console.error('[server] unexpected error:', err);
  return res.status(500).json({ error: 'internal', message: 'Something went wrong.', ...fallbackBody });
}

// ───────────────────────── AI chat + live map ─────────────────────────
app.post('/api/chat', requireAuth, chatLimiter, async (req, res) => {
  const key = sessionKey(req);
  try {
    const result = await withGuards(key, () =>
      handleChat({
        message: req.body?.message,
        history: req.body?.history,
        coords: req.body?.coords ?? null,
        sessionKey: key,
      }),
    );
    res.json(result);
  } catch (err) {
    sendGuardError(res, err, {
      reply: 'The assistant is unavailable right now. Please describe your issue and we will still file it.',
      intent: 'report_complaint',
      category: 'General',
      priority: 'Medium',
      sentiment: 'Neutral',
      location: null,
      readyToFile: false,
      missingInfo: [],
      degraded: true,
    });
  }
});

// ───────────────────────── complaint analysis ─────────────────────────
app.post('/api/analyze-complaint', requireAuth, aiLimiter, async (req, res) => {
  const description = clampText(req.body?.description);
  const fallback = { sentiment: 'Neutral', priority: 'Medium', category: 'General' };
  if (!description) return res.json(fallback);

  try {
    const result = await withGuards(sessionKey(req), () =>
      generateJson({
        system:
          'Analyze citizen complaints. Identify sentiment (Frustrated, Neutral, Polite, Angry), priority (Low, Medium, High, Critical), and a category from: [Road & Infrastructure, Water Supply, Electricity, Sanitation, Law & Order, Public Transport, Parks & Recreation, General].',
        prompt: `Analyze this citizen complaint: "${description}"`,
        schema: {
          type: Type.OBJECT,
          properties: {
            sentiment: { type: Type.STRING, enum: ['Frustrated', 'Neutral', 'Polite', 'Angry'] },
            priority: { type: Type.STRING, enum: ['Low', 'Medium', 'High', 'Critical'] },
            category: { type: Type.STRING },
          },
          required: ['sentiment', 'priority', 'category'],
        },
        jsonHint: '{"sentiment":string,"priority":string,"category":string}',
        fallback,
      }),
    );
    res.json({ ...result.data, provider: result.provider, degraded: result.degraded });
  } catch (err) {
    sendGuardError(res, err, { ...fallback, degraded: true });
  }
});

// ───────────────────────── officer response templates ─────────────────────────
app.post('/api/response-templates', requireAuth, aiLimiter, async (req, res) => {
  const description = clampText(req.body?.description);
  const category = clampText(req.body?.category || 'General', 100);
  const fallback = {
    templates: [
      'Thank you for reaching out. We are investigating.',
      'This issue has been routed to the field team.',
      'We expect resolution within the SLA period.',
    ],
  };
  if (!description) return res.json(fallback);

  try {
    const result = await withGuards(sessionKey(req), () =>
      generateJson({
        system:
          'Generate 3 distinct, professional response templates for an Indian city official. Concise and action-oriented.',
        prompt: `Complaint: "${description}" | Category: "${category}"`,
        schema: {
          type: Type.OBJECT,
          properties: { templates: { type: Type.ARRAY, items: { type: Type.STRING } } },
          required: ['templates'],
        },
        jsonHint: '{"templates":[string,string,string]}',
        fallback,
      }),
    );
    res.json({ ...result.data, provider: result.provider, degraded: result.degraded });
  } catch (err) {
    sendGuardError(res, err, { ...fallback, degraded: true });
  }
});

/**
 * Public runtime configuration.
 *
 * The Google Client ID is public by design (it ships inside the page), but
 * sourcing it from `VITE_GOOGLE_CLIENT_ID` bakes it in at build time — so
 * changing it needs a rebuild, and a Vercel deploy needs the var present at
 * build. Serving it at runtime instead means the server's .env is the single
 * source of truth and the browser always sees the current value.
 */
app.get('/api/config', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    emailOtpEnabled: true,
  });
});

// ───────────────────────── citizen complaints ─────────────────────────
// Mounted BEFORE the /:id/duplicates route below so both live under the
// same prefix without the router swallowing it.
app.use('/api/complaints', requireAuth, complaintsRouter);

// ───────────────────────── complaint photos ─────────────────────────
// Upload requires a session; serving does not check ownership yet — see the
// note in media.ts. Ids are unguessable UUIDs, which is obscurity, not
// authorisation.
app.use('/api/media', requireAuth, mediaRouter);
app.get('/api/media/:id', requireAuth, serveMedia);

// ───────────────────────── real-time ─────────────────────────
/**
 * SSE stream. requireAuth so an anonymous client cannot learn that activity
 * is happening; the payloads carry ids only, and clients re-fetch through
 * the normal scoped endpoints.
 */
app.get('/api/events', requireAuth, sseHandler);

// ───────────────────────── duplicate detection ─────────────────────────
/**
 * Candidates that appear to describe the same real-world problem.
 * Read-only and advisory: linking is a human decision, so this never
 * mutates anything.
 */
app.get('/api/complaints/:id/duplicates', requireAuth, async (req, res) => {
  const all = await store.list();
  const target = all.find(c => c.id === req.params.id);
  if (!target) return res.status(404).json({ error: 'not_found' });

  const scored = scoreDuplicates(
    { category: target.category, description: target.description, lat: target.lat, lng: target.lng,
      createdAt: target.createdAt },
    all.filter(c => c.id !== target.id).map(c => ({
      id: c.id, category: c.category, description: c.description,
      lat: c.lat, lng: c.lng, createdAt: c.createdAt })),
  );

  res.json({
    id: target.id,
    matches: scored
      .filter(m => classify(m.score) !== 'distinct')
      .slice(0, 10)
      .map(m => ({
        id: m.id,
        verdict: classify(m.score),
        confidence: Math.round(m.score * 100),
        distanceM: m.distanceM === null ? null : Math.round(m.distanceM),
        reasons: m.reasons,
      })),
  });
});

// ───────────────────────── admin portal ─────────────────────────
// requireAuth first: admin RBAC assumes an authenticated session exists.
app.use('/api/admin', requireAuth, adminRouter);

// ───────────────────────── observability ─────────────────────────
app.get('/api/health', (_req, res) =>
  res.json({
    ok: true,
    providers: providerStatus(),
    email: emailStatus(),
    sms: smsStatus(),
    google: googleAuthStatus(),
    bot: botStatus(),
    sessions: sessionStats(),
    store: storeStatus(),
    realtime: { subscribers: subscriberCount() },
    budget: budgetStatus(),
    concurrency: concurrencyStatus(),
    limits: { ...LIMITS, auth: AUTH_LIMITS },
    config: {
      sessionSecret: !!(process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32),
      databaseUrl: !!process.env.DATABASE_URL,
      googleClientId: !!process.env.GOOGLE_CLIENT_ID,
    },
  }),
);

app.post('/api/admin/sla/sweep', requireAuth, async (_req, res) => {
  // Exposed so a cron trigger can drive the sweep where no long-lived
  // process exists (see the deployment note in sla.ts).
  const breaches = await runSlaSweep();
  res.json({ escalated: breaches.length, breaches });
});

app.use('/api', (_req, res) =>
  res.status(404).json({ error: 'not_found', message: 'Unknown endpoint.' }),
);

// Terminal error handler — nothing internal ever reaches the client.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (res.headersSent) return;
  safeError(res, err);
});

/**
 * On Vercel, api/index.ts imports this app and the platform owns the
 * listener — calling listen() there would crash the function. Only bind a
 * port when this module is the process entrypoint (local `npm run server`).
 */
/**
 * Boot work, guarded.
 *
 * This block runs at MODULE LOAD, which on Vercel means on every cold start
 * and inside the request path. An exception here does not fail one route —
 * it fails the module import, so `export default app` never happens and
 * every single endpoint 500s. That is precisely how the app could work on
 * localhost and be completely dead once deployed.
 *
 * So: nothing in here is allowed to throw.
 */
if (!isServerless) {
  // Locally, finish booting before binding the port so the first request
  // never races the store. `.then` rather than top-level await — see boot().
  void boot().then(() => startLocalServer());
}

function startLocalServer() {
  const server = app.listen(PORT, () => {
    const p = providerStatus();
    console.log(`[server] CivicAI API on http://localhost:${PORT}`);
    console.log(`[server] gemini=${p.gemini.configured ? p.gemini.model : 'off'} claude=${p.claude.configured ? p.claude.model : 'off'}`);
    console.log(`[server] google-signin=${googleAuthStatus().enabled ? 'on' : 'off'} sms=${smsStatus().provider} bot=${botStatus().captcha}`);
    console.log(`[server] daily budget ${LIMITS.DAILY_REQUEST_BUDGET} · max ${LIMITS.MAX_CONCURRENT} concurrent · ${LIMITS.MAX_OUTPUT_TOKENS} output tokens`);
  });

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      console.log(`\n[server] ${sig} received — shutting down`);
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 5000).unref();
    });
  }
}

export default app;
