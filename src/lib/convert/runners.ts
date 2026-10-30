import { PDFDocument } from 'pdf-lib'
import type { Msg } from '@/i18n'
import { type CsvDelimiter, parseCsv, toCsv } from './csv'
import { DOCX_MIME, docxToText, linesToDocx, readDocx, textToLines } from './docx'
import type { DocxLib } from './docxBuild'
import { docxModelToPdf, type FontLoader } from './docxPdf'
import { ConvertError } from './errors'
import { baseOf, safeName } from './formats'
import type { OcrFactory, OcrLang } from './ocr'
import { pdfToDocx } from './pdfToDocx'
import { buildFromPlan, mergePdfs, openPdf, optimizePdf, parseRanges, splitPdf } from './pdfTools'
import { type CanvasAdapter, closePdf, extractPdfText, loadPdfjs, openForRender, renderPageBytes } from './pdfRender'
import { readXlsx, writeXlsx, XLSX_MIME } from './xlsx'

/** Everything a conversion needs from its environment. The browser and the tests provide their own. */
export type Env = {
  loadFont: FontLoader
  canvas: CanvasAdapter<never>
  pdfjs?: Parameters<typeof openForRender>[1]
  /** Loads the `docx` library on demand. Defaults to a dynamic import. */
  docx?: () => Promise<DocxLib>
  /** Optional OCR engine factory. When absent, scanned PDFs are reported instead of converted. */
  ocr?: OcrFactory
}

export type RunInput = { file: File; bytes: Uint8Array }
export type WorkOutput = { name: string; blob: Blob; format: string }
export type RunResult = { outputs: WorkOutput[]; errors: { name: string; msg: Msg }[]; notes: Msg[] }
export type Ctx<O> = { inputs: RunInput[]; opts: O; env: Env; progress: (fraction: number) => void }

export const MAX_PDF_PAGES_PER_RUN = 100

const pdfBlob = (b: Uint8Array) => new Blob([b as BlobPart], { type: 'application/pdf' })
const toMsg = (e: unknown): Msg => (e instanceof ConvertError ? { key: e.key, vars: e.vars } : { key: 'err.withDetail', vars: { detail: e instanceof Error ? e.message : String(e) } })
const empty = (): RunResult => ({ outputs: [], errors: [], notes: [] })

/** Runs `fn` for every input; one bad file never hides the others. */
async function each(ctx: Ctx<unknown>, res: RunResult, fn: (i: RunInput, n: number) => Promise<void> | void) {
  for (let n = 0; n < ctx.inputs.length; n++) {
    try {
      await fn(ctx.inputs[n], n)
    } catch (e) {
      res.errors.push({ name: ctx.inputs[n].file.name, msg: toMsg(e) })
    }
    ctx.progress((n + 1) / ctx.inputs.length)
  }
}

/* ------------------------------------------------------------------ PDF -> Word */
export type PdfDocxOpts = { pageBreaks: 'keep' | 'flow'; images: boolean; stripMargins: boolean; ocr: boolean; ocrLang: OcrLang }
export async function runPdfToDocx(ctx: Ctx<PdfDocxOpts>): Promise<RunResult> {
  const res = empty()
  await each(ctx, res, async (input, idx) => {
    const pdfjs = ctx.env.pdfjs ?? (await loadPdfjs())
    const doc = await openForRender(input.bytes, pdfjs)
    try {
      if (doc.numPages > MAX_PDF_PAGES_PER_RUN) throw new ConvertError('cv.err.tooManyPages', { max: MAX_PDF_PAGES_PER_RUN, n: doc.numPages })
      const base = safeName(baseOf(input.file.name))
      const out = await pdfToDocx(
        { pdfjs, adapter: ctx.env.canvas, docx: ctx.env.docx ?? (() => import('docx')), ocr: ctx.env.ocr },
        doc,
        base,
        { pageBreaks: ctx.opts.pageBreaks, images: ctx.opts.images, stripMargins: ctx.opts.stripMargins, ocr: ctx.opts.ocr && ctx.env.ocr ? { lang: ctx.opts.ocrLang } : null, maxPages: MAX_PDF_PAGES_PER_RUN },
        (f) => ctx.progress((idx + f) / ctx.inputs.length),
      )
      res.outputs.push({ name: `${base}.docx`, blob: new Blob([out.bytes as BlobPart], { type: DOCX_MIME }), format: 'DOCX' })
      const s = out.stats
      res.notes.push({ key: 'cv.note.docxSummary', vars: { name: input.file.name, pages: s.pages, paragraphs: s.paragraphs, headings: s.headings, tables: s.tables, images: s.images } })
      res.notes.push(...out.notes)
    } finally {
      await closePdf(doc)
    }
  })
  return res
}

/* ------------------------------------------------------------------ PDF */
export async function runMerge(ctx: Ctx<unknown>): Promise<RunResult> {
  if (ctx.inputs.length < 2) throw new ConvertError('cv.err.needTwo')
  const res = empty()
  const bytes = await mergePdfs(ctx.inputs.map((i) => i.bytes))
  res.outputs.push({ name: 'merged.pdf', blob: pdfBlob(bytes), format: 'PDF' })
  ctx.progress(1)
  return res
}

export type SplitOpts = { mode: 'ranges' | 'each'; spec: string }
export async function runSplit(ctx: Ctx<SplitOpts>): Promise<RunResult> {
  const res = empty()
  const [input] = ctx.inputs
  const doc = await openPdf(input.bytes)
  const n = doc.getPageCount()
  const groups = ctx.opts.mode === 'each' ? Array.from({ length: n }, (_, i) => [i]) : parseRanges(ctx.opts.spec, n)
  const parts = await splitPdf(input.bytes, groups)
  const base = safeName(baseOf(input.file.name))
  parts.forEach((p, i) => {
    const g = groups[i]
    const label = g.length === 1 ? `page-${g[0] + 1}` : `pages-${g[0] + 1}-${g[g.length - 1] + 1}`
    res.outputs.push({ name: `${base}-${label}.pdf`, blob: pdfBlob(p), format: 'PDF' })
  })
  ctx.progress(1)
  return res
}

export type ImagesOpts = { format: 'png' | 'jpeg'; dpi: number; quality: number; spec: string }
export async function runPdfToImages(ctx: Ctx<ImagesOpts>): Promise<RunResult> {
  const res = empty()
  await each(ctx, res, async (input, idx) => {
    const doc = await openForRender(input.bytes, ctx.env.pdfjs)
    const groups = ctx.opts.spec.trim() ? parseRanges(ctx.opts.spec, doc.numPages) : [Array.from({ length: doc.numPages }, (_, i) => i)]
    const pages = [...new Set(groups.flat())]
    if (pages.length > MAX_PDF_PAGES_PER_RUN) throw new ConvertError('cv.err.tooManyPages', { max: MAX_PDF_PAGES_PER_RUN, n: pages.length })
    const base = safeName(baseOf(input.file.name))
    const pad = String(doc.numPages).length
    let clamped = false
    for (let k = 0; k < pages.length; k++) {
      const page = await doc.getPage(pages[k] + 1)
      const out = await renderPageBytes(page, { dpi: ctx.opts.dpi, format: ctx.opts.format, quality: ctx.opts.quality / 100 }, ctx.env.canvas)
      clamped ||= out.clamped
      page.cleanup()
      const ext = ctx.opts.format === 'png' ? 'png' : 'jpg'
      res.outputs.push({ name: `${base}-page-${String(pages[k] + 1).padStart(pad, '0')}.${ext}`, blob: new Blob([out.bytes as BlobPart], { type: ctx.opts.format === 'png' ? 'image/png' : 'image/jpeg' }), format: ext.toUpperCase() })
      ctx.progress((idx + (k + 1) / pages.length) / ctx.inputs.length)
    }
    if (clamped) res.notes.push({ key: 'cv.note.dpiClamped' })
    await closePdf(doc)
  })
  return res
}

export type CompressOpts = { mode: 'lossless' | 'strong'; dpi: number; quality: number }
export async function runPdfCompress(ctx: Ctx<CompressOpts>): Promise<RunResult> {
  const res = empty()
  await each(ctx, res, async (input, idx) => {
    const base = safeName(baseOf(input.file.name))
    let bytes: Uint8Array
    if (ctx.opts.mode === 'lossless') bytes = await optimizePdf(input.bytes)
    else {
      const src = await openForRender(input.bytes, ctx.env.pdfjs)
      if (src.numPages > MAX_PDF_PAGES_PER_RUN) throw new ConvertError('cv.err.tooManyPages', { max: MAX_PDF_PAGES_PER_RUN, n: src.numPages })
      const out = await PDFDocument.create()
      for (let p = 1; p <= src.numPages; p++) {
        const page = await src.getPage(p)
        const size = page.getViewport({ scale: 1 })
        const img = await renderPageBytes(page, { dpi: ctx.opts.dpi, format: 'jpeg', quality: ctx.opts.quality / 100 }, ctx.env.canvas)
        const jpg = await out.embedJpg(img.bytes)
        const pg = out.addPage([size.width, size.height])
        pg.drawImage(jpg, { x: 0, y: 0, width: size.width, height: size.height })
        page.cleanup()
        ctx.progress((idx + p / src.numPages) / ctx.inputs.length)
      }
      out.setProducer('GoldenPixel')
      bytes = await out.save({ useObjectStreams: true })
      await closePdf(src)
    }
    if (bytes.length >= input.bytes.length) {
      if (ctx.opts.mode === 'strong') throw new ConvertError('cv.err.notSmaller')
      res.notes.push({ key: 'cv.note.noGain', vars: { name: input.file.name } })
    }
    res.outputs.push({ name: `${base}-compressed.pdf`, blob: pdfBlob(bytes), format: 'PDF' })
  })
  return res
}

/* ------------------------------------------------------------------ Documents */
export async function runDocxToPdf(ctx: Ctx<unknown>): Promise<RunResult> {
  const res = empty()
  await each(ctx, res, async (input) => {
    const model = await readDocx(input.bytes)
    const out = await docxModelToPdf(model, ctx.env.loadFont)
    res.outputs.push({ name: `${safeName(baseOf(input.file.name))}.pdf`, blob: pdfBlob(out.bytes), format: 'PDF' })
    if (model.warnings.includes('images')) res.notes.push({ key: 'cv.note.images', vars: { name: input.file.name } })
    if (model.warnings.includes('headerFooter')) res.notes.push({ key: 'cv.note.headerFooter', vars: { name: input.file.name } })
    if (out.replacedChars > 0) res.notes.push({ key: 'cv.note.glyphs', vars: { name: input.file.name, n: out.replacedChars } })
  })
  return res
}

export async function runDocxToTxt(ctx: Ctx<unknown>): Promise<RunResult> {
  const res = empty()
  await each(ctx, res, async (input) => {
    const model = await readDocx(input.bytes)
    res.outputs.push({ name: `${safeName(baseOf(input.file.name))}.txt`, blob: new Blob([docxToText(model)], { type: 'text/plain;charset=utf-8' }), format: 'TXT' })
    if (model.warnings.includes('images')) res.notes.push({ key: 'cv.note.imagesTxt', vars: { name: input.file.name } })
  })
  return res
}

export async function runTxtToDocx(ctx: Ctx<unknown>): Promise<RunResult> {
  const res = empty()
  await each(ctx, res, (input) => {
    const text = new TextDecoder('utf-8').decode(input.bytes)
    if (text.includes('\uFFFD')) res.notes.push({ key: 'cv.note.encoding', vars: { name: input.file.name } })
    res.outputs.push({ name: `${safeName(baseOf(input.file.name))}.docx`, blob: linesToDocx(textToLines(text)), format: 'DOCX' })
  })
  return res
}

export type ExtractOpts = { format: 'txt' | 'docx'; pageMarkers: boolean }
export async function runExtractText(ctx: Ctx<ExtractOpts>): Promise<RunResult> {
  const res = empty()
  await each(ctx, res, async (input) => {
    const base = safeName(baseOf(input.file.name))
    const isPdf = input.file.name.toLowerCase().endsWith('.pdf')
    let text: string
    if (isPdf) {
      const doc = await openForRender(input.bytes, ctx.env.pdfjs)
      const pages = await extractPdfText(doc)
      await closePdf(doc)
      if (pages.every((p) => p.replace(/\s/g, '') === '')) throw new ConvertError('cv.err.noText')
      text = pages.map((p, i) => (ctx.opts.pageMarkers ? `--- ${i + 1} / ${pages.length} ---\n${p}` : p)).join('\n\n')
    } else text = docxToText(await readDocx(input.bytes))
    if (ctx.opts.format === 'docx') res.outputs.push({ name: `${base}.docx`, blob: linesToDocx(textToLines(text)), format: 'DOCX' })
    else res.outputs.push({ name: `${base}.txt`, blob: new Blob([text], { type: 'text/plain;charset=utf-8' }), format: 'TXT' })
  })
  return res
}

/* ------------------------------------------------------------------ Spreadsheets */
export type XlsxCsvOpts = { delimiter: CsvDelimiter; bom: boolean }
export async function runXlsxToCsv(ctx: Ctx<XlsxCsvOpts>): Promise<RunResult> {
  const res = empty()
  await each(ctx, res, async (input) => {
    const sheets = await readXlsx(input.bytes)
    const base = safeName(baseOf(input.file.name))
    for (const s of sheets) {
      res.outputs.push({
        name: sheets.length === 1 ? `${base}.csv` : `${base}-${safeName(s.name)}.csv`,
        blob: new Blob([toCsv(s.rows, ctx.opts.delimiter, ctx.opts.bom)], { type: 'text/csv;charset=utf-8' }),
        format: 'CSV',
      })
    }
    if (sheets.length > 1) res.notes.push({ key: 'cv.note.sheets', vars: { name: input.file.name, n: sheets.length } })
  })
  return res
}

export type CsvXlsxOpts = { delimiter: 'auto' | CsvDelimiter; combine: boolean }
export async function runCsvToXlsx(ctx: Ctx<CsvXlsxOpts>): Promise<RunResult> {
  const res = empty()
  const sheets: { name: string; rows: string[][] }[] = []
  await each(ctx, res, (input) => {
    const text = new TextDecoder('utf-8').decode(input.bytes)
    if (text.includes('\uFFFD')) res.notes.push({ key: 'cv.note.encoding', vars: { name: input.file.name } })
    const parsed = parseCsv(text, ctx.opts.delimiter === 'auto' ? undefined : ctx.opts.delimiter)
    if (parsed.rows.length === 0) throw new ConvertError('cv.err.empty')
    const name = baseOf(input.file.name)
    if (ctx.opts.combine && ctx.inputs.length > 1) sheets.push({ name, rows: parsed.rows })
    else res.outputs.push({ name: `${safeName(name)}.xlsx`, blob: writeXlsx([{ name, rows: parsed.rows }]), format: 'XLSX' })
  })
  if (sheets.length) res.outputs.push({ name: 'workbook.xlsx', blob: writeXlsx(sheets), format: 'XLSX' })
  return res
}

export { DOCX_MIME, XLSX_MIME, buildFromPlan }
