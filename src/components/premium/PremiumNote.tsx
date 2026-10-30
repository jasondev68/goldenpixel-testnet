import { CheckCircle2, Crown } from 'lucide-react'
import { usePremiumAction, type PremiumAction } from '@/hooks/usePremiumAction'
import { PREMIUM_FEATURES, type PremiumFeatureId } from '@/config/payments'
import { useI18n } from '@/i18n'
import { usePaymentSession } from '@/lib/payments/session'
import { shortAddress } from '@/lib/web3'

/** "0.10 USDC" while something still has to be paid for, otherwise "unlocked" (this session). */
export function usePriceText() {
  const { t, fmt } = useI18n()
  const px = usePremiumAction()
  return (features: readonly PremiumFeatureId[]) => {
    const todo = px.missing(features)
    return todo.length === 0 ? t('px.unlocked') : `${fmt.usdc(px.priceOf(features))} USDC`
  }
}

/**
 * Quiet, inline explanation next to a premium action: the exact price, that one payment unlocks the feature for this
 * session, and what is needed next. Never a popup, and it never blocks the free path.
 */
export function PremiumNote({ ops, px }: { ops: readonly PremiumFeatureId[]; px: PremiumAction }) {
  const { t, td, fmt } = useI18n()
  const session = usePaymentSession()
  const todo = px.missing(ops)
  const price = fmt.usdc(px.priceOf(ops))
  const paid = session.payments().find((p) => ops.some((o) => p.features.includes(o)) && session.isVerified(p.txHash))
  return (
    <div className="gp-inner mt-2 p-3 text-xs leading-relaxed text-mist">
      {todo.length === 0 ? (
        <p className="flex items-start gap-1.5 text-ink">
          <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-emerald-400" />
          <span>
            {t('px.unlockedNote', { features: ops.map((o) => td(`op.${o}.label`, PREMIUM_FEATURES[o].label)).join(' + ') })}
            {paid && <> · {shortAddress(paid.txHash)}</>}
          </span>
        </p>
      ) : (
        <p className="flex items-start gap-1.5 text-ink">
          <Crown size={13} className="mt-0.5 shrink-0 text-[var(--gp-gold)]" />
          <span>{t('px.price', { price })}</span>
        </p>
      )}
      {!px.available && <p className="mt-1.5">{t('px.err.unavailable')}</p>}
      {px.available && !px.isConnected && todo.length > 0 && <p className="mt-1.5">{t('px.needWallet')}</p>}
      <p className="mt-1.5 opacity-80">{t('px.honest')}</p>
    </div>
  )
}
