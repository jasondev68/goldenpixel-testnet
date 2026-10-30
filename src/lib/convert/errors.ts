import type { TKey } from '@/i18n'

/** A conversion failure that carries a translatable message. Never claims success for an unsupported input. */
export class ConvertError extends Error {
  constructor(
    readonly key: TKey,
    readonly vars?: Record<string, string | number>,
  ) {
    super(key)
    this.name = 'ConvertError'
  }
}
