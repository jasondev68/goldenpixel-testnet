import { useEffect, useRef, useState } from 'react'
import { useAccount, useConnect, useDisconnect, useSwitchChain, type Connector } from 'wagmi'
import { AlertTriangle, Check, ChevronDown, Copy, ExternalLink, Loader2, LogOut, Wallet } from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { APP_CHAINS, ARC_TESTNET_ID, appChainById } from '@/config/bridgeChains'
import { useUsdcBalance } from '@/hooks/useChainMoney'
import { buildAddressExplorerUrl, getChain } from '@/onchain-facts'
import { parseOnchainError, shortAddress } from '@/lib/web3'
import { useI18n, type Msg } from '@/i18n'
import { OPEN_WALLET_EVENT } from '@/hooks/usePremiumAction'

function hasInjectedWallet(connectors: readonly Connector[]) {
  const w = window as unknown as { ethereum?: unknown }
  return Boolean(w.ethereum) || connectors.some((c) => c.type === 'injected' && c.id !== 'injected')
}

export function WalletButton() {
  const { t, m, fmt } = useI18n()
  const { address, isConnected, isConnecting, isReconnecting, chainId, chain, connector } = useAccount()
  const { connectors, connectAsync, isPending: connecting } = useConnect()
  const { disconnect } = useDisconnect()
  const { switchChainAsync, isPending: switching } = useSwitchChain()
  const [open, setOpen] = useState(false)
  const [notice, setNotice] = useState<Msg | null>(null)
  const [copied, setCopied] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  const supported = Boolean(chain && appChainById(chainId))
  const balance = useUsdcBalance(supported ? chainId : ARC_TESTNET_ID)
  const balanceChain = supported ? chain?.name : 'Arc Testnet'

  // Premium actions ask for a wallet only when needed: they open this panel instead of forcing a connection.
  useEffect(() => {
    const openPanel = () => setOpen(true)
    window.addEventListener(OPEN_WALLET_EVENT, openPanel)
    return () => window.removeEventListener(OPEN_WALLET_EVENT, openPanel)
  }, [])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const connect = async (c: Connector) => {
    setNotice(null)
    try {
      await connectAsync({ connector: c })
    } catch (e) {
      const p = parseOnchainError(e)
      setNotice(p.rejected ? { key: 'wallet.err.cancelled' } : /provider.*not found|connector.*not found/i.test(String(e)) ? { key: 'wallet.err.unavailable' } : p.msg)
    }
  }

  const switchTo = async (id: number) => {
    setNotice(null)
    try {
      await switchChainAsync({ chainId: id })
    } catch (e) {
      const p = parseOnchainError(e)
      setNotice(p.rejected ? { key: 'wallet.err.switchCancelled' } : { key: 'wallet.err.switchFailed' })
    }
  }

  const copy = async () => {
    if (!address) return
    await navigator.clipboard.writeText(address).catch(() => undefined)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const busy = isConnecting || isReconnecting || connecting

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        className={`gp-btn gp-btn-sm ${isConnected ? 'gp-btn-ghost' : 'gp-btn-primary'}`}
        aria-label={isConnected ? t('wallet.title') : t('wallet.connect')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Wallet size={15} />}
        {isConnected ? (
          <>
            <span className={`h-2 w-2 rounded-full ${supported ? 'bg-emerald-400' : 'bg-amber-400'}`} aria-hidden="true" />
            <span className="hidden tabular-nums min-[360px]:inline">{shortAddress(address)}</span>
            <ChevronDown size={14} className="hidden sm:block" />
          </>
        ) : (
          <span className="hidden min-[400px]:inline">{busy ? t('wallet.connecting') : t('wallet.connect')}</span>
        )}
      </button>

      {open && (
        <div role="dialog" aria-label={t('wallet.title')} className="gp-card gp-page fixed inset-x-3 top-[68px] z-50 max-h-[80dvh] overflow-y-auto p-4 !backdrop-blur-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-[340px]" style={{ background: 'rgba(10,9,18,0.96)' }}>
          {!isConnected ? (
            <div>
              <p className="font-display text-lg font-semibold">{t('wallet.connectTitle')}</p>
              <p className="mt-1 text-sm text-mist">{t('wallet.connectBody')}</p>
              {!hasInjectedWallet(connectors) ? (
                <div className="gp-inner mt-4 p-3 text-sm" role="alert">
                  <p className="flex items-center gap-2 font-medium text-amber-300"><AlertTriangle size={14} /> {t('wallet.none.title')}</p>
                  <p className="mt-1 text-mist">{t('wallet.none.body')}</p>
                </div>
              ) : (
                <ul className="mt-4 grid gap-2">
                  {connectors.map((c) => (
                    <li key={c.uid}>
                      <button type="button" disabled={busy} onClick={() => void connect(c)} className="gp-inner flex min-h-[48px] w-full items-center gap-3 px-3 text-left transition-colors hover:border-[var(--gp-line-strong)] disabled:opacity-50">
                        {c.icon ? <img src={c.icon} alt="" className="h-6 w-6 rounded-md" /> : <Wallet size={20} className="text-[var(--gp-gold)]" />}
                        <span className="text-sm font-semibold">{c.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {notice && <p className="mt-3 text-sm text-amber-300" role="alert">{m(notice)}</p>}
            </div>
          ) : (
            <div className="grid gap-3">
              <div className="flex items-center justify-between">
                <p className="gp-eyebrow">{t('wallet.connected')}</p>
                <span className="gp-chip">{connector?.name ?? t('wallet.title')}</span>
              </div>

              <div className="gp-inner flex items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <p className="text-xs text-mist">{t('wallet.address')}</p>
                  <p className="truncate font-mono text-sm" title={address}>{shortAddress(address)}</p>
                </div>
                <div className="flex gap-1">
                  <button type="button" onClick={() => void copy()} className="grid h-9 w-9 place-items-center rounded-lg text-mist hover:text-[var(--gp-gold)]" aria-label={t('wallet.copy')}>
                    {copied ? <Check size={15} /> : <Copy size={15} />}
                  </button>
                  {chainId && getChain(chainId) && address && (
                    <a href={buildAddressExplorerUrl(chainId, address)} target="_blank" rel="noopener noreferrer" className="grid h-9 w-9 place-items-center rounded-lg text-mist hover:text-[var(--gp-gold)]" aria-label={t('wallet.explorer')}>
                      <ExternalLink size={15} />
                    </a>
                  )}
                </div>
              </div>

              <div className="gp-inner p-3">
                <p className="text-xs text-mist">{t('wallet.network')}</p>
                <p className="mt-0.5 flex items-center gap-2 text-sm font-medium">
                  <span className={`h-2 w-2 rounded-full ${supported ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                  {supported ? chain?.name : t('wallet.unsupported', { id: chainId ?? '?' })}
                </p>
                {!supported && <p className="mt-1 text-xs text-amber-300">{t('wallet.unsupported.hint')}</p>}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {APP_CHAINS.map((c) => (
                    <button key={c.chain.id} type="button" disabled={switching || c.chain.id === chainId} onClick={() => void switchTo(c.chain.id)} className={`gp-chip min-h-[32px] cursor-pointer disabled:cursor-default ${c.chain.id === chainId ? '!border-[var(--gp-gold)]' : 'opacity-80 hover:opacity-100'}`}>
                      {c.short}
                    </button>
                  ))}
                </div>
              </div>

              <div className="gp-inner p-3">
                <p className="text-xs text-mist">{t('wallet.balanceOn', { chain: balanceChain ?? '' })}</p>
                <p className="mt-0.5 flex items-center gap-2 font-display text-xl font-semibold tabular-nums">
                  <TokenUSDC variant="branded" size={20} />
                  {balance.isLoading ? '...' : balance.error ? t('common.unavailable') : fmt.decimal(balance.amount ? balance.amount.toFixed(2) : '0.00')}
                </p>
                {balance.error && <p className="mt-1 text-xs text-amber-300">{t('wallet.balanceError')}</p>}
                {balance.amount?.isZero() && <p className="mt-1 text-xs text-mist">{t('wallet.faucet')}</p>}
                <p className="mt-2 text-xs text-mist">{t('wallet.gasNote')}</p>
              </div>

              {notice && <p className="text-sm text-amber-300" role="alert">{m(notice)}</p>}

              <button type="button" className="gp-btn gp-btn-ghost gp-btn-sm w-full" onClick={() => { disconnect(); setOpen(false) }}>
                <LogOut size={14} /> {t('wallet.disconnect')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
