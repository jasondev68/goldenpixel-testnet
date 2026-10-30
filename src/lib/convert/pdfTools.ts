import { PDFDocument, degrees } from 'pdf-lib'
import { ConvertError } from './errors'

/** Opens a PDF with pdf-lib and maps failures to translatable errors (encrypted, damaged). */
export async function openPdf(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false })
  } catch (e) {
    if (/encrypt/i.test(String(e))) throw new ConvertError('cv.err.encrypted')
    throw new ConvertError('cv.err.badPdf')
  }
}

export async function pdfPageCount(bytes: Uint8Array): Promise<number> {
  return (await openPdf(bytes)).getPageCount()
}

/**
 * Parses "1-3,5,8-" into zero-based page groups. A group is one output file when splitting.
 * Throws a translatable error that names the offending token.
 */
export function parseRanges(spec: string, pageCount: number): number[][] {
  const tokens = spec.split(',').map((s) => s.trim()).filter(Boolean)
  if (tokens.length === 0) throw new ConvertError('cv.err.rangeEmpty')
  return tokens.map((tok) => {
    const m = /^(\d*)\s*(-?)\s*(\d*)$/.exec(tok)
    if (!m || (!m[1] && !m[3])) throw new ConvertError('cv.err.range', { token: tok })
    const from = m[1] ? Number(m[1]) : 1
    const to = m[2] ? (m[3] ? Number(m[3]) : pageCount) : from
    if (from < 1 || to > pageCount || from > to) throw new ConvertError('cv.err.rangeBounds', { token: tok, pages: pageCount })
    return Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i)
  })
}

/** A page of the output: which source page to use and how many degrees to rotate it by (added to its own rotation). */
export type PagePlan = { src: number; rotate: number }[]

/** Builds one PDF from a plan. Extract, remove, reorder and rotate are all plans over the same source. */
export async function buildFromPlan(bytes: Uint8Array, plan: PagePlan): Promise<Uint8Array> {
  if (plan.length === 0) throw new ConvertError('cv.err.noPages')
  const src = await openPdf(bytes)
  const out = await PDFDocument.create()
  const pages = await out.copyPages(src, plan.map((p) => p.src))
  pages.forEach((page, i) => {
    const extra = ((plan[i].rotate % 360) + 360) % 360
    if (extra) page.setRotation(degrees((page.getRotation().angle + extra) % 360))
    out.addPage(page)
  })
  out.setProducer('GoldenPixel')
  return out.save()
}

export async function mergePdfs(files: Uint8Array[]): Promise<Uint8Array> {
  const out = await PDFDocument.create()
  for (const bytes of files) {
    const src = await openPdf(bytes)
    const pages = await out.copyPages(src, src.getPageIndices())
    pages.forEach((p) => out.addPage(p))
  }
  out.setProducer('GoldenPixel')
  return out.save()
}

export async function splitPdf(bytes: Uint8Array, groups: number[][]): Promise<Uint8Array[]> {
  const result: Uint8Array[] = []
  for (const g of groups) result.push(await buildFromPlan(bytes, g.map((src) => ({ src, rotate: 0 }))))
  return result
}

/** Lossless optimisation: rewrites the file with compressed object streams. Gains vary and can be zero. */
export async function optimizePdf(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await openPdf(bytes)
  doc.setProducer('GoldenPixel')
  return doc.save({ useObjectStreams: true })
}
