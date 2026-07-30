const CSRF_COOKIE = 'civicai_csrf';

/** Mirrors authService's CSRF handling for this module's raw fetch. */
function csrfHeaders(): Record<string, string> {
  const m = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return m ? { 'x-csrf-token': decodeURIComponent(m[1]) } : {};
}

export type ChatTurn = { role: 'user' | 'assistant'; content: string };

export type ChatLocation = {
  lat: number;
  lng: number;
  label: string;
  confidence: 'exact' | 'approximate' | 'city';
};

export type ChatResponse = {
  reply: string;
  intent: 'report_complaint' | 'track_status' | 'emergency' | 'general_query' | 'feedback';
  category: string;
  priority: 'Low' | 'Medium' | 'High' | 'Critical';
  sentiment: 'Frustrated' | 'Neutral' | 'Polite' | 'Angry';
  locationText: string;
  readyToFile: boolean;
  missingInfo: string[];
  location: ChatLocation | null;
  provider?: string;
  degraded?: boolean;
  rateLimited?: boolean;
};

const OFFLINE: ChatResponse = {
  reply: 'The assistant is offline. Please describe your issue — we will still record it.',
  intent: 'report_complaint',
  category: 'General',
  priority: 'Medium',
  sentiment: 'Neutral',
  locationText: '',
  readyToFile: false,
  missingInfo: [],
  location: null,
  degraded: true,
};

/** Client-side guards mirroring the server so we never send junk. */
const MAX_MESSAGE_CHARS = 2000;
const MAX_HISTORY = 12;

export async function sendChat(
  message: string,
  history: ChatTurn[],
  coords?: { lat: number; lng: number } | null,
): Promise<ChatResponse> {
  const payload = {
    message: message.slice(0, MAX_MESSAGE_CHARS),
    history: history.slice(-MAX_HISTORY),
    coords: coords ?? null,
  };

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));

    if (res.status === 429 || res.status === 503 || res.status === 504) {
      return {
        ...OFFLINE,
        ...data,
        reply: data.message || data.reply || OFFLINE.reply,
        rateLimited: true,
        degraded: true,
      };
    }
    if (res.status === 401) {
      return { ...OFFLINE, reply: 'Your session expired. Please log in again.' };
    }
    if (!res.ok) return OFFLINE;

    return data as ChatResponse;
  } catch {
    return OFFLINE;
  }
}

/** Asks the browser for GPS once, resolving to null if denied/unavailable. */
export function getBrowserLocation(timeoutMs = 6000): Promise<{ lat: number; lng: number } | null> {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    const done = (v: { lat: number; lng: number } | null) => resolve(v);
    const timer = setTimeout(() => done(null), timeoutMs);
    navigator.geolocation.getCurrentPosition(
      pos => { clearTimeout(timer); done({ lat: pos.coords.latitude, lng: pos.coords.longitude }); },
      () => { clearTimeout(timer); done(null); },
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 300_000 },
    );
  });
}
