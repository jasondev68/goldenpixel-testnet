import { PREMIUM_FEATURES, REQUIRED_CONFIRMATIONS, featuresRaw } from '@/config/payments'
import { paymentConfig, paymentReader } from './client'
import { paymentSession, type PaymentRecord } from './session'
import { verifyPayment } from './verify'

const inFlight = new Set<string>()

/** The intent a stored payment must still satisfy: rebuilt from configuration + stored features, not trusted as stored. */
function intentFor(p: PaymentRecord) {
  const cfg = paymentConfig()
  const features = p.features.filter((f) => f in PREMIUM_FEATURES)
  return { payer: p.payer, recipient: cfg.recipient, token: cfg.token, chainId: p.chainId, amountRaw: featuresRaw(features, cfg.decimals), startedAt: p.startedAt }
}

/**
 * Stored payments never unlock anything by themselves. After a page reload each one is read from the chain again; if
 * the check passes it counts, if it fails for good (edited storage, wrong amount, wrong wallet) it is discarded.
 */
export async function revalidateStoredPayments(): Promise<void> {
  const cfg = paymentConfig()
  for (const p of paymentSession.payments()) {
    if (paymentSession.isVerified(p.txHash) || inFlight.has(p.txHash)) continue
    inFlight.add(p.txHash)
    try {
      if (p.chainId !== cfg.chainId) {
        paymentSession.remove(p.txHash)
        continue
      }
      const out = await verifyPayment(paymentReader(), intentFor(p), { confirmations: REQUIRED_CONFIRMATIONS }, p.txHash as `0x${string}`)
      if (out.status === 'verified') paymentSession.markVerified(p.txHash)
      else if (out.status === 'rejected') paymentSession.remove(p.txHash)
    } catch {
      /* RPC trouble: stays locked until the next attempt */
    } finally {
      inFlight.delete(p.txHash)
    }
  }
}
