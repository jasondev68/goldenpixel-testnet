/**
 * PDF -> editable Word (.docx), end to end: pdf.js extraction -> layout analysis -> `docx` generation.
 * Everything runs locally. It is a text-and-structure conversion, not a pixel-perfect one.
 */
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { Msg } from '@/i18n'
import { buildDocx, type DocxLib, type PageIR } from './docxBuild'
import { ConvertError } from './errors'
import type { OcrFactory, OcrLang } from './ocr'
import { extractAll, type ExtractedPage, type PdfJs } from './pdfExtract'
import { buildSegments, computeStats, layoutPage, stripRepeatedMargins, type Block, type PBlock } from './pdfLayout'
import { renderPageBytes, type CanvasAdapter } from './pdfRender'

export type PdfToDocxOptions = {
  pageBreaks: 'keep' | 'flow'
  images: boolean
  stripMargins: boolean
  /** Turn scanned pages into text with OCR. Needs `env.ocr`. */
  ocr: { lang: OcrLang } | null
  maxPages: number
}
export type PdfToDocxEnv<C> = { pdfjs: PdfJs; adapter: CanvasAdapter<C>; docx: () => Promise<DocxLib>; ocr?: OcrFactory }
export type PdfToDocxResult = {
  bytes: Uint8Array
  notes: Msg[]
  stats: { pages: number; textPages: number; scannedPages: number; ocrPages: number; paragraphs: number; headings: number; lists: number; tables: number; images: number; chars: number }
}

/** A page with fewer characters than this is treated as having no real text. */
export const MIN_TEXT_CHARS = 25
export const MAX_OCR_PAGES = 30

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
const charsOf = (b: Block) => (b.kind === 'p' ? b.runs.reduce((n, r) => n + r.text.trim().length, 0) : b.kind === 'table' ? b.rows.flat(2).reduce((n, r) => n + r.text.trim().length, 0) : 0)

function marginsOf(p: ExtractedPage) {
  if (!p.segs.length) return { l: 72, t: 72, r: 72, b: 72 }
  const left = Math.min(...p.segs.map((s) => s.x))
  const right = Math.max(...p.segs.map((s) => s.x + s.w))
  const top = Math.min(...p.segs.map((s) => s.top))
  const bottom = Math.max(...p.segs.map((s) => s.top + s.h))
  return { l: clamp(left, 28, 120), r: clamp(p.width - right, 28, 120), t: clamp(top, 28, 120), b: clamp(p.height - bottom, 28, 120) }
}

/** Joins a paragraph that was split by a page break (flow mode only). */
function mergeAcrossPages(pages: PageIR[]) {
  for (let i = 1; i < pages.length; i++) {
    const prevPage = pages[i - 1]
    const page = pages[i]
    if (!prevPage || !page) continue
    const last = prevPage.blocks[prevPage.blocks.length - 1]
    const first = page.blocks[0]
    if (last?.kind !== 'p' || first?.kind !== 'p' || last.heading || last.list || first.heading || first.list) continue
    const tail = last.runs[last.runs.length - 1]
    if (!tail || /[.!?:;。”’")\]]\s*$/.test(tail.text) || !/^[a-zà-ỹ]/.test(first.runs[0]?.text ?? '')) continue
    tail.text = tail.text.endsWith('-') ? tail.text.slice(0, -1) : `${tail.text} `
    last.runs.push(...first.runs)
    page.blocks.shift()
  }
}

export async function pdfToDocx<C>(
  env: PdfToDocxEnv<C>,
  doc: PDFDocumentProxy,
  title: string,
  opts: PdfToDocxOptions,
  onProgress: (fraction: number, stage: 'read' | 'ocr' | 'write') => void = () => {},
): Promise<PdfToDocxResult> {
  const total = doc.numPages
  if (total > opts.maxPages) throw new ConvertError('cv.err.tooManyPages', { max: opts.maxPages, n: total })
  const notes: Msg[] = []

  const { pages, store, budget } = await extractAll(env.pdfjs, doc, {
    images: true,
    adapter: env.adapter,
    maxPages: opts.maxPages,
    onProgress: (d, t) => onProgress((d / t) * 0.55, 'read'),
  })

  const isScanned = (p: ExtractedPage) => p.chars < MIN_TEXT_CHARS && !!p.pageImage && p.pageImage.coverage >= 0.35
  const scanned = pages.map((p, i) => (isScanned(p) ? i : -1)).filter((i) => i >= 0)
  const textChars = pages.reduce((n, p) => n + p.chars, 0)

  if (scanned.length === pages.length && !(opts.ocr && env.ocr)) throw new ConvertError('cv.err.scanned')
  if (textChars < MIN_TEXT_CHARS && !scanned.length && !pages.some((p) => p.images.length)) throw new ConvertError('cv.err.noText')

  // OCR for scanned pages (opt-in). Pages beyond the cap fall back to an embedded picture of the page.
  let ocrDone = 0
  const ocrPages = new Set<number>()
  if (scanned.length && opts.ocr && env.ocr) {
    const todo = scanned.slice(0, MAX_OCR_PAGES)
    const engine = await env.ocr(opts.ocr.lang)
    try {
      for (const idx of todo) {
        const page = await doc.getPage(idx + 1)
        const png = await renderPageBytes(page, { dpi: 200, format: 'png', quality: 1 }, env.adapter)
        const scale = 72 / 200
        const lines = await engine.recognize(png.bytes)
        const raw = lines
          .filter((l) => l.text.trim().length > 0 && l.confidence >= 35)
          .map((l) => {
            const h = Math.max(4, (l.y1 - l.y0) * scale)
            return { str: l.text.trim(), x: l.x0 * scale, baseline: l.y1 * scale - h * 0.2, w: (l.x1 - l.x0) * scale, size: clamp(h * 0.8, 6, 48), bold: false, italic: false }
          })
        const target = pages[idx]
        if (target) {
          target.segs = buildSegments(raw)
          target.chars = target.segs.reduce((n, s) => n + s.text.replace(/\s/g, '').length, 0)
          target.images = []
          target.width = png.width * scale
          target.height = png.height * scale
          if (target.chars >= 1) ocrPages.add(idx)
        }
        page.cleanup()
        ocrDone++
        onProgress(0.55 + (ocrDone / todo.length) * 0.3, 'ocr')
      }
    } finally {
      await engine.terminate()
    }
    if (ocrPages.size) notes.push({ key: 'cv.note.ocr', vars: { n: ocrPages.size } })
    if (scanned.length > todo.length) notes.push({ key: 'cv.note.ocrCap', vars: { max: MAX_OCR_PAGES } })
  }

  // Scanned pages that were not recognised keep their picture, so nothing silently disappears.
  const pictured: number[] = []
  for (const idx of scanned) {
    const p = pages[idx]
    if (!p || ocrPages.has(idx) || !p.pageImage) continue
    p.images = [{ kind: 'image', id: p.pageImage.id, x: 0, top: 0, w: p.width, h: p.height }]
    p.segs = []
    pictured.push(idx + 1)
  }
  if (pictured.length) notes.push({ key: 'cv.note.scannedKept', vars: { pages: pictured.slice(0, 8).join(', ') + (pictured.length > 8 ? '…' : '') } })

  let removed = 0
  if (opts.stripMargins) removed = stripRepeatedMargins(pages.filter((_, i) => !pictured.includes(i + 1)))
  if (removed) notes.push({ key: 'cv.note.margins', vars: { n: removed } })

  const stats = computeStats(pages.map((p) => p.segs))
  const irPages: PageIR[] = []
  let columnsPages = 0
  const used = new Set<string>()
  for (const p of pages) {
    const images = opts.images || p.segs.length === 0 ? p.images : []
    const { blocks, columns } = layoutPage({ width: p.width, segs: p.segs, images }, { stats, pageWidth: p.width })
    if (columns) columnsPages++
    for (const b of blocks) if (b.kind === 'image') used.add(b.id)
    irPages.push({ width: p.width, height: p.height, margin: p.images.length && !p.segs.length ? { l: 28, t: 28, r: 28, b: 28 } : marginsOf(p), blocks })
  }
  if (opts.pageBreaks === 'flow') mergeAcrossPages(irPages)

  const all = irPages.flatMap((p) => p.blocks)
  const chars = all.reduce((n, b) => n + charsOf(b), 0)
  const imageCount = all.filter((b) => b.kind === 'image').length
  if (chars < 1 && imageCount === 0) throw new ConvertError('cv.err.noText')

  for (const [id] of store) if (!used.has(id)) store.delete(id)
  if (pages.some((p) => p.rotated)) notes.push({ key: 'cv.note.rotated', vars: { n: pages.filter((p) => p.rotated).length } })
  if (pages.some((p) => p.skippedAngled)) notes.push({ key: 'cv.note.angled', vars: { n: pages.reduce((s, p) => s + p.skippedAngled, 0) } })
  if (budget.skipped) notes.push({ key: 'cv.note.imagesSkipped', vars: { n: budget.skipped } })
  if (columnsPages) notes.push({ key: 'cv.note.columns', vars: { n: columnsPages } })
  notes.push({ key: ocrPages.size ? 'cv.note.proofread' : 'cv.note.layoutApprox' })

  onProgress(0.9, 'write')
  const bytes = await buildDocx(await env.docx(), irPages, store, { pageBreaks: opts.pageBreaks, title })
  onProgress(1, 'write')

  const paras = all.filter((b): b is PBlock => b.kind === 'p')
  return {
    bytes,
    notes,
    stats: {
      pages: pages.length,
      textPages: pages.length - scanned.length,
      scannedPages: scanned.length,
      ocrPages: ocrPages.size,
      paragraphs: paras.length,
      headings: paras.filter((p) => p.heading).length,
      lists: paras.filter((p) => p.list).length,
      tables: all.filter((b) => b.kind === 'table').length,
      images: imageCount,
      chars,
    },
  }
}
