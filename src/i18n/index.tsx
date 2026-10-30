/**
 * GoldenPixel i18n: centralized EN/VI dictionaries, no dependencies.
 *
 * - English is the default for first-time visitors; the choice persists in localStorage.
 * - `vi.ts` is typed against `en.ts`, so a missing Vietnamese key is a compile error.
 * - Components call `useI18n()` and re-render on a language change without remounting,
 *   so uploaded files, settings and in-flight workflows are untouched.
 * - Non-React code (toasts) uses `translate()`, which reads the current language.
 * - Never translate addresses, token symbols, hashes, file extensions or chain identifiers: pass them as `vars`.
 */
import { useMemo, useSyncExternalStore } from 'react'
import en from './en'
import vi from './vi'

export type Lang = 'en' | 'vi'
export type TKey = keyof typeof en
export type Vars = Record<string, string | number>
/** A translatable message that can live in state and render in whichever language is active. */
export type Msg = { key: TKey; vars?: Vars }

export const LANGS: readonly Lang[] = ['en', 'vi']
const STORAGE_KEY = 'gp-lang'
const LOCALES: Record<Lang, string> = { en: 'en-US', vi: 'vi-VN' }
const dicts: Record<Lang, Record<string, string>> = { en, vi }

function readInitial(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'vi' || v === 'en' ? v : 'en'
  } catch {
    return 'en'
  }
}

let current: Lang = readInitial()
const listeners = new Set<() => void>()
const warned = new Set<string>()

function applyDocument() {
  if (typeof document === 'undefined') return
  document.documentElement.lang = current
  document.title = dicts[current]['meta.title'] ?? document.title
  document.querySelector('meta[name="description"]')?.setAttribute('content', dicts[current]['meta.description'] ?? '')
}
applyDocument()

export function getLang(): Lang {
  return current
}

export function setLang(lang: Lang) {
  if (lang === current) return
  current = lang
  try {
    localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    // Storage can be unavailable (private mode); the choice still applies for this session.
  }
  applyDocument()
  listeners.forEach((l) => l())
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function interpolate(s: string, vars?: Vars) {
  return s.replace(/\{(\w+)\}/g, (_m, k: string) => (vars && k in vars ? String(vars[k]) : `{${k}}`))
}

function missing(key: string, lang: Lang) {
  const id = `${lang}:${key}`
  if (warned.has(id)) return
  warned.add(id)
  if (import.meta.env.DEV) console.warn(`[i18n] missing ${lang} translation for "${key}"`)
}

/** Translates a typed key. Falls back to English, and flags a missing key visibly instead of silently. */
export function translate(key: TKey, vars?: Vars): string {
  const own = dicts[current][key]
  if (own !== undefined) return interpolate(own, vars)
  missing(key, current)
  const fallback = dicts.en[key]
  if (fallback !== undefined) return interpolate(fallback, vars)
  return `[[${key}]]`
}

/** Translates a key built at runtime (e.g. per credit pack id). Uses `fallback` when the key does not exist. */
export function translateDyn(key: string, fallback: string, vars?: Vars): string {
  const own = dicts[current][key]
  if (own !== undefined) return interpolate(own, vars)
  missing(key, current)
  return interpolate(fallback, vars)
}

export const translateMsg = (m: Msg) => translate(m.key, m.vars)

/** Locale-aware formatting (numbers, file sizes, decimal money strings, dates). */
export function makeFormatters(lang: Lang) {
  const locale = LOCALES[lang]
  const nf = (max: number, min = 0) => new Intl.NumberFormat(locale, { maximumFractionDigits: max, minimumFractionDigits: min })
  return {
    locale,
    number: (n: number, maxFraction = 2) => nf(maxFraction).format(n),
    bytes(n: number) {
      if (n < 1024) return `${nf(0).format(n)} B`
      if (n < 1024 * 1024) return `${nf(1, 1).format(n / 1024)} KB`
      return `${nf(2, 2).format(n / 1024 / 1024)} MB`
    },
    /** Localizes a plain decimal string such as "1234.5" (token amounts) without losing precision. */
    decimal(value: string) {
      const [int = '0', frac] = value.split('.')
      const neg = int.startsWith('-')
      const digits = neg ? int.slice(1) : int
      const group = new Intl.NumberFormat(locale, { useGrouping: true }).format(BigInt(digits || '0'))
      const sep = new Intl.NumberFormat(locale).formatToParts(1.1).find((p) => p.type === 'decimal')?.value ?? '.'
      return `${neg ? '-' : ''}${group}${frac ? sep + frac : ''}`
    },
    /** USDC amounts always show at least two decimals (0.50, 2.00), longer values keep their precision. */
    usdc(value: string) {
      const [int = '0', frac = ''] = value.split('.')
      return this.decimal(`${int}.${frac.padEnd(2, '0')}`)
    },
    date: (d: Date | number, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }) => new Intl.DateTimeFormat(locale, opts).format(d),
  }
}

export function useI18n() {
  const lang = useSyncExternalStore<Lang>(subscribe, getLang, () => 'en')
  return useMemo(
    () => ({ lang, t: translate, td: translateDyn, m: translateMsg, fmt: makeFormatters(lang), setLang }),
    [lang],
  )
}
