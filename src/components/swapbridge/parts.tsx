import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, ExternalLink, Info, Loader2, XCircle } from 'lucide-react'
import { Amount } from '@/onchain-money'
import { txUrl } from '@/lib/web3'
import { useI18n } from '@/i18n'

/** Truncates a decimal string to at most 6 decimals for display. */
export function trimDecimals(v: string, max = 6): string {
  const [i, f = ''] = v.split('.')
  if (!f) return i
  const t = f.slice(0, max).replace(/0+$/, '')
  if (!t) return Number(v) > 0 ? `<0.${'0'.repeat(max - 1)}1` : i
  return `${i}.${t}`
}

/** Sums decimal fee strings (any precision up to 18 decimals) into an 18-decimal Amount. */
export function sumFees(values: (string | null | undefined)[]): Amount {
  return values.reduce<Amount>((acc, v) => {
    if (!v) return acc
    try {
      return acc.add(Amount.parse(v, 18))
    } catch {
      return acc
    }
  }, Amount.zero(18))
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error' | 'success'; children: ReactNode }) {
  const styles = {
    info: 'border-white/10 text-mist',
    warn: 'border-amber-400/30 bg-amber-400/5 text-amber-200',
    error: 'border-red-400/30 bg-red-400/5 text-red-300',
    success: 'border-emerald-400/30 bg-emerald-400/5 text-emerald-300',
  }[tone]
  const Icon = tone === 'error' ? XCircle : tone === 'success' ? CheckCircle2 : tone === 'warn' ? AlertTriangle : Info
  return (
    <div role={tone === 'error' || tone === 'warn' ? 'alert' : 'status'} className={`flex gap-2.5 rounded-xl border p-3 text-sm ${styles}`}>
      <Icon size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0 text-pretty">{children}</div>
    </div>
  )
}

export function Row({ label, value, strong = false }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <span className="text-mist">{label}</span>
      <span className={`text-right tabular-nums ${strong ? 'font-semibold text-[var(--gp-gold)]' : ''}`}>{value}</span>
    </div>
  )
}

export function ExplorerLink({ chainId, hash, label, href }: { chainId?: number; hash?: string; label?: string; href?: string }) {
  const { t } = useI18n()
  const url = href ?? (chainId && hash ? txUrl(chainId, hash) : undefined)
  if (!url) return hash ? <span className="font-mono text-xs text-mist">{hash.slice(0, 10)}...</span> : null
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-[var(--gp-gold)] underline-offset-4 hover:underline">
      {label ?? t('common.viewExplorer')} <ExternalLink size={12} />
    </a>
  )
}

export function AmountField({
  label,
  value,
  onChange,
  symbol,
  balance,
  onMax,
  disabled,
  icon,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  symbol: string
  balance?: Amount
  onMax?: () => void
  disabled?: boolean
  icon?: ReactNode
}) {
  const { t, fmt } = useI18n()
  return (
    <div className="gp-inner p-3.5">
      <div className="flex items-center justify-between text-xs text-mist">
        <label htmlFor={`amt-${label}`}>{label}</label>
        <span className="tabular-nums">
          {t('common.balance')}: {balance ? fmt.decimal(balance.toFixed(2)) : '--'} {symbol}
          {onMax && (
            <button type="button" className="ml-2 font-semibold text-[var(--gp-gold)] disabled:opacity-40" disabled={disabled || !balance} onClick={onMax}>
              {t('common.max')}
            </button>
          )}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <input
          id={`amt-${label}`}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          disabled={disabled}
          value={value}
          onChange={(e) => {
            const v = e.target.value.replace(',', '.')
            if (/^\d*\.?\d{0,6}$/.test(v)) onChange(v)
          }}
          className="min-w-0 flex-1 bg-transparent font-display text-3xl font-semibold tabular-nums outline-none placeholder:text-white/20"
        />
        <span className="flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-semibold">
          {icon}
          {symbol}
        </span>
      </div>
    </div>
  )
}

export function Spinner({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Loader2 size={16} className="animate-spin" /> {label}
    </span>
  )
}
