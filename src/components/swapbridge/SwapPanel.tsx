import { useMemo, useState } from 'react'
import { useAccount, useReadContract, useSwitchChain } from 'wagmi'
import { erc20Abi } from 'viem'
import { ArrowDownUp } from 'lucide-react'
import { TokenEURC, TokenUSDC } from '@web3icons/react'
import type { SwapEstimate, SwapResult } from '@circle-fin/app-kit'
import { ARC_TESTNET_ID } from '@/config/bridgeChains'
import { useGasReserve, useUsdcBalance } from '@/hooks/useChainMoney'
import { Amount } from '@/onchain-money'
import { adapterFromConnector, getKit, sdkArcTestnetTokens } from '@/lib/appkit'
import { parseOnchainError } from '@/lib/web3'
import { useI18n, type Msg, type TKey } from '@/i18n'
import { AmountField, ExplorerLink, Notice, Row, Spinner, sumFees, trimDecimals } from './parts'

type TokenSym = 'USDC' | 'EURC'
const SLIPPAGE = [50, 100, 300]
const QUOTE_TTL_MS = 60_000
const TOKEN_DECIMALS = 6

type Phase = 'idle' | 'quoting' | 'quoted' | 'swapping' | 'done' | 'failed'
type Reviewed = { estimate: SwapEstimate; key: string; account: string | undefined; at: number }

const FEE_LABEL: Record<string, TKey> = { provider: 'fee.provider', gas: 'fee.gas', kit: 'fee.kit', forwarder: 'fee.forwarder' }

const TokenIcon = ({ s }: { s: TokenSym }) => (s === 'USDC' ? <TokenUSDC variant="branded" size={20} /> : <TokenEURC variant="branded" size={20} />)

export function SwapPanel() {
  const { t, m, fmt } = useI18n()
  const { address, chainId, connector, isConnected } = useAccount()
  const { switchChainAsync, isPending: switching } = useSwitchChain()
  const [tokenIn, setTokenIn] = useState<TokenSym>('USDC')
  const tokenOut: TokenSym = tokenIn === 'USDC' ? 'EURC' : 'USDC'
  const [amount, setAmount] = useState('')
  const [slippageBps, setSlippageBps] = useState(100)
  const [phase, setPhase] = useState<Phase>('idle')
  const [reviewed, setReviewed] = useState<Reviewed | null>(null)
  const [result, setResult] = useState<SwapResult | null>(null)
  const [error, setError] = useState<Msg | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const tokens = useMemo(() => sdkArcTestnetTokens(), [])
  const usdcBal = useUsdcBalance(ARC_TESTNET_ID)
  const eurcQ = useReadContract({
    address: (tokens.eurc ?? undefined) as `0x${string}` | undefined,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: ARC_TESTNET_ID,
    query: { enabled: Boolean(address && tokens.eurc), refetchInterval: 15_000 },
  })
  const eurcBal = eurcQ.data !== undefined ? Amount.fromRaw(eurcQ.data, TOKEN_DECIMALS) : undefined
  const balances: Record<TokenSym, Amount | undefined> = { USDC: usdcBal.amount, EURC: eurcBal }
  const balanceIn = balances[tokenIn]

  // A swap on Arc is approve + swap, heavier than a transfer: hold back extra USDC before quoting.
  const gas = useGasReserve(ARC_TESTNET_ID, 10)

  const parsed = useMemo(() => {
    try {
      return amount ? Amount.parse(amount, TOKEN_DECIMALS) : undefined
    } catch {
      return undefined
    }
  }, [amount])

  let maxSpend: Amount | undefined = balanceIn
  if (balanceIn && tokenIn === 'USDC' && gas.reserve) {
    const left = balanceIn.sub(gas.reserve)
    maxSpend = left.isNegative() ? Amount.zero(TOKEN_DECIMALS) : left
  }

  const wrongChain = isConnected && chainId !== ARC_TESTNET_ID
  const request = { tokenIn, tokenOut, amountIn: amount, config: { slippageBps } } as const
  const requestKey = JSON.stringify(request)
  const stale = reviewed ? reviewed.key !== requestKey || reviewed.account !== address : false
  const expired = reviewed ? now - reviewed.at > QUOTE_TTL_MS : false

  let validation: Msg | null = null
  if (amount && !parsed) validation = { key: 'val.invalidAmount' }
  else if (parsed && !parsed.isPositive()) validation = { key: 'val.positive' }
  else if (parsed && balanceIn && parsed.gt(balanceIn)) validation = { key: 'val.insufficient', vars: { token: tokenIn } }
  else if (parsed && tokenIn === 'USDC' && maxSpend && parsed.gt(maxSpend)) validation = { key: 'val.gasReserve', vars: { max: fmt.decimal(maxSpend.toFixed(2)) } }
  else if (parsed && tokenIn !== 'USDC' && gas.reserve && usdcBal.amount && usdcBal.amount.lt(gas.reserve)) validation = { key: 'val.needGasUsdc' }

  const switchToArc = async () => {
    setError(null)
    try {
      await switchChainAsync({ chainId: ARC_TESTNET_ID })
    } catch (e) {
      setError(parseOnchainError(e).msg)
    }
  }

  const review = async () => {
    setError(null)
    setResult(null)
    setPhase('quoting')
    try {
      const adapter = await adapterFromConnector(connector)
      const estimate = await getKit().estimateSwap({ from: { adapter, chain: 'Arc_Testnet' }, ...request })
      setReviewed({ estimate, key: requestKey, account: address, at: Date.now() })
      setNow(Date.now())
      setPhase('quoted')
      setTimeout(() => setNow(Date.now()), QUOTE_TTL_MS + 500)
    } catch (e) {
      const p = parseOnchainError(e)
      setPhase('idle')
      setReviewed(null)
      setError(!p.rejected && p.msg.key === 'err.withDetail' ? { key: 'swap.err.quote', vars: { detail: String(p.msg.vars?.detail ?? '') } } : p.msg)
    }
  }

  const execute = async () => {
    if (!reviewed || stale || expired || address !== reviewed.account) return
    setError(null)
    setPhase('swapping')
    try {
      const adapter = await adapterFromConnector(connector)
      const res = await getKit().swap({ from: { adapter, chain: 'Arc_Testnet' }, ...request })
      setResult(res)
      setReviewed(null)
      setPhase(res.progress.status === 'FAILED' || res.progress.status === 'NOT_FOUND' ? 'failed' : 'done')
    } catch (e) {
      const p = parseOnchainError(e)
      setPhase(p.rejected ? 'quoted' : 'failed')
      setError(p.msg)
    }
  }

  const est = reviewed?.estimate
  // After a quote, re-check gas against the provider's own gas estimate (USDC pays gas on Arc).
  const quotedGas = sumFees((est?.fees ?? []).filter((f) => f.type === 'gas' && f.token === 'USDC').map((f) => f.amount))
  const gasShort =
    est && parsed && tokenIn === 'USDC' && balanceIn
      ? balanceIn.toDecimals(18).lt(parsed.toDecimals(18).add(quotedGas.mul(3n).div(2n)))
      : false
  const canReview = isConnected && !wrongChain && parsed?.isPositive() && !validation && phase !== 'quoting' && phase !== 'swapping'
  const ready = est && !stale && !expired && !gasShort && phase === 'quoted'
  const balOut = balances[tokenOut]

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <AmountField
          label={t('swap.youPay')}
          value={amount}
          onChange={(v) => { setAmount(v); if (phase === 'done' || phase === 'failed') setPhase('idle') }}
          symbol={tokenIn}
          icon={<TokenIcon s={tokenIn} />}
          balance={balanceIn}
          onMax={maxSpend ? () => setAmount(maxSpend.toString()) : undefined}
          disabled={phase === 'swapping'}
        />
        <div className="relative z-10 -my-4 flex justify-center">
          <button type="button" className="grid h-10 w-10 place-items-center rounded-full border border-[var(--gp-line-strong)] bg-[#0b0a14] text-[var(--gp-gold)] transition-transform hover:rotate-180 disabled:opacity-40" aria-label={t('swap.direction')} disabled={phase === 'swapping'} onClick={() => { setTokenIn(tokenOut); setReviewed(null); setPhase('idle') }}>
            <ArrowDownUp size={16} />
          </button>
        </div>
        <div className="gp-inner p-3.5">
          <div className="flex items-center justify-between gap-2 text-xs text-mist">
            <span>{t('swap.youReceive')}</span>
            <span className="tabular-nums">{t('common.balance')}: {balOut ? fmt.decimal(balOut.toFixed(2)) : '--'} {tokenOut}</span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="font-display text-3xl font-semibold tabular-nums text-white/90">{est && !stale ? fmt.decimal(est.estimatedOutput.amount) : '--'}</p>
            <span className="flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-semibold"><TokenIcon s={tokenOut} />{tokenOut}</span>
          </div>
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium">{t('swap.slippage')}</p>
        <div className="gp-seg" role="radiogroup" aria-label={t('swap.slippage')}>
          {SLIPPAGE.map((b) => (
            <button key={b} type="button" role="radio" aria-checked={slippageBps === b} onClick={() => setSlippageBps(b)}>{fmt.number(b / 100, 1)}%</button>
          ))}
        </div>
      </div>

      {wrongChain && <Notice tone="warn">{t('swap.wrongChain')}</Notice>}
      {validation && <Notice tone="warn">{m(validation)}</Notice>}
      {!eurcQ.isLoading && !tokens.eurc && <Notice tone="warn">{t('swap.noEurc')}</Notice>}

      {est && !stale && (
        <div className="gp-inner divide-y divide-white/5 p-3.5">
          <Row label={t('swap.estOutput')} value={`${fmt.decimal(est.estimatedOutput.amount)} ${est.estimatedOutput.token}`} strong />
          <Row label={t('swap.minReceived', { pct: fmt.number(slippageBps / 100, 1) })} value={`${fmt.decimal(est.stopLimit.amount)} ${est.stopLimit.token}`} />
          {(est.fees ?? []).map((f, i) => (
            <Row key={i} label={FEE_LABEL[f.type] ? t(FEE_LABEL[f.type]) : t('fee.other', { type: f.type })} value={`${fmt.decimal(trimDecimals(f.amount ?? '0'))} ${f.token}`} />
          ))}
          <Row label={t('swap.networkFee')} value={gas.perTx ? t('swap.networkFee.est', { fee: fmt.decimal(gas.perTx.toFixed(4)) }) : t('swap.networkFee.later')} />
          <Row label={t('swap.approval')} value={t('swap.approval.note')} />
          <p className="pt-2 text-xs text-mist">{t('swap.disclaimer')}</p>
        </div>
      )}
      {est && !stale && gasShort && <Notice tone="warn">{t('swap.gasShort')}</Notice>}
      {reviewed && (stale || expired) && phase === 'quoted' && <Notice tone="warn">{stale ? t('swap.stale.changed') : t('swap.stale.expired')} {t('swap.stale.refresh')}</Notice>}

      {error && <Notice tone="error">{m(error)}</Notice>}

      {phase === 'done' && result && (
        <Notice tone={result.progress.status === 'DONE' ? 'success' : 'info'}>
          <p className="font-semibold">{result.progress.status === 'DONE' ? t('swap.done') : t('swap.pending')}</p>
          <p className="mt-1">
            {result.amountOut
              ? t('swap.done.body', { amountIn: fmt.decimal(result.amountIn), tokenIn: result.tokenIn, amountOut: fmt.decimal(result.amountOut), tokenOut: result.tokenOut })
              : t('swap.done.bodyPending', { amountIn: fmt.decimal(result.amountIn), tokenIn: result.tokenIn })}
          </p>
          <div className="mt-1"><ExplorerLink chainId={ARC_TESTNET_ID} hash={result.txHash} href={result.explorerUrl} /></div>
        </Notice>
      )}
      {phase === 'failed' && result && (
        <Notice tone="error">
          <p className="font-semibold">{t('swap.failed')}</p>
          <p className="mt-1">{result.progress.substatusMessage ? t('swap.failed.provider', { detail: result.progress.substatusMessage }) : t('swap.failed.generic')}</p>
          <div className="mt-1"><ExplorerLink chainId={ARC_TESTNET_ID} hash={result.txHash} href={result.explorerUrl} /></div>
        </Notice>
      )}

      {wrongChain ? (
        <button type="button" className="gp-btn gp-btn-primary w-full" disabled={switching} onClick={() => void switchToArc()}>{switching ? t('common.switching') : t('common.switchTo', { chain: 'Arc Testnet' })}</button>
      ) : ready ? (
        <button type="button" className="gp-btn gp-btn-primary w-full" onClick={() => void execute()}>{t('swap.cta.swap', { amount: fmt.decimal(est.amountIn), from: tokenIn, to: tokenOut })}</button>
      ) : (
        <button type="button" className="gp-btn gp-btn-primary w-full" disabled={!canReview} onClick={() => void review()}>
          {!isConnected ? t('common.connectToContinue') : phase === 'quoting' ? <Spinner label={t('swap.gettingQuote')} /> : phase === 'swapping' ? <Spinner label={t('common.confirmInWallet')} /> : reviewed && (stale || expired) ? t('swap.refreshQuote') : t('swap.reviewQuote')}
        </button>
      )}
      {phase === 'swapping' && <p className="text-center text-xs text-mist">{t('swap.waitNote')}</p>}
    </div>
  )
}
