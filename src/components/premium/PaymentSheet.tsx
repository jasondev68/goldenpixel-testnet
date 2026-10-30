import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { CheckCircle2, ExternalLink, Lock, ShieldCheck, X } from 'lucide-react'
import { encodeFunctionData, erc20Abi } from 'viem'
import { useAccount, useSwitchChain, useWriteContract } from 'wagmi'
import { ExplorerLink, Notice, Row, Spinner } from '@/components/swapbridge/parts'
import { PREMIUM_FEATURES, featuresPriceUsdc, featuresRaw } from '@/config/payments'
import { useGasFee, useUsdcBalance } from '@/hooks/useChainMoney'
import { useI18n, type Msg } from '@/i18n'
import { ApiError } from '@/lib/apiError'
import { closeSheet, sheetStore, type SheetRequest } from '@/lib/paymentSheet'
import { paymentConfig, paymentReader } from '@/lib/payments/client'
import { confirmPayment } from '@/lib/payments/flow'
import { revalidateStoredPayments } from '@/lib/payments/revalidate'
import { paymentSession, type PendingPayment } from '@/lib/payments/session'
import { parseOnchainError, shortAddress } from '@/lib/web3'

type Phase = 'review' | 'wallet' | 'confirming' | 'done' | 'error' | 'slow'

/**
 * Hosts the payment sheet and re-checks, after every page load, the payments stored for this session.
 * The sheet is the only place a payment starts: the user sees the exact price, recipient, network, token and fee,
 * then approves ONE direct USDC transfer in their wallet. Nothing unlocks until the transaction has been read back
 * from the Arc RPC and every check passed.
 */
export function PaymentSheet() {
  const req = useSyncExternalStore(sheetStore.subscribe, sheetStore.get, sheetStore.get)
  const { address } = useAccount()

  // After a reload: finish a payment that was still confirming, and re-verify stored payments before trusting them.
  useEffect(() => {
    if (!address) return
    let cancelled = false
    const run = async () => {
      const cfg = paymentConfig()
      const pending = paymentSession.pending()
      if (pending && pending.payer.toLowerCase() === address.toLowerCase() && pending.chainId === cfg.chainId && !sheetStore.get()) {
        await confirmPayment(paymentReader(), paymentSession, cfg, pending, { isCancelled: () => cancelled })
      }
      for (let i = 0; i < 4 && !cancelled; i++) {
        await revalidateStoredPayments()
        if (paymentSession.payments().every((p) => paymentSession.isVerified(p.txHash))) break
        await new Promise((r) => setTimeout(r, 3000))
      }
    }
    void run().catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [address])

  return req ? <Sheet key={req.id} req={req} /> : null
}

function Sheet({ req }: { req: SheetRequest }) {
  const { t, td, m, fmt } = useI18n()
  const cfg = paymentConfig()
  const { address, chainId: walletChain } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const [phase, setPhase] = useState<Phase>('review')
  const [error, setError] = useState<Msg | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [reason, setReason] = useState<string>('')
  const dialogRef = useRef<HTMLDivElement>(null)
  const attempt = useRef(0)

  const live = () => sheetStore.get()?.id === req.id
  const amountRaw = featuresRaw(req.features, cfg.decimals)
  const total = featuresPriceUsdc(req.features, cfg.decimals)

  const usdc = useUsdcBalance(cfg.chainId)
  const transfer = { to: cfg.token, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [cfg.recipient, amountRaw] }) }
  const gas = useGasFee(cfg.chainId, transfer)

  useEffect(() => dialogRef.current?.focus(), [])

  const finish = (e?: unknown) => {
    if (e) req.reject(e)
    closeSheet(req.id)
  }

  /** Reads the transaction back from the chain and decides. Only a verified result unlocks anything. */
  const watch = async (pending: PendingPayment) => {
    setPhase('confirming')
    setError(null)
    const my = ++attempt.current
    const res = await confirmPayment(paymentReader(), paymentSession, cfg, pending, {
      isCancelled: () => !live() || attempt.current !== my,
      onTick: (r) => live() && setReason(r),
    })
    if (!live() || attempt.current !== my) return
    if (res.status === 'verified') {
      setPhase('done')
      req.resolve()
      setTimeout(() => closeSheet(req.id), 2500)
    } else if (res.status === 'rejected') {
      setError({ key: 'pay.rejected', vars: { reason: td(`pay.reject.${res.code}`, res.code) } })
      setPhase('error')
    } else {
      setError({ key: 'pay.slow' })
      setPhase('slow')
    }
  }

  // Resume a payment that was already sent for this wallet (for example the tab was reloaded).
  useEffect(() => {
    const p = paymentSession.pending()
    if (p && address && p.payer.toLowerCase() === address.toLowerCase() && p.chainId === cfg.chainId && p.features.join() === req.features.join()) {
      setTxHash(p.txHash)
      void watch(p)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pay = async () => {
    if (!address || address.toLowerCase() !== req.payer.toLowerCase()) return setError({ key: 'pay.err.walletChanged' })
    setError(null)
    setPhase('wallet')
    try {
      if (walletChain !== cfg.chainId) await switchChainAsync({ chainId: cfg.chainId })
      const startedAt = Date.now()
      const hash = await writeContractAsync({ address: cfg.token, abi: erc20Abi, functionName: 'transfer', args: [cfg.recipient, amountRaw], chainId: cfg.chainId })
      const pending: PendingPayment = { txHash: hash, payer: address, chainId: cfg.chainId, features: req.features, amountRaw: amountRaw.toString(), startedAt }
      paymentSession.setPending(pending) // so a reload can resume watching this exact transaction
      setTxHash(hash)
      await watch(pending)
    } catch (e) {
      const p = parseOnchainError(e)
      setError(p.rejected ? { key: 'pay.walletRejected' } : p.msg)
      setPhase('review')
    }
  }

  const close = () => {
    if (phase === 'wallet') return
    if (phase === 'done') return closeSheet(req.id)
    const saved = phase === 'confirming' || phase === 'slow'
    finish(new ApiError({ key: saved ? 'pay.err.pendingSaved' : 'pay.cancelled' }, saved ? 'PENDING' : 'CANCELLED'))
  }

  const fee = gas.feeUsdc
  const balance = usdc.amount
  const needed = fee ? amountRaw + fee.raw : amountRaw
  const enough = balance ? balance.raw >= needed : true
  const wrongChain = walletChain !== cfg.chainId
  const busy = phase === 'wallet' || phase === 'confirming'
  const reasonText = reason === 'NOT_FOUND' || reason === 'NOT_MINED' ? t('pay.wait.mined') : reason === 'CONFIRMATIONS' ? t('pay.wait.confirmations') : reason === 'RPC_ERROR' ? t('pay.wait.rpc') : ''

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center" onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="pay-title" className="gp-card relative max-h-[92vh] w-full max-w-md overflow-y-auto p-5 outline-none">
        <button type="button" className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full text-mist hover:text-ink disabled:opacity-40" onClick={close} disabled={phase === 'wallet'} aria-label={t('common.close')}>
          <X size={18} />
        </button>
        <h2 id="pay-title" className="flex items-center gap-2 pr-8 font-display text-xl font-semibold">
          <Lock size={18} className="text-[var(--gp-gold)]" /> {t('pay.title')}
        </h2>

        <div className="mt-4 space-y-3">
          <ul className="space-y-1.5 text-sm">
            {req.features.map((id) => (
              <li key={id} className="flex items-start justify-between gap-3">
                <span>{td(`op.${id}.label`, PREMIUM_FEATURES[id].label)}</span>
                <span className="shrink-0 tabular-nums text-mist">{fmt.usdc(PREMIUM_FEATURES[id].priceUsdc)} USDC</span>
              </li>
            ))}
          </ul>
          <div className="gp-inner space-y-1.5 p-3 text-sm">
            <Row label={t('pay.total')} value={<span className="font-display text-lg font-semibold text-[var(--gp-gold)] tabular-nums">{fmt.usdc(total)} USDC</span>} />
            <Row label={t('pay.network')} value={<span>{cfg.networkName} <span className="text-mist">({t('pay.chainId', { id: cfg.chainId })})</span>{cfg.isTestnet && <span className="gp-chip ml-1.5 !px-1.5 !py-0">Testnet</span>}</span>} />
            <Row label={t('pay.token')} value={<ExplorerLink chainId={cfg.chainId} label={`USDC ${shortAddress(cfg.token)}`} href={`${cfg.explorerBase}/address/${cfg.token}`} />} />
            <Row label={t('pay.recipient')} value={<span className="break-all font-mono text-xs">{cfg.recipient}</span>} />
            <Row label={t('pay.from')} value={<span className="font-mono text-xs">{shortAddress(req.payer)}</span>} />
            {balance && <Row label={t('pay.balance')} value={`${fmt.usdc(balance.toString())} USDC`} />}
            <Row label={t('pay.gas')} value={fee ? t('pay.fee.est', { fee: fmt.decimal(fee.toString()) }) : t('pay.fee.unknown')} />
          </div>
          <p className="flex items-start gap-1.5 text-xs text-mist">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-[var(--gp-gold)]" /> {t('pay.fixed')}
          </p>
          {cfg.isTestnet && <p className="text-xs text-mist">{t('pay.testnetNote')}</p>}
        </div>

        {phase === 'review' && wrongChain && <div className="mt-3"><Notice tone="warn">{t('pay.wrongNetwork', { network: cfg.networkName })}</Notice></div>}
        {phase === 'review' && !enough && !wrongChain && <div className="mt-3"><Notice tone="warn">{t('pay.insufficient')}</Notice></div>}
        {error && <div className="mt-3" role="alert"><Notice tone={phase === 'slow' ? 'warn' : 'error'}>{m(error)}</Notice></div>}
        {phase === 'done' && (
          <div className="mt-3" role="status">
            <Notice tone="success">
              <p className="font-semibold">{t('pay.done')}</p>
              <p className="mt-1">{t('pay.done.body')}</p>
            </Notice>
          </div>
        )}

        {busy && (
          <div className="mt-4 space-y-2" role="status" aria-live="polite">
            <p className="flex items-center gap-2 text-sm"><Spinner label={phase === 'wallet' ? t('pay.confirmWallet') : t('pay.confirming')} /></p>
            {phase === 'confirming' && reasonText && <p className="text-xs text-mist">{reasonText}</p>}
            {phase === 'confirming' && <p className="text-xs text-mist">{t('pay.notPaidYet')}</p>}
          </div>
        )}
        {txHash && (
          <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-mist">
            <CheckCircle2 size={13} /> {t('pay.txSent')}: <ExplorerLink chainId={cfg.chainId} hash={txHash} label={shortAddress(txHash)} />
            <a className="inline-flex items-center gap-1 underline underline-offset-2" href={`${cfg.explorerBase}/tx/${txHash}`} target="_blank" rel="noreferrer">
              {t('pay.viewTx')} <ExternalLink size={11} />
            </a>
          </p>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          {phase === 'review' && (
            <button type="button" className="gp-btn gp-btn-primary flex-1" disabled={!enough && !wrongChain} onClick={() => void (wrongChain ? switchChainAsync({ chainId: cfg.chainId }).catch(() => undefined) : pay())}>
              {wrongChain ? t('common.switchTo', { chain: cfg.networkName }) : t('pay.cta')}
            </button>
          )}
          {(phase === 'slow' || (phase === 'error' && txHash && paymentSession.pending())) && (
            <button type="button" className="gp-btn gp-btn-primary flex-1" onClick={() => { const p = paymentSession.pending(); if (p) void watch(p) }}>
              {t('pay.tryAgain')}
            </button>
          )}
          {phase === 'error' && (!txHash || !paymentSession.pending()) && (
            <button type="button" className="gp-btn gp-btn-primary flex-1" onClick={() => { setTxHash(null); setError(null); setPhase('review') }}>
              {t('pay.again')}
            </button>
          )}
          <button type="button" className={`gp-btn ${phase === 'done' ? 'gp-btn-primary flex-1' : 'gp-btn-ghost'}`} onClick={close} disabled={phase === 'wallet'}>
            {phase === 'done' ? t('common.close') : busy ? t('pay.closeSaved') : t('pay.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
