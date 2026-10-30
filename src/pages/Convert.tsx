import { lazy, Suspense } from 'react'
import { Ban, Crown, Lock } from 'lucide-react'
import { ImageConverter } from '@/components/convert/ImageConverter'
import { ToolHeader } from '@/components/ui'
import { usePriceText } from '@/components/premium/PremiumNote'
import { useI18n } from '@/i18n'
import { CATALOG, CATEGORIES, toolInfo, type CatalogTool, type ToolStatus } from '@/lib/convert/catalog'
import { Link, navigate, usePath } from '@/lib/router'

const STATUS_STYLE: Record<ToolStatus, string> = {
  ready: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  basic: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  unsupported: 'border-red-400/30 bg-red-400/10 text-red-300',
}

function StatusChip({ status }: { status: ToolStatus }) {
  const { t } = useI18n()
  const label = status === 'ready' ? 'cv.badge.ready' : status === 'basic' ? 'cv.badge.basic' : 'cv.badge.unsupported'
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[status]}`}>{t(label)}</span>
}

function ToolCardButton({ tool, active }: { tool: CatalogTool; active: boolean }) {
  const { t } = useI18n()
  const costOf = usePriceText()
  const op = tool.premium ? { id: tool.premium } : null
  return (
    <button
      type="button"
      onClick={() => navigate(`/convert/${tool.id}`)}
      aria-pressed={active}
      className={`gp-card gp-card-hover flex h-full flex-col p-4 text-left ${active ? 'ring-1 ring-[var(--gp-gold)]' : ''}`}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="font-display text-base font-semibold">{t(tool.title)}</span>
        <StatusChip status={tool.status} />
      </span>
      <span className="mt-1.5 flex-1 text-pretty text-xs leading-relaxed text-mist">{t(tool.desc)}</span>
      <span className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="gp-chip !px-2 !py-0.5">{tool.from}</span>
        <span className="text-mist">→</span>
        <span className="gp-chip !px-2 !py-0.5">{tool.to}</span>
        {op && (
          <span className="ml-auto inline-flex items-center gap-1 text-[var(--gp-gold)]" title={t('cv.premiumTip')}>
            <Crown size={11} /> {costOf([op.id])}
          </span>
        )}
        {!op && tool.status !== 'unsupported' && (
          <span className="ml-auto inline-flex items-center gap-1 text-mist"><Lock size={11} /> {t('cv.free')}</span>
        )}
      </span>
    </button>
  )
}

function LoadingEngine() {
  const { t } = useI18n()
  return <p className="py-8 text-center text-sm text-mist" role="status">{t('common.loading')}</p>
}

function Unsupported({ tool }: { tool: CatalogTool }) {
  const { t } = useI18n()
  const alt = tool.alternative ? toolInfo(tool.alternative) : null
  return (
    <div className="gp-card p-5 sm:p-6" role="status">
      <p className="flex items-center gap-2 font-display text-lg font-semibold">
        <Ban size={18} className="text-red-300" /> {t('cv.unsupported.title', { tool: t(tool.title) })}
      </p>
      <p className="mt-2 max-w-2xl text-pretty text-sm text-mist">{tool.reason ? t(tool.reason) : null}</p>
      <p className="mt-2 max-w-2xl text-pretty text-sm text-mist">{t('cv.unsupported.noFake')}</p>
      {alt && (
        <Link to={`/convert/${alt.id}`} className="gp-btn gp-btn-primary gp-btn-sm mt-4">
          {t('cv.unsupported.use', { tool: t(alt.title) })}
        </Link>
      )}
    </div>
  )
}

// PDF, document and spreadsheet engines (pdf-lib, pdf.js) load only when one of those tools is opened.
const GenericTool = lazy(() => import('@/components/convert/GenericTool'))
// The speech model engine (Transformers.js) is loaded only when Audio to Text is opened, and the model itself only on request.
const AudioToText = lazy(() => import('@/components/convert/AudioToText'))
const PdfOrganizer = lazy(() => import('@/components/convert/PdfOrganizer').then((m) => ({ default: m.PdfOrganizer })))

export default function Convert() {
  const { t } = useI18n()
  const path = usePath()
  const id = path.split('/')[2] ?? 'image-convert'
  const tool: CatalogTool = toolInfo(id) ?? CATALOG[0]
  const category = tool.category
  const inCategory = CATALOG.filter((c) => c.category === category)

  let body
  if (tool.status === 'unsupported') body = <Unsupported tool={tool} />
  else if (tool.id === 'image-convert') body = <ImageConverter key="img" />
  else if (tool.id === 'images-to-pdf') body = <ImageConverter key="img2pdf" initialTarget="pdf" />
  else if (tool.id === 'audio-to-text') body = <Suspense fallback={<LoadingEngine />}><AudioToText /></Suspense>
  else if (tool.id === 'pdf-organize') body = <Suspense fallback={<LoadingEngine />}><PdfOrganizer /></Suspense>
  else body = <Suspense fallback={<LoadingEngine />}><GenericTool key={tool.id} id={tool.id} /></Suspense>

  return (
    <div className="gp-page mx-auto max-w-6xl px-4 pb-8 pt-8 sm:px-6">
      <ToolHeader id="convert" />

      <div role="tablist" aria-label={t('cv.cats.aria')} className="mb-4 flex flex-wrap gap-2">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={category === c.id}
            onClick={() => navigate(`/convert/${(CATALOG.find((x) => x.category === c.id) as CatalogTool).id}`)}
            className={`min-h-[40px] rounded-full border px-4 text-sm font-medium transition-colors ${category === c.id ? 'border-[var(--gp-gold)] bg-[rgba(245,197,66,0.12)] text-[var(--gp-gold)]' : 'border-white/10 text-mist hover:text-ink'}`}
          >
            {t(c.label)}
          </button>
        ))}
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" role="tabpanel">
        {inCategory.map((c) => (
          <ToolCardButton key={c.id} tool={c} active={c.id === tool.id} />
        ))}
      </div>

      <section className="gp-card p-4 sm:p-6" aria-labelledby="workspace-h">
        <h2 id="workspace-h" className="font-display mb-1 text-xl font-semibold">{t(tool.title)}</h2>
        <p className="mb-5 text-sm text-mist">{t(tool.desc)}</p>
        {body}
      </section>

      <p className="mt-4 text-xs text-mist">{t('cv.legend')}</p>
    </div>
  )
}
