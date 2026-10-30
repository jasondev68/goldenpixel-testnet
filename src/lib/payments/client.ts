import { createPublicClient, getAddress, http, isAddress, type PublicClient } from 'viem'
import { arcTestnet } from 'viem/chains'
import { FORBIDDEN_RECIPIENTS, PAYMENT_RECIPIENT } from '@/config/payments'
import { ACTIVE_PAYMENT_NETWORK, resolvePaymentNetwork, type ResolvedPaymentNetwork } from '@/config/networks'

/**
 * The payment network and an RPC client used ONLY for reading the payment from the chain. It talks to the Arc RPC
 * endpoint directly, not through the user's wallet, so a wallet (or a page script) cannot answer on the chain's behalf.
 * `VITE_PAYMENT_RPC_URL` (a public, non-secret URL) can point it at your own Arc node.
 */
export function paymentNetwork(): ResolvedPaymentNetwork {
  return resolvePaymentNetwork(ACTIVE_PAYMENT_NETWORK)
}

let cached: PublicClient | null = null
export function paymentReader(): PublicClient {
  if (cached) return cached
  const net = paymentNetwork()
  const override = (import.meta.env.VITE_PAYMENT_RPC_URL)?.trim()
  // The registry only ships testnet for now, so the chain definition below is the matching one.
  cached = createPublicClient({ chain: arcTestnet, transport: http(override || net.rpcUrls[0]) })
  return cached
}

export type PaymentConfig = {
  recipient: `0x${string}`
  chainId: number
  networkName: string
  isTestnet: boolean
  explorerBase: string
  token: `0x${string}`
  decimals: number
}

/**
 * Everything a payment is checked against, from configuration only. The recipient is `PAYMENT_RECIPIENT` in
 * src/config/payments.ts (or the public `VITE_PAYMENT_RECIPIENT` override). The deployer wallet is refused.
 */
export function paymentConfig(): PaymentConfig {
  const net = paymentNetwork()
  const raw = ((import.meta.env.VITE_PAYMENT_RECIPIENT)?.trim() || PAYMENT_RECIPIENT).toLowerCase()
  if (!isAddress(raw, { strict: false })) throw new Error('The payment recipient is not a valid address')
  if (FORBIDDEN_RECIPIENTS.some((f) => f.toLowerCase() === raw)) throw new Error('The payment recipient must not be the shared deployer wallet')
  return {
    recipient: getAddress(raw),
    chainId: net.chainId,
    networkName: net.name,
    isTestnet: net.isTestnet,
    explorerBase: net.explorerBase,
    token: net.usdc.address,
    decimals: net.usdc.decimals,
  }
}
