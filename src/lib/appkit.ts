import { AppKit } from '@circle-fin/app-kit'
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2'
import { numberToHex, type Chain, type EIP1193Provider } from 'viem'
import type { Connector } from 'wagmi'
import { APP_CHAINS, APP_VIEM_CHAINS } from '@/config/bridgeChains'
import { translate } from '@/i18n'

let kit: AppKit | null = null
export const getKit = () => (kit ??= new AppKit())

const isUnrecognizedChain = (error: unknown) => {
  const e = error as { code?: number; data?: { originalError?: { code?: number } } }
  return e?.code === 4902 || e?.data?.originalError?.code === 4902
}

/**
 * Without the Forwarding Service the adapter switches the wallet to the destination chain to mint.
 * A wallet that lacks that chain rejects with 4902 after the burn, so add the chain and retry.
 */
export function withAddChainFallback(provider: EIP1193Provider, chains: readonly Chain[]): EIP1193Provider {
  const send = provider.request.bind(provider) as (args: { method: string; params?: unknown }) => Promise<unknown>
  const request = (async (args: { method: string; params?: unknown }) => {
    try {
      return await send(args)
    } catch (error) {
      if (args.method !== 'wallet_switchEthereumChain' || !isUnrecognizedChain(error)) throw error
      const [{ chainId }] = args.params as [{ chainId: string }]
      const chain = chains.find((c) => c.id === Number(chainId))
      if (!chain) throw error
      await send({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: numberToHex(chain.id),
            chainName: chain.name,
            nativeCurrency: chain.nativeCurrency,
            rpcUrls: [...chain.rpcUrls.default.http],
            blockExplorerUrls: chain.blockExplorers ? [chain.blockExplorers.default.url] : undefined,
          },
        ],
      })
      return send(args)
    }
  }) as EIP1193Provider['request']

  return new Proxy(provider, {
    get(target, prop) {
      if (prop === 'request') return request
      const value: unknown = Reflect.get(target, prop, target)
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value
    },
  })
}

export async function adapterFromConnector(connector: Connector | undefined) {
  if (!connector) throw new Error(translate('err.walletNotConnected'))
  const provider = (await connector.getProvider()) as EIP1193Provider
  return createViemAdapterFromProvider({ provider: withAddChainFallback(provider, APP_VIEM_CHAINS) })
}

/** App chains the SDK itself reports for the operation. Never show a chain the SDK does not support. */
export function sdkSupportedChains(op: 'bridge' | 'swap') {
  const kit = getKit()
  const defs = op === 'bridge' ? kit.getSupportedChains('bridge') : kit.getSupportedChains('swap')
  const names = new Set(defs.filter((c) => c.isTestnet).map((c) => c.chain as string))
  return APP_CHAINS.filter((c) => names.has(c.sdk))
}

/** Token contract on the SDK's Arc Testnet definition (used to read verified EURC balances). */
export function sdkArcTestnetTokens() {
  const def = getKit()
    .getSupportedChains('swap')
    .find((c) => (c.chain as string) === 'Arc_Testnet')
  return { usdc: def?.usdcAddress ?? null, eurc: def?.eurcAddress ?? null }
}
