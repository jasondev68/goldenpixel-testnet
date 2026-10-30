import { describe, expect, test } from 'bun:test'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { readDocx } from './docx'
import { ConvertError } from './errors'
import { MAX_PDF_PAGES_PER_RUN } from './runners'
import { openForRender } from './pdfRender'
import { buildSegments, computeStats, layoutPage, stripRepeatedMargins, type Block, type PBlock, type RawItem } from './pdfLayout'
import { pdfToDocx } from './pdfToDocx'

const item = (str: string, x: number, baseline: number, size = 11, bold = false): RawItem => ({ str, x, baseline, w: str.length * size * 0.5, size, bold, italic: false })
const lines = (texts: string[], x: number, start: number, size = 11, lead = 14): RawItem[] => texts.map((t, i) => item(t, x, start + i * lead, size))
const plain = (b: Block) => (b.kind === 'p' ? b.runs.map((r) => r.text).join('') : b.kind)

function layout(items: RawItem[], width = 595) {
  const segs = buildSegments(items)
  const stats = computeStats([segs])
  return layoutPage({ width, segs, images: [] }, { stats, pageWidth: width })
}

describe('layout analysis', () => {
  test('wrapped lines become one paragraph, a bigger gap starts a new one', () => {
    const a = lines(['The quick brown fox jumps over', 'the lazy dog and keeps running', 'until the evening.'], 72, 100)
    const b = lines(['A second paragraph starts here', 'and continues on this line.'], 72, 100 + 3 * 14 + 12)
    const { blocks } = layout([...a, ...b])
    expect(blocks.map(plain)).toEqual(['The quick brown fox jumps over the lazy dog and keeps running until the evening.', 'A second paragraph starts here and continues on this line.'])
  })

  test('hyphenated line breaks are joined', () => {
    const { blocks } = layout(lines(['Conversion keeps the docu-', 'ment structure intact.'], 72, 100))
    expect(blocks.map(plain)).toEqual(['Conversion keeps the document structure intact.'])
  })

  test('large and bold lines become headings; lists are detected', () => {
    const items = [item('Big Title', 72, 60, 24, true), ...lines(['Body text of the document is written here', 'and it goes on for a few lines in total.'], 72, 100), item('• First point', 72, 150), item('• Second point', 72, 164), item('1. Step one', 72, 190), item('2. Step two', 72, 204)]
    const { blocks } = layout(items)
    const ps = blocks as PBlock[]
    expect(ps[0]?.heading).toBe(1)
    expect(ps[1]?.heading).toBeUndefined()
    expect(ps.filter((p) => p.list && !p.list.ordered).map(plain)).toEqual(['First point', 'Second point'])
    expect(ps.filter((p) => p.list?.ordered).map(plain)).toEqual(['Step one', 'Step two'])
  })

  test('two columns are read column by column, not line by line', () => {
    const L = (n: string) => `left column ${n} line with enough words to be long`
    const R = (n: string) => `right column ${n} line with enough words to be long`
    const left = lines(['first', 'second', 'third', 'fourth'].map(L), 56, 100, 10)
    const right = lines(['first', 'second', 'third', 'fourth'].map(R), 330, 100, 10)
    const { blocks, columns } = layout([...left, ...right])
    expect(columns).toBe(true)
    const text = blocks.map(plain).join(' | ')
    expect(text.indexOf('left column fourth')).toBeLessThan(text.indexOf('right column first'))
    expect(blocks.some((b) => b.kind === 'table')).toBe(false)
  })

  test('aligned short cells become a table', () => {
    const rows = [['Region', 'Revenue', 'Growth'], ['Europe', '1,240', '12%'], ['Asia', '2,310', '18%'], ['Americas', '1,980', '9%']]
    const items = rows.flatMap((r, i) => r.map((c, k) => item(c, 72 + k * 150, 200 + i * 20)))
    const { blocks } = layout(items)
    const table = blocks.find((b) => b.kind === 'table')
    expect(table?.kind === 'table' && table.rows.length).toBe(4)
    expect(table?.kind === 'table' && table.rows[1]?.map((c) => c.map((r) => r.text).join(''))).toEqual(['Europe', '1,240', '12%'])
  })

  test('repeated headers and page numbers are removed, real headings are kept', () => {
    const page = (n: number) => ({ height: 842, segs: buildSegments([item('Annual Report', 72, 40), item(`Section ${n}`, 72, 100, 16, true), item(`Page ${n}`, 280, 810)]) })
    const pages = [page(1), page(2), page(3)]
    stripRepeatedMargins(pages)
    for (const [i, p] of pages.entries()) expect(p.segs.map((s) => s.text)).toEqual([`Section ${i + 1}`])
  })
})

async function pdfBytes(build: (doc: PDFDocument, font: Awaited<ReturnType<PDFDocument['embedFont']>>, bold: Awaited<ReturnType<PDFDocument['embedFont']>>) => void) {
  const doc = await PDFDocument.create()
  build(doc, await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold))
  return new Uint8Array(await doc.save())
}

const stubCanvas = {
  create: () => ({}) as never,
  context: () => ({ createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {}, drawImage() {}, fillRect() {}, fillStyle: '' }) as never,
  toBytes: () => Promise.resolve(new Uint8Array([1, 2, 3])),
  dispose() {},
}
// docx is injected so the test reads the real generated package back.
const env = { pdfjs: pdfjs as never, adapter: stubCanvas as never, docx: () => import('docx') }
const OPTS = { pageBreaks: 'keep' as const, images: true, stripMargins: true, ocr: null, maxPages: MAX_PDF_PAGES_PER_RUN }

async function convert(bytes: Uint8Array, opts = OPTS) {
  const doc = await openForRender(bytes, pdfjs)
  const res = await pdfToDocx(env, doc, 'test', opts)
  return { ...res, model: await readDocx(res.bytes) }
}

describe('PDF to DOCX', () => {
  test('a text PDF becomes a real, readable .docx with structure', async () => {
    const bytes = await pdfBytes((doc, font, bold) => {
      const page = doc.addPage([595, 842])
      page.drawText('Product Overview', { x: 72, y: 760, size: 24, font: bold })
      const body = ['GoldenPixel converts files in your browser.', 'Nothing is uploaded, so your documents stay private.', 'Every conversion runs locally.']
      body.forEach((t, i) => page.drawText(t, { x: 72, y: 720 - i * 14, size: 11, font }))
      page.drawText('Highlights', { x: 72, y: 650, size: 16, font: bold })
      ;['Private by design', 'Fast exports'].forEach((t, i) => {
        page.drawText('•', { x: 72, y: 625 - i * 16, size: 11, font })
        page.drawText(t, { x: 90, y: 625 - i * 16, size: 11, font })
      })
    })
    const r = await convert(bytes)
    expect(r.bytes[0]).toBe(0x50) // zip signature "PK"
    expect(r.bytes[1]).toBe(0x4b)
    const blocks = r.model.blocks
    const texts = blocks.map((b) => (b.kind === 'p' ? b.runs.map((x) => x.text).join('') : ''))
    expect(texts.some((t) => t.includes('Product Overview'))).toBe(true)
    expect(texts.some((t) => t.includes('GoldenPixel converts files in your browser. Nothing is uploaded'))).toBe(true)
    expect(blocks.filter((b) => b.kind === 'p' && b.style === 'h1').length).toBeGreaterThan(0)
    expect(r.stats.lists).toBe(2)
    expect(r.stats.chars).toBeGreaterThan(100)
  })

  test('multi-page PDFs keep every page, in order, with page-size sections', async () => {
    const bytes = await pdfBytes((doc, font) => {
      for (let p = 1; p <= 4; p++) {
        const page = doc.addPage(p === 3 ? [842, 595] : [595, 842])
        page.drawText(`Unique content of page ${p} which is long enough to count as real text.`, { x: 60, y: 500, size: 11, font })
      }
    })
    const r = await convert(bytes)
    const text = r.model.blocks.map((b) => (b.kind === 'p' ? b.runs.map((x) => x.text).join('') : '')).join('\n')
    for (const p of [1, 2, 3, 4]) expect(text).toContain(`page ${p}`)
    expect(r.stats.pages).toBe(4)
  })

  test('a PDF with no text and no images is refused instead of producing an empty document', async () => {
    const bytes = await pdfBytes((doc) => doc.addPage([595, 842]))
    await expect(convert(bytes)).rejects.toMatchObject({ key: 'cv.err.noText' })
  })

  test('a scanned PDF (page-sized picture, no text) is refused without OCR', async () => {
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
    const doc = await PDFDocument.create()
    const img = await doc.embedPng(png)
    doc.addPage([595, 842]).drawImage(img, { x: 0, y: 0, width: 595, height: 842 })
    const saved = new Uint8Array(await doc.save())
    await expect(convert(saved)).rejects.toMatchObject({ key: 'cv.err.scanned' })
  })

  test('too many pages are rejected with the limit', async () => {
    const bytes = await pdfBytes((doc, font) => {
      for (let p = 0; p < 3; p++) doc.addPage([595, 842]).drawText('Some text on this page that is long enough', { x: 60, y: 500, size: 11, font })
    })
    const d = await openForRender(bytes, pdfjs)
    await expect(pdfToDocx(env, d, 'x', { ...OPTS, maxPages: 2 })).rejects.toBeInstanceOf(ConvertError)
  })
})
