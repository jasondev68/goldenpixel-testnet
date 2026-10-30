import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import en from './en'
import vi from './vi'

const enMap = en as Record<string, string>
const viMap = vi as Record<string, string>
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')

/** Values that are legitimately identical in both languages (brand names, units, identifiers). */
const SAME_OK = new Set(['footer.credit', 'audio.device.cpu', 'bridge.gasRow', 'cv.run.premium'])

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return p.includes('/i18n') ? [] : sources(p)
    return /\.(ts|tsx)$/.test(f) && !f.endsWith('.test.ts') ? [readFileSync(p, 'utf8')] : []
  })
}

describe('i18n dictionaries', () => {
  test('English and Vietnamese define exactly the same keys', () => {
    expect(Object.keys(viMap).sort()).toEqual(Object.keys(enMap).sort())
  })

  test('every value is non-empty and uses the same placeholders in both languages', () => {
    for (const key of Object.keys(enMap)) {
      expect(enMap[key].trim().length > 0).toBe(true)
      expect(viMap[key].trim().length > 0).toBe(true)
      expect(`${key}:${placeholders(viMap[key])}`).toBe(`${key}:${placeholders(enMap[key])}`)
    }
  })

  test('no long Vietnamese string is an untranslated copy of the English one', () => {
    const copies = Object.keys(enMap).filter((k) => !SAME_OK.has(k) && enMap[k].length > 14 && enMap[k] === viMap[k])
    expect(copies).toEqual([])
  })

  test('every key is used by the source (no dead translations)', () => {
    const code = sources('src').join('\n')
    const dynamic = ['pay.reject.', 'pack.', 'op.', 'meta.']
    const unused = Object.keys(enMap).filter((k) => !dynamic.some((p) => k.startsWith(p)) && !code.includes(`'${k}'`) && !code.includes(`"${k}"`))
    expect(unused).toEqual([])
  })

  test('source never references a key that is missing from the dictionary', () => {
    const code = sources('src').join('\n')
    const used = [...code.matchAll(/\bt\(\s*'([a-zA-Z0-9_.-]+)'/g)].map((m) => m[1])
    expect(used.filter((k) => !(k in enMap))).toEqual([])
  })
})

describe('i18n runtime', () => {
  test('defaults to English, switches to Vietnamese and interpolates variables', async () => {
    const { getLang, setLang, translate, translateDyn, makeFormatters } = await import('./index')
    expect(getLang()).toBe('en')
    expect(translate('nav.home')).toBe('Home')
    expect(translate('dash.ready.many', { n: 3 })).toBe('3 images ready')
    setLang('vi')
    expect(getLang()).toBe('vi')
    expect(translate('nav.home')).toBe('Trang chủ')
    expect(translate('dash.ready.many', { n: 3 })).toBe('3 ảnh đã sẵn sàng')
    expect(translateDyn('pack.unknown.label', 'Fallback pack')).toBe('Fallback pack')
    expect(translateDyn('op.hd-export.label', 'x')).toBe('Xuất độ phân giải cao')
    setLang('en')
    expect(translate('nav.home')).toBe('Home')
    expect(makeFormatters('vi').decimal('1234.5')).toBe('1.234,5')
    expect(makeFormatters('en').decimal('1234.5')).toBe('1,234.5')
    expect(makeFormatters('vi').bytes(1536000)).toBe('1,46 MB')
  })
})
