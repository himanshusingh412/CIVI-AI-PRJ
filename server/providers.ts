import { GoogleGenAI, Type } from '@google/genai';
import { LIMITS, type ChatTurn } from './limits.js';

/**
 * Multi-provider AI layer with automatic failover.
 *
 *   Gemini  → primary (cheapest, fastest, native JSON schema support)
 *   Bedrock → first fallback (Anthropic models via AWS, strongest reasoning)
 *   Claude  → second fallback (direct Anthropic API)
 *   static  → last resort so the app never hard-fails
 *
 * Every provider is capped at LIMITS.MAX_OUTPUT_TOKENS so a response can
 * never balloon, and each call is wrapped in a timeout by limits.ts.
 */

const GEMINI_KEY = process.env.AI_API_KEY || '';
const GEMINI_MODEL = process.env.AI_MODEL || 'gemini-3.1-flash-lite';
const CLAUDE_KEY = process.env.ANTHROPIC_API_KEY || '';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';

// AWS Bedrock — API-key ("bearer token") auth against the bedrock-runtime
// Converse endpoint, so no SigV4 signing or AWS SDK dependency is needed.
const BEDROCK_TOKEN = process.env.AWS_BEARER_TOKEN_BEDROCK || '';
const BEDROCK_REGION = process.env.AWS_REGION || 'us-east-2';
const BEDROCK_MODEL =
  process.env.BEDROCK_MODEL_ID || 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

const gemini = GEMINI_KEY ? new GoogleGenAI({ apiKey: GEMINI_KEY }) : null;

export const providerStatus = () => ({
  gemini: { configured: !!GEMINI_KEY, model: GEMINI_MODEL },
  bedrock: { configured: !!BEDROCK_TOKEN, model: BEDROCK_MODEL, region: BEDROCK_REGION },
  claude: { configured: !!CLAUDE_KEY, model: CLAUDE_MODEL },
});

export type ProviderName = 'gemini' | 'bedrock' | 'claude' | 'fallback';
export type AiResult<T> = { data: T; provider: ProviderName; degraded: boolean };

/** Models can wrap JSON in prose or fences; pull out the first JSON object. */
function extractJson<T>(text: string): T {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no_json_in_response');
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
}

// ───────────────────────── Gemini ─────────────────────────
async function geminiJson<T>(opts: {
  system: string;
  prompt: string;
  history?: ChatTurn[];
  schema: any;
}): Promise<T> {
  if (!gemini) throw new Error('gemini_not_configured');

  const contents = [
    ...(opts.history ?? []).map(t => ({
      role: t.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: t.content }],
    })),
    { role: 'user', parts: [{ text: opts.prompt }] },
  ];

  const response = await gemini.models.generateContent({
    model: GEMINI_MODEL,
    contents,
    config: {
      systemInstruction: opts.system,
      responseMimeType: 'application/json',
      responseSchema: opts.schema,
      maxOutputTokens: LIMITS.MAX_OUTPUT_TOKENS,
      temperature: 0.4,
    },
  });

  return JSON.parse(response.text || '{}') as T;
}

// ───────────────────────── AWS Bedrock (Converse API) ─────────────────────────
async function bedrockJson<T>(opts: {
  system: string;
  prompt: string;
  history?: ChatTurn[];
  jsonHint: string;
}): Promise<T> {
  if (!BEDROCK_TOKEN) throw new Error('bedrock_not_configured');

  const url =
    `https://bedrock-runtime.${BEDROCK_REGION}.amazonaws.com/model/` +
    `${encodeURIComponent(BEDROCK_MODEL)}/converse`;

  // Converse requires strictly alternating roles starting with 'user'.
  const history = (opts.history ?? []).map(t => ({
    role: t.role === 'assistant' ? ('assistant' as const) : ('user' as const),
    content: [{ text: t.content }],
  }));
  const messages = [
    ...history,
    {
      role: 'user' as const,
      content: [{ text: `${opts.prompt}\n\nRespond with ONLY valid JSON matching: ${opts.jsonHint}` }],
    },
  ];

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${BEDROCK_TOKEN}`,
    },
    body: JSON.stringify({
      messages,
      system: [{ text: opts.system }],
      inferenceConfig: {
        maxTokens: LIMITS.MAX_OUTPUT_TOKENS,
        temperature: 0.4,
      },
    }),
    signal: AbortSignal.timeout(LIMITS.REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    // Body may carry the real reason (throttling, model access not granted).
    const detail = await res.text().catch(() => '');
    const err: any = new Error(`bedrock_${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
    err.status = res.status;
    throw err;
  }

  const body: any = await res.json();
  const text: string =
    body?.output?.message?.content?.map((c: any) => c?.text ?? '').join('') ?? '';
  return extractJson<T>(text);
}

// ───────────────────────── Claude ─────────────────────────
async function claudeJson<T>(opts: {
  system: string;
  prompt: string;
  history?: ChatTurn[];
  jsonHint: string;
}): Promise<T> {
  if (!CLAUDE_KEY) throw new Error('claude_not_configured');

  const messages = [
    ...(opts.history ?? []).map(t => ({ role: t.role, content: t.content })),
    { role: 'user' as const, content: `${opts.prompt}\n\nRespond with ONLY valid JSON matching: ${opts.jsonHint}` },
  ];

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': CLAUDE_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: LIMITS.MAX_OUTPUT_TOKENS,
      system: opts.system,
      messages,
    }),
  });

  if (!res.ok) {
    const err: any = new Error(`claude_${res.status}`);
    err.status = res.status;
    throw err;
  }

  const body = await res.json();
  const text: string = body?.content?.[0]?.text ?? '{}';
  const match = text.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : '{}') as T;
}

// ───────────────────────── unified entry ─────────────────────────
export async function generateJson<T>(opts: {
  system: string;
  prompt: string;
  history?: ChatTurn[];
  schema: any;
  jsonHint: string;
  fallback: T;
}): Promise<AiResult<T>> {
  // 1. Gemini — primary
  if (gemini) {
    try {
      return { data: await geminiJson<T>(opts), provider: 'gemini', degraded: false };
    } catch (err: any) {
      const quota = err?.status === 429;
      console.warn(`[ai] gemini failed (${quota ? 'quota' : err?.message}) — trying Bedrock`);
    }
  }

  // 2. Bedrock — strongest fallback
  if (BEDROCK_TOKEN) {
    try {
      return { data: await bedrockJson<T>(opts), provider: 'bedrock', degraded: false };
    } catch (err: any) {
      console.warn(`[ai] bedrock failed (${err?.message}) — trying Claude`);
    }
  }

  // 3. Claude direct
  if (CLAUDE_KEY) {
    try {
      return { data: await claudeJson<T>(opts), provider: 'claude', degraded: false };
    } catch (err: any) {
      console.warn(`[ai] claude failed (${err?.message})`);
    }
  }

  // 4. Static fallback — the app keeps working, just without AI
  return { data: opts.fallback, provider: 'fallback', degraded: true };
}

export { Type };
