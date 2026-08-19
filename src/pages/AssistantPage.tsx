import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, Check, ChevronRight, FileSearch, Info, Loader2,
  MapPin, MessageSquarePlus, Mic, MicOff, Moon, PanelLeft, PanelRight,
  Send, Sparkles, Square, Sun, Trash2, Volume2, X,
} from 'lucide-react';
import { Button } from '../components/Button';
import { LanguagePicker } from '../components/LanguagePicker';
import { IntegrationBadge } from '../components/IntegrationBadge';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useI18n } from '../i18n/I18nContext';
import { useVoice } from '../hooks/useVoice';
import { sendChat, getBrowserLocation, type ChatTurn } from '../services/chatService';
import { createComplaint } from '../services/complaintService';
import {
  createConversation, deleteConversation, getConversation, listConversations,
  newId, saveConversation, titleFrom,
  type AssistantMessage, type Conversation,
} from '../services/conversationStore';

/**
 * /portal/assistant — the assistant as a place, not a tab.
 *
 * It used to be one view inside the citizen dashboard, sharing that screen's
 * chrome and its fixed bottom navigation. That framing was wrong in a way
 * that showed: a conversation needs vertical room and a stable input at the
 * bottom, and it was competing for both with a nav bar. It also had nowhere
 * to put the two things a conversation actually needs beside it — what came
 * before, and what the system currently believes.
 *
 * Hence three panels:
 *   left    identity, history, a way to start over, suggested openings
 *   centre  the conversation and its input
 *   right   what the assistant has understood, and what it still needs
 *
 * The right panel is the important one. An assistant that quietly builds a
 * structured record while you talk should show you that record, so a wrong
 * category or a missed location is caught by the person who knows, before
 * anything is filed.
 *
 * On narrow screens both side panels become overlay drawers; the centre
 * column never shrinks below full width.
 */

const SUGGESTIONS = [
  'There has been no water supply in my area for three days.',
  'I want to apply for an income certificate — what do I need?',
  'A streetlight outside my house has been broken for two weeks.',
  'How do I check the status of a complaint I filed last month?',
] as const;

/** Category → the services worth surfacing beside it. Advisory, never a promise. */
const RELATED_SERVICES: Record<string, string[]> = {
  'Water Supply': ['New water connection', 'Water quality testing request', 'Billing dispute'],
  'Road & Infrastructure': ['Pothole repair', 'Street name / signage request', 'Drainage desilting'],
  Electricity: ['New electricity connection', 'Meter fault report', 'Streetlight repair'],
  Sanitation: ['Garbage collection schedule', 'Public toilet maintenance', 'Drain cleaning'],
  'Law & Order': ['Police station locator', 'Women safety helpline', 'Noise complaint'],
  'Public Transport': ['Bus route information', 'Bus stop maintenance', 'Fare complaint'],
  'Parks & Recreation': ['Park maintenance', 'Tree pruning request', 'Playground repair'],
  General: ['Income certificate', 'Residence certificate', 'Birth / death certificate'],
};

const MAX_CHARS = 2000;
const MAX_HISTORY = 12;

type Understanding = NonNullable<AssistantMessage['meta']>;

export function AssistantPage() {
  const { lang, t } = useI18n();
  const { isDark, toggleTheme } = useTheme();
  const { identity } = useAuth();
  const navigate = useNavigate();

  const [conversations, setConversations] = useState<Conversation[]>(() => listConversations());
  const [active, setActive] = useState<Conversation>(() => createConversation());
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [understanding, setUnderstanding] = useState<Understanding | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [filing, setFiling] = useState(false);
  const [filed, setFiled] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  /** Read replies aloud only after the user has used voice at least once. */
  const [autoSpeak, setAutoSpeak] = useState(false);

  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ───────────────────────── voice ─────────────────────────
  const handleTranscript = useCallback((text: string) => {
    setAutoSpeak(true);
    // Append rather than replace: someone may dictate in two goes, or type
    // half a sentence and speak the rest.
    setInput(prev => (prev ? `${prev.trim()} ${text}` : text).slice(0, MAX_CHARS));
    inputRef.current?.focus();
  }, []);

  const voice = useVoice({ lang, onTranscript: handleTranscript });

  // GPS improves location resolution; failure is silent and harmless.
  useEffect(() => { void getBrowserLocation().then(setCoords); }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [active.messages.length, thinking]);

  // ───────────────────────── conversation plumbing ─────────────────────────
  const persist = useCallback((conv: Conversation) => {
    // Never persist an empty shell — an unused "New conversation" in the
    // sidebar is clutter the user did not create.
    if (conv.messages.length) {
      saveConversation(conv);
      setConversations(listConversations());
    }
  }, []);

  const startNew = useCallback(() => {
    persist(active);
    setActive(createConversation());
    setUnderstanding(null);
    setFiled(null);
    setFileError(null);
    setInput('');
    setLeftOpen(false);
    voice.stopSpeaking();
  }, [active, persist, voice]);

  const openConversation = useCallback((id: string) => {
    persist(active);
    const found = getConversation(id);
    if (!found) return;
    setActive(found);
    // Restore the last understanding so the context panel is not blank when
    // you come back to a conversation you were part-way through.
    const lastMeta = [...found.messages].reverse().find(m => m.meta)?.meta ?? null;
    setUnderstanding(lastMeta);
    setFiled(null);
    setLeftOpen(false);
    voice.stopSpeaking();
  }, [active, persist, voice]);

  const removeConversation = useCallback((id: string) => {
    deleteConversation(id);
    setConversations(listConversations());
    if (id === active.id) {
      setActive(createConversation());
      setUnderstanding(null);
    }
  }, [active.id]);

  // Persist on unmount so leaving mid-conversation does not lose it.
  const activeRef = useRef(active);
  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => () => {
    if (activeRef.current.messages.length) saveConversation(activeRef.current);
  }, []);

  // ───────────────────────── sending ─────────────────────────
  const send = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text || thinking) return;

    voice.stopSpeaking();
    setInput('');
    setFileError(null);

    const userMsg: AssistantMessage = {
      id: newId(), role: 'user', content: text.slice(0, MAX_CHARS), at: new Date().toISOString(),
    };

    const withUser: Conversation = {
      ...active,
      title: active.messages.length ? active.title : titleFrom(text),
      messages: [...active.messages, userMsg],
    };
    setActive(withUser);
    setThinking(true);

    const history: ChatTurn[] = withUser.messages
      .slice(-MAX_HISTORY)
      .map(m => ({ role: m.role, content: m.content }));

    const res = await sendChat(text, history.slice(0, -1), coords);

    const meta: Understanding = {
      category: res.category,
      priority: res.priority,
      intent: res.intent,
      missingInfo: res.missingInfo ?? [],
      readyToFile: res.readyToFile,
      locationLabel: res.location?.label,
      provider: res.provider,
      degraded: res.degraded,
    };

    const botMsg: AssistantMessage = {
      id: newId(), role: 'assistant', content: res.reply, at: new Date().toISOString(), meta,
    };

    const next: Conversation = { ...withUser, messages: [...withUser.messages, botMsg] };
    setActive(next);
    persist(next);
    setUnderstanding(meta);
    setThinking(false);

    // Only speak back to someone who spoke to us. Reading every reply aloud
    // to a person typing on a bus is an unpleasant surprise.
    if (autoSpeak && voice.speechSupported) voice.speak(res.reply);
  }, [active, coords, thinking, persist, voice, autoSpeak]);

  // ───────────────────────── filing ─────────────────────────
  const fileComplaint = useCallback(async () => {
    const description = [...active.messages].filter(m => m.role === 'user').map(m => m.content).join(' ');
    if (!description) return;

    setFiling(true);
    setFileError(null);
    try {
      const { complaint } = await createComplaint({
        category: understanding?.category ?? 'General',
        description,
        priority: (understanding?.priority as any) ?? 'Medium',
        ...(coords ? { lat: coords.lat, lng: coords.lng } : {}),
        ...(understanding?.locationLabel ? { ward: understanding.locationLabel } : {}),
      } as any);
      setFiled(complaint.id);
    } catch (err) {
      setFileError(err instanceof Error ? err.message : 'Could not file the complaint.');
    } finally {
      setFiling(false);
    }
  }, [active.messages, understanding, coords]);

  const relatedServices = useMemo(
    () => RELATED_SERVICES[understanding?.category ?? 'General'] ?? RELATED_SERVICES.General,
    [understanding?.category],
  );

  const empty = active.messages.length === 0;

  return (
    <div
      className="h-screen flex flex-col overflow-hidden"
      style={{ background: 'var(--color-bg-main)', color: 'var(--color-content)' }}
    >
      <a href="#assistant-main" className="sr-only-focusable">{t('nav.skipToMain')}</a>

      {/* ───────────── header — deliberately its own, not the dashboard's ───────────── */}
      <header
        className="h-14 shrink-0 glass border-b flex items-center gap-2 px-3 sm:px-4"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <Link
          to="/portal"
          className="press w-9 h-9 rounded-xl grid place-items-center text-content-3 hover:text-cta transition-colors"
          aria-label="Back to CivicAI"
        >
          <ArrowLeft size={17} aria-hidden="true" />
        </Link>

        <button
          onClick={() => setLeftOpen(o => !o)}
          className="press lg:hidden w-9 h-9 rounded-xl grid place-items-center text-content-3 hover:text-cta transition-colors"
          aria-label="Conversation history"
          aria-expanded={leftOpen}
        >
          <PanelLeft size={17} aria-hidden="true" />
        </button>

        {/*
          Everything in this header is allowed to shrink or disappear except
          the two things that must not: the way back, and the way to speak.
          `min-w-0` on the title block is what lets `truncate` work at all —
          a flex child defaults to min-width:auto and refuses to shrink below
          its content, which is precisely how this header overflowed at
          390px and pushed the language picker off the screen.
        */}
        <div className="min-w-0 flex items-center gap-2 overflow-hidden">
          <span
            aria-hidden="true"
            className="w-8 h-8 rounded-xl grid place-items-center shrink-0"
            style={{ background: 'var(--color-cta)', color: '#fff' }}
          >
            <Sparkles size={15} />
          </span>
          <span className="min-w-0 hidden sm:block">
            <span className="block font-display font-bold text-[15px] leading-none truncate">
              CivicAI Assistant
            </span>
            <span className="block text-[10px] font-bold uppercase tracking-widest text-content-3 truncate">
              {t('app.tagline')}
            </span>
          </span>
          <span className="sm:hidden font-display font-bold text-[15px] leading-none truncate">
            Assistant
          </span>
        </div>

        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          {/* Status belongs beside the thing whose status it is; on a phone
              there is no room, and the context panel carries it instead. */}
          <span className="hidden sm:inline-flex">
            <IntegrationBadge integrationKey="ai" size="xs" />
          </span>
          <LanguagePicker compact />
          <button
            onClick={toggleTheme}
            aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
            className="press hidden sm:grid w-9 h-9 rounded-xl place-items-center text-content-3 hover:text-cta transition-colors"
          >
            {isDark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
          </button>
          <button
            onClick={() => setRightOpen(o => !o)}
            className="press xl:hidden w-9 h-9 rounded-xl grid place-items-center text-content-3 hover:text-cta transition-colors"
            aria-label="What the assistant understood"
            aria-expanded={rightOpen}
          >
            <PanelRight size={17} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex">
        {/* ───────────── left panel ───────────── */}
        <SidePanel side="left" open={leftOpen} onClose={() => setLeftOpen(false)} className="lg:flex">
          <div className="p-3.5 border-b" style={{ borderColor: 'var(--color-border)' }}>
            <p className="text-[13px] text-content-2 leading-relaxed">
              I can explain what a government service needs, help you describe a
              problem clearly, and file it with the right department.
            </p>
            <p className="text-[11.5px] text-content-3 leading-relaxed mt-2">
              I will say so when I don’t know something rather than guessing, and
              I never change your documents.
            </p>
          </div>

          <div className="p-3">
            <Button fullWidth size="sm" variant="secondary" icon={<MessageSquarePlus size={14} />} onClick={startNew}>
              New conversation
            </Button>
          </div>

          <nav className="flex-1 overflow-y-auto px-2 pb-3" aria-label="Conversation history">
            {conversations.length === 0 ? (
              <p className="text-[12px] text-content-3 px-2 py-3 leading-relaxed">
                Your past conversations appear here. They stay on this device
                and are not sent anywhere unless you file a complaint.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {conversations.map(c => (
                  <li key={c.id} className="group relative">
                    <button
                      onClick={() => openConversation(c.id)}
                      aria-current={c.id === active.id ? 'true' : undefined}
                      className="w-full text-left rounded-lg px-2.5 py-2 pr-8 transition-colors"
                      style={{
                        background: c.id === active.id ? 'var(--color-surface-2)' : 'transparent',
                      }}
                    >
                      <span className="block text-[12.5px] font-semibold text-content truncate">
                        {c.title}
                      </span>
                      <span className="block text-[10.5px] text-content-3 mt-0.5">
                        {new Date(c.updatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                        {' · '}
                        {c.messages.length} message{c.messages.length === 1 ? '' : 's'}
                      </span>
                    </button>
                    <button
                      onClick={() => removeConversation(c.id)}
                      aria-label={`Delete conversation: ${c.title}`}
                      className="absolute right-1 top-2 w-7 h-7 rounded-lg grid place-items-center
                                 text-content-3 opacity-0 group-hover:opacity-100 focus:opacity-100
                                 hover:text-danger transition-opacity"
                    >
                      <Trash2 size={13} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </nav>

          <div className="p-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
            <p className="text-[10px] font-bold uppercase tracking-widest text-content-3 mb-2">
              Try asking
            </p>
            <div className="space-y-1.5">
              {SUGGESTIONS.slice(0, 3).map(s => (
                <button
                  key={s}
                  onClick={() => { setLeftOpen(false); void send(s); }}
                  className="press w-full text-left text-[11.5px] leading-snug rounded-lg p-2 bordered
                             surface hover:border-[var(--color-cta)] text-content-2 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </SidePanel>

        {/* ───────────── centre: the conversation ───────────── */}
        <main id="assistant-main" tabIndex={-1} className="flex-1 min-w-0 flex flex-col focus:outline-none">
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 flex flex-col">
            {/* mt-auto bottom-anchors a short transcript; once it overflows,
                the scroll container takes over and this has no effect. */}
            <div className="max-w-2xl mx-auto w-full mt-auto">
              {empty ? (
                <EmptyState onPick={s => void send(s)} name={identity?.displayName} />
              ) : (
                <ol className="space-y-4">
                  {active.messages.map(m => (
                    <li key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                      <div
                        className="max-w-[85%] rounded-2xl px-4 py-3"
                        style={
                          m.role === 'user'
                            ? { background: 'var(--color-cta)', color: '#fff' }
                            : { background: 'var(--color-surface)', border: '1px solid var(--color-border)' }
                        }
                      >
                        <p className="text-[14px] leading-relaxed whitespace-pre-wrap">{m.content}</p>
                        {m.role === 'assistant' && (
                          <div className="flex items-center gap-2 mt-2">
                            {m.meta?.degraded && (
                              <span
                                className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide"
                                style={{ color: 'var(--color-warning)' }}
                              >
                                <AlertTriangle size={10} aria-hidden="true" /> Fallback answer
                              </span>
                            )}
                            {voice.speechSupported && (
                              <button
                                onClick={() => voice.speak(m.content)}
                                className="text-[10px] font-bold uppercase tracking-wide text-content-3 hover:text-cta
                                           inline-flex items-center gap-1 transition-colors"
                                aria-label="Read this answer aloud"
                              >
                                <Volume2 size={11} aria-hidden="true" /> Listen
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              )}

              {thinking && (
                <div className="flex justify-start mt-4" role="status" aria-live="polite">
                  <div
                    className="rounded-2xl px-4 py-3 flex items-center gap-2"
                    style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
                  >
                    <Loader2 size={14} className="animate-spin" style={{ color: 'var(--color-cta)' }} aria-hidden="true" />
                    <span className="text-[13px] text-content-3">Thinking…</span>
                  </div>
                </div>
              )}

              {/*
                On narrow screens the context panel is a drawer, so the one
                action that matters — actually filing — would be hidden
                behind a panel toggle at the exact moment the user is ready.
                Surfaced inline below `xl`, where the panel is not visible.
              */}
              {understanding?.readyToFile && !filed && (
                <div className="xl:hidden mt-4 rounded-2xl p-4 bordered surface">
                  <p className="text-[12.5px] text-content-2 leading-relaxed">
                    Ready to file as{' '}
                    <strong className="text-content">{understanding.category}</strong>
                    {understanding.locationLabel ? <> in <strong className="text-content">{understanding.locationLabel}</strong></> : null}
                    {' · '}
                    {understanding.priority} urgency.
                  </p>
                  <Button
                    className="mt-3"
                    fullWidth
                    size="sm"
                    loading={filing}
                    loadingText="Filing…"
                    onClick={fileComplaint}
                  >
                    File this complaint
                  </Button>
                  {fileError && (
                    <p className="text-[11.5px] mt-2 leading-relaxed" style={{ color: 'var(--color-danger)' }}>
                      {fileError}
                    </p>
                  )}
                  <button
                    onClick={() => setRightOpen(true)}
                    className="text-[11.5px] font-bold text-content-3 hover:text-cta mt-2 inline-flex items-center gap-1"
                  >
                    Review the details first <ChevronRight size={11} aria-hidden="true" />
                  </button>
                </div>
              )}

              {filed && (
                <div
                  className="xl:hidden mt-4 rounded-2xl p-4"
                  style={{ background: 'var(--color-success-pale)' }}
                >
                  <p className="text-[12.5px] font-bold flex items-center gap-1.5" style={{ color: 'var(--color-success)' }}>
                    <Check size={14} aria-hidden="true" /> Complaint filed
                  </p>
                  <p className="font-mono text-[14px] font-bold mt-1 text-content">{filed}</p>
                  <Link to="/portal" className="text-[12px] font-bold underline underline-offset-2 mt-2 inline-block" style={{ color: 'var(--color-success)' }}>
                    Track it
                  </Link>
                </div>
              )}

              <div ref={endRef} />
            </div>
          </div>

          {/* ───────────── composer ───────────── */}
          <div
            className="shrink-0 border-t px-4 sm:px-6 py-3"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
          >
            <div className="max-w-2xl mx-auto">
              {voice.error && (
                <div
                  role="status"
                  className="flex items-start gap-2 rounded-xl p-2.5 mb-2 text-[12px]"
                  style={{ background: 'var(--color-warning-pale)', color: 'var(--color-warning)' }}
                >
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span className="flex-1 leading-relaxed">{voice.error}</span>
                  <button onClick={voice.clearError} aria-label="Dismiss" className="shrink-0">
                    <X size={13} aria-hidden="true" />
                  </button>
                </div>
              )}

              {voice.listening && (
                <div
                  role="status"
                  aria-live="polite"
                  className="flex items-center gap-2.5 rounded-xl p-2.5 mb-2"
                  style={{ background: 'var(--color-info-pale)', color: 'var(--color-info)' }}
                >
                  <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
                    <span className="animate-ping absolute h-full w-full rounded-full opacity-75" style={{ background: 'currentColor' }} />
                    <span className="relative rounded-full h-2.5 w-2.5" style={{ background: 'currentColor' }} />
                  </span>
                  <span className="text-[12px] font-semibold">
                    {voice.interim || 'Listening… speak now'}
                  </span>
                  <button onClick={voice.stop} className="ml-auto text-[11px] font-bold uppercase tracking-wide">
                    Stop
                  </button>
                </div>
              )}

              {voice.speaking && (
                <div className="flex items-center gap-2 mb-2">
                  <Button size="sm" variant="ghost" icon={<Square size={12} />} onClick={voice.stopSpeaking}>
                    Stop speaking
                  </Button>
                </div>
              )}

              <div className="flex items-end gap-2">
                <label htmlFor="assistant-input" className="sr-only">Message the assistant</label>
                <textarea
                  id="assistant-input"
                  ref={inputRef}
                  rows={1}
                  value={input}
                  onChange={e => setInput(e.target.value.slice(0, MAX_CHARS))}
                  onKeyDown={e => {
                    // Enter sends; Shift+Enter is a newline. On touch devices the
                    // on-screen keyboard's return key inserts a newline instead,
                    // which is why the send button is never hidden.
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void send(input);
                    }
                  }}
                  /*
                    Short enough to fit one line at 390px. The previous
                    placeholder wrapped to two lines inside a 46px-tall box
                    and was visibly cut in half on a phone.
                  */
                  placeholder="Describe your issue…"
                  className="flex-1 resize-none rounded-xl px-3.5 py-3 text-[14px] bordered
                             surface-2 text-content placeholder:text-[var(--color-content-3)]
                             focus:outline-none focus:border-[var(--color-cta)] max-h-40
                             focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-cta)_18%,transparent)]
                             overflow-hidden"
                  style={{ minHeight: '46px' }}
                />

                {voice.supported && (
                  <button
                    onClick={voice.toggle}
                    disabled={voice.state === 'denied'}
                    aria-label={voice.listening ? 'Stop listening' : 'Speak your message'}
                    aria-pressed={voice.listening}
                    className="press w-[46px] h-[46px] shrink-0 rounded-xl grid place-items-center
                               transition-colors disabled:opacity-40"
                    style={
                      voice.listening
                        ? { background: 'var(--color-danger)', color: '#fff' }
                        : { background: 'var(--color-surface-2)', color: 'var(--color-content-2)', border: '1px solid var(--color-border-strong)' }
                    }
                  >
                    {voice.state === 'denied'
                      ? <MicOff size={18} aria-hidden="true" />
                      : <Mic size={18} aria-hidden="true" />}
                  </button>
                )}

                <button
                  onClick={() => void send(input)}
                  disabled={!input.trim() || thinking}
                  aria-label="Send message"
                  className="press w-[46px] h-[46px] shrink-0 rounded-xl grid place-items-center
                             text-white transition-colors disabled:opacity-40"
                  style={{ background: 'var(--color-cta)' }}
                >
                  <Send size={17} aria-hidden="true" />
                </button>
              </div>

              <p className="text-[10.5px] text-content-3 mt-1.5 leading-relaxed">
                CivicAI can be wrong. Verify anything important with the
                department before you act on it.
                {input.length > MAX_CHARS - 200 && (
                  <> {' · '}{MAX_CHARS - input.length} characters left</>
                )}
              </p>
            </div>
          </div>
        </main>

        {/* ───────────── right panel: what the assistant understood ───────────── */}
        <SidePanel side="right" open={rightOpen} onClose={() => setRightOpen(false)} className="xl:flex">
          <div className="p-3.5 border-b" style={{ borderColor: 'var(--color-border)' }}>
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-content-3">
              What I’ve understood
            </h2>
            <p className="text-[11px] text-content-3 mt-1.5 leading-relaxed">
              Correct me if any of this is wrong — it is what gets filed.
            </p>
          </div>

          <div className="flex-1 overflow-y-auto p-3.5 space-y-4">
            {!understanding ? (
              <p className="text-[12px] text-content-3 leading-relaxed">
                Nothing yet. Once you describe an issue, the category, urgency
                and location I have picked up will appear here.
              </p>
            ) : (
              <>
                <dl className="space-y-2.5">
                  <Field label="Category" value={understanding.category} />
                  <Field label="Urgency" value={understanding.priority} />
                  <Field
                    label="Location"
                    value={understanding.locationLabel || 'Not identified yet'}
                    muted={!understanding.locationLabel}
                    icon={MapPin}
                  />
                </dl>

                {!!understanding.missingInfo?.length && (
                  <div
                    className="rounded-xl p-3"
                    style={{ background: 'var(--color-warning-pale)' }}
                  >
                    <p
                      className="text-[10px] font-bold uppercase tracking-widest mb-1.5"
                      style={{ color: 'var(--color-warning)' }}
                    >
                      Still needed
                    </p>
                    <ul className="space-y-1">
                      {understanding.missingInfo.map(item => (
                        <li key={item} className="text-[12px] flex items-start gap-1.5" style={{ color: 'var(--color-warning)' }}>
                          <span aria-hidden="true">•</span>
                          <span className="leading-snug">{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {filed ? (
                  <div className="rounded-xl p-3" style={{ background: 'var(--color-success-pale)' }}>
                    <p className="text-[12px] font-bold flex items-center gap-1.5" style={{ color: 'var(--color-success)' }}>
                      <Check size={13} aria-hidden="true" /> Complaint filed
                    </p>
                    <p className="font-mono text-[13px] font-bold mt-1.5 text-content">{filed}</p>
                    <button
                      onClick={() => navigate('/portal')}
                      className="text-[11.5px] font-bold underline underline-offset-2 mt-2 inline-flex items-center gap-1"
                      style={{ color: 'var(--color-success)' }}
                    >
                      Track it <ChevronRight size={11} aria-hidden="true" />
                    </button>
                  </div>
                ) : understanding.readyToFile ? (
                  <div>
                    <Button
                      fullWidth
                      size="sm"
                      loading={filing}
                      loadingText="Filing…"
                      onClick={fileComplaint}
                    >
                      File this complaint
                    </Button>
                    {fileError && (
                      <p className="text-[11.5px] mt-2 leading-relaxed" style={{ color: 'var(--color-danger)' }}>
                        {fileError}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-[11.5px] text-content-3 leading-relaxed flex items-start gap-1.5">
                    <Info size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                    I’ll offer to file this once I have both the problem and
                    where it is.
                  </p>
                )}
              </>
            )}

            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-content-3 mb-2">
                Related services
              </p>
              <ul className="space-y-1">
                {relatedServices.map(s => (
                  <li
                    key={s}
                    className="text-[12px] text-content-2 rounded-lg px-2.5 py-1.5"
                    style={{ background: 'var(--color-surface-2)' }}
                  >
                    {s}
                  </li>
                ))}
              </ul>
              <p className="text-[10.5px] text-content-3 mt-2 leading-relaxed">
                Suggestions based on the category above. Availability varies by
                state and district.
              </p>
            </div>

            <Link
              to="/portal/documents"
              className="press flex items-center gap-2.5 rounded-xl p-3 bordered surface
                         hover:border-[var(--color-cta)] transition-colors"
            >
              <FileSearch size={16} style={{ color: 'var(--color-saffron)' }} aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-[12.5px] font-bold text-content">Check my documents</span>
                <span className="block text-[11px] text-content-3 leading-snug">
                  Find mismatches before you apply
                </span>
              </span>
            </Link>
          </div>
        </SidePanel>
      </div>
    </div>
  );
}

// ───────────────────────── small pieces ─────────────────────────

/**
 * A panel that is a column on wide screens and an overlay drawer on narrow
 * ones. One component rather than two so the content cannot drift between
 * the desktop and mobile versions — a class of bug that is invisible until
 * someone opens the phone.
 */
function SidePanel({
  side, open, onClose, className = '', children,
}: {
  side: 'left' | 'right';
  open: boolean;
  onClose: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  // Escape closes the drawer. Only bound while it is open as an overlay.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const edge = side === 'left' ? 'left-0 border-r' : 'right-0 border-l';

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-[var(--color-overlay)]"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside
        className={`${open ? 'flex' : 'hidden'} ${className} fixed lg:static inset-y-0 ${edge}
                    z-50 w-[280px] shrink-0 flex-col border-[var(--color-border)]`}
        style={{ background: 'var(--color-surface)' }}
      >
        <button
          onClick={onClose}
          className="lg:hidden absolute top-3 right-3 w-8 h-8 rounded-lg grid place-items-center text-content-3"
          aria-label="Close panel"
        >
          <X size={16} aria-hidden="true" />
        </button>
        {children}
      </aside>
    </>
  );
}

function Field({
  label, value, muted, icon: Icon,
}: {
  label: string;
  value?: string;
  muted?: boolean;
  icon?: typeof MapPin;
}) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-widest text-content-3">{label}</dt>
      <dd
        className="text-[13px] font-semibold mt-0.5 flex items-center gap-1.5"
        style={{ color: muted ? 'var(--color-content-3)' : 'var(--color-content)' }}
      >
        {Icon && <Icon size={12} aria-hidden="true" />}
        {value || '—'}
      </dd>
    </div>
  );
}

function EmptyState({ onPick, name }: { onPick: (s: string) => void; name?: string }) {
  return (
    <div className="py-10 text-center">
      <span
        aria-hidden="true"
        className="w-14 h-14 rounded-2xl grid place-items-center mx-auto mb-5"
        style={{ background: 'var(--color-cta)', color: '#fff' }}
      >
        <Sparkles size={26} />
      </span>
      <h1 className="font-display font-bold text-xl text-content">
        {name ? `How can I help, ${name.split(' ')[0]}?` : 'How can I help?'}
      </h1>
      <p className="text-[13.5px] text-content-3 mt-2 max-w-md mx-auto leading-relaxed">
        Describe a problem in your own words — typed or spoken, in any of the
        twelve supported languages. I’ll ask only for what’s missing.
      </p>

      <div className="grid sm:grid-cols-2 gap-2 mt-7 text-left">
        {SUGGESTIONS.map(s => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="press rounded-xl p-3 bordered surface hover:border-[var(--color-cta)]
                       text-[12.5px] text-content-2 leading-snug transition-colors"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
