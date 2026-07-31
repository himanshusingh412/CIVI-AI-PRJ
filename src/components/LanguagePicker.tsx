import { useEffect, useRef, useState } from 'react';
import { Check, Globe } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import { LOCALES, localeOf } from '../i18n/locales';

/**
 * Language selector.
 *
 * A dropdown rather than the previous EN/HI segmented pair: twelve options
 * will not fit inline on a phone, and a native <select> cannot show each
 * name in its own script reliably across Android WebViews.
 *
 * Every option shows the native name first and the English name beneath.
 * Someone who cannot read the interface still needs to find their language
 * in it — that is the whole point of the control.
 */
export function LanguagePicker({ compact = false }: { compact?: boolean }) {
  const { lang, setLang, t } = useI18n();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const current = localeOf(lang);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('lang.label')}
        className="press flex items-center gap-2 h-10 px-3 rounded-xl bordered surface-2
                   text-content-2 hover:text-cta transition-colors"
      >
        <Globe size={16} aria-hidden="true" />
        <span className="text-[13px] font-bold">{current.native}</span>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={t('lang.label')}
          className="absolute end-0 mt-2 w-60 max-h-[min(70vh,26rem)] overflow-auto
                     surface bordered rounded-2xl elev-3 z-[120] p-1.5"
        >
          {LOCALES.map(l => {
            const active = l.code === lang;
            return (
              <button
                key={l.code}
                role="option"
                aria-selected={active}
                lang={l.code}
                dir={l.dir}
                onClick={() => { setLang(l.code); setOpen(false); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-start
                           hover:bg-[var(--color-surface-2)] transition-colors"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold text-content truncate">{l.native}</span>
                  <span className="block text-[11px] text-content-3 truncate">{l.english}</span>
                </span>
                {active && <Check size={16} className="shrink-0" style={{ color: 'var(--color-cta)' }} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}

      {!compact && <span className="sr-only">{current.english}</span>}
    </div>
  );
}
