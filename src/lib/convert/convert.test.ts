import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { parseCsv, toCsv } from './csv'
import { docxToText, linesToDocx, readDocx, textToLines } from './docx'
import { docxModelToPdf } from './docxPdf'
import { buildFromPlan, mergePdfs, openPdf, optimizePdf, parseRanges, splitPdf } from './pdfTools'
import { extractPdfText, openForRender } from './pdfRender'
import { readXlsx, writeXlsx } from './xlsx'
import { extOf, validateInput } from './formats'
// pdf.js legacy build runs in Node/Bun without a browser.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

const loadFont = (f: string) => Promise.resolve(new Uint8Array(readFileSync(`public/fonts/${f}`)))
const bytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer())

async function makePdf(pages: number, tag: string) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 1; i <= pages; i++) doc.addPage([300, 400]).drawText(`${tag} page ${i}`, { x: 30, y: 350, size: 18, font })
  return doc.save()
}
const textOf = async (pdf: Uint8Array) => extractPdfText(await openForRender(pdf, pdfjs))
const code = async (p: Promise<unknown>) => p.then(() => 'no error', (e: { key?: string }) => e.key)

describe('csv', () => {
  test('round-trips quotes, delimiters and newlines', () => {
    const rows = [['a', 'b,c', 'd"e'], ['line\nbreak', '', 'ü']]
    expect(parseCsv(toCsv(rows)).rows).toEqual(rows)
    expect(toCsv(rows).charCodeAt(0)).toBe(0xfeff)
  })
  test('detects delimiters', () => {
    expect(parseCsv('a;b\n1;2').delimiter).toBe(';')
    expect(parseCsv('a\tb\n1\t2').delimiter).toBe('\t')
  })
})

describe('docx / xlsx', () => {
  test('txt to docx and back keeps every line', async () => {
    const lines = ['Xin chào', '', 'a\tb & <c>']
    expect(docxToText(await readDocx(await bytes(linesToDocx(lines)))).trimEnd().split('\n')).toEqual(lines)
    expect(textToLines('\uFEFFa\r\nb\rc')).toEqual(['a', 'b', 'c'])
  })
  test('xlsx written and read back; numbers vs text', async () => {
    const out = await readXlsx(await bytes(writeXlsx([{ name: 'S', rows: [['Tên', '42', '007'], ['x', '-1.5', 'y']] }])))
    expect(out[0].rows).toEqual([['Tên', '42', '007'], ['x', '-1.5', 'y']])
  })
  test('unsupported or corrupt inputs fail with clear keys', async () => {
    const junk = new TextEncoder().encode('not a zip')
    expect(await code(readDocx(junk))).toBe('cv.err.badDocx')
    expect(await code(readXlsx(junk))).toBe('cv.err.badXlsx')
    expect(await code(openPdf(junk))).toBe('cv.err.badPdf')
  })
})

describe('pdf tools', () => {
  test('ranges parse and reject bad input', () => {
    expect(parseRanges('1-2,4,5-', 5)).toEqual([[0, 1], [3], [4]])
    expect(() => parseRanges('1-9', 5)).toThrow()
    expect(() => parseRanges('abc', 5)).toThrow()
    expect(() => parseRanges(' ', 5)).toThrow()
  })
  test('merge, split, extract/reorder, rotate, remove', async () => {
    const a = await makePdf(5, 'A')
    const b = await makePdf(2, 'B')
    const merged = await mergePdfs([a, b])
    expect((await textOf(merged)).map((t) => t.replace(/\s/g, ''))).toEqual(['Apage1', 'Apage2', 'Apage3', 'Apage4', 'Apage5', 'Bpage1', 'Bpage2'])
    const parts = await splitPdf(a, parseRanges('1-2,5', 5))
    expect(await Promise.all(parts.map(async (p) => (await openPdf(p)).getPageCount()))).toEqual([2, 1])
    const reordered = await buildFromPlan(a, [4, 0].map((src) => ({ src, rotate: 0 })))
    expect((await textOf(reordered)).map((t) => t.replace(/\s/g, ''))).toEqual(['Apage5', 'Apage1'])
    const rotated = await buildFromPlan(a, [{ src: 0, rotate: 90 }])
    expect((await (await openForRender(rotated, pdfjs)).getPage(1)).rotate).toBe(90)
    expect((await openPdf(await optimizePdf(a))).getPageCount()).toBe(5)
    expect(await code(buildFromPlan(a, []))).toBe('cv.err.noPages')
  })
})

describe('docx to pdf (basic engine)', () => {
  test('Vietnamese text is embedded, selectable and paginated', async () => {
    const model = { blocks: [{ kind: 'p' as const, style: 'h1' as const, runs: [{ text: 'Báo cáo quý' }] }, ...Array.from({ length: 80 }, (_, i) => ({ kind: 'p' as const, style: 'normal' as const, runs: [{ text: `Dòng ${i}: thế giới ` + 'abc '.repeat(30) }] }))], warnings: [] }
    const out = await docxModelToPdf(model, loadFont)
    expect(out.replacedChars).toBe(0)
    expect(out.pages).toBeGreaterThan(1)
    expect((await textOf(out.bytes))[0]).toContain('Báo cáo quý')
  })
  test('glyphs outside the built-in font are counted, not hidden', async () => {
    const out = await docxModelToPdf({ blocks: [{ kind: 'p', style: 'normal', runs: [{ text: 'Hi 你好' }] }], warnings: [] }, loadFont)
    expect(out.replacedChars).toBe(2)
  })
})

describe('input validation', () => {
  const file = (name: string, data: BlobPart) => new File([data], name)
  test('unsupported formats get a specific reason, never a fake conversion', async () => {
    expect((await validateInput(file('a.pptx', 'x'), ['docx']))?.key).toBe('cv.unsup.pptx')
    expect((await validateInput(file('a.doc', 'x'), ['docx']))?.key).toBe('cv.unsup.doc')
    expect((await validateInput(file('a.xls', 'x'), ['xlsx']))?.key).toBe('cv.unsup.xls')
    expect((await validateInput(file('a.zzz', 'x'), ['pdf']))?.key).toBe('cv.unsup.generic')
  })
  test('renamed files are caught by their first bytes', async () => {
    expect((await validateInput(file('fake.pdf', 'hello world'), ['pdf']))?.key).toBe('cv.err.badPdf')
    expect((await validateInput(file('fake.docx', 'hello'), ['docx']))?.key).toBe('cv.err.badDocx')
    expect((await validateInput(file('empty.pdf', ''), ['pdf']))?.key).toBe('cv.err.empty')
    expect(await validateInput(file('ok.pdf', '%PDF-1.7\n'), ['pdf'])).toBeNull()
    expect(extOf('Report.FINAL.DOCX')).toBe('docx')
  })
})
