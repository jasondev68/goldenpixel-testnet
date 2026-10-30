import { useCallback, useState } from 'react'
import { FREE_LIMITS, PREMIUM_LIMITS } from '@/config/plans'
import { ApiError } from '@/lib/apiError'
import { usePremiumAction } from './usePremiumAction'
import type { Msg } from '@/i18n'

/**
 * Free vs Pro limits for the multi-file tools (Compress, Convert).
 * Valid files above the free limits are held back (never discarded). A Pro batch is paid for directly (exact price shown,
 * confirmed in the wallet, verified on-chain) BEFORE the larger set is loaded. It then stays unlocked for the session.
 */
export function useBatchPlan() {
  const px = usePremiumAction()
  const [held, setHeld] = useState<File[]>([])
  const [unlocking, setUnlocking] = useState(false)
  const [error, setError] = useState<Msg | null>(null)

  const pro = px.isUnlocked(['pro-batch'])
  const limits = pro ? PREMIUM_LIMITS : FREE_LIMITS

  const unlock = useCallback(async () => {
    setError(null)
    setUnlocking(true)
    try {
      await px.ensurePaid(['pro-batch'])
    } catch (e) {
      // Closing the payment sheet is a choice, not an error.
      setError(e instanceof ApiError ? (e.code === 'CANCELLED' ? null : e.msg) : { key: 'err.generic' })
    } finally {
      setUnlocking(false)
    }
  }, [px])

  /** Kept for the tools' download paths: nothing to settle, a verified payment already unlocked the session. */
  const settle = useCallback(() => Promise.resolve(), [])

  return { px, pro, limits, held, addHeld: (f: File[]) => setHeld((p) => [...p, ...f]), takeHeld: () => { const f = held; setHeld([]); return f }, unlock, unlocking, error, settle }
}

export type BatchPlan = ReturnType<typeof useBatchPlan>
