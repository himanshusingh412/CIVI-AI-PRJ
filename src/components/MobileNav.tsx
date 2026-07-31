import { MessageSquare, LayoutDashboard, Search, TrendingUp } from 'lucide-react';
import type { ViewType } from '../types';
import { useT } from '../i18n/I18nContext';
import type { StringKey } from '../i18n/strings';

/**
 * Bottom navigation for viewports below `lg`, where the sidebar is hidden.
 *
 * Without this the app had no navigation at all on phones and tablets —
 * every view except the default was unreachable.
 *
 * Follows the platform conventions: max 5 destinations, always icon + label
 * (never icon-only), current item marked with aria-current, 44px+ targets,
 * and safe-area padding so it clears the iOS home indicator.
 */

// Labels are dictionary keys, not literals. This component previously
// carried its own inline Hindi strings, which is how it ended up pinned to
// a two-language union while the rest of the app moved to twelve.
const ITEMS: { view: ViewType; key: StringKey; Icon: typeof MessageSquare }[] = [
  { view: 'chat', key: 'nav.chat', Icon: MessageSquare },
  { view: 'dashboard', key: 'nav.dashboard', Icon: LayoutDashboard },
  { view: 'track', key: 'nav.track', Icon: Search },
  { view: 'public_feed', key: 'nav.feed', Icon: TrendingUp },
];

export function MobileNav({
  view,
  onNavigate,
  pendingCount,
}: {
  view: ViewType;
  onNavigate: (v: ViewType) => void;
  pendingCount: number;
}) {
  const t = useT();
  return (
    <nav
      aria-label="Primary"
      className="lg:hidden fixed bottom-0 inset-x-0 glass border-t"
      style={{
        borderColor: 'var(--color-border)',
        zIndex: 'var(--z-nav)' as any,
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      <ul className="grid grid-cols-4">
        {ITEMS.map(({ view: v, key, Icon }) => {
          const label = t(key);
          const active = view === v;
          return (
            <li key={v}>
              <button
                onClick={() => onNavigate(v)}
                aria-current={active ? 'page' : undefined}
                aria-label={label}
                className="press relative w-full min-h-[56px] flex flex-col items-center justify-center gap-1 pt-2 pb-1.5"
                style={{ color: active ? 'var(--color-cta)' : 'var(--color-content-3)' }}
              >
                <span className="relative">
                  <Icon size={21} aria-hidden="true" />
                  {v === 'dashboard' && pendingCount > 0 && (
                    <span
                      aria-hidden="true"
                      className="absolute -top-1 -right-2 min-w-[16px] h-4 px-1 rounded-full
                                 text-[10px] font-black grid place-items-center text-white bg-saffron"
                    >
                      {pendingCount > 9 ? '9+' : pendingCount}
                    </span>
                  )}
                </span>
                <span className="text-[11px] font-bold leading-none">
                  {label}
                </span>
                {/* Active pill grows from the centre — spatial, not decorative. */}
                <span
                  aria-hidden="true"
                  className="absolute top-0 h-[3px] w-8 rounded-full bg-cta origin-center"
                  style={{
                    transform: active ? 'scaleX(1)' : 'scaleX(0)',
                    transition: 'transform var(--dur-normal) var(--ease-spring)',
                  }}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
