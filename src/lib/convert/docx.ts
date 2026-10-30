import { createZip } from '../zip'
import { ConvertError } from './errors'
import { attr, decodeEntities, escapeXml } from './xml'
import { listZip, readZipText } from './zipread'

export type Run = { text: string; bold?: boolean; italic?: boolean }
export type ParaStyle = 'normal' | 'title' | 'h1' | 'h2' | 'h3' | 'list'
export type DocBlock = { kind: 'p'; style: ParaStyle; runs: Run[] } | { kind: 'table'; rows: string[][] }
export type DocWarning = 'images' | 'headerFooter'
export type DocModel = { blocks: DocBlock[]; warnings: DocWarning[] }

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

const TOKEN = /<w:tbl(?:\s[^>]*)?>[\s\S]*?<\/w:tbl>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>|<w:p(?:\s[^>]*)?\/>/g
const RUN = /<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g
const RUN_PART = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br(?:\s[^>]*)?\/>|<w:cr\s*\/>|<w:noBreakHyphen\s*\/>/g

const isOn = (rpr: string, tag: string) => {
  const m = new RegExp(`<w:${tag}(\\s[^>]*)?\\/?>`).exec(rpr)
  if (!m) return false
  const val = m[1] ? attr(`<x${m[1]}>`, 'w:val') : null
  return val === null || !/^(0|false|off)$/i.test(val)
}

function styleFromName(name: string | undefined): ParaStyle | null {
  if (!name) return null
  const n = name.toLowerCase().replace(/\s+/g, '')
  if (n === 'title') return 'title'
  const h = /^heading([1-9])$/.exec(n)
  if (h) return (Number(h[1]) === 1 ? 'h1' : Number(h[1]) === 2 ? 'h2' : 'h3')
  if (n.startsWith('listparagraph') || n.startsWith('listbullet') || n.startsWith('listnumber')) return 'list'
  return null
}

function readParagraph(xml: string, styleNames: Map<string, string>): Extract<DocBlock, { kind: 'p' }> {
  const pStyle = /<w:pStyle\s[^>]*>/.exec(xml)
  const styleId = pStyle ? attr(pStyle[0], 'w:val') : null
  let style: ParaStyle = styleFromName(styleId ? (styleNames.get(styleId) ?? styleId) : undefined) ?? 'normal'
  if (style === 'normal' && /<w:numPr>/.test(xml)) style = 'list'
  const runs: Run[] = []
  for (const r of xml.matchAll(RUN)) {
    const inner = r[1]
    const rpr = /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(inner)?.[0] ?? ''
    let text = ''
    for (const part of inner.matchAll(RUN_PART)) {
      if (part[1] !== undefined) text += decodeEntities(part[1])
      else if (part[0].startsWith('<w:tab')) text += '\t'
      else if (part[0].startsWith('<w:noBreakHyphen')) text += '-'
      else text += '\n'
    }
    if (text) runs.push({ text, bold: isOn(rpr, 'b') || undefined, italic: isOn(rpr, 'i') || undefined })
  }
  return { kind: 'p', style, runs }
}

const paraText = (p: Extract<DocBlock, { kind: 'p' }>) => p.runs.map((r) => r.text).join('')

/** Reads the text, headings, lists and tables of a .docx. Images, headers and footers are reported, not converted. */
export async function readDocx(bytes: Uint8Array): Promise<DocModel> {
  let files
  try {
    files = listZip(bytes)
  } catch {
    throw new ConvertError('cv.err.badDocx')
  }
  const documentXml = await readZipText(bytes, files, 'word/document.xml')
  if (documentXml === null) {
    throw new ConvertError(files.has('word/document.bin') || files.has('EncryptedPackage') ? 'cv.err.encrypted' : 'cv.err.badDocx')
  }
  const stylesXml = (await readZipText(bytes, files, 'word/styles.xml')) ?? ''
  const styleNames = new Map<string, string>()
  for (const s of stylesXml.matchAll(/<w:style\s[^>]*w:styleId="([^"]+)"[^>]*>[\s\S]*?<w:name\s+w:val="([^"]+)"/g)) styleNames.set(s[1], decodeEntities(s[2]))

  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(documentXml)?.[1] ?? documentXml
  const blocks: DocBlock[] = []
  for (const m of body.matchAll(TOKEN)) {
    const xml = m[0]
    if (xml.startsWith('<w:tbl')) {
      const rows: string[][] = []
      for (const tr of xml.matchAll(/<w:tr(?:\s[^>]*)?>([\s\S]*?)<\/w:tr>/g)) {
        const cells: string[] = []
        for (const tc of tr[1].matchAll(/<w:tc(?:\s[^>]*)?>([\s\S]*?)<\/w:tc>/g)) {
          const paras = [...tc[1].matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map((p) => paraText(readParagraph(p[0], styleNames)))
          cells.push(paras.join('\n'))
        }
        rows.push(cells)
      }
      blocks.push({ kind: 'table', rows })
    } else blocks.push(readParagraph(xml, styleNames))
  }

  const warnings: DocWarning[] = []
  if (/<w:drawing[\s>]|<w:pict[\s>]|<w:object[\s>]/.test(documentXml)) warnings.push('images')
  if ([...files.keys()].some((n) => /^word\/(header|footer)\d*\.xml$/.test(n))) warnings.push('headerFooter')
  return { blocks, warnings }
}

export function docxToText(model: DocModel): string {
  const lines: string[] = []
  for (const b of model.blocks) {
    if (b.kind === 'table') b.rows.forEach((r) => lines.push(r.map((c) => c.replace(/\n/g, ' ')).join('\t')))
    else lines.push((b.style === 'list' ? '• ' : '') + paraText(b))
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

/* ------------------------------------------------------------------ writing */

const CT = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'
const RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
const DOC_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>'

function paragraphXml(line: string): string {
  const parts = line.split('\t')
  const runs = parts
    .map((p, i) => `${i > 0 ? '<w:r><w:tab/></w:r>' : ''}${p ? `<w:r><w:t xml:space="preserve">${escapeXml(p)}</w:t></w:r>` : ''}`)
    .join('')
  return `<w:p>${runs}</w:p>`
}

/** Builds a valid .docx from plain-text lines (one paragraph per line, tabs preserved). */
export function linesToDocx(lines: string[]): Blob {
  const enc = new TextEncoder()
  const body = lines.map((l) => paragraphXml(l.replace(/\r$/, ''))).join('')
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`
  const zip = createZip([
    { name: '[Content_Types].xml', data: enc.encode(CT) },
    { name: '_rels/.rels', data: enc.encode(RELS) },
    { name: 'word/document.xml', data: enc.encode(doc) },
    { name: 'word/_rels/document.xml.rels', data: enc.encode(DOC_RELS) },
    { name: 'word/styles.xml', data: enc.encode(STYLES) },
  ])
  return new Blob([zip], { type: DOCX_MIME })
}

export const textToLines = (text: string) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r\n|\n|\r/)
