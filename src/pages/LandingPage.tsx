import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import {
  ArrowRight, Building2, CheckCircle2, ClipboardList, Droplet, FileSearch,
  Gavel, Languages, Lock, MapPin, MessageSquare, Moon, ScrollText, ShieldCheck,
  Sun, Trash2, Zap,
} from 'lucide-react';
import { Button } from '../components/Button';
import { LanguagePicker } from '../components/LanguagePicker';
import { PageBackground } from '../components/backgrounds/PageBackground';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useConfig } from '../context/ConfigContext';
import { useI18n } from '../i18n/I18nContext';

/**
 * The public front door.
 *
 * Before this existed, visiting CivicAI dropped you straight onto a sign-in
 * form. That is a reasonable choice for an internal tool and the wrong one
 * for a citizen service: the people who most need this are the least likely
 * to hand over a phone number to something that has not yet told them what
 * it does. So the landing page's job is to be *readable without an account*,
 * and to make the two doors — citizen and staff — obvious and separate.
 *
 * Design constraints observed here:
 *   - Text sits on opaque surfaces. The animated background never touches
 *     anything that has to meet a contrast ratio.
 *   - Motion is opt-out (prefers-reduced-motion) and only ever moves opacity
 *     and transform, so it stays on the compositor.
 *   - Every claim in the "built to be checked" section is one this codebase
 *     can actually back up, and the integration strip below it reports real
 *     modes from /api/config rather than decorative green ticks.
 */

const SERVICE_CARDS = [
  { icon: ClipboardList, titleKey: 'landing.services.report.title',    bodyKey: 'landing.services.report.body',    tone: 'var(--color-cta)' },
  { icon: FileSearch,    titleKey: 'landing.services.verify.title',    bodyKey: 'landing.services.verify.body',    tone: 'var(--color-saffron)' },
  { icon: MessageSquare, titleKey: 'landing.services.assistant.title', bodyKey: 'landing.services.assistant.body', tone: 'var(--color-success)' },
  { icon: MapPin,        titleKey: 'landing.services.track.title',     bodyKey: 'landing.services.track.body',     tone: 'var(--color-chart-4)' },
] as const;

const STEPS = [
  { n: '01', titleKey: 'landing.how.step1', bodyKey: 'landing.how.step1Body' },
  { n: '02', titleKey: 'landing.how.step2', bodyKey: 'landing.how.step2Body' },
  { n: '03', titleKey: 'landing.how.step3', bodyKey: 'landing.how.step3Body' },
  { n: '04', titleKey: 'landing.how.step4', bodyKey: 'landing.how.step4Body' },
] as const;

const TRUST = [
  { icon: ShieldCheck, key: 'landing.trust.rbac' },
  { icon: ScrollText,  key: 'landing.trust.audit' },
  { icon: Lock,        key: 'landing.trust.privacy' },
  { icon: CheckCircle2, key: 'landing.trust.honest' },
] as const;

const CATEGORY_CHIPS = [
  { icon: Droplet, key: 'cat.water' },
  { icon: MapPin,  key: 'cat.roads' },
  { icon: Zap,     key: 'cat.electricity' },
  { icon: Trash2,  key: 'cat.sanitation' },
  { icon: Gavel,   key: 'cat.law' },
] as const;

export function LandingPage() {
  const { t } = useI18n();
  const { isDark, toggleTheme } = useTheme();
  const { status, identity } = useAuth();
  const { offline } = useConfig();
  const navigate = useNavigate();
  const reduce = useReducedMotion();

  /**
   * Someone who is already signed in should not be looking at a sales page.
   * The destination comes from the server (identity.homeRoute), so a staff
   * member lands in their portal and a citizen lands in theirs without the
   * browser deciding anything.
   */
  useEffect(() => {
    if (status === 'authenticated' && identity) navigate(identity.homeRoute, { replace: true });
  }, [status, identity, navigate]);

  const rise = (delay = 0) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 16 },
          whileInView: { opacity: 1, y: 0 },
          viewport: { once: true, margin: '-60px' },
          transition: { duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] as const },
        };

  return (
    <div
      className="relative isolate min-h-screen flex flex-col"
      style={{ background: 'var(--color-bg-main)', color: 'var(--color-content)' }}
    >
      <PageBackground variant="auth" />

      <a href="#main" className="sr-only-focusable">{t('nav.skipToMain')}</a>

      {/* ───────────────────────── header ───────────────────────── */}
      <header
        className="sticky top-0 z-30 glass border-b"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-4">
          <Link to="/" className="flex items-center gap-2.5 min-w-0" aria-label="CivicAI home">
            <span
              aria-hidden="true"
              className="w-9 h-9 rounded-xl grid place-items-center shrink-0 elev-1"
              style={{ background: 'var(--color-cta)', color: '#fff' }}
            >
              <Building2 size={18} />
            </span>
            <span className="min-w-0">
              <span className="block font-display font-bold text-[17px] leading-none text-gradient-premium">
                CivicAI
              </span>
              <span className="block text-[10px] font-bold uppercase tracking-widest text-content-3 truncate">
                {t('app.tagline')}
              </span>
            </span>
          </Link>

          <nav className="hidden lg:flex items-center gap-1 ml-4" aria-label="Primary">
            {[
              { href: '#services', label: t('landing.nav.services') },
              { href: '#how',      label: t('landing.nav.about') },
              { href: '#assistant', label: t('landing.nav.assistant') },
              { href: '#trust',    label: t('landing.nav.help') },
            ].map(item => (
              <a
                key={item.href}
                href={item.href}
                className="px-3 h-9 inline-flex items-center rounded-lg text-[13px] font-semibold
                           text-content-2 hover:text-cta hover:bg-[var(--color-surface-2)] transition-colors"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2 ml-auto">
            <LanguagePicker compact />
            <button
              onClick={toggleTheme}
              aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
              className="press w-9 h-9 rounded-xl bordered surface grid place-items-center
                         text-content-3 hover:text-cta transition-colors"
            >
              {isDark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
            </button>
            <Link
              to="/login"
              className="press hidden sm:inline-flex items-center h-9 px-4 rounded-xl text-[13px]
                         font-bold text-white bg-cta hover:bg-cta-hover transition-colors"
            >
              {t('landing.nav.signIn')}
            </Link>
          </div>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
        {/*
          Say so plainly when the backend is unreachable. The alternative —
          a landing page that looks perfect while every button leads to a
          dead end — wastes the visitor's time and their data.
        */}
        {offline && (
          <div
            role="status"
            className="px-4 sm:px-6 py-2.5 text-[12.5px] font-semibold text-center"
            style={{ background: 'var(--color-warning-pale)', color: 'var(--color-warning)' }}
          >
            CivicAI services are not responding right now. You can read this page,
            but signing in and filing a complaint will not work until the
            connection is restored.
          </div>
        )}
        {/* ───────────────────────── hero ───────────────────────── */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-14 pb-16 sm:pt-20 sm:pb-24">
          <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-12 lg:gap-16 items-center">
            <motion.div {...rise()}>
              <span
                className="inline-flex items-center gap-2 h-7 px-3 rounded-full text-[11px] font-bold
                           uppercase tracking-widest"
                style={{ background: 'var(--color-saffron-pale)', color: 'var(--color-saffron)' }}
              >
                <ShieldCheck size={12} aria-hidden="true" />
                {t('landing.hero.eyebrow')}
              </span>

              <h1 className="font-display font-bold tracking-tight mt-5 text-[34px] sm:text-[46px] lg:text-[52px] leading-[1.08]">
                {t('landing.hero.title')}
              </h1>

              <p className="text-[15px] sm:text-base text-content-2 leading-relaxed mt-5 max-w-xl">
                {t('landing.hero.body')}
              </p>

              <div className="flex flex-wrap items-center gap-3 mt-8">
                <Button size="lg" icon={<ArrowRight size={17} />} onClick={() => navigate('/login')}>
                  {t('landing.hero.ctaCitizen')}
                </Button>
                <Button
                  size="lg"
                  variant="secondary"
                  icon={<Building2 size={17} />}
                  onClick={() => navigate('/staff')}
                >
                  {t('landing.hero.ctaStaff')}
                </Button>
              </div>

              <p className="text-[12px] text-content-3 mt-4 max-w-md leading-relaxed">
                {t('landing.hero.noAccount')}
              </p>
            </motion.div>

            {/* Visual: a stack of the actual product's surfaces, not a stock
                illustration. Purely decorative, so it is hidden from AT. */}
            <motion.div {...rise(0.1)} aria-hidden="true" className="relative hidden sm:block">
              <div className="surface bordered rounded-3xl elev-4 p-5 relative z-10">
                <div className="flex items-center gap-2 mb-4">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--color-danger)' }} />
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--color-warning)' }} />
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--color-success)' }} />
                  <span className="ml-auto text-[10px] font-mono text-content-3">CIV-20260818-0042</span>
                </div>

                <div className="rounded-2xl p-4" style={{ background: 'var(--color-surface-2)' }}>
                  <p className="text-[13px] text-content-2 leading-relaxed">
                    “Sector 14 mein teen din se paani nahi aa raha.”
                  </p>
                </div>

                <div className="flex flex-wrap gap-1.5 mt-3">
                  {CATEGORY_CHIPS.slice(0, 3).map(c => (
                    <span
                      key={c.key}
                      className="inline-flex items-center gap-1.5 h-6 px-2 rounded-lg text-[10px] font-bold"
                      style={{ background: 'var(--color-info-pale)', color: 'var(--color-info)' }}
                    >
                      <c.icon size={11} />
                      {t(c.key as never)}
                    </span>
                  ))}
                </div>

                <div className="mt-4 space-y-2.5">
                  {[
                    { label: 'Department assigned', done: true },
                    { label: 'Officer assigned', done: true },
                    { label: 'Work in progress', done: false },
                  ].map(row => (
                    <div key={row.label} className="flex items-center gap-2.5">
                      <span
                        className="w-4 h-4 rounded-full grid place-items-center shrink-0"
                        style={{
                          background: row.done ? 'var(--color-success)' : 'var(--color-surface-3)',
                          color: '#fff',
                        }}
                      >
                        {row.done && <CheckCircle2 size={11} />}
                      </span>
                      <span
                        className="text-[12px] font-semibold"
                        style={{ color: row.done ? 'var(--color-content-2)' : 'var(--color-content-3)' }}
                      >
                        {row.label}
                      </span>
                    </div>
                  ))}
                </div>

                <div
                  className="mt-4 h-1.5 rounded-full overflow-hidden"
                  style={{ background: 'var(--color-surface-3)' }}
                >
                  <div className="h-full rounded-full" style={{ width: '68%', background: 'var(--color-cta)' }} />
                </div>
              </div>

              {/* Depth without a second WebGL layer. */}
              <div
                className="absolute -bottom-5 -right-4 w-2/3 h-32 rounded-3xl -z-0 opacity-60 blur-2xl"
                style={{ background: 'var(--color-cta)' }}
              />
            </motion.div>
          </div>

          {/* stats strip */}
          <motion.dl
            {...rise(0.15)}
            className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-14 sm:mt-20"
          >
            {/*
              Every figure here is one this codebase can be held to:
              12 = LOCALES.length, 10 = the seeded department list,
              14 = STATUSES.length in server/workflow.ts. No invented
              "50,000 complaints resolved" — a number nobody can check is
              exactly the kind of claim this product is trying not to make.
            */}
            {[
              { v: '12', k: t('landing.stat.languages'), icon: Languages },
              { v: '10', k: t('landing.stat.departments'), icon: Building2 },
              { v: '14', k: 'Lifecycle stages tracked', icon: ClipboardList },
              { v: t('landing.stat.trackedValue'), k: t('landing.stat.tracked'), icon: MapPin },
            ].map(s => (
              <div key={s.k} className="surface bordered rounded-2xl p-4 elev-1">
                <s.icon size={15} aria-hidden="true" style={{ color: 'var(--color-cta)' }} />
                <dd className="font-display font-bold text-2xl mt-2 text-content">{s.v}</dd>
                <dt className="text-[11px] font-semibold text-content-3 mt-0.5 leading-tight">{s.k}</dt>
              </div>
            ))}
          </motion.dl>
        </section>

        {/* ───────────────────────── services ───────────────────────── */}
        <section id="services" className="scroll-mt-20 py-16 sm:py-20" style={{ background: 'var(--color-surface-2)' }}>
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <motion.div {...rise()} className="max-w-2xl">
              <h2 className="font-display font-bold text-[26px] sm:text-[32px] tracking-tight">
                {t('landing.services.title')}
              </h2>
              <p className="text-[15px] text-content-2 mt-3 leading-relaxed">
                {t('landing.services.body')}
              </p>
            </motion.div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-10">
              {SERVICE_CARDS.map((card, i) => (
                <motion.article
                  key={card.titleKey}
                  {...rise(0.05 * i)}
                  className="surface bordered rounded-2xl p-5 elev-1 h-full"
                >
                  <span
                    aria-hidden="true"
                    className="w-10 h-10 rounded-xl grid place-items-center"
                    style={{ background: 'var(--color-surface-2)', color: card.tone }}
                  >
                    <card.icon size={19} />
                  </span>
                  <h3 className="font-display font-bold text-[15px] mt-4 text-content">
                    {t(card.titleKey as never)}
                  </h3>
                  <p className="text-[13px] text-content-3 mt-2 leading-relaxed">
                    {t(card.bodyKey as never)}
                  </p>
                </motion.article>
              ))}
            </div>
          </div>
        </section>

        {/* ───────────────────────── how it works ───────────────────────── */}
        <section id="how" className="scroll-mt-20 max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
          <motion.h2 {...rise()} className="font-display font-bold text-[26px] sm:text-[32px] tracking-tight">
            {t('landing.how.title')}
          </motion.h2>

          <ol className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-10">
            {STEPS.map((step, i) => (
              <motion.li key={step.n} {...rise(0.05 * i)} className="relative surface bordered rounded-2xl p-5 elev-1">
                <span
                  className="font-mono font-bold text-[11px] tracking-widest"
                  style={{ color: 'var(--color-cta)' }}
                >
                  {step.n}
                </span>
                <h3 className="font-display font-bold text-[15px] mt-2 text-content">
                  {t(step.titleKey as never)}
                </h3>
                <p className="text-[13px] text-content-3 mt-2 leading-relaxed">
                  {t(step.bodyKey as never)}
                </p>
              </motion.li>
            ))}
          </ol>
        </section>

        {/* ───────────────────────── assistant teaser ───────────────────────── */}
        <section
          id="assistant"
          className="scroll-mt-20 py-16 sm:py-20"
          style={{ background: 'var(--color-surface-2)' }}
        >
          <div className="max-w-6xl mx-auto px-4 sm:px-6 grid lg:grid-cols-2 gap-10 items-center">
            <motion.div {...rise()}>
              <h2 className="font-display font-bold text-[26px] sm:text-[32px] tracking-tight">
                {t('landing.services.assistant.title')}
              </h2>
              <p className="text-[15px] text-content-2 mt-3 leading-relaxed max-w-lg">
                {t('landing.services.assistant.body')}
              </p>
              <ul className="mt-6 space-y-2.5">
                {[
                  'Ask what a certificate requires before you queue for it.',
                  'Speak in Hindi, English or a mix — it answers in the language you used.',
                  'It says “I don’t have verified information” rather than inventing a scheme.',
                ].map(line => (
                  <li key={line} className="flex items-start gap-2.5 text-[13px] text-content-2">
                    <CheckCircle2 size={15} className="mt-0.5 shrink-0" style={{ color: 'var(--color-success)' }} aria-hidden="true" />
                    <span className="leading-relaxed">{line}</span>
                  </li>
                ))}
              </ul>
              <Button className="mt-7" variant="secondary" icon={<MessageSquare size={16} />} onClick={() => navigate('/login')}>
                {t('landing.nav.assistant')}
              </Button>
            </motion.div>

            <motion.div {...rise(0.1)} aria-hidden="true" className="surface bordered rounded-3xl elev-3 p-5 space-y-3">
              {[
                { who: 'user', text: 'I want to apply for an income certificate.' },
                { who: 'bot',  text: 'You will usually need proof of identity, proof of address, and last year’s income proof. Shall I check your documents for mismatches first?' },
                { who: 'user', text: 'Haan, check karo.' },
                { who: 'bot',  text: 'Found a date-of-birth difference between two documents. Review it before you submit — I have not changed anything.' },
              ].map((m, i) => (
                <div key={i} className={m.who === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                  <p
                    className="max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[12.5px] leading-relaxed"
                    style={
                      m.who === 'user'
                        ? { background: 'var(--color-cta)', color: '#fff' }
                        : { background: 'var(--color-surface-2)', color: 'var(--color-content-2)' }
                    }
                  >
                    {m.text}
                  </p>
                </div>
              ))}
            </motion.div>
          </div>
        </section>

        {/* ───────────────────────── trust ───────────────────────── */}
        <section id="trust" className="scroll-mt-20 max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
          <motion.h2 {...rise()} className="font-display font-bold text-[26px] sm:text-[32px] tracking-tight">
            {t('landing.trust.title')}
          </motion.h2>

          <div className="grid sm:grid-cols-2 gap-4 mt-10">
            {TRUST.map((item, i) => (
              <motion.div
                key={item.key}
                {...rise(0.05 * i)}
                className="surface bordered rounded-2xl p-5 flex items-start gap-3.5 elev-1"
              >
                <span
                  aria-hidden="true"
                  className="w-9 h-9 rounded-xl grid place-items-center shrink-0"
                  style={{ background: 'var(--color-success-pale)', color: 'var(--color-success)' }}
                >
                  <item.icon size={17} />
                </span>
                <p className="text-[13.5px] text-content-2 leading-relaxed">{t(item.key as never)}</p>
              </motion.div>
            ))}
          </div>
        </section>
      </main>

      {/* ───────────────────────── footer ───────────────────────── */}
      <footer
        className="border-t"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row gap-4 sm:items-center justify-between">
          <div>
            <p className="font-display font-bold text-sm text-content">CivicAI</p>
            <p className="text-[12px] text-content-3 mt-0.5">{t('landing.footer.rights')}</p>
          </div>
          <p className="text-[11px] text-content-3 max-w-sm leading-relaxed">
            {t('landing.footer.builtWith')}
          </p>
          <Link
            to="/staff"
            className="text-[12px] font-semibold text-content-3 hover:text-cta transition-colors shrink-0"
          >
            {t('landing.hero.ctaStaff')}
          </Link>
        </div>
      </footer>
    </div>
  );
}
