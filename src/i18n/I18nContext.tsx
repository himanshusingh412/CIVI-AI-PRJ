import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_LANG, detectLang, isLang, localeOf, type LangType } from './locales';
import { STRINGS, type StringKey } from './strings';

/**
 * Translation for the citizen-facing app.
 *
 * Deliberately hand-rolled rather than pulling in i18next: this app needs
 * lookup with fallback and a document direction flip, which is ~40 lines.
 * A 40 kB dependency for that would cost more than it returns on a portal
 * whose users are largely on slow mobile connections.
 */
const STORAGE_KEY = 'civicai.lang';

interface I18nValue {
  lang: LangType;
  setLang: (l: LangType) => void;
  /** Translate. Unknown keys return the English string, then the key itself. */
  t: (key: StringKey, fallback?: string) => string;
  dir: 'ltr' | 'rtl';
}

const I18nContext = createContext<I18nValue | null>(null);

function initialLang(): LangType {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLang(saved)) return saved;
  } catch {
    // Private browsing can throw on localStorage access; fall through.
  }
  return detectLang();
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<LangType>(initialLang);

  const dir = localeOf(lang).dir as 'ltr' | 'rtl';

  /**
   * Reflect the choice onto <html>. `lang` drives screen-reader pronunciation
   * and font selection; `dir` flips the whole layout for Urdu. Setting these
   * on the document rather than a wrapper div means native form controls and
   * scrollbars flip too.
   */
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);

  const setLang = useCallback((l: LangType) => {
    setLangState(l);
    try { localStorage.setItem(STORAGE_KEY, l); } catch { /* non-fatal */ }
  }, []);

  const t = useCallback(
    (key: StringKey, fallback?: string) =>
      STRINGS[lang]?.[key] ?? STRINGS[DEFAULT_LANG][key] ?? fallback ?? key,
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t, dir }), [lang, setLang, t, dir]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}

/** Convenience for the common case. */
export function useT() {
  return useI18n().t;
}
