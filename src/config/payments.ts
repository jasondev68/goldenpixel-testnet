/**
 * GoldenPixel premium payments: the single place to change the recipient and the price of each premium feature.
 * Public values only.
 *
 * Model: no accounts, no credits, no database, no backend. A user pays for a premium feature with ONE direct USDC
 * transfer from their own wallet to the recipient below. The browser then reads the transaction from the Arc RPC and
 * checks it (chain, token, sender, recipient, exact amount, success, confirmations). Basic tools stay free.
 *
 * IMPORTANT: this is frontend-only. It is a session convenience check, not enforcement. See README "Payment model".
 */

/** Receiving wallet for premium payments. Public address, never a secret. */
export const PAYMENT_RECIPIENT = '0xd7d80191dee0a4cd481766b82b0c38c7feb63586'

/** Wallets that must never receive payments (the shared Arc Studio deployer wallet). */
export const FORBIDDEN_RECIPIENTS = ['0x5B12Ce46C7194aD57d143bC22847224047b1Ef42'] as const

export type PremiumFeatureId =
  | 'upscale-2x'
  | 'upscale-4x'
  | 'hd-export'
  | 'advanced-collage'
  | 'zip'
  | 'pro-batch'
  | 'pdf-to-images'
  | 'pdf-compress'
  | 'docx-to-pdf'
  | 'audio-long'

export type PremiumFeature = {
  id: PremiumFeatureId
  label: string
  description: string
  /** Price as a decimal USDC string (at most 6 decimals, the ERC-20 view of USDC). Edit here to reprice. */
  priceUsdc: string
}

/**
 * Price of each premium feature in USDC (the single place to reprice them). Basic tools stay free.
 * One payment unlocks that feature for the current browser session.
 */
export const PREMIUM_FEATURES: Record<PremiumFeatureId, PremiumFeature> = {
  'upscale-2x': { id: 'upscale-2x', label: 'HD upscale 2x', description: 'Doubles width and height with smart sharpening.', priceUsdc: '0.10' },
  'upscale-4x': { id: 'upscale-4x', label: 'HD upscale 4x', description: 'Quadruples width and height with smart sharpening.', priceUsdc: '0.20' },
  'hd-export': { id: 'hd-export', label: 'High-resolution export', description: 'Export beyond the free resolution limit, up to the original size.', priceUsdc: '0.05' },
  'advanced-collage': { id: 'advanced-collage', label: 'Advanced collage templates', description: 'Export a collage that uses a premium template.', priceUsdc: '0.05' },
  zip: { id: 'zip', label: 'ZIP download', description: 'Download several results as one ZIP file.', priceUsdc: '0.05' },
  'pdf-to-images': { id: 'pdf-to-images', label: 'PDF pages to images', description: 'Render PDF pages as JPG or PNG images (up to 100 pages per run).', priceUsdc: '0.10' },
  'pdf-compress': { id: 'pdf-compress', label: 'Strong PDF compression', description: 'Shrink a PDF by re-rendering its pages as images. Text is no longer selectable.', priceUsdc: '0.10' },
  'docx-to-pdf': { id: 'docx-to-pdf', label: 'Word to PDF', description: 'Convert a .docx to PDF with the basic text engine.', priceUsdc: '0.10' },
  'audio-long': { id: 'audio-long', label: 'Long audio transcription', description: 'Transcribe recordings longer than the free limit (up to 30 minutes). The AI runs in your browser.', priceUsdc: '0.20' },
  'pro-batch': { id: 'pro-batch', label: 'Pro batch session', description: 'Process up to 50 files of up to 40 MB each, ZIP download included.', priceUsdc: '0.25' },
}

export const isFeatureId = (id: string): id is PremiumFeatureId => Object.prototype.hasOwnProperty.call(PREMIUM_FEATURES, id)

/** Most features one payment may cover (a collage can combine a premium template with an HD size). */
export const MAX_FEATURES_PER_PAYMENT = 4

/** Tools that stay free. `label` is a translation key resolved by the UI. */
export const FREE_FEATURES = [
  { key: 'editor', label: 'tool.editor.title' },
  { key: 'collage', label: 'tool.collage.title' },
  { key: 'compress', label: 'tool.compress.title' },
  { key: 'convert', label: 'tool.convert.title' },
] as const

/** Block confirmations required before a payment counts (Arc finalizes in under a second). */
export const REQUIRED_CONFIRMATIONS = 1

/** How long the wallet prompt may stay open and how long we keep reading the chain for a sent transaction. */
export const VERIFY_TIMEOUT_SECONDS = 120

/**
 * Conservative USDC gas reserve used only when the live gas estimate is unavailable.
 * Arc pays gas in USDC, so spending an entire balance would leave nothing for fees.
 */
export const GAS_RESERVE_FALLBACK_USDC = '0.05'

/** Strict decimal -> raw units. Throws on anything that cannot be represented exactly (no silent rounding of money). */
export function exactUnits(value: string, decimals: number): bigint {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(value)
  if (!m) throw new Error(`Invalid amount: ${value}`)
  const frac = m[2] ?? ''
  if (frac.length > decimals) throw new Error(`Amount ${value} has more than ${decimals} decimals`)
  return BigInt((m[1] ?? '0') + frac.padEnd(decimals, '0'))
}

/** The distinct features in `ids`, in a stable order. */
export const uniqueFeatures = (ids: readonly PremiumFeatureId[]): PremiumFeatureId[] => [...new Set(ids)].sort()

/** Exact amount, in raw token units, for a set of features. Pure, so UI and verification always agree. */
export const featuresRaw = (ids: readonly PremiumFeatureId[], decimals: number): bigint =>
  uniqueFeatures(ids).reduce((sum, id) => sum + exactUnits(PREMIUM_FEATURES[id].priceUsdc, decimals), 0n)

/** The same total as a decimal string, e.g. "0.15". */
export function featuresPriceUsdc(ids: readonly PremiumFeatureId[], decimals = 6): string {
  const raw = featuresRaw(ids, decimals)
  const s = raw.toString().padStart(decimals + 1, '0')
  const int = s.slice(0, s.length - decimals)
  const frac = s.slice(s.length - decimals).replace(/0+$/, '')
  return frac.length >= 2 ? `${int}.${frac}` : `${int}.${frac.padEnd(2, '0')}`
}
