import { decodeFunctionData, erc20Abi, parseEventLogs, type Hash, type Hex, type Log } from 'viem'

/** The minimal chain surface verification needs (a viem PublicClient satisfies it). */
export interface ChainReader {
  getChainId(): Promise<number>
  getTransaction(args: { hash: Hash }): Promise<{ from: string; to: string | null; input: Hex; chainId?: number }>
  getTransactionReceipt(args: { hash: Hash }): Promise<{ status: 'success' | 'reverted'; blockNumber: bigint; logs: Log[] }>
  getBlock(args: { blockNumber: bigint }): Promise<{ timestamp: bigint }>
  getBlockNumber(): Promise<bigint>
}

/** What this payment is supposed to be. Built from the app's own configuration and the connected wallet, never from the chain. */
export type PaymentIntent = {
  payer: string
  recipient: string
  token: string
  chainId: number
  amountRaw: bigint
  /** When the user pressed Pay (ms). A transaction mined before this cannot be the payment for it. */
  startedAt: number
}

export type VerifyParams = { confirmations: number }

export type VerifyOutcome =
  | { status: 'verified'; blockNumber: bigint; minedAt: number }
  | { status: 'pending'; reason: 'NOT_FOUND' | 'NOT_MINED' | 'CONFIRMATIONS' }
  | { status: 'rejected'; code: string; message: string }

const reject = (code: string, message: string): VerifyOutcome => ({ status: 'rejected', code, message })
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
const isNotFound = (e: unknown) => /not (be )?found|could not be found/i.test(String((e as Error)?.message ?? e))
/** The browser clock and the chain clock are never identical; allow a minute either way before calling a payment "old". */
export const CLOCK_SKEW_MS = 60_000

/**
 * Checks, from on-chain data only, that `hash` is the successful, confirmed USDC payment described by `intent`:
 * right chain, official token contract, sent by the connected wallet, to the configured recipient, for the exact
 * amount, with a matching Transfer event, enough confirmations, and made after the user pressed Pay.
 * Nothing about the transaction is taken from the wallet popup or from component state.
 */
export async function verifyPayment(reader: ChainReader, intent: PaymentIntent, p: VerifyParams, hash: Hash): Promise<VerifyOutcome> {
  const chainId = await reader.getChainId()
  if (chainId !== intent.chainId) return reject('WRONG_NETWORK', 'The RPC endpoint is on a different network than the payment network')

  let tx: Awaited<ReturnType<ChainReader['getTransaction']>>
  try {
    tx = await reader.getTransaction({ hash })
  } catch (e) {
    if (isNotFound(e)) return { status: 'pending', reason: 'NOT_FOUND' }
    throw e
  }

  if (tx.chainId !== undefined && tx.chainId !== intent.chainId) return reject('WRONG_NETWORK', 'Transaction is on a different network')
  if (!tx.to || !same(tx.to, intent.token)) return reject('WRONG_TOKEN', 'Transaction was not sent to the official USDC contract')
  if (!same(tx.from, intent.payer)) return reject('WRONG_SENDER', 'Transaction was not sent by the connected wallet')

  let decoded: ReturnType<typeof decodeFunctionData<typeof erc20Abi>>
  try {
    decoded = decodeFunctionData({ abi: erc20Abi, data: tx.input })
  } catch {
    return reject('NOT_A_TRANSFER', 'Transaction is not a USDC transfer')
  }
  if (decoded.functionName !== 'transfer') return reject('NOT_A_TRANSFER', 'Transaction is not a USDC transfer')
  const [to, value] = decoded.args as readonly [string, bigint]
  if (!same(to, intent.recipient)) return reject('WRONG_RECIPIENT', 'Payment was not sent to the GoldenPixel recipient')
  if (value !== intent.amountRaw) return reject('WRONG_AMOUNT', 'Payment amount does not match the price exactly')

  let receipt: Awaited<ReturnType<ChainReader['getTransactionReceipt']>>
  try {
    receipt = await reader.getTransactionReceipt({ hash })
  } catch (e) {
    if (isNotFound(e)) return { status: 'pending', reason: 'NOT_MINED' }
    throw e
  }
  if (receipt.status !== 'success') return reject('TX_FAILED', 'Transaction failed onchain')

  const head = await reader.getBlockNumber()
  const confirmations = head >= receipt.blockNumber ? head - receipt.blockNumber + 1n : 0n
  if (confirmations < BigInt(p.confirmations)) return { status: 'pending', reason: 'CONFIRMATIONS' }

  // The ERC-20 USDC contract emits its own 6-decimal Transfer log (Arc also emits an 18-decimal system log from a
  // different address, which is ignored here so the same movement is never read twice).
  const transfers = parseEventLogs({ abi: erc20Abi, eventName: 'Transfer', logs: receipt.logs }).filter((l) => same(l.address, intent.token))
  const match = transfers.find((l) => same(l.args.to, intent.recipient) && same(l.args.from, intent.payer) && l.args.value === value)
  if (!match) return reject('NO_TRANSFER_EVENT', 'No matching USDC Transfer event in the receipt')

  const block = await reader.getBlock({ blockNumber: receipt.blockNumber })
  const minedAt = Number(block.timestamp) * 1000
  if (minedAt < intent.startedAt - CLOCK_SKEW_MS) return reject('BEFORE_PAYMENT', 'Transaction was mined before this payment was started')

  return { status: 'verified', blockNumber: receipt.blockNumber, minedAt }
}
