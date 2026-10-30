import { Check, Lock, ShieldCheck, Wallet } from 'lucide-react'
import { useAccount, useSwitchChain } from 'wagmi'
import { PaymentLog } from '@/components/premium/PaymentLog'
import { Upscaler } from '@/components/premium/Upscaler'
import { Notice } from '@/components/swapbridge/parts'
import { FREE_FEATURES, PREMIUM_FEATURES } from '@/config/payments'
import { FREE_LIMITS, PREMIUM_LIMITS } from '@/config/plans'
import { useUsdcBalance } from '@/hooks/useChainMoney'
import { OPEN_WALLET_EVENT, usePremiumAction } from '@/hooks/usePremiumAction'
import { useI18n } from '@/i18n'
import { paymentConfig } from '@/lib/payments/client'
import { shortAddress } from '@/lib/web3'

export default function Premium() {
  const { t, td, fmt } = useI18n()
  const px = usePremiumAction()
  const { address, isConnected, chainId } = useAccount()
  const { switchChainAsync, isPending: switching } = useSwitchChain()
  const cfg = px.config ?? paymentConfig()
  const usdc = useUsdcBalance(cfg.chainId)
  const onPaymentNetwork = chainId === cfg.chainId

  return (
    <div className="gp-page mx-auto max-w-6xl px-4 pb-8 pt-8 sm:px-6 sm:pt-12">
      <div className="flex flex-wrap items-center gap-3">
        <p className="gp-eyebrow">{t('nav.premium')}</p>
        <span className="gp-chip">
          <ShieldCheck size={12} /> {cfg.isTestnet ? t('prem.badge.test', { network: cfg.networkName }) : t('prem.badge.live', { network: cfg.networkName })}
        </span>
      </div>
      <h1 className="font-display mt-2 text-balance text-3xl font-bold sm:text-5xl">
        {t('prem.title.a')} <span className="gp-gold-text">{t('prem.title.b')}</span>
      </h1>
      <p className="mt-3 max-w-xl text-pretty text-mist">{t('prem.lead')}</p>

      {cfg.isTestnet && <div className="mt-6"><Notice tone="info">{t('prem.testPayments')}</Notice></div>}
      {!px.available && <div className="mt-6"><Notice tone="warn">{t('px.err.unavailable')} {t('prem.basicWorks')}</Notice></div>}

      <div className="mt-8 grid gap-5 lg:grid-cols-[1fr_1fr]">
        <section className="gp-card p-5 sm:p-6" aria-labelledby="prices-h">
          <h2 id="prices-h" className="font-display text-xl font-semibold">{t('prem.pricing')}</h2>
          <p className="mt-1 text-sm text-mist">{t('prem.pricing.lead')}</p>

          <div className="gp-inner mt-4 p-3 text-sm">
            <p className="flex items-center gap-1.5 text-xs text-mist"><Wallet size={12} /> {t('prem.wallet')}</p>
            {isConnected && address ? (
              <>
                <p className="mt-1 font-mono text-xs">{shortAddress(address)}</p>
                <p className="mt-1 text-xs">
                  <span className={onPaymentNetwork ? 'text-emerald-400' : 'text-amber-300'}>{onPaymentNetwork ? t('prem.network.ok', { network: cfg.networkName }) : t('prem.network.wrong')}</span>
                  {!onPaymentNetwork && (
                    <button type="button" className="ml-2 text-[var(--gp-gold)] underline underline-offset-2" disabled={switching} onClick={() => void switchChainAsync({ chainId: cfg.chainId }).catch(() => undefined)}>
                      {t('common.switchTo', { chain: cfg.networkName })}
                    </button>
                  )}
                </p>
                {usdc.amount && <p className="mt-1 text-xs tabular-nums">{t('pay.balance')}: {fmt.usdc(usdc.amount.toString())} USDC</p>}
              </>
            ) : (
              <button type="button" className="gp-btn gp-btn-primary gp-btn-sm mt-2" onClick={() => window.dispatchEvent(new Event(OPEN_WALLET_EVENT))}>{t('wallet.connect')}</button>
            )}
          </div>

          <div className="mt-4 grid gap-2.5">
            {Object.values(PREMIUM_FEATURES).map((o) => {
              const unlocked = px.isUnlocked([o.id])
              return (
                <div key={o.id} className="gp-inner flex items-center justify-between gap-3 p-3 text-sm">
                  <span><span className="font-semibold">{td(`op.${o.id}.label`, o.label)}</span> <span className="block text-xs text-mist">{td(`op.${o.id}.desc`, o.description)}</span></span>
                  <span className="shrink-0 text-right tabular-nums">
                    <span className="block font-semibold text-[var(--gp-gold)]">{fmt.usdc(o.priceUsdc)} USDC</span>
                    {unlocked && <span className="gp-chip !px-2 !py-0 text-[11px]">{t('px.unlocked')}</span>}
                  </span>
                </div>
              )
            })}
            <div className="gp-inner p-3 text-sm">
              <p className="flex items-center gap-2 font-semibold"><Lock size={13} className="text-[var(--gp-gold)]" /> {t('prem.alwaysFree')}</p>
              <ul className="mt-1.5 grid gap-1 text-mist sm:grid-cols-2">
                {FREE_FEATURES.map((f) => <li key={f.key} className="flex items-center gap-1.5"><Check size={12} className="text-emerald-400" /> {t(f.label)}</li>)}
              </ul>
              <p className="mt-2 text-xs text-mist">{t('prem.freeLimits', { files: FREE_LIMITS.maxFiles, mb: Math.round(FREE_LIMITS.maxFileBytes / 1048576), side: fmt.number(FREE_LIMITS.maxExportSide, 0), collage: fmt.number(FREE_LIMITS.maxCollageSide, 0) })}</p>
              <p className="mt-1 text-xs text-mist">{t('prem.noWallet')}</p>
            </div>
          </div>
        </section>

        <section className="gp-card p-5 sm:p-6" aria-labelledby="log-h">
          <h2 id="log-h" className="font-display text-xl font-semibold">{t('log.title')}</h2>
          <p className="mb-4 mt-1 text-sm text-mist">{t('log.lead')}</p>
          <PaymentLog />
        </section>
      </div>

      <section className="gp-card mt-5 p-5 sm:p-6" aria-labelledby="how-h">
        <h2 id="how-h" className="font-display text-xl font-semibold">{t('how.title')}</h2>
        <ul className="mt-3 grid gap-2.5 text-sm text-mist">
          <li>{t('how.pay')}</li>
          <li>{t('how.verify')}</li>
          <li>{t('how.session')}</li>
          <li>{t('how.local')}</li>
          <li>{t('how.preview', { side: fmt.number(FREE_LIMITS.maxExportSide, 0) })}</li>
          <li className="text-amber-200/90">{t('how.limit')}</li>
          <li>{t('how.noScreens')}</li>
          <li>{t('how.pro', { files: PREMIUM_LIMITS.maxFiles, mb: Math.round(PREMIUM_LIMITS.maxFileBytes / 1048576) })}</li>
        </ul>
      </section>

      <section className="gp-card mt-5 p-5 sm:p-6" aria-labelledby="up-h">
        <h2 id="up-h" className="font-display text-xl font-semibold">{t('up.title')}</h2>
        <p className="mb-4 mt-1 text-sm text-mist">{t('up.lead')}</p>
        <Upscaler />
      </section>
    </div>
  )
}
