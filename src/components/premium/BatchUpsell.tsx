import { Crown, Layers } from 'lucide-react'
import { Spinner } from '@/components/swapbridge/parts'
import { FREE_LIMITS, PREMIUM_LIMITS } from '@/config/plans'
import type { BatchPlan } from '@/hooks/useBatchPlan'
import { useI18n } from '@/i18n'
import { PremiumNote, usePriceText } from './PremiumNote'

const mb = (bytes: number) => Math.round(bytes / 1048576)

/** Inline (never modal) explanation of the free limits, with a one-click Pro batch session when files were held back. */
export function BatchUpsell({ plan }: { plan: BatchPlan }) {
  const { t, m } = useI18n()
  const cost = usePriceText()(['pro-batch'])
  if (plan.pro) {
    return (
      <p className="gp-inner mb-4 flex items-center gap-2 px-3 py-2 text-xs text-mist" role="status">
        <Crown size={13} className="shrink-0 text-[var(--gp-gold)]" />
        {t('batch.active', { files: PREMIUM_LIMITS.maxFiles, mb: mb(PREMIUM_LIMITS.maxFileBytes) })}
      </p>
    )
  }
  if (plan.held.length === 0) return null
  return (
    <div className="gp-card mb-4 p-4" role="status">
      <p className="flex items-start gap-2 text-sm font-semibold">
        <Layers size={16} className="mt-0.5 shrink-0 text-[var(--gp-gold)]" />
        {t('batch.held', { n: plan.held.length })}
      </p>
      <p className="mt-1 text-sm text-mist">{t('batch.free', { files: FREE_LIMITS.maxFiles, mb: mb(FREE_LIMITS.maxFileBytes) })}</p>
      <p className="mt-1 text-sm text-mist">{t('batch.pro', { files: PREMIUM_LIMITS.maxFiles, mb: mb(PREMIUM_LIMITS.maxFileBytes) })}</p>
      {plan.error && <p className="mt-2 text-sm text-red-300" role="alert">{m(plan.error)}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" className="gp-btn gp-btn-primary gp-btn-sm" disabled={plan.unlocking || !plan.px.available} onClick={() => void plan.unlock()}>
          {plan.unlocking ? <Spinner label={t('pay.confirmWallet')} /> : t('batch.unlock', { cost })}
        </button>
        <span className="text-xs text-mist">{t('batch.keepFree')}</span>
      </div>
      <PremiumNote ops={['pro-batch']} px={plan.px} />
    </div>
  )
}
