import { useAccount, usePublicClient, useReadContract } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import { encodeFunctionData, erc20Abi, type Hex } from 'viem'
import { getUsdc } from '@/onchain-facts'
import { Amount, gasTokenDecimalsFor, gasTokenToUsdc, isGasTokenUsdc, parseAmount, usdcToGasToken } from '@/onchain-money'
import { GAS_RESERVE_FALLBACK_USDC } from '@/config/payments'

/** ERC-20 USDC balance of the connected wallet on `chainId` (6 decimals). One number, never summed with the native view. */
export function useUsdcBalance(chainId: number | undefined) {
  const { address } = useAccount()
  const usdc = chainId ? getUsdc(chainId) : undefined
  const q = useReadContract({
    address: usdc?.address as `0x${string}` | undefined,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId,
    query: { enabled: Boolean(address && usdc), refetchInterval: 15_000 },
  })
  const amount = q.data !== undefined && usdc ? Amount.fromRaw(q.data, usdc.decimals) : undefined
  return { amount, isLoading: q.isLoading, error: q.error, refetch: q.refetch, hasUsdc: Boolean(usdc) }
}

/** Rounds a gas-token amount up to the 6-decimal USDC view so fees are never understated. */
function gasToUsdcUp(chainId: number, native: Amount): Amount {
  const down = gasTokenToUsdc(chainId, native, 'trunc')
  return usdcToGasToken(chainId, down).lt(native) ? down.add(Amount.fromRaw(1n, down.decimals)) : down
}

type TxLike = { to: `0x${string}`; data?: Hex; value?: bigint }

/**
 * Live fee estimate for a transaction, in USDC. Only meaningful where gas is paid in USDC (Arc).
 * `feeUsdc` is undefined while loading, unavailable, or when the chain's gas token is not USDC.
 */
export function useGasFee(chainId: number | undefined, tx: TxLike | undefined) {
  const { address } = useAccount()
  const client = usePublicClient({ chainId })
  const usable = Boolean(chainId && client && address && tx && isGasTokenUsdc(chainId))
  const q = useQuery({
    queryKey: ['gasFee', chainId, address, tx?.to, tx?.data, String(tx?.value ?? 0n)],
    enabled: usable,
    refetchInterval: 20_000,
    retry: 1,
    queryFn: async () => {
      if (!client || !tx || !address || !chainId) throw new Error('not ready')
      const gas = await client.estimateGas({ account: address, to: tx.to, data: tx.data, value: tx.value })
      const fees = await client.estimateFeesPerGas()
      const price = fees.maxFeePerGas ?? fees.gasPrice
      if (!price) throw new Error('no gas price')
      return Amount.fromRaw(gas * price, gasTokenDecimalsFor(chainId))
    },
  })
  const feeUsdc = q.data && chainId ? gasToUsdcUp(chainId, q.data) : undefined
  return { feeUsdc, isLoading: q.isLoading && usable, failed: q.isError }
}

/**
 * USDC to hold back for gas when spending USDC on a chain that pays gas in USDC.
 * `weight` is how many simple-transfer fees the flow can cost (a payment is 1; swap and bridge flows are
 * heavier). Uses a live transfer estimate times `weight`, doubled for headroom, and falls back to a configured
 * conservative reserve when the estimate is unavailable. Flows with an SDK quote re-check against that quote.
 */
export function useGasReserve(chainId: number | undefined, weight: number) {
  const { address } = useAccount()
  const usdc = chainId ? getUsdc(chainId) : undefined
  const tx: TxLike | undefined =
    usdc && address ? { to: usdc.address as `0x${string}`, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [address, 1n] }) } : undefined
  const { feeUsdc, isLoading } = useGasFee(chainId, tx)

  if (!chainId || !usdc || !isGasTokenUsdc(chainId)) return { reserve: undefined, perTx: undefined, estimated: false, isLoading: false }
  const n = BigInt(Math.max(1, Math.round(weight)))
  if (feeUsdc) return { reserve: feeUsdc.mul(n * 2n), perTx: feeUsdc, estimated: true, isLoading }
  return { reserve: parseAmount(chainId, GAS_RESERVE_FALLBACK_USDC).mul(n), perTx: undefined, estimated: false, isLoading }
}
