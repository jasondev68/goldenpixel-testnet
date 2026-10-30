/**
 * Centralized payment network configuration (shared by the browser app and the payments server).
 *
 * Mainnet and testnet are kept in separate entries. Only the networks listed in
 * PAYMENT_NETWORKS can ever receive payments. Arc Mainnet is intentionally NOT listed yet:
 * enabling it is a deliberate, reviewed step (see README "Going live on Arc Mainnet").
 */
import { getChain, getUsdc } from '../onchain-facts'

export type PaymentNetworkKey = 'testnet'

/** Official USDC predeploy on every Arc network (Arc docs, "Token Addresses for Arc"). */
export const OFFICIAL_ARC_USDC = '0x3600000000000000000000000000000000000000'

type NetworkDef = {
  key: PaymentNetworkKey
  chainId: number
  /** Circle SDK chain identifier. */
  sdkChain: string
  /** Key used by the sandbox RPC proxy (RPC_PROXY_CHAINS). */
  proxyKey: string
  isTestnet: boolean
}

export const PAYMENT_NETWORKS: Record<PaymentNetworkKey, NetworkDef> = {
  testnet: { key: 'testnet', chainId: 5042002, sdkChain: 'Arc_Testnet', proxyKey: 'Arc_Testnet', isTestnet: true },
}

/** The one network premium payments are accepted on. Change here, nowhere else. */
export const ACTIVE_PAYMENT_NETWORK: PaymentNetworkKey = 'testnet'

export type ResolvedPaymentNetwork = NetworkDef & {
  name: string
  explorerBase: string
  rpcUrls: string[]
  usdc: { address: `0x${string}`; decimals: number }
}

/** Resolves the network and verifies the USDC contract is the official Arc USDC. Throws otherwise. */
export function resolvePaymentNetwork(key: PaymentNetworkKey = ACTIVE_PAYMENT_NETWORK): ResolvedPaymentNetwork {
  const def = PAYMENT_NETWORKS[key]
  const chain = getChain(def.chainId)
  const usdc = getUsdc(def.chainId)
  if (!chain || !usdc) throw new Error(`Payment network ${key} (chain ${def.chainId}) is missing from the onchain facts`)
  if (usdc.address.toLowerCase() !== OFFICIAL_ARC_USDC.toLowerCase()) {
    throw new Error(`USDC address for chain ${def.chainId} does not match the official Arc USDC`)
  }
  if (chain.isTestnet !== def.isTestnet) throw new Error(`Chain ${def.chainId} testnet flag mismatch`)
  return {
    ...def,
    name: chain.name,
    explorerBase: chain.explorerBase,
    rpcUrls: chain.rpcUrls,
    usdc: { address: usdc.address as `0x${string}`, decimals: usdc.decimals },
  }
}
