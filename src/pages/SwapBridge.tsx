import { useState } from 'react'
import { ArrowLeftRight, Repeat2, ShieldCheck } from 'lucide-react'
import { SwapPanel } from '@/components/swapbridge/SwapPanel'
import { BridgePanel } from '@/components/swapbridge/BridgePanel'
import { Notice } from '@/components/swapbridge/parts'
import { Segmented } from '@/components/ui'
import { useI18n } from '@/i18n'

export default function SwapBridge() {
  const { t } = useI18n()
  const [tab, setTab] = useState<'swap' | 'bridge'>('swap')
  return (
    <div className="gp-page mx-auto max-w-5xl px-4 pb-8 pt-8 sm:px-6 sm:pt-12">
      <p className="gp-eyebrow">{t('dash.web3')}</p>
      <h1 className="font-display mt-2 text-balance text-3xl font-bold sm:text-5xl">
        {t('sb.title.a')} <span className="gp-gold-text">{t('sb.title.b')}</span> {t('sb.title.c')}
      </h1>
      <p className="mt-3 max-w-xl text-pretty text-mist">{t('sb.lead')}</p>

      <div className="mt-8 grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="gp-card p-4 sm:p-6">
          <div className="mb-5 max-w-xs">
            <Segmented label={t('sb.tabs')} value={tab} onChange={setTab} options={[{ value: 'swap', label: t('sb.swap') }, { value: 'bridge', label: t('sb.bridge') }]} />
          </div>
          {tab === 'swap' ? <SwapPanel /> : <BridgePanel />}
        </div>

        <aside className="grid content-start gap-4">
          <div className="gp-card p-5">
            <p className="gp-eyebrow flex items-center gap-2"><Repeat2 size={14} /> {t('sb.swap')}</p>
            <p className="mt-2 text-sm text-mist">{t('sb.swap.desc')}</p>
          </div>
          <div className="gp-card p-5">
            <p className="gp-eyebrow flex items-center gap-2"><ArrowLeftRight size={14} /> {t('sb.bridge')}</p>
            <p className="mt-2 text-sm text-mist">{t('sb.bridge.desc')}</p>
          </div>
          <Notice tone="info">
            <span className="flex items-start gap-2"><ShieldCheck size={14} className="mt-0.5 shrink-0" /> {t('sb.safe')}</span>
          </Notice>
        </aside>
      </div>
    </div>
  )
}
