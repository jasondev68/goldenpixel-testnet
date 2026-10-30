/**
 * Free versus premium: the single place for plan limits and which features are premium.
 * Per-feature USDC prices live in payments.ts; limits here are plain numbers so they are easy to tune.
 *
 * Basic tools are free, run in the browser and never require a wallet. Premium features are paid per use in USDC,
 * the exact price is shown first, and the payment is verified on-chain before the premium output is produced.
 */

export const MB = 1024 * 1024

export const FREE_LIMITS = {
  /** Largest source file accepted on the free plan. */
  maxFileBytes: 15 * MB,
  /** Files processed together in Compress and Convert. */
  maxFiles: 5,
  /** Longest side of a free Photo Editor export, in pixels. */
  maxExportSide: 2048,
  /** Longest side of a free collage export, in pixels. */
  maxCollageSide: 1600,
  /** Longest recording the free plan transcribes, in seconds. */
  maxAudioSeconds: 5 * 60,
} as const

/** What a Pro batch session unlocks. */
export const PREMIUM_LIMITS = {
  maxFileBytes: 40 * MB,
  maxFiles: 50,
  /** Longest recording a paid long-audio transcription accepts, in seconds. */
  maxAudioSeconds: 30 * 60,
} as const

/** Safety limits that apply to every plan (memory protection and input validation). */
export const HARD_LIMITS = {
  maxPixels: 100_000_000,
  allowedTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp'],
} as const

/** Collage layout ids that need the Advanced collage templates feature to export. */
export const PREMIUM_COLLAGE_LAYOUTS: readonly string[] = ['trio-row', 'hero-top', 'six', 'nine']

