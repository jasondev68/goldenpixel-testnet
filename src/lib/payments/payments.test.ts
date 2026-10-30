import { describe, expect, test } from 'bun:test'
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, erc20Abi, type Hash, type Log } from 'viem'
import { PAYMENT_RECIPIENT, PREMIUM_FEATURES, exactUnits, featuresPriceUsdc, featuresRaw } from '@/config/payments'
import { confirmPayment } from './flow'
import { createPaymentSession, type PendingPayment } from './session'
import { verifyPayment, type ChainReader, type PaymentIntent } from './verify'

const PAYER = '0x1111111111111111111111111111111111111111'
const OTHER = '0x2222222222222222222222222222222222222222'
const RECIPIENT = '0xd7d80191dee0a4cd481766b82b0c38c7feb63586'
const USDC = '0x3600000000000000000000000000000000000000'
const SYSTEM_EMITTER = '0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE'
const HASH: Hash = `0x${'1'.repeat(64)}`
const T0 = 1_800_000_000_000
const intent: PaymentIntent = { payer: PAYER, recipient: RECIPIENT, token: USDC, chainId: 5042002, amountRaw: 100_000n, startedAt: T0 }

const transferLog = (from: string, to: string, value: bigint, address = USDC): Log =>
  ({
    address,
    topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from: from as `0x${string}`, to: to as `0x${string}` } }),
    data: encodeAbiParameters([{ type: 'uint256' }], [value]),
  }) as unknown as Log

type O = Partial<{
  rpcChain: number; from: string; to: string | null; recipient: string; value: bigint; logs: Log[]; status: 'success' | 'reverted'
  head: bigint; block: bigint; mined: number; txChainId: number; txMissing: boolean; receiptMissing: boolean; calldata: `0x${string}`
}>
function reader(o: O = {}): ChainReader {
  const value = o.value ?? 100_000n
  return {
    getChainId: () => Promise.resolve(o.rpcChain ?? 5042002),
    getTransaction: () =>
      o.txMissing
        ? Promise.reject(new Error('Transaction with hash "0x" could not be found.'))
        : Promise.resolve({ from: o.from ?? PAYER, to: o.to === undefined ? USDC : o.to, input: o.calldata ?? encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [(o.recipient ?? RECIPIENT) as `0x${string}`, value] }), chainId: o.txChainId }),
    getTransactionReceipt: () => {
      if (o.receiptMissing) return Promise.reject(new Error('Transaction receipt with hash "0x" could not be found.'))
      // Arc emits the 6-decimal ERC-20 log AND an 18-decimal system log for the same movement.
      const logs = o.logs ?? [transferLog(o.from ?? PAYER, o.recipient ?? RECIPIENT, value * 10n ** 12n, SYSTEM_EMITTER), transferLog(o.from ?? PAYER, o.recipient ?? RECIPIENT, value)]
      return Promise.resolve({ status: o.status ?? 'success', blockNumber: o.block ?? 10n, logs })
    },
    getBlock: () => Promise.resolve({ timestamp: BigInt(Math.floor((o.mined ?? T0 + 5000) / 1000)) }),
    getBlockNumber: () => Promise.resolve(o.head ?? 10n),
  }
}
const check = (o: O) => verifyPayment(reader(o), intent, { confirmations: 1 }, HASH)

describe('configuration', () => {
  test('recipient is the configured wallet and prices are exact raw units', () => {
    expect(PAYMENT_RECIPIENT).toBe('0xd7d80191dee0a4cd481766b82b0c38c7feb63586')
    expect(featuresRaw(['upscale-2x'], 6)).toBe(100_000n)
    expect(featuresRaw(['hd-export', 'advanced-collage', 'hd-export'], 6)).toBe(100_000n)
    expect(featuresPriceUsdc(['pro-batch'])).toBe('0.25')
    expect(featuresPriceUsdc(['hd-export', 'advanced-collage'])).toBe('0.10')
    expect(() => exactUnits('0.1234567', 6)).toThrow()
    for (const f of Object.values(PREMIUM_FEATURES)) expect(/^\d+(\.\d{1,6})?$/.test(f.priceUsdc)).toBe(true)
  })
})

describe('verifyPayment (reads only chain data)', () => {
  test('accepts the exact payment from the connected wallet, ignoring the duplicate 18-decimal system log', async () => {
    const r = await check({})
    expect(r.status).toBe('verified')
  })

  test('not found, not mined and too few confirmations are pending, never paid', async () => {
    expect((await check({ txMissing: true })).status).toBe('pending')
    expect((await check({ receiptMissing: true })).status).toBe('pending')
    expect((await check({ block: 10n, head: 9n })).status).toBe('pending')
  })

  test('every way the payment can differ is rejected', async () => {
    const code = async (o: O) => {
      const r = await check(o)
      return r.status === 'rejected' ? r.code : r.status
    }
    expect(await code({ rpcChain: 1 })).toBe('WRONG_NETWORK')
    expect(await code({ txChainId: 1 })).toBe('WRONG_NETWORK')
    expect(await code({ to: OTHER })).toBe('WRONG_TOKEN')
    expect(await code({ to: null })).toBe('WRONG_TOKEN')
    expect(await code({ from: OTHER })).toBe('WRONG_SENDER')
    expect(await code({ recipient: OTHER })).toBe('WRONG_RECIPIENT')
    expect(await code({ value: 99_999n })).toBe('WRONG_AMOUNT')
    expect(await code({ value: 100_001n })).toBe('WRONG_AMOUNT')
    expect(await code({ status: 'reverted' })).toBe('TX_FAILED')
    expect(await code({ calldata: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [RECIPIENT, 100_000n] }) })).toBe('NOT_A_TRANSFER')
    expect(await code({ calldata: '0xdeadbeef' })).toBe('NOT_A_TRANSFER')
    expect(await code({ mined: T0 - 10 * 60_000 })).toBe('BEFORE_PAYMENT')
  })

  test('matching calldata without a real Transfer event from the USDC contract is not accepted', async () => {
    const spoof = [transferLog(PAYER, RECIPIENT, 100_000n, OTHER)]
    expect(await check({ logs: spoof })).toMatchObject({ status: 'rejected', code: 'NO_TRANSFER_EVENT' })
    expect(await check({ logs: [] })).toMatchObject({ status: 'rejected', code: 'NO_TRANSFER_EVENT' })
  })
})

function memoryStorage() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), raw: m }
}
const cfg = { recipient: RECIPIENT as `0x${string}`, chainId: 5042002, networkName: 'Arc Testnet', isTestnet: true, explorerBase: 'https://x', token: USDC as `0x${string}`, decimals: 6 }
const pending: PendingPayment = { txHash: HASH, payer: PAYER, chainId: 5042002, features: ['upscale-2x' as const], amountRaw: '100000', startedAt: T0 }

describe('session store', () => {
  test('a stored payment never unlocks by itself: it must be verified in this page load', () => {
    const storage = memoryStorage()
    const s = createPaymentSession(storage)
    s.record({ ...pending, verifiedAt: T0 })
    expect(s.isUnlocked('upscale-2x', PAYER, 5042002)).toBe(false)
    s.markVerified(HASH)
    expect(s.isUnlocked('upscale-2x', PAYER, 5042002)).toBe(true)
    // A reload (new store over the same storage) restores the record but not the verification.
    const reloaded = createPaymentSession(storage)
    expect(reloaded.payments().length).toBe(1)
    expect(reloaded.isUnlocked('upscale-2x', PAYER, 5042002)).toBe(false)
  })

  test('unlock is bound to the feature, the paying wallet and the chain', () => {
    const s = createPaymentSession(memoryStorage())
    s.record({ ...pending, verifiedAt: T0 })
    s.markVerified(HASH)
    expect(s.isUnlocked('upscale-4x', PAYER, 5042002)).toBe(false)
    expect(s.isUnlocked('upscale-2x', OTHER, 5042002)).toBe(false)
    expect(s.isUnlocked('upscale-2x', PAYER, 5042)).toBe(false)
    expect(s.isUnlocked('upscale-2x', undefined, 5042002)).toBe(false)
  })

  test('a transaction hash can back only one payment record per session', () => {
    const s = createPaymentSession(memoryStorage())
    expect(s.record({ ...pending, verifiedAt: T0 })).toBe(true)
    expect(s.record({ ...pending, features: ['upscale-4x'], verifiedAt: T0 })).toBe(false)
    expect(s.payments().length).toBe(1)
  })

  test('corrupt or tampered storage degrades to an empty session', () => {
    const storage = memoryStorage()
    storage.setItem('gp-premium-session', '{not json')
    expect(createPaymentSession(storage).payments()).toEqual([])
  })
})

describe('confirmPayment', () => {
  const run = (o: O, p = pending, session = createPaymentSession(memoryStorage())) => confirmPayment(reader(o), session, cfg, p, { intervalMs: 1, timeoutMs: 40 }).then((res) => ({ res, session }))

  test('a verified transaction unlocks the feature for the paying wallet only', async () => {
    const { res, session } = await run({})
    expect(res.status).toBe('verified')
    expect(session.isUnlocked('upscale-2x', PAYER, 5042002)).toBe(true)
    expect(session.isUnlocked('upscale-2x', OTHER, 5042002)).toBe(false)
  })

  test('wrong amount, wrong sender, wrong recipient, reverted: nothing unlocks', async () => {
    for (const o of [{ value: 90_000n }, { from: OTHER }, { recipient: OTHER }, { status: 'reverted' as const }, { to: OTHER }]) {
      const { res, session } = await run(o)
      expect(res.status).toBe('rejected')
      expect(session.payments().length).toBe(0)
      expect(session.isUnlocked('upscale-2x', PAYER, 5042002)).toBe(false)
    }
  })

  test('a transaction that is never mined times out and unlocks nothing', async () => {
    const { res, session } = await run({ txMissing: true })
    expect(res.status).toBe('timeout')
    expect(session.isUnlocked('upscale-2x', PAYER, 5042002)).toBe(false)
  })

  test('an unreadable RPC is "not verified", never "paid"', async () => {
    const broken: ChainReader = { ...reader(), getChainId: () => Promise.reject(new Error('network down')) }
    const session = createPaymentSession(memoryStorage())
    const res = await confirmPayment(broken, session, cfg, pending, { intervalMs: 1, timeoutMs: 20 })
    expect(res.status).toBe('timeout')
    expect(session.isUnlocked('upscale-2x', PAYER, 5042002)).toBe(false)
  })

  test('the price is recomputed from the features, so a tampered amount cannot lower it', async () => {
    const cheaper = { ...pending, features: ['upscale-4x' as const], amountRaw: '1' } // 4x costs 0.20, payment is 0.10
    const { res } = await run({ value: 100_000n }, cheaper)
    expect(res.status).toBe('rejected')
  })

  test('resuming the same hash after a reload is idempotent and does not record a second payment', async () => {
    const session = createPaymentSession(memoryStorage())
    await confirmPayment(reader(), session, cfg, pending, { intervalMs: 1, timeoutMs: 40 })
    const again = await confirmPayment(reader(), session, cfg, pending, { intervalMs: 1, timeoutMs: 40 })
    expect(again.status).toBe('verified')
    expect(session.payments().length).toBe(1)
  })
})
