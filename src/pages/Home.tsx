import { ArrowRight, Download, Lock, Sliders, Sparkles, UploadCloud, Zap } from 'lucide-react'
import { Link } from '@/lib/router'
import { TOOLS } from '@/lib/tools'
import { ToolCard } from '@/components/ToolCard'
import { useI18n, type TKey } from '@/i18n'

const FEATURES: { icon: typeof Lock; title: TKey; body: TKey }[] = [
  { icon: Lock, title: 'home.f1.title', body: 'home.f1.body' },
  { icon: Zap, title: 'home.f2.title', body: 'home.f2.body' },
  { icon: Sparkles, title: 'home.f3.title', body: 'home.f3.body' },
]

const STEPS: { icon: typeof Lock; title: TKey; body: TKey }[] = [
  { icon: UploadCloud, title: 'home.s1.title', body: 'home.s1.body' },
  { icon: Sliders, title: 'home.s2.title', body: 'home.s2.body' },
  { icon: Download, title: 'home.s3.title', body: 'home.s3.body' },
]

function HeroPreview() {
  const { t } = useI18n()
  return (
    <div className="gp-card gp-float mx-auto w-full max-w-md p-4" aria-hidden="true">
      <div className="flex items-center gap-1.5 pb-3">
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--gp-gold)]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--gp-gold)]/50" />
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--gp-gold)]/25" />
        <span className="ml-auto gp-chip">{t('tool.editor.title')}</span>
      </div>
      <div className="relative aspect-[4/3] overflow-hidden rounded-xl border border-white/10" style={{ background: 'radial-gradient(60% 70% at 70% 30%, #ffe08a 0%, rgba(245,197,66,0.4) 30%, transparent 62%), radial-gradient(70% 80% at 20% 90%, #5b3aa8 0%, transparent 65%), linear-gradient(160deg, #1a1530, #05050a)' }}>
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/70 to-transparent" />
        <div className="absolute bottom-3 left-3 flex gap-1.5">
          <span className="gp-chip !bg-black/60">{t('preset.golden')}</span>
          <span className="gp-chip !bg-black/60">{t('home.hero.optimized')}</span>
        </div>
      </div>
      <div className="mt-4 grid gap-3">
        {[68, 42, 84].map((w, i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="h-2 w-16 rounded-full bg-white/10" />
            <span className="relative h-1 flex-1 rounded-full bg-white/10">
              <span className="absolute inset-y-0 left-0 rounded-full bg-[var(--gp-gold)]" style={{ width: `${w}%` }} />
              <span className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 border-[var(--gp-gold)] bg-[#fff1b8] shadow-[0_0_10px_var(--gp-gold)]" style={{ left: `calc(${w}% - 7px)` }} />
            </span>
          </div>
        ))}
      </div>
      <div className="gp-btn gp-btn-primary mt-4 w-full">
        <Download size={16} /> {t('common.download')}
      </div>
    </div>
  )
}

export default function Home() {
  const { t } = useI18n()
  return (
    <div className="gp-page">
      {/* Hero */}
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-10 sm:px-6 sm:pt-16 lg:grid-cols-[1.1fr_0.9fr] lg:pt-24">
        <div>
          <span className="gp-chip">
            <Lock size={12} /> {t('home.badge')}
          </span>
          <h1 className="font-display mt-6 text-balance text-4xl font-bold leading-[1.05] sm:text-6xl">
            {t('home.h1.a')} <span className="gp-gold-text">{t('home.h1.b')}</span>
          </h1>
          <p className="mt-6 max-w-xl text-pretty text-base leading-relaxed text-mist sm:text-lg">
            {t('home.lead')}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/tools" className="gp-btn gp-btn-primary">
              {t('home.cta.open')} <ArrowRight size={16} />
            </Link>
            <Link to="/editor" className="gp-btn gp-btn-ghost">
              {t('home.cta.edit')}
            </Link>
          </div>
        </div>
        <HeroPreview />
      </section>

      {/* Tools */}
      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6" aria-labelledby="tools-heading">
        <p className="gp-eyebrow">{t('home.toolkit.eyebrow')}</p>
        <h2 id="tools-heading" className="font-display mt-2 text-balance text-3xl font-bold sm:text-4xl">
          {t('home.toolkit.title')}
        </h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {TOOLS.map((t, i) => (
            <ToolCard key={t.id} tool={t} index={i} />
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid gap-4 md:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="gp-card p-6">
              <f.icon size={22} className="text-[var(--gp-gold)]" />
              <h3 className="font-display mt-4 text-lg font-semibold">{t(f.title)}</h3>
              <p className="mt-2 text-pretty text-sm leading-relaxed text-mist">{t(f.body)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Steps */}
      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <p className="gp-eyebrow">{t('home.how.eyebrow')}</p>
        <h2 className="font-display mt-2 text-balance text-3xl font-bold sm:text-4xl">{t('home.how.title')}</h2>
        <ol className="mt-8 grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="gp-inner flex items-start gap-4 p-5">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[var(--gp-line-strong)] font-display font-bold tabular-nums text-[var(--gp-gold)]">{i + 1}</span>
              <div>
                <h3 className="font-display font-semibold">{t(s.title)}</h3>
                <p className="mt-1 text-sm text-mist">{t(s.body)}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-4 pt-12 sm:px-6">
        <div className="gp-card relative overflow-hidden p-8 text-center sm:p-14" style={{ background: 'radial-gradient(70% 120% at 50% 0%, rgba(245,197,66,0.16), transparent 70%), var(--gp-card)' }}>
          <h2 className="font-display mx-auto max-w-xl text-balance text-3xl font-bold sm:text-4xl">{t('home.final.title')}</h2>
          <p className="mx-auto mt-4 max-w-md text-pretty text-mist">{t('home.final.body')}</p>
          <Link to="/tools" className="gp-btn gp-btn-primary mt-8">
            {t('home.final.cta')} <ArrowRight size={16} />
          </Link>
        </div>
      </section>
    </div>
  )
}
