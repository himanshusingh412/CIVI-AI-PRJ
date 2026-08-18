/**
 * Assistant conversation history — stored in this browser, not on a server.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Why local
 * ─────────────────────────────────────────────────────────────────────────
 * These transcripts are the most sensitive text in the product. People
 * describe an unsafe street, a landlord, a hospital visit, sometimes a
 * police matter, and they do it before they have decided whether to file
 * anything at all. Keeping that on the device by default means an
 * unfiled conversation never becomes a record the state holds.
 *
 * The `chatbot_history` table exists in db/001_schema.sql for the day this
 * needs to be server-side (multi-device continuity, or an audit obligation).
 * That is a policy decision with a privacy notice attached, not a storage
 * detail — so it is not made silently here.
 *
 * Consequences, stated plainly rather than discovered later:
 *   - history does not follow you to another device
 *   - clearing site data erases it
 *   - private-browsing windows keep nothing
 */

export type AssistantMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  at: string;
  /** Structured extras from the chat endpoint, kept for the context panel. */
  meta?: {
    category?: string;
    priority?: string;
    intent?: string;
    missingInfo?: string[];
    readyToFile?: boolean;
    locationLabel?: string;
    provider?: string;
    degraded?: boolean;
  };
};

export type Conversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: AssistantMessage[];
};

const KEY = 'civicai.assistant.conversations';

/**
 * Bounded on purpose. localStorage is a shared ~5 MB budget for the whole
 * origin; an unbounded transcript log would eventually start throwing
 * QuotaExceededError on every write, which surfaces as "the assistant
 * stopped remembering anything" with no other symptom.
 */
const MAX_CONVERSATIONS = 20;
const MAX_MESSAGES_PER_CONVERSATION = 200;

export const newId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function read(): Conversation[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(c => c && typeof c.id === 'string' && Array.isArray(c.messages));
  } catch {
    // Corrupt JSON, or storage blocked in private browsing. Either way the
    // assistant must still work — it just starts with no history.
    return [];
  }
}

function write(list: Conversation[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_CONVERSATIONS)));
  } catch {
    /* quota or blocked storage — history is a convenience, never a blocker */
  }
}

export const listConversations = (): Conversation[] =>
  read().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

export const getConversation = (id: string): Conversation | null =>
  read().find(c => c.id === id) ?? null;

/**
 * Titles come from the first thing the person said, trimmed at a word
 * boundary. Naming a conversation is a chore nobody does, and "New chat 4"
 * is useless for finding the one about the water supply.
 */
export function titleFrom(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return 'New conversation';
  if (clean.length <= 42) return clean;
  const cut = clean.slice(0, 42);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

export function saveConversation(conv: Conversation): void {
  const trimmed: Conversation = {
    ...conv,
    messages: conv.messages.slice(-MAX_MESSAGES_PER_CONVERSATION),
    updatedAt: new Date().toISOString(),
  };
  const rest = read().filter(c => c.id !== conv.id);
  write([trimmed, ...rest]);
}

export function deleteConversation(id: string): void {
  write(read().filter(c => c.id !== id));
}

export function clearAllConversations(): void {
  try { localStorage.removeItem(KEY); } catch { /* noop */ }
}

export function createConversation(): Conversation {
  const now = new Date().toISOString();
  return { id: newId(), title: 'New conversation', createdAt: now, updatedAt: now, messages: [] };
}
