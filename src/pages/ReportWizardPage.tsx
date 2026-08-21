import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, CircleMarker, useMapEvents } from 'react-leaflet';
import {
  AlertTriangle, ArrowLeft, ArrowRight, Camera, Check, CheckCircle2, ChevronLeft,
  Droplet, Gavel, Info, Loader2, Lightbulb, MapPin, Mic, Recycle, Route, Sparkles,
  Trash2, TreePine, Trash, X, Zap,
} from 'lucide-react';
import { Button } from '../components/Button';
import { LanguagePicker } from '../components/LanguagePicker';
import { useI18n } from '../i18n/I18nContext';
import { useVoice } from '../hooks/useVoice';
import { getBrowserLocation } from '../services/chatService';
import { createComplaint, type DuplicateHint } from '../services/complaintService';

/**
 * /portal/report - the guided complaint workflow.
 *
 * =========================================================================
 * Why a wizard, when there is already a chat
 * =========================================================================
 * The conversational path is better for someone who does not know what they
 * need, or who is describing something messy. It is worse for someone who
 * knows exactly what is wrong and wants it filed in ninety seconds - there,
 * a chat is a series of round trips where a form would have been one screen.
 *
 * So both exist, and neither replaces the other. The wizard's advantage is
 * that the citizen can SEE the whole shape of what they are about to submit
 * and go back to any part of it. Its risk is the usual one for government
 * forms: asking for everything because the schema has a column for it.
 *
 * The rule applied here is that a step must earn its place by changing what
 * an officer can DO. Category routes it. Location is how they find it.
 * Urgency sets the clock. Evidence settles arguments. Everything else is
 * optional, and the AI review asks for at most three more things.
 * =========================================================================
 */

type Urgency = 'Low' | 'Medium' | 'High' | 'Critical';

const CATEGORIES = [
  { key: 'Road & Infrastructure', label: 'Roads & infrastructure', Icon: Route,     hint: 'Potholes, broken footpaths, damaged bridges' },
  { key: 'Water Supply',          label: 'Water supply',           Icon: Droplet,   hint: 'No supply, leaks, contaminated water' },
  { key: 'Electricity',           label: 'Electricity',            Icon: Zap,       hint: 'Power cuts, exposed wires, faulty meters' },
  { key: 'Sanitation',            label: 'Sanitation',             Icon: Trash,     hint: 'Blocked drains, sewage, public toilets' },
  { key: 'Waste Management',      label: 'Waste management',       Icon: Recycle,   hint: 'Uncollected rubbish, illegal dumping' },
  { key: 'Street Lighting',       label: 'Street lighting',        Icon: Lightbulb, hint: 'Dark streets, broken or flickering lamps' },
  { key: 'Law & Order',           label: 'Law & order',            Icon: Gavel,     hint: 'Safety concerns, noise, public nuisance' },
  { key: 'Public Transport',      label: 'Public transport',       Icon: MapPin,    hint: 'Bus stops, routes, fares' },
  { key: 'Parks & Recreation',    label: 'Parks & recreation',     Icon: TreePine,  hint: 'Park upkeep, playgrounds, trees' },
  { key: 'General',               label: 'Something else',         Icon: Info,      hint: "If none of these fit" },
] as const;

/**
 * Urgency descriptions are written in terms of CONSEQUENCE, not adjectives.
 * "High" means nothing on its own, and left undefined every complaint
 * becomes Critical - which is the same as none of them being.
 */
const URGENCIES: Array<{ key: Urgency; label: string; hint: string; tone: string }> = [
  { key: 'Low',      label: 'Low',      hint: 'Annoying, but nothing is at risk',                  tone: 'var(--color-priority-low)' },
  { key: 'Medium',   label: 'Medium',   hint: 'Affecting daily life and should be fixed soon',      tone: 'var(--color-priority-medium)' },
  { key: 'High',     label: 'High',     hint: 'Many people affected, or property is being damaged', tone: 'var(--color-priority-high)' },
  { key: 'Critical', label: 'Critical', hint: 'Someone could be hurt if this is not dealt with now', tone: 'var(--color-priority-critical)' },
];

const STEPS = ['Category', 'Description', 'Location', 'Urgency', 'Evidence', 'Review', 'Done'] as const;
type StepIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

type Review = {
  summary: string;
  verdict: 'ready' | 'needs_detail';
  missingInfo: string[];
  suggestedCategory: string;
  suggestedPriority: Urgency;
  priorityReason?: string;
  degraded?: boolean;
};

export function ReportWizardPage() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();

  const [step, setStep] = useState<StepIndex>(0);
  const [category, setCategory] = useState<string>('');
  const [description, setDescription] = useState('');
  const [addressText, setAddressText] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [urgency, setUrgency] = useState<Urgency>('Medium');
  const [photos, setPhotos] = useState<File[]>([]);
  const [review, setReview] = useState<Review | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; duplicate: DuplicateHint | null } | null>(null);
  const [uploadNote, setUploadNote] = useState<string | null>(null);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /** Dictation for the description. Voice is an input method here, not a feature. */
  const voice = useVoice({
    lang,
    onTranscript: text => setDescription(prev => (prev ? `${prev.trim()} ${text}` : text)),
  });

  /**
   * Move focus to the new step's heading. Without this a keyboard or screen
   * reader user presses "Continue" and focus stays on a button that has just
   * been replaced, so they have no idea the screen changed.
   */
  useEffect(() => { headingRef.current?.focus(); }, [step]);

  const go = (next: StepIndex) => { setError(null); setStep(next); };

  /**
   * Start over in place. This used to call window.location.reload(), which
   * re-downloads the bundle and re-runs session restore - on a slow
   * connection that reads as the app having crashed at the exact moment the
   * person was told their complaint succeeded.
   */
  const startAnother = () => {
    setStep(0); setCategory(''); setDescription(''); setAddressText('');
    setCoords(null); setShowMap(false); setUrgency('Medium'); setPhotos([]);
    setReview(null); setCreated(null); setUploadNote(null); setError(null);
  };

  const useMyLocation = useCallback(async () => {
    setLocating(true);
    const got = await getBrowserLocation();
    setLocating(false);
    if (got) { setCoords(got); setShowMap(true); }
    else setError(t('reportWizard.locationIsUnavailableOrWas'));
  }, []);

  const addPhotos = (files: FileList | null) => {
    if (!files?.length) return;
    const accepted: File[] = [];
    for (const f of Array.from(files)) {
      if (photos.length + accepted.length >= MAX_PHOTOS) break;
      if (!f.type.startsWith('image/')) { setError(t('reportWizard.photosOnlyJpgPngOr')); continue; }
      if (f.size > MAX_PHOTO_BYTES) { setError(`${f.name} is over 5 MB.`); continue; }
      accepted.push(f);
    }
    if (accepted.length) setPhotos(p => [...p, ...accepted]);
  };

  const runReview = useCallback(async () => {
    setReviewing(true); setError(null);
    try {
      const res = await fetch('/api/complaints/review', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          ...(document.cookie.match(/(?:^|; )civicai_csrf=([^;]*)/)
            ? { 'x-csrf-token': decodeURIComponent(document.cookie.match(/(?:^|; )civicai_csrf=([^;]*)/)![1]) }
            : {}),
        },
        body: JSON.stringify({
          description, category, urgency,
          location: addressText || (coords ? `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}` : ''),
          hasEvidence: photos.length > 0,
        }),
      });
      setReview(await res.json());
    } catch {
      // A failed review must never block filing - see the note on the
      // endpoint. Fall through with no suggestions rather than an error.
      setReview({
        summary: description, verdict: 'ready', missingInfo: [],
        suggestedCategory: category, suggestedPriority: urgency, degraded: true,
      });
    } finally {
      setReviewing(false);
    }
  }, [description, category, urgency, addressText, coords, photos.length]);

  const submit = useCallback(async () => {
    setSubmitting(true); setError(null);
    try {
      const { complaint, duplicate } = await createComplaint({
        category,
        description,
        priority: urgency,
        ...(coords ? { lat: coords.lat, lng: coords.lng } : {}),
        ...(addressText ? { ward: addressText } : {}),
      } as any);

      // Photos attach AFTER creation, because the upload endpoint is keyed on
      // the complaint. A failed photo must not lose the complaint, so this is
      // reported separately rather than thrown.
      if (photos.length) {
        let failed = 0;
        for (const file of photos) {
          try {
            const res = await fetch(`/api/media/${encodeURIComponent(complaint.id)}`, {
              method: 'POST',
              credentials: 'same-origin',
              headers: {
                'Content-Type': file.type,
                'x-file-name': 'evidence',
                ...(document.cookie.match(/(?:^|; )civicai_csrf=([^;]*)/)
                  ? { 'x-csrf-token': decodeURIComponent(document.cookie.match(/(?:^|; )civicai_csrf=([^;]*)/)![1]) }
                  : {}),
              },
              body: file,
            });
            if (!res.ok) failed++;
          } catch { failed++; }
        }
        if (failed) {
          setUploadNote(
            `Your complaint was filed, but ${failed} photo${failed > 1 ? 's' : ''} could not be attached. ` +
            'You can add them from the complaint page.',
          );
        }
      }

      setCreated({ id: complaint.id, duplicate });
      setStep(6);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not file your complaint. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [category, description, urgency, coords, addressText, photos]);

  const canContinue = useMemo(() => {
    switch (step) {
      case 0: return !!category;
      case 1: return description.trim().length >= 10;
      case 2: return !!addressText.trim() || !!coords;
      default: return true;
    }
  }, [step, category, description, addressText, coords]);

  const previews = useMemo(() => photos.map(f => ({ file: f, url: URL.createObjectURL(f) })), [photos]);
  useEffect(() => () => previews.forEach(p => URL.revokeObjectURL(p.url)), [previews]);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--color-bg-main)', color: 'var(--color-content)' }}>
      <a href="#wizard-main" className="sr-only-focusable">{t('nav.skipToMain')}</a>

      <header className="h-14 shrink-0 glass border-b flex items-center gap-2 px-3 sm:px-5"
              style={{ borderColor: 'var(--color-border)' }}>
        <Link to="/portal" className="press w-9 h-9 rounded-xl grid place-items-center text-content-3 hover:text-cta transition-colors"
              aria-label={t('reportWizard.backToCivicai')}>
          <ArrowLeft size={17} aria-hidden="true" />
        </Link>
        <div className="min-w-0">
          <h1 className="font-display font-bold text-[15px] leading-none truncate">{t('reportWizard.fileAComplaint')}</h1>
          <p className="text-[10px] font-bold uppercase tracking-widest text-content-3">
            {step === 6 ? 'Filed' : `Step ${step + 1} of 6`}
          </p>
        </div>
        <div className="ml-auto"><LanguagePicker compact /></div>
      </header>

      {/* Progress. aria-hidden because the step count in the header already
          says this, and a screen reader does not need it twice. */}
      <div className="h-1 shrink-0" style={{ background: 'var(--color-surface-3)' }} aria-hidden="true">
        <div className="h-full transition-all duration-500"
             style={{ width: `${((Math.min(step, 5) + 1) / 6) * 100}%`, background: 'var(--color-cta)' }} />
      </div>

      <main id="wizard-main" tabIndex={-1} className="flex-1 focus:outline-none">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 pb-28">
          {error && (
            <div role="alert" className="rounded-xl p-3 mb-4 text-[13px] flex items-start gap-2"
                 style={{ background: 'var(--color-danger-pale)', color: 'var(--color-danger)' }}>
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span className="flex-1">{error}</span>
              <button onClick={() => setError(null)} aria-label={t('reportWizard.dismiss')}><X size={14} aria-hidden="true" /></button>
            </div>
          )}

          {/* ─────────── 0. category ─────────── */}
          {step === 0 && (
            <section>
              <h2 ref={headingRef} tabIndex={-1} className="font-display font-bold text-xl sm:text-2xl tracking-tight focus:outline-none">
                What do you need help with?
              </h2>
              <p className="text-[13.5px] text-content-3 mt-1.5">
                This decides which department receives it. Pick the closest match.
              </p>
              <ul className="grid sm:grid-cols-2 gap-2 mt-5">
                {CATEGORIES.map(c => (
                  <li key={c.key}>
                    <button
                      onClick={() => { setCategory(c.key); go(1); }}
                      aria-pressed={category === c.key}
                      className="press w-full text-left rounded-2xl p-3.5 bordered surface flex items-start gap-3
                                 hover:border-[var(--color-cta)] transition-colors"
                      style={category === c.key ? { borderColor: 'var(--color-cta)', background: 'var(--color-info-pale)' } : undefined}
                    >
                      <span aria-hidden="true" className="w-9 h-9 rounded-xl grid place-items-center shrink-0"
                            style={{ background: 'var(--color-surface-2)', color: 'var(--color-cta)' }}>
                        <c.Icon size={17} />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[13.5px] font-bold text-content">{c.label}</span>
                        <span className="block text-[11.5px] text-content-3 mt-0.5 leading-snug">{c.hint}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ─────────── 1. description ─────────── */}
          {step === 1 && (
            <section>
              <h2 ref={headingRef} tabIndex={-1} className="font-display font-bold text-xl sm:text-2xl tracking-tight focus:outline-none">
                What is happening?
              </h2>
              <p className="text-[13.5px] text-content-3 mt-1.5">
                In your own words. Say when it started and who it affects, if you know.
              </p>

              <label htmlFor="wiz-desc" className="sr-only">{t('reportWizard.describeTheProblem')}</label>
              <textarea
                id="wiz-desc" rows={6} value={description}
                onChange={e => setDescription(e.target.value.slice(0, 4000))}
                placeholder={t('reportWizard.thereHasBeenNoWater')}
                className="w-full mt-4 rounded-2xl p-4 text-[14px] bordered surface text-content
                           placeholder:text-[var(--color-content-3)] focus:outline-none
                           focus:border-[var(--color-cta)] resize-y leading-relaxed"
              />

              <div className="flex flex-wrap items-center gap-2 mt-2">
                {voice.supported && (
                  <Button
                    size="sm" variant={voice.listening ? 'danger' : 'secondary'}
                    icon={<Mic size={14} />} onClick={voice.toggle}
                  >
                    {voice.listening ? 'Stop dictating' : 'Dictate instead'}
                  </Button>
                )}
                <span className="text-[11.5px] text-content-3">
                  {description.trim().length < 10
                    ? 'A sentence or two is enough.'
                    : `${description.length} characters`}
                </span>
              </div>

              {voice.listening && (
                <p role="status" className="text-[12px] mt-2 rounded-xl p-2.5"
                   style={{ background: 'var(--color-info-pale)', color: 'var(--color-info)' }}>
                  {voice.interim || 'Listening... speak now'}
                </p>
              )}
              {voice.error && (
                <p className="text-[12px] mt-2" style={{ color: 'var(--color-warning)' }}>{voice.error}</p>
              )}
            </section>
          )}

          {/* ─────────── 2. location ─────────── */}
          {step === 2 && (
            <section>
              <h2 ref={headingRef} tabIndex={-1} className="font-display font-bold text-xl sm:text-2xl tracking-tight focus:outline-none">
                Where is it?
              </h2>
              <p className="text-[13.5px] text-content-3 mt-1.5">
                An officer has to find this on the ground. A landmark helps more than an exact pin.
              </p>

              <div className="flex flex-wrap gap-2 mt-4">
                <Button size="sm" variant="secondary" icon={<MapPin size={14} />}
                        loading={locating} loadingText={t('reportWizard.findingYou')} onClick={useMyLocation}>
                  Use my current location
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowMap(m => !m)}>
                  {showMap ? 'Hide map' : 'Pick on a map'}
                </Button>
              </div>

              <label htmlFor="wiz-addr" className="block text-[12px] font-bold text-content-2 mt-4 mb-1.5">
                Address or landmark
              </label>
              <input
                id="wiz-addr" value={addressText}
                onChange={e => setAddressText(e.target.value.slice(0, 200))}
                placeholder={t('reportWizard.sector14NearTheWater')}
                className="w-full h-12 rounded-xl px-3.5 text-[14px] bordered surface text-content
                           placeholder:text-[var(--color-content-3)] focus:outline-none focus:border-[var(--color-cta)]"
              />

              {showMap && (
                <div className="mt-3 rounded-2xl overflow-hidden bordered" style={{ height: 260 }}>
                  <MapContainer
                    center={[coords?.lat ?? 28.6139, coords?.lng ?? 77.2090]}
                    zoom={coords ? 16 : 12}
                    style={{ height: '100%', width: '100%' }}
                    scrollWheelZoom={false}
                  >
                    <TileLayer
                      attribution='&copy; OpenStreetMap contributors'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    <MapPicker onPick={setCoords} />
                    {coords && (
                      <CircleMarker center={[coords.lat, coords.lng]} radius={9}
                                    pathOptions={{ color: '#0369A1', fillColor: '#0369A1', fillOpacity: 0.6 }} />
                    )}
                  </MapContainer>
                </div>
              )}

              {coords && (
                <p className="text-[12px] text-content-3 mt-2 flex items-center gap-1.5">
                  <Check size={13} style={{ color: 'var(--color-success)' }} aria-hidden="true" />
                  Pin set at {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
                  <button onClick={() => setCoords(null)} className="underline underline-offset-2 ml-1">clear</button>
                </p>
              )}
              <p className="text-[11.5px] text-content-3 mt-3 leading-relaxed">
                Your exact location is only shared on this complaint, and only with the
                department handling it.
              </p>
            </section>
          )}

          {/* ─────────── 3. urgency ─────────── */}
          {step === 3 && (
            <section>
              <h2 ref={headingRef} tabIndex={-1} className="font-display font-bold text-xl sm:text-2xl tracking-tight focus:outline-none">
                How urgent is it?
              </h2>
              <p className="text-[13.5px] text-content-3 mt-1.5">
                This starts the response clock. Be honest - if everything is critical,
                nothing is.
              </p>
              <ul className="space-y-2 mt-5">
                {URGENCIES.map(u => (
                  <li key={u.key}>
                    <button
                      onClick={() => setUrgency(u.key)}
                      aria-pressed={urgency === u.key}
                      className="press w-full text-left rounded-2xl p-3.5 bordered surface flex items-center gap-3
                                 hover:border-[var(--color-cta)] transition-colors"
                      style={urgency === u.key ? { borderColor: u.tone, background: 'var(--color-surface-2)' } : undefined}
                    >
                      <span aria-hidden="true" className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: u.tone }} />
                      <span className="min-w-0">
                        <span className="block text-[13.5px] font-bold text-content">{u.label}</span>
                        <span className="block text-[11.5px] text-content-3 mt-0.5">{u.hint}</span>
                      </span>
                      {urgency === u.key && <Check size={16} className="ml-auto shrink-0" style={{ color: u.tone }} aria-hidden="true" />}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ─────────── 4. evidence ─────────── */}
          {step === 4 && (
            <section>
              <h2 ref={headingRef} tabIndex={-1} className="font-display font-bold text-xl sm:text-2xl tracking-tight focus:outline-none">
                Add a photo
              </h2>
              <p className="text-[13.5px] text-content-3 mt-1.5">
                Optional, but a photo settles arguments about whether a problem is real.
                Only add one if it is safe to.
              </p>

              <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple className="sr-only"
                     onChange={e => { addPhotos(e.target.files); e.target.value = ''; }} />

              <div className="grid grid-cols-3 gap-2 mt-4">
                {previews.map((p, i) => (
                  <div key={p.url} className="relative rounded-xl overflow-hidden bordered aspect-square">
                    <img src={p.url} alt={`Attached photo ${i + 1}`} className="w-full h-full object-cover" />
                    <button
                      onClick={() => setPhotos(list => list.filter((_, idx) => idx !== i))}
                      aria-label={`Remove photo ${i + 1}`}
                      className="absolute top-1 right-1 w-7 h-7 rounded-lg grid place-items-center text-white"
                      style={{ background: 'rgb(0 0 0 / 0.55)' }}
                    >
                      <Trash2 size={13} aria-hidden="true" />
                    </button>
                  </div>
                ))}
                {photos.length < MAX_PHOTOS && (
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="press rounded-xl border-2 border-dashed aspect-square grid place-items-center
                               text-content-3 hover:text-cta transition-colors"
                    style={{ borderColor: 'var(--color-border-strong)' }}
                  >
                    <span className="text-center">
                      <Camera size={20} className="mx-auto" aria-hidden="true" />
                      <span className="block text-[11px] font-bold mt-1">{t('reportWizard.addPhoto')}</span>
                    </span>
                  </button>
                )}
              </div>

              <p className="text-[11.5px] text-content-3 mt-3 leading-relaxed">
                Up to {MAX_PHOTOS} photos, 5 MB each. Photos are attached to this
                complaint and visible to the officer handling it.
              </p>
            </section>
          )}

          {/* ─────────── 5. AI review ─────────── */}
          {step === 5 && (
            <section>
              <h2 ref={headingRef} tabIndex={-1} className="font-display font-bold text-xl sm:text-2xl tracking-tight focus:outline-none">
                Check before it goes
              </h2>
              <p className="text-[13.5px] text-content-3 mt-1.5">
                Everything below is what the department will receive.
              </p>

              {reviewing ? (
                <div className="flex items-center gap-2 mt-6 text-content-3" role="status">
                  <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                  <span className="text-[13px]">{t('reportWizard.readingYourComplaint')}</span>
                </div>
              ) : (
                <>
                  {review && review.missingInfo.length > 0 && (
                    <div className="rounded-2xl p-4 mt-4" style={{ background: 'var(--color-warning-pale)' }}>
                      <p className="text-[12px] font-bold uppercase tracking-widest flex items-center gap-1.5"
                         style={{ color: 'var(--color-warning)' }}>
                        <Sparkles size={12} aria-hidden="true" /> This would help the officer
                      </p>
                      <ul className="mt-2 space-y-1.5">
                        {review.missingInfo.map(m => (
                          <li key={m} className="text-[13px] flex items-start gap-2" style={{ color: 'var(--color-warning)' }}>
                            <span aria-hidden="true">-</span><span className="leading-snug">{m}</span>
                          </li>
                        ))}
                      </ul>
                      <div className="flex gap-2 mt-3">
                        <Button size="sm" variant="secondary" onClick={() => go(1)}>{t('reportWizard.addMoreDetail')}</Button>
                      </div>
                      <p className="text-[11.5px] mt-2.5 leading-relaxed" style={{ color: 'var(--color-warning)' }}>
                        You can file without these. Your complaint will be registered either way.
                      </p>
                    </div>
                  )}

                  {review && review.missingInfo.length === 0 && (
                    <div className="rounded-2xl p-4 mt-4 flex items-start gap-2.5" style={{ background: 'var(--color-success-pale)' }}>
                      <CheckCircle2 size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--color-success)' }} aria-hidden="true" />
                      <p className="text-[13px] leading-relaxed" style={{ color: 'var(--color-success)' }}>
                        This has everything an officer needs to act on it.
                      </p>
                    </div>
                  )}

                  <dl className="mt-4 rounded-2xl bordered surface divide-y" style={{ borderColor: 'var(--color-border)' }}>
                    <Row label="Category" value={category} onEdit={() => go(0)} />
                    <Row label="Description" value={description} onEdit={() => go(1)} multiline />
                    <Row
                      label="Location"
                      value={addressText || (coords ? `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}` : 'Not given')}
                      onEdit={() => go(2)}
                    />
                    <Row label="Urgency" value={urgency} onEdit={() => go(3)} />
                    <Row
                      label="Photos"
                      value={photos.length ? `${photos.length} attached` : 'None'}
                      onEdit={() => go(4)}
                    />
                  </dl>

                  {review?.degraded && (
                    <p className="text-[11.5px] text-content-3 mt-3">
                      The review assistant was unavailable, so only basic checks ran.
                      Your complaint can still be filed normally.
                    </p>
                  )}
                </>
              )}
            </section>
          )}

          {/* ─────────── 6. done ─────────── */}
          {step === 6 && created && (
            <section className="text-center py-6">
              <span aria-hidden="true" className="w-16 h-16 rounded-2xl grid place-items-center mx-auto"
                    style={{ background: 'var(--color-success-pale)', color: 'var(--color-success)' }}>
                <CheckCircle2 size={30} />
              </span>
              <h2 ref={headingRef} tabIndex={-1} className="font-display font-bold text-xl sm:text-2xl mt-5 focus:outline-none">
                Filed. Here is your reference.
              </h2>
              <p className="font-mono font-bold text-2xl mt-3 tracking-tight text-content">{created.id}</p>
              <p className="text-[13px] text-content-3 mt-2 max-w-md mx-auto leading-relaxed">
                Write this down or take a screenshot. You can look it up any time on the
                tracking page, and you will be notified when the status changes.
              </p>

              {created.duplicate && (
                <div className="rounded-2xl p-4 mt-5 text-left max-w-md mx-auto" style={{ background: 'var(--color-info-pale)' }}>
                  <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--color-info)' }}>
                    Somebody may have already reported this ({created.duplicate.confidence}% match
                    with {created.duplicate.of}). Yours has still been registered separately and
                    will be tracked on its own - reports are never merged without a person deciding to.
                  </p>
                </div>
              )}

              {uploadNote && (
                <p className="text-[12.5px] mt-4 max-w-md mx-auto leading-relaxed" style={{ color: 'var(--color-warning)' }}>
                  {uploadNote}
                </p>
              )}

              <div className="flex flex-wrap gap-2 justify-center mt-7">
                <Button onClick={() => navigate('/portal')}>{t('reportWizard.trackThisComplaint')}</Button>
                <Button variant="secondary" onClick={startAnother}>{t('reportWizard.fileAnother')}</Button>
              </div>
            </section>
          )}
        </div>
      </main>

      {/* ─────────── sticky footer ─────────── */}
      {step < 6 && (
        <div className="fixed bottom-0 inset-x-0 border-t px-4 sm:px-6 py-3"
             style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <div className="max-w-2xl mx-auto flex items-center gap-3">
            {step > 0 && (
              <Button variant="ghost" icon={<ChevronLeft size={16} />} onClick={() => go((step - 1) as StepIndex)}>
                Back
              </Button>
            )}
            <div className="flex-1" />
            {step < 5 ? (
              <Button
                disabled={!canContinue}
                onClick={() => {
                  const next = (step + 1) as StepIndex;
                  if (next === 5) void runReview();
                  go(next);
                }}
              >
                Continue <ArrowRight size={16} aria-hidden="true" />
              </Button>
            ) : (
              <Button loading={submitting} loadingText={t('reportWizard.filing')} onClick={submit}>
                File this complaint
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Click-to-place. Separate component because useMapEvents needs map context. */
function MapPicker({ onPick }: { onPick: (c: { lat: number; lng: number }) => void }) {
  useMapEvents({ click: e => onPick({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

function Row({
  label, value, onEdit, multiline,
}: { label: string; value: string; onEdit: () => void; multiline?: boolean }) {
  return (
    <div className="p-3.5 flex items-start gap-3">
      <dt className="text-[11.5px] font-bold uppercase tracking-wide text-content-3 w-24 shrink-0 pt-0.5">
        {label}
      </dt>
      <dd className={`flex-1 min-w-0 text-[13.5px] text-content ${multiline ? 'leading-relaxed' : 'truncate'}`}>
        {value || '-'}
      </dd>
      <button onClick={onEdit} className="text-[12px] font-bold text-cta hover:underline shrink-0">
        Edit
      </button>
    </div>
  );
}
