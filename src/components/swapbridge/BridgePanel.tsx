import { useMemo, useState } from 'react'
import { useAccount, useBalance, useSwitchChain } from 'wagmi'
import { ArrowRight, Check, Circle, Loader2, X } from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import type { BridgeParams, BridgeResult } from '@circle-fin/app-kit'
import { APP_CHAINS, ARC_TESTNET_ID } from '@/config/bridgeChains'
import { useGasReserve, useUsdcBalance } from '@/hooks/useChainMoney'
import { Amount, isGasTokenUsdc } from '@/onchain-money'
import { adapterFromConnector, getKit, sdkSupportedChains } from '@/lib/appkit'
import { parseOnchainError } from '@/lib/web3'
import { useI18n, type Msg, type TKey } from '@/i18n'
import { AmountField, ExplorerLink, Notice, Row, Spinner, sumFees, trimDecimals } from './parts'

type Chain = BridgeParams['from']['chain']
type Phase = 'idle' | 'estimating' | 'estimated' | 'bridging' | 'done' | 'failed'
type StepView = { name: string; state: 'waiting' | 'pending' | 'success' | 'error'; txHash?: string; explorerUrl?: string }
type Estimate = Awaited<ReturnType<ReturnType<typeof getKit>['estimateBridge']>>

const STEP_NAMES = ['approve', 'burn', 'fetchAttestation', 'mint'] as const
const STEP_LABEL: Record<string, TKey> = { approve: 'bridge.step.approve', burn: 'bridge.step.burn', fetchAttestation: 'bridge.step.attest', mint: 'bridge.step.mint' }
const GAS_NAME: Record<string, TKey> = { Approve: 'bridge.gas.approve', Burn: 'bridge.gas.burn', Mint: 'bridge.gas.mint' }
const FEE_LABEL: Record<string, TKey> = { provider: 'fee.provider', gas: 'fee.gas', kit: 'fee.kit', forwarder: 'fee.forwarder' }
const emptySteps = (): StepView[] => STEP_NAMES.map((name) => ({ name, state: 'waiting' }))

export function BridgePanel() {
  const { t, m, fmt } = useI18n()
  const { address, chainId, connector, isConnected } = useAccount()
  const { switchChainAsync, isPending: switching } = useSwitchChain()
  const chains = useMemo(() => sdkSupportedChains('bridge'), [])
  const [fromId, setFromId] = useState<number>(ARC_TESTNET_ID)
  const [toId, setToId] = useState<number>(APP_CHAINS.find((c) => c.sdk === 'Base_Sepolia')?.chain.id ?? ARC_TESTNET_ID)
  const [amount, setAmount] = useState('')
  const [forwarder, setForwarder] = useState(true)
  const [phase, setPhase] = useState<Phase>('idle')
  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const [estimateKey, setEstimateKey] = useState('')
  const [steps, setSteps] = useState<StepView[]>(emptySteps)
  const [result, setResult] = useState<BridgeResult | null>(null)
  const [error, setError] = useState<Msg | null>(null)

  const from = chains.find((c) => c.chain.id === fromId)
  const to = chains.find((c) => c.chain.id === toId)
  const fromBal = useUsdcBalance(fromId)
  const toBal = useUsdcBalance(toId)
  const nativeBal = useBalance({ address, chainId: fromId, query: { enabled: Boolean(address) && !isGasTokenUsdc(fromId) } })
  const gas = useGasReserve(fromId, 12)

  const parsed = useMemo(() => {
    try {
      return amount ? Amount.parse(amount, 6) : undefined
    } catch {
      return undefined
    }
  }, [amount])
  const maxSpend = fromBal.amount && gas.reserve ? (fromBal.amount.gt(gas.reserve) ? fromBal.amount.sub(gas.reserve) : Amount.zero(6)) : fromBal.amount

  const key = `${fromId}|${toId}|${amount}|${forwarder}|${address}`
  const stale = estimate !== null && estimateKey !== key
  const needsSwitch = isConnected && chainId !== fromId

  let validation: Msg | null = null
  if (fromId === toId) validation = { key: 'bridge.val.sameChain' }
  else if (amount && !parsed) validation = { key: 'val.invalidAmount' }
  else if (parsed && !parsed.isPositive()) validation = { key: 'val.positive' }
  else if (parsed && fromBal.amount && parsed.gt(fromBal.amount)) validation = { key: 'bridge.val.insufficient' }
  else if (parsed && maxSpend && parsed.gt(maxSpend)) validation = { key: 'val.gasReserve', vars: { max: fmt.decimal(maxSpend.toFixed(2)) } }
  else if (!isGasTokenUsdc(fromId) && nativeBal.data && nativeBal.data.value === 0n) validation = { key: 'bridge.val.nativeGas', vars: { symbol: nativeBal.data.symbol, chain: from?.short ?? '' } }

  const setFrom = (id: number) => {
    setFromId(id)
    if (id === toId) setToId(chains.find((c) => c.chain.id !== id)?.chain.id ?? id)
    setEstimate(null)
    setPhase('idle')
  }

  const doSwitch = async (id: number) => {
    setError(null)
    try {
      await switchChainAsync({ chainId: id })
    } catch (e) {
      setError(parseOnchainError(e).msg)
    }
  }

  const runEstimate = async () => {
    if (!from || !to) return
    setError(null)
    setPhase('estimating')
    try {
      const adapter = await adapterFromConnector(connector)
      const est = await getKit().estimateBridge({
        from: { adapter, chain: from.sdk as Chain },
        to: { adapter, chain: to.sdk as Chain, ...(forwarder ? { useForwarder: true } : {}) },
        amount,
      } as BridgeParams)
      setEstimate(est)
      setEstimateKey(key)
      setPhase('estimated')
    } catch (e) {
      const p = parseOnchainError(e)
      setPhase('idle')
      setError(!p.rejected && p.msg.key === 'err.withDetail' ? { key: 'bridge.err.estimate', vars: { detail: String(p.msg.vars?.detail ?? '') } } : p.msg)
    }
  }

  const onEvent = (payload: unknown) => {
    const p = payload as { method?: string; values?: { state?: string; txHash?: string; transactionHash?: string; explorerUrl?: string } }
    const name = p.method?.replace('bridge.', '')
    if (!name) return
    setSteps((prev) =>
      prev.map((s) =>
        s.name === name
          ? { ...s, state: p.values?.state === 'error' ? 'error' : p.values?.state === 'pending' ? 'pending' : 'success', txHash: p.values?.txHash ?? p.values?.transactionHash ?? s.txHash, explorerUrl: p.values?.explorerUrl ?? s.explorerUrl }
          : s,
      ),
    )
  }

  const finish = (res: BridgeResult) => {
    setResult(res)
    setSteps((prev) => prev.map((s) => {
      const r = res.steps.find((x) => x.name === s.name)
      return r ? { name: s.name, state: r.state === 'noop' ? 'success' : r.state, txHash: r.txHash, explorerUrl: r.explorerUrl } : s
    }))
    setPhase(res.state === 'success' ? 'done' : res.state === 'error' ? 'failed' : 'bridging')
  }

  const run = async (resume: boolean) => {
    if (!from || !to || (!resume && (stale || !estimate))) return
    setError(null)
    setPhase('bridging')
    if (!resume) setSteps(emptySteps())
    const kit = getKit()
    kit.on('*', onEvent)
    try {
      const adapter = await adapterFromConnector(connector)
      const res = resume && result
        ? await kit.retryBridge(result, { from: adapter, to: adapter })
        : await kit.bridge({
            from: { adapter, chain: from.sdk as Chain },
            to: { adapter, chain: to.sdk as Chain, ...(forwarder ? { useForwarder: true } : {}) },
            amount,
          })
      finish(res)
    } catch (e) {
      const p = parseOnchainError(e)
      setPhase(p.rejected ? 'estimated' : 'failed')
      setError(p.msg)
    } finally {
      kit.off('*', onEvent)
    }
  }

  const usdcFees = estimate?.fees.reduce<Amount | null>((acc, f) => {
    if (f.token !== 'USDC' || f.amount === null) return acc
    try { return (acc ?? Amount.zero(6)).add(Amount.parse(f.amount, 6)) } catch { return acc }
  }, null)
  const arrival = parsed && usdcFees ? parsed.sub(usdcFees) : undefined
  // After an estimate, re-check against the SDK's own gas quote (USDC pays gas on Arc).
  const quotedGas = sumFees((estimate?.gasFees ?? []).filter((g) => g.token === 'USDC' && String(g.blockchain) === from?.sdk).map((g) => g.fees?.fee))
  const gasShort = Boolean(estimate && !stale && parsed && fromBal.amount && isGasTokenUsdc(fromId) && fromBal.amount.toDecimals(18).lt(parsed.toDecimals(18).add(quotedGas.mul(3n).div(2n))))
  const busy = phase === 'estimating' || phase === 'bridging'
  const canEstimate = isConnected && Boolean(parsed?.isPositive()) && !validation && !busy

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
        <label className="grid gap-1.5 text-sm font-medium">
          {t('bridge.from')}
          <select className="gp-input" value={fromId} disabled={busy} onChange={(e) => setFrom(Number(e.target.value))}>
            {chains.map((c) => <option key={c.chain.id} value={c.chain.id} className="bg-[#0b0a14]">{c.chain.name}</option>)}
          </select>
        </label>
        <ArrowRight className="mx-auto hidden text-[var(--gp-gold)] sm:mb-3 sm:block" size={18} />
        <label className="grid gap-1.5 text-sm font-medium">
          {t('bridge.to')}
          <select className="gp-input" value={toId} disabled={busy} onChange={(e) => { setToId(Number(e.target.value)); setEstimate(null); setPhase('idle') }}>
            {chains.filter((c) => c.chain.id !== fromId).map((c) => <option key={c.chain.id} value={c.chain.id} className="bg-[#0b0a14]">{c.chain.name}</option>)}
          </select>
        </label>
      </div>

      <AmountField label={t('common.amount')} value={amount} onChange={(v) => { setAmount(v); if (phase === 'done' || phase === 'failed') setPhase('idle') }} symbol="USDC" icon={<TokenUSDC variant="branded" size={20} />} balance={fromBal.amount} onMax={maxSpend ? () => setAmount(maxSpend.toString()) : undefined} disabled={busy} />
      <p className="-mt-2 px-1 text-xs tabular-nums text-mist">{t('bridge.destBalance', { chain: to?.short ?? '', amount: toBal.amount ? fmt.decimal(toBal.amount.toFixed(2)) : '--' })}</p>

      <label className="gp-inner flex min-h-[52px] cursor-pointer items-center justify-between gap-3 px-3.5 py-2 text-sm">
        <span>
          <span className="block font-medium">{t('bridge.forwarder.title')}</span>
          <span className="block text-xs text-mist">{t('bridge.forwarder.body')}</span>
        </span>
        <input type="checkbox" className="h-5 w-5 shrink-0 accent-[#f5c542]" checked={forwarder} disabled={busy} onChange={(e) => { setForwarder(e.target.checked); setEstimate(null); setPhase('idle') }} />
      </label>
      {!forwarder && to && !isGasTokenUsdc(toId) && <Notice tone="warn">{t('bridge.noForwarder', { symbol: to.chain.nativeCurrency.symbol, chain: to.short })}</Notice>}

      {validation && <Notice tone="warn">{m(validation)}</Notice>}

      {estimate && !stale && (
        <div className="gp-inner divide-y divide-white/5 p-3.5">
          <Row label={t('bridge.youSend')} value={t('bridge.youSend.value', { amount: fmt.decimal(estimate.amount), chain: from?.short ?? '' })} />
          {estimate.fees.map((f, i) => <Row key={i} label={FEE_LABEL[f.type] ? t(FEE_LABEL[f.type]) : t('fee.other', { type: f.type })} value={f.amount === null ? t('common.unavailable') : `${fmt.decimal(trimDecimals(f.amount))} ${f.token}`} />)}
          {estimate.gasFees.map((g, i) => <Row key={`g${i}`} label={t('bridge.gasRow', { name: GAS_NAME[g.name] ? t(GAS_NAME[g.name]) : g.name, chain: String(g.blockchain) })} value={g.fees ? `${fmt.decimal(trimDecimals(g.fees.fee))} ${g.token}` : t('common.unavailable')} />)}
          <Row label={t('bridge.estReceive')} value={arrival ? `${fmt.decimal(arrival.toString())} USDC` : t('common.notAvailable')} strong />
          <Row label={t('bridge.speed')} value={t('bridge.speed.fast')} />
          <p className="pt-2 text-xs text-mist">{t('bridge.estNote')}</p>
        </div>
      )}
      {gasShort && <Notice tone="warn">{t('bridge.gasShort')}</Notice>}
      {stale && <Notice tone="warn">{t('bridge.stale')}</Notice>}
      {error && <Notice tone="error">{m(error)}</Notice>}

      {(phase === 'bridging' || phase === 'done' || phase === 'failed') && (
        <ol className="gp-inner grid gap-2 p-3.5" aria-label={t('bridge.progress')}>
          {steps.filter((s) => !(forwarder && s.name === 'mint' && s.state === 'waiting' && false)).map((s) => (
            <li key={s.name} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2.5">
                {s.state === 'success' ? <Check size={16} className="text-emerald-400" /> : s.state === 'error' ? <X size={16} className="text-red-400" /> : s.state === 'pending' || (phase === 'bridging' && s.state === 'waiting' && steps.find((x) => x.state === 'waiting')?.name === s.name) ? <Loader2 size={16} className="animate-spin text-[var(--gp-gold)]" /> : <Circle size={16} className="text-white/25" />}
                {t(STEP_LABEL[s.name])}
              </span>
              {s.txHash && <ExplorerLink hash={s.txHash} href={s.explorerUrl} chainId={s.name === 'mint' ? toId : fromId} label={t('common.tx')} />}
            </li>
          ))}
        </ol>
      )}

      {phase === 'done' && result && <Notice tone="success"><p className="font-semibold">{t('bridge.done')}</p><p className="mt-1">{t('bridge.done.body', { amount: fmt.decimal(result.amount), from: from?.short ?? '', to: to?.short ?? '' })}</p></Notice>}
      {phase === 'failed' && (
        <Notice tone="error">
          <p className="font-semibold">{t('bridge.failed')}</p>
          <p className="mt-1">{t('bridge.failed.body1')}</p>
          <p className="mt-1">{t('bridge.failed.body2')}</p>
        </Notice>
      )}

      {needsSwitch && phase !== 'bridging' ? (
        <button type="button" className="gp-btn gp-btn-primary w-full" disabled={switching} onClick={() => void doSwitch(fromId)}>{switching ? t('common.switching') : t('common.switchTo', { chain: from?.chain.name ?? '' })}</button>
      ) : phase === 'failed' && result ? (
        <button type="button" className="gp-btn gp-btn-primary w-full" onClick={() => void run(true)}>{t('bridge.resume')}</button>
      ) : phase === 'estimated' && estimate && !stale && !gasShort ? (
        <button type="button" className="gp-btn gp-btn-primary w-full" onClick={() => void run(false)}>{t('bridge.cta.bridge', { amount: fmt.decimal(estimate.amount), to: to?.short ?? '' })}</button>
      ) : (
        <button type="button" className="gp-btn gp-btn-primary w-full" disabled={!canEstimate} onClick={() => void runEstimate()}>
          {!isConnected ? t('common.connectToContinue') : phase === 'estimating' ? <Spinner label={t('bridge.estimating')} /> : phase === 'bridging' ? <Spinner label={t('bridge.bridging')} /> : t('bridge.review')}
        </button>
      )}
    </div>
  )
}
