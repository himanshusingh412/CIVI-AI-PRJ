import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, Bell, BellOff, Check, Mail, MessageCircle, Smartphone,
} from 'lucide-react';
import { Button } from '../components/Button';
import { IntegrationBadge } from '../components/IntegrationBadge';
import { useConfig } from '../context/ConfigContext';
import { useI18n } from '../i18n/I18nContext';

/**
 * /portal/settings — notification preferences and the in-app inbox.
 *
 * =========================================================================
 * Every switch here tells the truth about what it costs
 * =========================================================================
 * SMS is billed per message and WhatsApp has policy limits that mean some
 * updates simply cannot be delivered outside a 24-hour window. A settings
 * screen that presents four identical toggles implies four equivalent
 * channels, and the person only discovers otherwise when a message they
 * were expecting never arrives.
 *
 * So each row says what it actually is, and shows the deployment's real
 * mode for that channel from /api/config rather than a decorative tick.
 *
 * In-app has no toggle. It is not a message pushed at anybody — it is the
 * tracking page they already came to look at — and making it optional would
 * let someone switch off the only guaranteed record of their own complaint.
 */

type Preferences = {
  in_app: true;
  email: boolean;
  sms: boolean;
  whatsapp: boolean;
  mutedAll: boolean;
};

type Notification = {
  id: string;
  title: string;
  body: string;
  complaintId: string;
  at: string;
  read: boolean;
};

const csrf = (): Record<string, string> => {
  const m = document.cookie.match(/(?:^|; )civicai_csrf=([^;]*)/);
  return m ? { 'x-csrf-token': decodeURIComponent(m[1]) } : {};
};

export function NotificationSettingsPage() {
  const { t } = useI18n();
  const { modeOf } = useConfig();
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [items, setItems] = useState<Notification[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications', { credentials: 'same-origin' });
      if (!res.ok) throw new Error('load failed');
      const body = await res.json();
      setPrefs(body.preferences);
      setItems(body.notifications ?? []);
    } catch {
      setError('Could not load your notification settings.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const update = async (patch: Partial<Preferences>) => {
    const key = Object.keys(patch)[0];
    setSaving(key); setError(null);
    // Optimistic: a toggle that waits for a round trip before moving feels
    // broken, and this request cannot fail in a way the user must act on.
    setPrefs(p => (p ? { ...p, ...patch } : p));
    try {
      const res = await fetch('/api/notifications/preferences', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...csrf() },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error('save failed');
      setPrefs((await res.json()).preferences);
    } catch {
      setError('That change could not be saved. Please try again.');
      void load();
    } finally {
      setSaving(null);
    }
  };

  const markAllRead = async () => {
    await fetch('/api/notifications/read', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...csrf() }, body: '{}',
    });
    void load();
  };

  const channels = [
    {
      key: 'whatsapp' as const, label: 'WhatsApp', Icon: MessageCircle,
      integration: 'whatsapp',
      detail:
        'Free to receive. Some updates can only be sent within 24 hours of your last ' +
        'message, so occasionally you will see it in the app first.',
    },
    {
      key: 'sms' as const, label: 'SMS', Icon: Smartphone,
      integration: 'sms',
      detail:
        'Works on any phone with no internet. Standard carrier charges may apply to you, ' +
        'and each message costs the department money — so only the important updates are sent.',
    },
    {
      key: 'email' as const, label: 'Email', Icon: Mail,
      integration: 'email',
      detail: 'The fullest version of each update, including anything the officer wrote.',
    },
  ];

  const unread = items.filter(i => !i.read).length;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--color-bg-main)', color: 'var(--color-content)' }}>
      <a href="#settings-main" className="sr-only-focusable">{t('nav.skipToMain')}</a>

      <header className="h-14 shrink-0 glass border-b flex items-center gap-2 px-3 sm:px-5"
              style={{ borderColor: 'var(--color-border)' }}>
        <Link to="/portal" className="press w-9 h-9 rounded-xl grid place-items-center text-content-3 hover:text-cta transition-colors"
              aria-label="Back to CivicAI">
          <ArrowLeft size={17} aria-hidden="true" />
        </Link>
        <h1 className="font-display font-bold text-[15px]">Notifications</h1>
      </header>

      <main id="settings-main" tabIndex={-1} className="flex-1 focus:outline-none">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-6">
          {error && (
            <div role="alert" className="rounded-xl p-3 text-[13px] flex items-start gap-2"
                 style={{ background: 'var(--color-danger-pale)', color: 'var(--color-danger)' }}>
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <section>
            <h2 className="font-display font-bold text-xl tracking-tight">How we reach you</h2>
            <p className="text-[13.5px] text-content-3 mt-1.5 leading-relaxed">
              Everything below is off until you switch it on. You will always be able to see
              updates in CivicAI itself, whatever you choose here.
            </p>

            <div className="mt-5 rounded-2xl bordered surface divide-y" style={{ borderColor: 'var(--color-border)' }}>
              {/* Not a toggle, and shown first so its permanence is obvious. */}
              <div className="p-4 flex items-start gap-3">
                <Bell size={17} className="mt-0.5 shrink-0" style={{ color: 'var(--color-cta)' }} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-bold text-content">In the app</p>
                  <p className="text-[12.5px] text-content-3 mt-0.5 leading-relaxed">
                    Always on. This is the record of your complaint, not a message we push at you.
                  </p>
                </div>
                <span className="text-[11px] font-bold uppercase tracking-wide shrink-0 mt-1"
                      style={{ color: 'var(--color-success)' }}>
                  Always
                </span>
              </div>

              {channels.map(c => (
                <div key={c.key} className="p-4 flex items-start gap-3">
                  <c.Icon size={17} className="mt-0.5 shrink-0" style={{ color: 'var(--color-content-3)' }} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-bold text-content flex items-center gap-2 flex-wrap">
                      {c.label}
                      <IntegrationBadge integrationKey={c.integration} size="xs" />
                    </p>
                    <p className="text-[12.5px] text-content-3 mt-0.5 leading-relaxed">{c.detail}</p>
                    {modeOf(c.integration) === 'demo' && (
                      <p className="text-[11.5px] mt-1.5 leading-relaxed" style={{ color: 'var(--color-info)' }}>
                        This deployment simulates {c.label}. Switching it on records what would
                        have been sent; nothing reaches your phone.
                      </p>
                    )}
                  </div>
                  <Toggle
                    label={`${c.label} notifications`}
                    checked={!!prefs?.[c.key] && !prefs?.mutedAll}
                    disabled={!prefs || prefs.mutedAll || saving === c.key}
                    onChange={v => update({ [c.key]: v } as Partial<Preferences>)}
                  />
                </div>
              ))}

              <div className="p-4 flex items-start gap-3">
                <BellOff size={17} className="mt-0.5 shrink-0" style={{ color: 'var(--color-content-3)' }} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-bold text-content">Pause everything</p>
                  <p className="text-[12.5px] text-content-3 mt-0.5 leading-relaxed">
                    Stops every message without forgetting your choices above. Your complaints
                    carry on being worked either way.
                  </p>
                </div>
                <Toggle
                  label="Pause all notifications"
                  checked={!!prefs?.mutedAll}
                  disabled={!prefs || saving === 'mutedAll'}
                  onChange={v => update({ mutedAll: v })}
                />
              </div>
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-display font-bold text-xl tracking-tight">
                Recent updates{unread > 0 && <span className="text-[13px] font-semibold text-content-3"> · {unread} unread</span>}
              </h2>
              {unread > 0 && (
                <Button size="sm" variant="ghost" onClick={markAllRead}>Mark all read</Button>
              )}
            </div>

            {items.length === 0 ? (
              <p className="text-[13px] text-content-3 rounded-2xl bordered surface p-6 text-center">
                Nothing yet. Updates about your complaints will appear here.
              </p>
            ) : (
              <ul className="space-y-2">
                {items.map(n => (
                  <li key={n.id} className="rounded-2xl bordered surface p-4"
                      style={n.read ? undefined : { borderColor: 'var(--color-cta)' }}>
                    <div className="flex items-start gap-2">
                      {!n.read && (
                        <span aria-label="Unread" className="w-2 h-2 rounded-full mt-1.5 shrink-0"
                              style={{ background: 'var(--color-cta)' }} />
                      )}
                      <div className="min-w-0">
                        <p className="text-[13.5px] font-bold text-content">{n.title}</p>
                        <p className="text-[12.5px] text-content-2 mt-1 leading-relaxed whitespace-pre-line">{n.body}</p>
                        <p className="text-[11px] text-content-3 mt-1.5 font-mono">
                          {n.complaintId} · {new Date(n.at).toLocaleString('en-IN')}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

/** A switch that is a real checkbox underneath, so it is keyboard-operable
 *  and announced correctly without any aria plumbing. */
function Toggle({
  label, checked, disabled, onChange,
}: { label: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={`shrink-0 mt-0.5 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <span className="sr-only">{label}</span>
      <input
        type="checkbox" role="switch" className="sr-only peer"
        checked={checked} disabled={disabled}
        onChange={e => onChange(e.target.checked)}
      />
      <span
        aria-hidden="true"
        className="block w-11 h-6 rounded-full transition-colors relative
                   peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2"
        style={{ background: checked ? 'var(--color-cta)' : 'var(--color-surface-3)' }}
      >
        <span
          className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all"
          style={{ left: checked ? '1.375rem' : '0.125rem' }}
        />
      </span>
    </label>
  );
}
