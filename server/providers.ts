import { GoogleGenAI, Type } from '@google/genai';
import { LIMITS, type ChatTurn } from './limits.js';

/**
 * Dual-provider AI layer.
 *  - Gemini is primary (cheap, fast).
 *  - Claude is the automatic fallback when Gemini 429s / errors, if a key is configured.
 * Both are capped at LIMITS.MAX_OUTPUT_TOKENS so a response can never balloon.
 */

const GEMINI_KEY = process.env.AI_API_KEY || '';
const GEMINI_MODEL = process.env.AI_MODEL || 'gemini-3.1-flash-lite';
const CLAUDE_KEY = process.env.ANTHROPIC_API_KEY || '';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';

const gemini = GEMINI_KEY ? new GoogleGenAI({ apiKey: GEMINI_KEY }) : null;

export const providerStatus = () => ({
  gemini: { configured: !!GEMINI_KEY, model: GEMINI_MODEL },
  claude: { configured: !!CLAUDE_KEY, model: CLAUDE_MODEL },
});

export type AiResult<T> = { data: T; provider: 'gemini' | 'claude' | 'fallback'; degraded: boolean };

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
  // 1. Gemini
  if (gemini) {
    try {
      return { data: await geminiJson<T>(opts), provider: 'gemini', degraded: false };
    } catch (err: any) {
      const quota = err?.status === 429;
      console.warn(`[ai] gemini failed (${quota ? 'quota' : err?.message}) — trying Claude`);
    }
  }

  // 2. Claude fallback
  if (CLAUDE_KEY) {
    try {
      return { data: await claudeJson<T>(opts), provider: 'claude', degraded: false };
    } catch (err: any) {
      console.warn(`[ai] claude failed (${err?.message})`);
    }
  }

  // 3. Static fallback — the app keeps working, just without AI
  return { data: opts.fallback, provider: 'fallback', degraded: true };
}

export { Type };
