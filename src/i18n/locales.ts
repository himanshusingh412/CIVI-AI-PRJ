/**
 * The twelve languages CivicAI ships in.
 *
 * All twelve are scheduled languages under the Eighth Schedule of the
 * Constitution, chosen by number of speakers. Each is listed in its OWN
 * script, never transliterated: a Tamil speaker looks for "தமிழ்", not
 * "Tamil". A picker written entirely in English is a picker that the people
 * who most need it cannot use.
 */
export const LOCALES = [
  { code: 'en', native: 'English',   english: 'English',   dir: 'ltr' },
  { code: 'hi', native: 'हिन्दी',      english: 'Hindi',     dir: 'ltr' },
  { code: 'bn', native: 'বাংলা',      english: 'Bengali',   dir: 'ltr' },
  { code: 'mr', native: 'मराठी',      english: 'Marathi',   dir: 'ltr' },
  { code: 'te', native: 'తెలుగు',      english: 'Telugu',    dir: 'ltr' },
  { code: 'ta', native: 'தமிழ்',       english: 'Tamil',     dir: 'ltr' },
  { code: 'gu', native: 'ગુજરાતી',     english: 'Gujarati',  dir: 'ltr' },
  { code: 'kn', native: 'ಕನ್ನಡ',       english: 'Kannada',   dir: 'ltr' },
  { code: 'ml', native: 'മലയാളം',    english: 'Malayalam', dir: 'ltr' },
  { code: 'pa', native: 'ਪੰਜਾਬੀ',      english: 'Punjabi',   dir: 'ltr' },
  { code: 'or', native: 'ଓଡ଼ିଆ',       english: 'Odia',      dir: 'ltr' },
  // Urdu is right-to-left. This is the reason `dir` exists on this list at
  // all — the layout has to flip, not just the words.
  { code: 'ur', native: 'اردو',        english: 'Urdu',      dir: 'rtl' },
] as const;

export type LangType = (typeof LOCALES)[number]['code'];

export const LANG_CODES = LOCALES.map(l => l.code) as readonly LangType[];

export const DEFAULT_LANG: LangType = 'en';

export function isLang(v: unknown): v is LangType {
  return typeof v === 'string' && (LANG_CODES as readonly string[]).includes(v);
}

export function localeOf(code: LangType) {
  return LOCALES.find(l => l.code === code) ?? LOCALES[0];
}

/**
 * Best match for the browser's preferred languages.
 *
 * navigator.languages gives region-tagged tags like "ta-IN"; we only care
 * about the base subtag. Falls back to English rather than guessing.
 */
export function detectLang(): LangType {
  if (typeof navigator === 'undefined') return DEFAULT_LANG;
  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = String(tag).split('-')[0].toLowerCase();
    if (isLang(base)) return base;
  }
  return DEFAULT_LANG;
}
