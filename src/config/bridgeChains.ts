/**
 * Testnet chains offered in the wallet, Swap and Bridge UI.
 * `sdk` is the Circle App Kit chain identifier; the UI re-checks each one against the SDK at runtime
 * and hides any chain the SDK does not report as bridge-capable.
 */
import { arbitrumSepolia, arcTestnet, avalancheFuji, baseSepolia, optimismSepolia, polygonAmoy, sepolia } from 'viem/chains'
import type { Chain } from 'viem'

export type AppChain = { chain: Chain; sdk: string; short: string }

export const APP_CHAINS: readonly AppChain[] = [
  { chain: arcTestnet, sdk: 'Arc_Testnet', short: 'Arc' },
  { chain: sepolia, sdk: 'Ethereum_Sepolia', short: 'Ethereum' },
  { chain: baseSepolia, sdk: 'Base_Sepolia', short: 'Base' },
  { chain: arbitrumSepolia, sdk: 'Arbitrum_Sepolia', short: 'Arbitrum' },
  { chain: optimismSepolia, sdk: 'Optimism_Sepolia', short: 'Optimism' },
  { chain: avalancheFuji, sdk: 'Avalanche_Fuji', short: 'Avalanche' },
  { chain: polygonAmoy, sdk: 'Polygon_Amoy_Testnet', short: 'Polygon' },
]

export const APP_VIEM_CHAINS = APP_CHAINS.map((c) => c.chain) as unknown as readonly [Chain, ...Chain[]]

export const ARC_TESTNET_ID = arcTestnet.id

export const appChainById = (id: number | undefined) => APP_CHAINS.find((c) => c.chain.id === id)
