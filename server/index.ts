import 'dotenv/config';
import express from 'express';
import { createRateLimiter, ipOf } from './rateLimit.js';
import {
  requestOtp,
  verifyOtp,
  revokeSession,
  requireAuth,
  issueSession,
  AUTH_LIMITS,
} from './auth.js';
import { generateJson, providerStatus, Type } from './providers.js';
import { smsStatus } from './sms.js';
import { emailStatus } from './email.js';
import { verifyGoogleCredential, googleAuthStatus } from './google.js';
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
app.use(express.json({ limit: '64kb' }));

// ───────────────────────── rate limiters ─────────────────────────
const globalLimiter = createRateLimiter({ name: 'global', windowMs: 60_000, max: 120 });
const otpRequestLimiter = createRateLimiter({ name: 'otp-request', windowMs: 15 * 60_000, max: 10 });
const otpVerifyLimiter = createRateLimiter({ name: 'otp-verify', windowMs: 15 * 60_000, max: 20 });

const sessionKey = (req: express.Request) => {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? `t:${h.slice(7, 27)}` : `ip:${ipOf(req)}`;
};

const aiLimiter = createRateLimiter({ name: 'ai', windowMs: 60_000, max: 10, keyFn: sessionKey });
const chatLimiter = createRateLimiter({ name: 'chat', windowMs: 60_000, max: 15, keyFn: sessionKey });

app.use('/api', globalLimiter);

// ───────────────────────── auth ─────────────────────────
app.post('/api/auth/request-otp', otpRequestLimiter, async (req, res) => {
  const result = await requestOtp(String(req.body?.identifier || '').slice(0, 254));
  if (result.ok === false) {
    if (result.retryAfterSec) res.setHeader('Retry-After', String(result.retryAfterSec));
    return res.status(result.status).json(result);
  }
  return res.json(result);
});

app.post('/api/auth/verify-otp', otpVerifyLimiter, (req, res) => {
  const identifier = String(req.body?.identifier || '').slice(0, 254);
  const result = verifyOtp(identifier, String(req.body?.otp || '').slice(0, 10));
  if (result.ok === false) {
    if (result.retryAfterSec) res.setHeader('Retry-After', String(result.retryAfterSec));
    return res.status(result.status).json(result);
  }
  return res.json(result);
});

app.post('/api/auth/google', otpVerifyLimiter, async (req, res) => {
  const credential = String(req.body?.credential || '');
  const result = await verifyGoogleCredential(credential);
  if (result.ok === false) return res.status(result.status).json(result);

  const session = issueSession(result.maskedEmail, 'email');
  return res.json({ ok: true, ...session });
});

app.post('/api/auth/logout', (req, res) => {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) revokeSession(h.slice(7));
  res.json({ ok: true });
});

app.get('/api/auth/session', requireAuth, (req, res) =>
  res.json({ ok: true, session: (req as any).session }),
);

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

// ───────────────────────── observability ─────────────────────────
app.get('/api/health', (_req, res) =>
  res.json({
    ok: true,
    providers: providerStatus(),
    sms: smsStatus(),
    email: emailStatus(),
    google: googleAuthStatus(),
    budget: budgetStatus(),
    concurrency: concurrencyStatus(),
    limits: { ...LIMITS, auth: AUTH_LIMITS },
  }),
);

app.listen(PORT, () => {
  const p = providerStatus();
  console.log(`[server] CivicAI API on http://localhost:${PORT}`);
  console.log(`[server] gemini=${p.gemini.configured ? p.gemini.model : 'off'} claude=${p.claude.configured ? p.claude.model : 'off'}`);
  console.log(`[server] daily budget ${LIMITS.DAILY_REQUEST_BUDGET} · max ${LIMITS.MAX_CONCURRENT} concurrent · ${LIMITS.MAX_OUTPUT_TOKENS} output tokens`);
});
