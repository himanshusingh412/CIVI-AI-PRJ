import { useCallback, useEffect, useRef, useState } from 'react';
import type { LangType } from '../i18n/locales';

/**
 * Voice input and output, entirely in the browser.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Why the Web Speech API and not a server-side STT provider
 * ─────────────────────────────────────────────────────────────────────────
 * Streaming a citizen's voice describing a grievance to a third-party
 * transcription service is a meaningful privacy decision, and it costs money
 * per minute. Doing it in the browser means the audio never leaves the
 * device — only the resulting text does, on the same path a typed message
 * would have taken. For a prototype that is both cheaper and more
 * defensible. A server-side adapter can be added later behind this same
 * hook; nothing above it would change.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * The rule this hook exists to enforce
 * ─────────────────────────────────────────────────────────────────────────
 * Voice must never be load-bearing. Support for SpeechRecognition is
 * genuinely patchy — Firefox does not ship it, iOS Safari is inconsistent,
 * and many Android WebViews return an unusable stub. So every failure path
 * here resolves to "you can still type", and `supported` is exported so the
 * UI can hide the control entirely rather than offering a button that does
 * nothing.
 */

export type VoiceState =
  | 'unsupported'  // this browser has no SpeechRecognition at all
  | 'idle'
  | 'requesting'   // waiting on the microphone permission prompt
  | 'listening'
  | 'denied'       // permission refused; recoverable only in browser settings
  | 'error';

/** Our language codes are ISO-639-1; the speech APIs want BCP-47 tags. */
const SPEECH_TAGS: Record<LangType, string> = {
  en: 'en-IN', hi: 'hi-IN', bn: 'bn-IN', mr: 'mr-IN', te: 'te-IN', ta: 'ta-IN',
  gu: 'gu-IN', kn: 'kn-IN', ml: 'ml-IN', pa: 'pa-IN', or: 'or-IN', ur: 'ur-IN',
};

/**
 * Hinglish note: there is no BCP-47 tag for it, and inventing one makes
 * recognition worse. Chrome's hi-IN model already handles Latin-script
 * Hindi and code-switched English reasonably well ("paani nahi aa raha" and
 * "water supply band hai" both transcribe), so Hindi is the right tag for a
 * mixed speaker and English is the right tag for everyone else.
 */
const tagFor = (lang: LangType) => SPEECH_TAGS[lang] ?? 'en-IN';

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
};

function recognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type UseVoiceOptions = {
  lang: LangType;
  /** Called once with the final transcript when the user stops speaking. */
  onTranscript: (text: string) => void;
};

export function useVoice({ lang, onTranscript }: UseVoiceOptions) {
  const Ctor = recognitionCtor();
  const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  const [state, setState] = useState<VoiceState>(Ctor ? 'idle' : 'unsupported');
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  /**
   * The callback is held in a ref so changing it does not tear down an
   * in-flight recognition session. Without this, any parent re-render while
   * the user is mid-sentence would abort them.
   */
  const onTranscriptRef = useRef(onTranscript);
  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);

  const langRef = useRef(lang);
  useEffect(() => { langRef.current = lang; }, [lang]);

  // ───────────────────────── recognition ─────────────────────────
  const stop = useCallback(() => {
    try { recRef.current?.stop(); } catch { /* already stopped */ }
    setInterim('');
    setState(s => (s === 'listening' || s === 'requesting' ? 'idle' : s));
  }, []);

  const start = useCallback(() => {
    if (!Ctor) return;
    // Restarting an active recogniser throws InvalidStateError in Chrome.
    if (recRef.current) { stop(); return; }

    setError(null);
    setInterim('');
    setState('requesting');

    const rec = new Ctor();
    recRef.current = rec;
    rec.lang = tagFor(langRef.current);
    // `continuous: false` gives us end-of-utterance detection for free —
    // the browser decides when the person stopped talking, which is far
    // better than a fixed timer that cuts off a slow speaker.
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => setState('listening');

    rec.onresult = (e: any) => {
      let finalText = '';
      let partial = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else partial += r[0].transcript;
      }
      if (partial) setInterim(partial);
      if (finalText.trim()) {
        setInterim('');
        onTranscriptRef.current(finalText.trim());
      }
    };

    rec.onerror = (e: any) => {
      const code = e?.error ?? 'unknown';
      // Each of these is a different conversation with the user, so they
      // are not collapsed into one "something went wrong".
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        setState('denied');
        setError('Microphone access is blocked. Allow it in your browser settings, or just type instead.');
      } else if (code === 'no-speech') {
        setState('idle');
        setError("I didn't catch anything. Tap the microphone and speak again.");
      } else if (code === 'aborted') {
        setState('idle');
      } else if (code === 'network') {
        setState('error');
        setError('Speech recognition needs a network connection. You can type instead.');
      } else {
        setState('error');
        setError('Voice input is not working on this device. Please type instead.');
      }
    };

    rec.onend = () => {
      recRef.current = null;
      setInterim('');
      setState(s => (s === 'denied' || s === 'error' ? s : 'idle'));
    };

    try {
      rec.start();
    } catch {
      recRef.current = null;
      setState('error');
      setError('Voice input could not start. Please type instead.');
    }
  }, [Ctor, stop]);

  const toggle = useCallback(() => {
    if (state === 'listening' || state === 'requesting') stop();
    else start();
  }, [state, start, stop]);

  // ───────────────────────── synthesis ─────────────────────────
  /**
   * Chrome populates the voice list asynchronously, so the first speak()
   * after a cold load would otherwise use the default (usually American
   * English) voice for a Hindi sentence. Kept warm here.
   */
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!speechSupported) return;
    const load = () => { voicesRef.current = window.speechSynthesis.getVoices(); };
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, [speechSupported]);

  const speak = useCallback((text: string) => {
    if (!speechSupported || !text.trim()) return;
    const synth = window.speechSynthesis;
    // One voice at a time. Queued utterances from a fast conversation talk
    // over each other and there is no way for the listener to catch up.
    synth.cancel();

    const u = new SpeechSynthesisUtterance(text);
    const tag = tagFor(langRef.current);
    u.lang = tag;

    const base = tag.split('-')[0];
    const match =
      voicesRef.current.find(v => v.lang === tag) ??
      voicesRef.current.find(v => v.lang?.startsWith(base));
    if (match) u.voice = match;

    // Slightly slower than default: this is often unfamiliar administrative
    // vocabulary, sometimes in a second language, sometimes on a phone
    // speaker in a noisy street.
    u.rate = 0.95;
    u.onstart = () => setSpeaking(true);
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);

    synth.speak(u);
  }, [speechSupported]);

  const stopSpeaking = useCallback(() => {
    if (!speechSupported) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [speechSupported]);

  // Leaving the page mid-sentence must not leave the browser talking.
  useEffect(() => () => {
    try { recRef.current?.abort(); } catch { /* noop */ }
    if (speechSupported) window.speechSynthesis.cancel();
  }, [speechSupported]);

  return {
    /** Speech-to-text availability. False → hide the microphone entirely. */
    supported: !!Ctor,
    /** Text-to-speech availability. Independent: Firefox has TTS but no STT. */
    speechSupported,
    state,
    listening: state === 'listening',
    /** Live partial transcript, for showing the user they are being heard. */
    interim,
    error,
    clearError: () => setError(null),
    start,
    stop,
    toggle,
    speaking,
    speak,
    stopSpeaking,
  };
}
