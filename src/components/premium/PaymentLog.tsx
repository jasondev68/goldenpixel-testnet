import { ExternalLink } from 'lucide-react'
import { PREMIUM_FEATURES } from '@/config/payments'
import { useI18n } from '@/i18n'
import { paymentConfig } from '@/lib/payments/client'
import { usePaymentSession } from '@/lib/payments/session'
import { shortAddress } from '@/lib/web3'
import { formatUnitsExact } from '@/onchain-money'

/** Payments made in this browser session, each with its transaction hash and an explorer link. Stored in the tab only. */
export function PaymentLog() {
  const { t, td, fmt } = useI18n()
  const session = usePaymentSession()
  const cfg = paymentConfig()
  const list = session.payments()
  const pending = session.pending()
  if (list.length === 0 && !pending) return <p className="text-sm text-mist">{t('log.empty')}</p>
  return (
    <div className="grid gap-2.5">
      {pending && (
        <div className="gp-inner p-3 text-sm">
          <p className="font-semibold">{pending.features.map((id) => td(`op.${id}.label`, PREMIUM_FEATURES[id].label)).join(' + ')}</p>
          <p className="mt-1 text-xs text-amber-300">{t('log.pending')}</p>
          <a className="mt-1 inline-flex items-center gap-1 text-xs text-mist underline underline-offset-2" href={`${cfg.explorerBase}/tx/${pending.txHash}`} target="_blank" rel="noreferrer">
            {shortAddress(pending.txHash)} <ExternalLink size={11} />
          </a>
        </div>
      )}
      {list.map((p) => {
        const verified = session.isVerified(p.txHash)
        return (
          <div key={p.txHash} className="gp-inner p-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <span className="min-w-0">
                {p.features.map((id) => td(`op.${id}.label`, PREMIUM_FEATURES[id].label)).join(' + ')}
                <span className="block text-xs text-mist">{fmt.date(new Date(p.verifiedAt))}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block tabular-nums font-semibold text-[var(--gp-gold)]">{fmt.usdc(formatUnitsExact(BigInt(p.amountRaw), cfg.decimals))} USDC</span>
                <span className={`gp-chip !px-2 !py-0 text-[11px] ${verified ? '' : '!border-amber-400/40 !text-amber-300'}`}>{verified ? t('log.verified') : t('log.checking')}</span>
              </span>
            </div>
            <a className="mt-1.5 inline-flex items-center gap-1 text-xs text-mist underline underline-offset-2" href={`${cfg.explorerBase}/tx/${p.txHash}`} target="_blank" rel="noreferrer">
              {t('pay.txHash')}: <span className="font-mono">{shortAddress(p.txHash)}</span> <ExternalLink size={11} />
            </a>
          </div>
        )
      })}
    </div>
  )
}
