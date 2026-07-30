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
          channel: 'email' as const,
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

    const session = issueSession(result.maskedEmail, 'google');
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

// ───────────────────────── observability ─────────────────────────
app.get('/api/health', (_req, res) =>
  res.json({
    ok: true,
    providers: providerStatus(),
    email: emailStatus(),
    google: googleAuthStatus(),
    bot: botStatus(),
    sessions: sessionStats(),
    budget: budgetStatus(),
    concurrency: concurrencyStatus(),
    limits: { ...LIMITS, auth: AUTH_LIMITS },
  }),
);

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
const isServerless = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

if (!isServerless) {
  const server = app.listen(PORT, () => {
    const p = providerStatus();
    console.log(`[server] CivicAI API on http://localhost:${PORT}`);
    console.log(`[server] gemini=${p.gemini.configured ? p.gemini.model : 'off'} claude=${p.claude.configured ? p.claude.model : 'off'}`);
    console.log(`[server] google-signin=${googleAuthStatus().enabled ? 'on' : 'off'} email=${emailStatus().provider} bot=${botStatus().captcha}`);
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
