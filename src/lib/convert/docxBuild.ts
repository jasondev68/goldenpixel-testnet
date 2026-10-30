/** Turns the layout blocks into a real, editable .docx using the `docx` library (loaded on demand by the caller). */
import type { ImageStore } from './pdfExtract'
import type { Block, PBlock, Run, TBlock } from './pdfLayout'

export type DocxLib = typeof import('docx')
export type PageIR = { width: number; height: number; margin: { l: number; t: number; r: number; b: number }; blocks: Block[] }
export type BuildOptions = { pageBreaks: 'keep' | 'flow'; title?: string }

const pt = (n: number) => Math.round(n * 20)
const FONT = 'Arial'

export async function buildDocx(lib: DocxLib, pages: PageIR[], images: ImageStore, opts: BuildOptions): Promise<Uint8Array> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType, ImageRun, LevelFormat, PageOrientation } = lib
  const headings = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3]
  let numberedInstance = 0
  let inNumbered = false

  const textRun = (r: Run) => new TextRun({ text: r.text, bold: r.bold || undefined, italics: r.italic || undefined, size: Math.max(2, Math.round(r.size * 2)), font: FONT })

  const paragraph = (b: PBlock) => {
    if (b.list?.ordered) {
      if (!inNumbered) numberedInstance++
      inNumbered = true
    } else inNumbered = false
    return new Paragraph({
      heading: b.heading ? headings[b.heading - 1] : undefined,
      alignment: b.align === 'center' ? AlignmentType.CENTER : b.align === 'right' ? AlignmentType.RIGHT : undefined,
      numbering: b.list ? { reference: b.list.ordered ? 'gp-numbered' : 'gp-bullets', level: b.list.level, instance: b.list.ordered ? numberedInstance : undefined } : undefined,
      spacing: { after: b.heading ? 160 : 100, before: b.heading ? 200 : 0 },
      children: b.runs.map(textRun),
    })
  }

  const table = (b: TBlock) => {
    const cols = Math.max(1, ...b.rows.map((r) => r.length))
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: b.rows.map(
        (cells) =>
          new TableRow({
            children: Array.from({ length: cols }, (_, i) => {
              const runs = cells[i] ?? []
              return new TableCell({
                width: { size: Math.floor(100 / cols), type: WidthType.PERCENTAGE },
                children: [new Paragraph({ children: runs.length ? runs.map(textRun) : [new TextRun({ text: '' })] })],
              })
            }),
          }),
      ),
    })
  }

  const children = (page: PageIR) => {
    const out: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = []
    const maxW = ((page.width - page.margin.l - page.margin.r) * 96) / 72
    for (const b of page.blocks) {
      if (b.kind !== 'p') inNumbered = false
      if (b.kind === 'p') out.push(paragraph(b))
      else if (b.kind === 'table') {
        out.push(table(b))
        out.push(new Paragraph({ children: [], spacing: { after: 80 } }))
      } else {
        const img = images.get(b.id)
        if (!img) continue
        let w = (b.w * 96) / 72
        let h = (b.h * 96) / 72
        if (w > maxW) {
          h *= maxW / w
          w = maxW
        }
        out.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 120 },
            children: [new ImageRun({ type: img.mime === 'image/png' ? 'png' : 'jpg', data: img.bytes, transformation: { width: Math.max(8, Math.round(w)), height: Math.max(8, Math.round(h)) }, altText: { name: b.id, title: 'Image', description: 'Image from the PDF' } })],
          }),
        )
      }
    }
    if (!out.length) out.push(new Paragraph({ children: [] }))
    return out
  }

  // One section per page keeps each PDF page's size and orientation; "flow" merges neighbours that share a size.
  const groups: PageIR[][] = []
  for (const p of pages) {
    const last = groups[groups.length - 1]
    const same = last?.[0] && Math.abs(last[0].width - p.width) < 2 && Math.abs(last[0].height - p.height) < 2
    if (opts.pageBreaks === 'flow' && last && same) last.push(p)
    else groups.push([p])
  }
  const sections = groups.map((g) => {
    const first = g[0]
    const landscape = first.width > first.height
    const short = Math.min(first.width, first.height)
    const long = Math.max(first.width, first.height)
    return {
      properties: {
        page: {
          size: { width: pt(short), height: pt(long), orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
          margin: { top: pt(first.margin.t), right: pt(first.margin.r), bottom: pt(first.margin.b), left: pt(first.margin.l), header: 0, footer: 0 },
        },
      },
      children: g.flatMap(children),
    }
  })

  const levels = (fmt: 'bullet' | 'num') =>
    [0, 1, 2].map((level) => ({
      level,
      format: fmt === 'bullet' ? LevelFormat.BULLET : [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][level],
      text: fmt === 'bullet' ? ['•', '◦', '▪'][level] ?? '•' : `%${level + 1}.`,
      alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 720 + level * 360, hanging: 360 } } },
    }))

  const doc = new Document({
    creator: 'GoldenPixel',
    title: opts.title,
    description: 'Converted from PDF with GoldenPixel',
    styles: { default: { document: { run: { font: FONT, size: 22 } } } },
    numbering: {
      config: [
        { reference: 'gp-bullets', levels: levels('bullet') },
        { reference: 'gp-numbered', levels: levels('num') },
      ],
    },
    sections,
  })
  const blob = await Packer.toBlob(doc)
  return new Uint8Array(await blob.arrayBuffer())
}
