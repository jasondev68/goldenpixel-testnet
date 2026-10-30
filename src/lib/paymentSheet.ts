import type { PremiumFeatureId } from '@/config/payments'
import { ApiError } from '@/lib/apiError'

export type SheetRequest = {
  id: number
  /** The features still to be paid for (already unlocked ones are not included). */
  features: PremiumFeatureId[]
  payer: string
  resolve: () => void
  reject: (e: unknown) => void
}

let current: SheetRequest | null = null
let seq = 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export const sheetStore = {
  get: () => current,
  subscribe: (cb: () => void) => {
    listeners.add(cb)
    return () => listeners.delete(cb)
  },
}

/** Opens the payment sheet. Resolves only after the payment was verified on-chain. */
export function requestPayment(features: PremiumFeatureId[], payer: string): Promise<void> {
  if (current) return Promise.reject(new ApiError({ key: 'pay.err.busy' }))
  return new Promise<void>((resolve, reject) => {
    current = { id: ++seq, features, payer, resolve, reject }
    emit()
  })
}

/** Called by the sheet when it is done (success, cancel or error). */
export function closeSheet(id: number) {
  if (current?.id === id) {
    current = null
    emit()
  }
}
