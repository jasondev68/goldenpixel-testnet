import { createZip } from '../zip'
import { ConvertError } from './errors'
import { attr, decodeEntities, escapeXml } from './xml'
import { listZip, readZipText } from './zipread'

export type Sheet = { name: string; rows: string[][] }
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const colIndex = (ref: string) => {
  let n = 0
  for (const ch of /^[A-Z]+/.exec(ref)?.[0] ?? 'A') n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

const BUILTIN_DATE_FMTS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47])

function isDateFormat(code: string) {
  const c = code.replace(/\[[^\]]*\]|"[^"]*"|\\./g, '')
  return /[dmyhs]/i.test(c) && !/^(general|0|#)/i.test(c)
}

function serialToText(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400000)
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return String(serial)
  const iso = d.toISOString()
  return Number.isInteger(serial) ? iso.slice(0, 10) : iso.slice(0, 19).replace('T', ' ')
}

/** Reads every worksheet of a .xlsx as a grid of text. Uses cached formula results and shared strings. */
export async function readXlsx(bytes: Uint8Array): Promise<Sheet[]> {
  let files
  try {
    files = listZip(bytes)
  } catch {
    throw new ConvertError('cv.err.badXlsx')
  }
  const workbook = await readZipText(bytes, files, 'xl/workbook.xml')
  if (workbook === null) throw new ConvertError(files.has('EncryptedPackage') ? 'cv.err.encrypted' : 'cv.err.badXlsx')
  const rels = (await readZipText(bytes, files, 'xl/_rels/workbook.xml.rels')) ?? ''
  const relTarget = new Map<string, string>()
  for (const r of rels.matchAll(/<Relationship\s[^>]*>/g)) {
    const id = attr(r[0], 'Id')
    const target = attr(r[0], 'Target')
    if (id && target) relTarget.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target}`)
  }

  const shared: string[] = []
  const sst = await readZipText(bytes, files, 'xl/sharedStrings.xml')
  if (sst) for (const si of sst.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)) shared.push([...si[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => decodeEntities(t[1])).join(''))

  const styles = (await readZipText(bytes, files, 'xl/styles.xml')) ?? ''
  const customFmt = new Map<number, string>()
  for (const f of styles.matchAll(/<numFmt\s[^>]*>/g)) {
    const id = Number(attr(f[0], 'numFmtId'))
    const code = attr(f[0], 'formatCode')
    if (code) customFmt.set(id, code)
  }
  const cellXfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? ''
  const dateStyle = [...cellXfs.matchAll(/<xf\s[^>]*>/g)].map((x) => {
    const id = Number(attr(x[0], 'numFmtId') ?? 0)
    return BUILTIN_DATE_FMTS.has(id) || (customFmt.has(id) && isDateFormat(customFmt.get(id) as string))
  })

  const sheets: Sheet[] = []
  for (const s of workbook.matchAll(/<sheet\s[^>]*>/g)) {
    const name = attr(s[0], 'name') ?? `Sheet${sheets.length + 1}`
    const rid = attr(s[0], 'r:id')
    const path = rid ? relTarget.get(rid) : undefined
    const xml = path ? await readZipText(bytes, files, path) : null
    if (xml === null) continue
    const grid: string[][] = []
    let autoRow = 0
    for (const row of xml.matchAll(/<row(\s[^>]*)?>([\s\S]*?)<\/row>|<row(\s[^>]*)?\/>/g)) {
      const rAttr = attr(`<row${row[1] ?? row[3] ?? ''}>`, 'r')
      const r = rAttr ? Number(rAttr) - 1 : autoRow
      autoRow = r + 1
      const cells: string[] = (grid[r] = grid[r] ?? [])
      let autoCol = 0
      for (const c of (row[2] ?? '').matchAll(/<c(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const tag = `<c${c[1] ?? ''}>`
        const ref = attr(tag, 'r')
        const col = ref ? colIndex(ref) : autoCol
        autoCol = col + 1
        const t = attr(tag, 't')
        const inner = c[2] ?? ''
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1]
        let text = ''
        if (t === 'inlineStr') text = [...inner.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((x) => decodeEntities(x[1])).join('')
        else if (v === undefined) text = ''
        else if (t === 's') text = shared[Number(v)] ?? ''
        else if (t === 'b') text = v === '1' ? 'TRUE' : 'FALSE'
        else if (t === 'str' || t === 'e') text = decodeEntities(v)
        else {
          const style = Number(attr(tag, 's') ?? 0)
          text = dateStyle[style] && Number.isFinite(Number(v)) ? serialToText(Number(v)) : v
        }
        cells[col] = text
      }
    }
    const width = Math.max(0, ...grid.map((r) => (r ? r.length : 0)))
    sheets.push({ name, rows: Array.from(grid, (r) => Array.from({ length: width }, (_, i) => r?.[i] ?? '')) })
  }
  if (sheets.length === 0) throw new ConvertError('cv.err.badXlsx')
  return sheets
}

/* ------------------------------------------------------------------ writing */

const colName = (i: number) => {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

const NUMERIC = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/

function safeSheetName(name: string, used: Set<string>) {
  let base = name.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Sheet'
  let n = 1
  let out = base
  while (used.has(out.toLowerCase())) out = `${base.slice(0, 28)} ${++n}`
  used.add(out.toLowerCase())
  return out
}

/** Builds a valid .xlsx. Plain numbers become numeric cells; everything else (including 007 or long IDs) stays text. */
export function writeXlsx(sheets: Sheet[]): Blob {
  const enc = new TextEncoder()
  const used = new Set<string>()
  const named = sheets.map((s) => ({ ...s, name: safeSheetName(s.name, used) }))
  const sheetXml = (rows: string[][]) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows
      .map(
        (r, ri) =>
          `<row r="${ri + 1}">${r
            .map((v, ci) => {
              if (v === '') return ''
              const ref = `${colName(ci)}${ri + 1}`
              return NUMERIC.test(v) && v.replace(/[-.eE+]/g, '').length <= 15
                ? `<c r="${ref}"><v>${v}</v></c>`
                : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(v)}</t></is></c>`
            })
            .join('')}</row>`,
      )
      .join('')}</sheetData></worksheet>`

  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${named.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`
  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
  const wb = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${named.map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${named.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>'

  const zip = createZip([
    { name: '[Content_Types].xml', data: enc.encode(ct) },
    { name: '_rels/.rels', data: enc.encode(rels) },
    { name: 'xl/workbook.xml', data: enc.encode(wb) },
    { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(wbRels) },
    { name: 'xl/styles.xml', data: enc.encode(styles) },
    ...named.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc.encode(sheetXml(s.rows)) })),
  ])
  return new Blob([zip], { type: XLSX_MIME })
}
