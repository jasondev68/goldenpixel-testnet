import type { Hash } from 'viem'
import { REQUIRED_CONFIRMATIONS, VERIFY_TIMEOUT_SECONDS, featuresRaw } from '@/config/payments'
import type { PaymentConfig } from './client'
import type { PaymentSession, PendingPayment } from './session'
import { verifyPayment, type ChainReader, type PaymentIntent } from './verify'

export type ConfirmResult = { status: 'verified' } | { status: 'rejected'; code: string } | { status: 'timeout' }

export function intentFor(p: PendingPayment, cfg: PaymentConfig): PaymentIntent {
  return { payer: p.payer, recipient: cfg.recipient, token: cfg.token, chainId: cfg.chainId, amountRaw: featuresRaw(p.features, cfg.decimals), startedAt: p.startedAt }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Waits for a sent transaction and decides, from on-chain data only, whether it is the payment for `p`.
 * Only a `verified` result records the payment in the session. A pending, failed or unreadable transaction unlocks nothing.
 */
export async function confirmPayment(
  reader: ChainReader,
  session: PaymentSession,
  cfg: PaymentConfig,
  p: PendingPayment,
  opts: { intervalMs?: number; timeoutMs?: number; isCancelled?: () => boolean; onTick?: (reason: string) => void } = {},
): Promise<ConfirmResult> {
  const interval = opts.intervalMs ?? 2000
  const deadline = Date.now() + (opts.timeoutMs ?? VERIFY_TIMEOUT_SECONDS * 1000)
  const intent = intentFor(p, cfg)
  while (!opts.isCancelled?.()) {
    let out
    try {
      out = await verifyPayment(reader, intent, { confirmations: REQUIRED_CONFIRMATIONS }, p.txHash as Hash)
    } catch {
      opts.onTick?.('RPC_ERROR') // the RPC could not be read right now: that is "not verified", never "paid"
    }
    if (out?.status === 'verified') {
      // A hash already recorded in this session is the same payment resumed after a reload, never a second unlock.
      if (!session.isUsed(p.txHash)) {
        session.record({ txHash: p.txHash, payer: p.payer, chainId: p.chainId, features: p.features, amountRaw: String(intent.amountRaw), startedAt: p.startedAt, verifiedAt: Date.now() })
      }
      session.markVerified(p.txHash)
      session.setPending(null)
      return { status: 'verified' }
    }
    if (out?.status === 'rejected') {
      session.setPending(null)
      return { status: 'rejected', code: out.code }
    }
    if (out?.status === 'pending') opts.onTick?.(out.reason)
    if (Date.now() >= deadline) return { status: 'timeout' }
    await sleep(interval)
  }
  return { status: 'timeout' }
}
