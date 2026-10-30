import { useCallback, useMemo } from 'react'
import { useAccount } from 'wagmi'
import { PREMIUM_FEATURES, featuresPriceUsdc, uniqueFeatures, type PremiumFeatureId } from '@/config/payments'
import type { Msg } from '@/i18n'
import { ApiError } from '@/lib/apiError'
import { requestPayment } from '@/lib/paymentSheet'
import { paymentConfig, type PaymentConfig } from '@/lib/payments/client'
import { usePaymentSession } from '@/lib/payments/session'

export const OPEN_WALLET_EVENT = 'gp:open-wallet'

/**
 * Pay-per-feature access, frontend only. A feature is unlocked for this browser session once ONE direct USDC transfer
 * for it has been confirmed on-chain and verified from chain data. There are no credits, accounts or backend.
 * This is a convenience gate for honest users, not enforcement: see README "Payment model".
 */
export function usePremiumAction() {
  const session = usePaymentSession()
  const { address, isConnected } = useAccount()
  const cfg = useMemo<{ config: PaymentConfig | null; problem: Msg | null }>(() => {
    try {
      return { config: paymentConfig(), problem: null }
    } catch {
      return { config: null, problem: { key: 'pay.cfg.recipientInvalid' } }
    }
  }, [])
  const available = cfg.config !== null
  const chainId = cfg.config?.chainId ?? 0

  const isUnlocked = useCallback((features: readonly PremiumFeatureId[]) => features.every((f) => session.isUnlocked(f, address, chainId)), [session, address, chainId])
  /** The features that still have to be paid for. */
  const missing = useCallback((features: readonly PremiumFeatureId[]) => uniqueFeatures(features).filter((f) => !session.isUnlocked(f, address, chainId)), [session, address, chainId])
  /** Exact USDC still to pay for `features` (0 when already unlocked), as a decimal string. */
  const priceOf = useCallback((features: readonly PremiumFeatureId[]) => featuresPriceUsdc(missing(features)), [missing])

  /** Makes sure `features` are unlocked, opening the payment sheet if they are not. Throws ApiError (translatable). */
  const ensurePaid = useCallback(
    async (features: readonly PremiumFeatureId[]): Promise<void> => {
      const todo = missing(features)
      if (todo.length === 0) return
      if (!available) throw new ApiError({ key: 'px.err.unavailable' })
      if (!isConnected || !address) {
        window.dispatchEvent(new Event(OPEN_WALLET_EVENT))
        throw new ApiError({ key: 'up.err.connect' })
      }
      await requestPayment(todo, address)
    },
    [missing, available, isConnected, address],
  )

  /** Pays if needed, then runs `produce`. A failure after payment keeps the unlock, so the retry is free. */
  const run = useCallback(
    async <T,>(features: readonly PremiumFeatureId[], produce: () => Promise<T>): Promise<T> => {
      await ensurePaid(features)
      return produce()
    },
    [ensurePaid],
  )

  return { available, problem: cfg.problem, config: cfg.config, isConnected, address, isUnlocked, missing, priceOf, ensurePaid, run, features: PREMIUM_FEATURES }
}

export type PremiumAction = ReturnType<typeof usePremiumAction>
