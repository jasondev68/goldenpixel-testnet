import { useState } from 'react'
import { ArrowLeftRight, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { Dropzone } from '@/components/ui'
import { ToolCard } from '@/components/ToolCard'
import { Link, navigate } from '@/lib/router'
import { TOOLS, setHandoff } from '@/lib/tools'
import { useI18n } from '@/i18n'

export default function Dashboard() {
  const { t } = useI18n()
  const [files, setFiles] = useState<File[]>([])

  const accept = (incoming: File[]) => {
    const images = incoming.filter((f) => f.type.startsWith('image/'))
    if (images.length < incoming.length) toast.error(t('dash.onlyImages'))
    if (images.length) setFiles(images)
  }

  return (
    <div className="gp-page mx-auto max-w-6xl px-4 pb-8 pt-8 sm:px-6 sm:pt-12">
      <p className="gp-eyebrow">{t('dash.eyebrow')}</p>
      <h1 className="font-display mt-2 text-balance text-3xl font-bold sm:text-5xl">
        {t('dash.title.a')} <span className="gp-gold-text">{t('dash.title.b')}</span>
      </h1>
      <p className="mt-3 max-w-xl text-pretty text-mist">{t('dash.lead')}</p>

      <div className="mt-8">
        {files.length === 0 ? (
          <Dropzone onFiles={accept} title={t('dash.drop.title')} hint={t('dash.drop.hint')} />
        ) : (
          <div className="gp-card gp-page p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-display text-lg font-semibold tabular-nums">
                  {files.length === 1 ? t('dash.ready.one') : t('dash.ready.many', { n: files.length })}
                </p>
                <p className="mt-1 max-w-md truncate text-sm text-mist">{files.map((f) => f.name).join(', ')}</p>
              </div>
              <button type="button" className="gp-btn gp-btn-ghost gp-btn-sm shrink-0 !px-3" onClick={() => setFiles([])} aria-label={t('dash.clear.aria')}>
                <X size={14} /> {t('common.clear')}
              </button>
            </div>
            <p className="mb-3 mt-5 text-sm font-medium">{t('dash.choose')}</p>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {TOOLS.map((tool) => (
                <button
                  key={tool.id}
                  type="button"
                  className="gp-inner flex min-h-[72px] items-center gap-3 px-4 text-left transition-colors hover:border-[var(--gp-line-strong)] hover:bg-[rgba(245,197,66,0.07)]"
                  onClick={() => {
                    setHandoff(files, tool.id)
                    navigate(tool.path)
                  }}
                >
                  <tool.icon size={20} className="shrink-0 text-[var(--gp-gold)]" />
                  <span className="min-w-0 text-sm font-semibold">{t(tool.short)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <h2 className="font-display mb-4 mt-12 text-xl font-semibold">{t('dash.allTools')}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {TOOLS.map((tool, i) => (
          <ToolCard key={tool.id} tool={tool} index={i} />
        ))}
      </div>

      <h2 className="font-display mb-4 mt-12 text-xl font-semibold">{t('dash.web3')}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Link to="/swap-bridge" className="gp-card gp-card-hover flex items-center gap-4 p-5">
          <ArrowLeftRight className="shrink-0 text-[var(--gp-gold)]" size={22} />
          <span>
            <span className="block font-display font-semibold">{t('nav.swapBridge')}</span>
            <span className="text-sm text-mist">{t('dash.sb.desc')}</span>
          </span>
        </Link>
        <Link to="/premium" className="gp-card gp-card-hover flex items-center gap-4 p-5">
          <Sparkles className="shrink-0 text-[var(--gp-gold)]" size={22} />
          <span>
            <span className="block font-display font-semibold">{t('dash.premium.title')}</span>
            <span className="text-sm text-mist">{t('dash.premium.desc')}</span>
          </span>
        </Link>
      </div>
    </div>
  )
}
