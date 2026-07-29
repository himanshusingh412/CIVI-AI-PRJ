import { generateJson, Type } from './providers.js';
import { clampHistory, clampText, type ChatTurn } from './limits.js';

/** Known landmarks so the map can drop a pin without an external geocoder. */
const LANDMARKS: Record<string, { lat: number; lng: number }> = {
  'mg road': { lat: 28.6304, lng: 77.2177 },
  'connaught place': { lat: 28.6315, lng: 77.2167 },
  'sector 12': { lat: 28.5921, lng: 77.3120 },
  'sector 14': { lat: 28.6210, lng: 77.2100 },
  'sector 18': { lat: 28.5695, lng: 77.3210 },
  'park street': { lat: 28.6100, lng: 77.2200 },
  'karol bagh': { lat: 28.6519, lng: 77.1909 },
  'lajpat nagar': { lat: 28.5677, lng: 77.2433 },
  'saket': { lat: 28.5245, lng: 77.2066 },
  'dwarka': { lat: 28.5921, lng: 77.0460 },
  'rohini': { lat: 28.7495, lng: 77.0565 },
  'chandni chowk': { lat: 28.6506, lng: 77.2303 },
  'india gate': { lat: 28.6129, lng: 77.2295 },
  'nehru place': { lat: 28.5494, lng: 77.2500 },
  'vasant kunj': { lat: 28.5200, lng: 77.1591 },
  'janakpuri': { lat: 28.6219, lng: 77.0878 },
  'pitampura': { lat: 28.6942, lng: 77.1314 },
  'okhla': { lat: 28.5355, lng: 77.2730 },
  'noida': { lat: 28.5355, lng: 77.3910 },
  'gurgaon': { lat: 28.4595, lng: 77.0266 },
};

const CITY_CENTER = { lat: 28.6139, lng: 77.2090 }; // New Delhi

export type ChatReply = {
  reply: string;
  intent: 'report_complaint' | 'track_status' | 'emergency' | 'general_query' | 'feedback';
  category: string;
  priority: 'Low' | 'Medium' | 'High' | 'Critical';
  sentiment: 'Frustrated' | 'Neutral' | 'Polite' | 'Angry';
  locationText: string;
  readyToFile: boolean;
  missingInfo: string[];
};

export type ChatResponse = ChatReply & {
  location: { lat: number; lng: number; label: string; confidence: 'exact' | 'approximate' | 'city' } | null;
  provider: string;
  degraded: boolean;
};

const CATEGORIES = [
  'Road & Infrastructure', 'Water Supply', 'Electricity', 'Sanitation',
  'Law & Order', 'Public Transport', 'Parks & Recreation', 'General',
];

const SYSTEM = `You are CivicAI, an assistant for an Indian municipal citizen helpline.
Your job: understand the citizen's civic issue, ask for anything missing, and extract structured data.

Rules:
- Be warm, concise (max 2 short sentences in "reply"), and never invent facts.
- Category MUST be one of: ${CATEGORIES.join(', ')}.
- "locationText" = the exact place the citizen named (street, sector, landmark, area). Empty string if none given.
- Set "readyToFile" true only when you have BOTH a clear problem description AND a location.
- "missingInfo" lists what you still need, e.g. ["location"] or ["description"].
- For life-threatening situations set intent "emergency" and priority "Critical".
- Reply in the same language the citizen used (English or Hindi).`;

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    reply: { type: Type.STRING },
    intent: { type: Type.STRING, enum: ['report_complaint', 'track_status', 'emergency', 'general_query', 'feedback'] },
    category: { type: Type.STRING, enum: CATEGORIES },
    priority: { type: Type.STRING, enum: ['Low', 'Medium', 'High', 'Critical'] },
    sentiment: { type: Type.STRING, enum: ['Frustrated', 'Neutral', 'Polite', 'Angry'] },
    locationText: { type: Type.STRING },
    readyToFile: { type: Type.BOOLEAN },
    missingInfo: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ['reply', 'intent', 'category', 'priority', 'sentiment', 'locationText', 'readyToFile', 'missingInfo'],
};

const JSON_HINT =
  '{"reply":string,"intent":"report_complaint"|"track_status"|"emergency"|"general_query"|"feedback","category":string,"priority":"Low"|"Medium"|"High"|"Critical","sentiment":"Frustrated"|"Neutral"|"Polite"|"Angry","locationText":string,"readyToFile":boolean,"missingInfo":string[]}';

/** Maps free text to coordinates using the landmark table, with a jittered city fallback. */
export function resolveLocation(
  text: string,
  userCoords?: { lat: number; lng: number } | null,
): ChatResponse['location'] {
  const t = text.toLowerCase().trim();

  if (t) {
    for (const [name, coords] of Object.entries(LANDMARKS)) {
      if (t.includes(name)) {
        return { ...coords, label: text, confidence: 'exact' };
      }
    }
    // "sector 42" style — spread sectors around the city deterministically
    const sector = t.match(/sector\s*(\d{1,3})/);
    if (sector) {
      const n = Number(sector[1]);
      return {
        lat: CITY_CENTER.lat + ((n % 20) - 10) * 0.006,
        lng: CITY_CENTER.lng + ((Math.floor(n / 3) % 20) - 10) * 0.006,
        label: text,
        confidence: 'approximate',
      };
    }
  }

  // GPS from the browser beats any guess
  if (userCoords && Number.isFinite(userCoords.lat) && Number.isFinite(userCoords.lng)) {
    return { ...userCoords, label: text || 'Your current location', confidence: 'exact' };
  }

  if (!t) return null;
  return { ...CITY_CENTER, label: text, confidence: 'city' };
}

export async function handleChat(input: {
  message: unknown;
  history: unknown;
  coords?: { lat: number; lng: number } | null;
  sessionKey: string;
}): Promise<ChatResponse> {
  const message = clampText(input.message);
  const history: ChatTurn[] = clampHistory(input.history);

  const fallback: ChatReply = {
    reply: "I've noted that. Could you tell me the location of the issue?",
    intent: 'report_complaint',
    category: 'General',
    priority: 'Medium',
    sentiment: 'Neutral',
    locationText: '',
    readyToFile: false,
    missingInfo: ['location'],
  };

  const result = await generateJson<ChatReply>({
    system: SYSTEM,
    prompt: message,
    history,
    schema: SCHEMA,
    jsonHint: JSON_HINT,
    fallback,
  });

  const d = { ...fallback, ...result.data };
  // never trust the model on enum drift
  if (!CATEGORIES.includes(d.category)) d.category = 'General';

  return {
    ...d,
    reply: clampText(d.reply, 600),
    location: resolveLocation(clampText(d.locationText, 120), input.coords),
    provider: result.provider,
    degraded: result.degraded,
  };
}
