/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 *
 * Testnets only for now. Chains come from src/config/bridgeChains.ts so the wallet,
 * Swap and Bridge all agree on one list.
 */

import { http, createConfig } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { arcTestnet } from 'viem/chains'
import { registerChain } from './tracing'
import { APP_VIEM_CHAINS } from './config/bridgeChains'

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(arcTestnet.id, arcTestnet.rpcUrls.default.http[0])

export const config = createConfig({
  chains: APP_VIEM_CHAINS,
  // Injected wallets only (MetaMask and any EIP-1193 / EIP-6963 browser wallet). No keys are ever requested.
  connectors: [injected()],
  transports: Object.fromEntries(APP_VIEM_CHAINS.map((c) => [c.id, http()])),
})
