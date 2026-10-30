import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import type { DocBlock, DocModel, Run } from './docx'

/**
 * A small, honest DOCX to PDF engine: text, headings, bold, bullet lists and simple tables on A4 pages, set in
 * Noto Sans (Latin, Latin Extended and Vietnamese). It does NOT reproduce images, columns, headers/footers, fonts,
 * italics or exact Word pagination. The UI says so before and after conversion.
 */
export type FontLoader = (file: string) => Promise<Uint8Array>

const SUBSETS = ['latin', 'latin-ext', 'vietnamese'] as const
const PAGE = { w: 595.28, h: 841.89, margin: 56.7 }
const STYLE_SIZE = { normal: 11, list: 11, title: 24, h1: 20, h2: 16, h3: 13 } as const

type Face = { font: PDFFont; chars: Set<number> }
type FontSet = { regular: Face[]; bold: Face[] }

async function loadFonts(pdf: PDFDocument, load: FontLoader): Promise<FontSet> {
  pdf.registerFontkit(fontkit)
  const make = async (weight: 400 | 700) =>
    Promise.all(
      SUBSETS.map(async (s) => {
        const font = await pdf.embedFont(await load(`noto-sans-${s}-${weight}-normal.woff`), { subset: true })
        return { font, chars: new Set(font.getCharacterSet()) } satisfies Face
      }),
    )
  return { regular: await make(400), bold: await make(700) }
}

type Seg = { text: string; face: PDFFont; width: number }

export async function docxModelToPdf(model: DocModel, load: FontLoader): Promise<{ bytes: Uint8Array; replacedChars: number; pages: number }> {
  const pdf = await PDFDocument.create()
  const fonts = await loadFonts(pdf, load)
  let replaced = 0
  const contentW = PAGE.w - PAGE.margin * 2

  const faceFor = (cp: number, bold: boolean): Face => {
    const set = bold ? fonts.bold : fonts.regular
    return set.find((f) => f.chars.has(cp)) ?? set[0]
  }

  /** Splits a run into same-font segments, replacing glyphs no embedded face has. */
  const segments = (text: string, bold: boolean, size: number): Seg[] => {
    const out: Seg[] = []
    for (const ch of text.replace(/\u00a0/g, ' ').replace(/[\u0000-\u0008\u000b-\u001f]/g, '')) {
      let cp = ch.codePointAt(0) as number
      let f = faceFor(cp, bold)
      if (!f.chars.has(cp)) {
        replaced++
        cp = 63
        f = faceFor(cp, bold)
      }
      const c = String.fromCodePoint(cp)
      const last = out[out.length - 1]
      if (last && last.face === f.font) {
        last.text += c
        last.width = f.font.widthOfTextAtSize(last.text, size)
      } else out.push({ text: c, face: f.font, width: f.font.widthOfTextAtSize(c, size) })
    }
    return out
  }

  /** Greedy word wrap over mixed-weight runs. */
  const wrap = (runs: Run[], size: number, width: number, forceBold = false): Seg[][] => {
    const lines: Seg[][] = [[]]
    let used = 0
    const push = (segs: Seg[]) => {
      const w = segs.reduce((s, x) => s + x.width, 0)
      if (used + w > width && used > 0 && segs.some((s) => s.text.trim())) {
        lines.push([])
        used = 0
      }
      lines[lines.length - 1].push(...segs)
      used += w
    }
    for (const run of runs) {
      const parts = run.text.split('\n')
      parts.forEach((part, pi) => {
        if (pi > 0) {
          lines.push([])
          used = 0
        }
        for (const word of part.split(/(?<=\s)/)) {
          const segs = segments(word.replace(/\t/g, '    '), forceBold || !!run.bold, size)
          const w = segs.reduce((s, x) => s + x.width, 0)
          if (w > width) {
            // A single very long token: break it by characters.
            for (const s of segs) for (const ch of s.text) push([{ text: ch, face: s.face, width: s.face.widthOfTextAtSize(ch, size) }])
          } else push(segs)
        }
      })
    }
    return lines
  }

  let page: PDFPage = pdf.addPage([PAGE.w, PAGE.h])
  let y = PAGE.h - PAGE.margin
  const ensure = (h: number) => {
    if (y - h < PAGE.margin) {
      page = pdf.addPage([PAGE.w, PAGE.h])
      y = PAGE.h - PAGE.margin
    }
  }

  const drawLines = (lines: Seg[][], size: number, x0: number, lh: number) => {
    for (const line of lines) {
      ensure(lh)
      y -= size
      let x = x0
      for (const s of line) {
        if (s.text.trim() || s.text.length) page.drawText(s.text, { x, y, size, font: s.face, color: rgb(0.08, 0.08, 0.1) })
        x += s.width
      }
      y -= lh - size
    }
  }

  const drawBlock = (b: DocBlock) => {
    if (b.kind === 'p') {
      const size = STYLE_SIZE[b.style]
      const lh = size * 1.35
      const heading = b.style === 'title' || b.style === 'h1' || b.style === 'h2' || b.style === 'h3'
      const indent = b.style === 'list' ? 18 : 0
      if (heading) y -= size * 0.5
      const lines = wrap(b.runs.length ? b.runs : [{ text: ' ' }], size, contentW - indent, heading)
      if (b.style === 'list') {
        ensure(lh)
        const [bullet] = segments('•', false, size)
        page.drawText(bullet.text, { x: PAGE.margin + 4, y: y - size, size, font: bullet.face, color: rgb(0.08, 0.08, 0.1) })
      }
      drawLines(lines, size, PAGE.margin + indent, lh)
      y -= heading ? size * 0.3 : size * 0.45
      return
    }
    // Simple table: equal column widths, wrapped cell text, thin borders. Rows are not split across pages.
    const cols = Math.max(1, ...b.rows.map((r) => r.length))
    const cw = contentW / cols
    const size = 10
    const lh = size * 1.3
    for (const row of b.rows) {
      const cells = Array.from({ length: cols }, (_, i) => wrap([{ text: row[i] ?? '' }], size, cw - 8))
      const rowH = Math.max(...cells.map((c) => c.length)) * lh + 8
      ensure(rowH)
      cells.forEach((lines, i) => {
        const x = PAGE.margin + i * cw
        page.drawRectangle({ x, y: y - rowH, width: cw, height: rowH, borderColor: rgb(0.6, 0.6, 0.62), borderWidth: 0.5 })
        let ty = y - 4
        for (const line of lines) {
          ty -= size
          let tx = x + 4
          for (const s of line) {
            if (s.text) page.drawText(s.text, { x: tx, y: ty, size, font: s.face, color: rgb(0.08, 0.08, 0.1) })
            tx += s.width
          }
          ty -= lh - size
        }
      })
      y -= rowH
    }
    y -= 8
  }

  for (const b of model.blocks) drawBlock(b)
  pdf.setProducer('GoldenPixel')
  const pages = pdf.getPageCount()
  return { bytes: await pdf.save(), replacedChars: replaced, pages }
}
