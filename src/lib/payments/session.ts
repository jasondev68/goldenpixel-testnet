import { useSyncExternalStore } from 'react'
import { uniqueFeatures, type PremiumFeatureId } from '@/config/payments'

/**
 * Session-level record of the payments made in this browser tab. Stored in sessionStorage (cleared when the tab
 * closes). It holds transaction hashes, never keys. A stored record alone never unlocks anything: a feature counts as
 * unlocked only after its payment has been (re-)verified on-chain in this page load (see `verified` below).
 */
export type PaymentRecord = {
  txHash: string
  payer: string
  chainId: number
  features: PremiumFeatureId[]
  amountRaw: string
  /** When the user pressed Pay (ms): the payment must have been mined after this. */
  startedAt: number
  verifiedAt: number
}

export type PendingPayment = { txHash: string; payer: string; chainId: number; features: PremiumFeatureId[]; amountRaw: string; startedAt: number }

type Stored = { payments: PaymentRecord[]; pending: PendingPayment | null }
const KEY = 'gp-premium-session'
const lc = (s: string) => s.toLowerCase()

export function createPaymentSession(storage: Pick<Storage, 'getItem' | 'setItem'> | null) {
  let state: Stored | null = null
  const verified = new Map<string, number>() // txHash -> verified at (in memory only: never persisted)
  let version = 0
  const listeners = new Set<() => void>()
  const emit = () => {
    version++
    listeners.forEach((l) => l())
  }

  const load = (): Stored => {
    if (state) return state
    try {
      const raw = JSON.parse(storage?.getItem(KEY) ?? 'null') as Partial<Stored> | null
      state = {
        payments: Array.isArray(raw?.payments) ? (raw.payments).filter((p) => typeof p?.txHash === 'string' && typeof p?.payer === 'string') : [],
        pending: raw?.pending && typeof raw.pending.txHash === 'string' ? raw.pending : null,
      }
    } catch {
      state = { payments: [], pending: null }
    }
    return state
  }
  const save = () => {
    try {
      storage?.setItem(KEY, JSON.stringify(load()))
    } catch {
      /* storage unavailable: the session lasts for this page only */
    }
    emit()
  }

  return {
    payments: () => load().payments,
    pending: () => load().pending,
    /** True once this exact transaction was confirmed by an on-chain read in this page load. */
    isVerified: (txHash: string) => verified.has(lc(txHash)),
    markVerified: (txHash: string, at = Date.now()) => {
      verified.set(lc(txHash), at)
      emit()
    },
    /** A transaction hash can be used for one payment record per session. */
    isUsed: (txHash: string) => load().payments.some((p) => lc(p.txHash) === lc(txHash)),
    setPending: (p: PendingPayment | null) => {
      load().pending = p ? { ...p, txHash: lc(p.txHash), features: uniqueFeatures(p.features) } : null
      save()
    },
    /** Stores a verified payment. Returns false if this hash was already used in the session. */
    record: (p: PaymentRecord): boolean => {
      const s = load()
      if (s.payments.some((x) => lc(x.txHash) === lc(p.txHash))) return false
      s.payments = [{ ...p, txHash: lc(p.txHash), features: uniqueFeatures(p.features) }, ...s.payments].slice(0, 50)
      if (s.pending && lc(s.pending.txHash) === lc(p.txHash)) s.pending = null
      save()
      return true
    },
    remove: (txHash: string) => {
      const s = load()
      s.payments = s.payments.filter((p) => lc(p.txHash) !== lc(txHash))
      verified.delete(lc(txHash))
      save()
    },
    /** A feature is unlocked for `payer` on `chainId` only if a payment covering it was verified on-chain. */
    isUnlocked: (feature: PremiumFeatureId, payer: string | undefined, chainId: number): boolean =>
      Boolean(payer) && load().payments.some((p) => p.features.includes(feature) && lc(p.payer) === lc(payer as string) && p.chainId === chainId && verified.has(lc(p.txHash))),
    clear: () => {
      state = { payments: [], pending: null }
      verified.clear()
      save()
    },
    version: () => version,
    subscribe: (cb: () => void) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
  }
}

export type PaymentSession = ReturnType<typeof createPaymentSession>

export const paymentSession: PaymentSession = createPaymentSession(typeof sessionStorage === 'undefined' ? null : sessionStorage)

/** Re-renders when the session changes (new payment, verification finished, pending payment updated). */
export function usePaymentSession() {
  useSyncExternalStore(paymentSession.subscribe, paymentSession.version, paymentSession.version)
  return paymentSession
}
