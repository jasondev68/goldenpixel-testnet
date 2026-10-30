/**
 * Layout analysis for PDF -> Word. Pure functions over text boxes (no pdf.js, no DOM), so they can be unit tested.
 *
 * Input is what pdf.js gives us: positioned text pieces. Output is a list of blocks (paragraphs, headings, list
 * items, tables, images) in reading order. It is heuristic: it reads multi-column pages column by column, detects
 * simple ruled-by-alignment tables, headings by font size and weight, and bulleted / numbered lists. It cannot
 * reproduce the exact layout of the PDF, and unusual layouts (overlapping text, vertical text, nested tables,
 * multi-line table cells, right-to-left scripts) will not be reconstructed faithfully.
 */

export type Run = { text: string; bold: boolean; italic: boolean; size: number }

/** A positioned piece of text, in page points with the origin at the top-left (y grows downwards). */
export type RawItem = { str: string; x: number; baseline: number; w: number; size: number; bold: boolean; italic: boolean }

/** One visual line (or one cell-like piece of a line). */
export type Seg = { kind: 'text'; x: number; top: number; w: number; h: number; baseline: number; size: number; runs: Run[]; text: string }
export type ImgBox = { kind: 'image'; id: string; x: number; top: number; w: number; h: number }

export type PBlock = {
  kind: 'p'
  runs: Run[]
  heading?: 1 | 2 | 3
  list?: { ordered: boolean; level: number }
  align?: 'left' | 'center' | 'right'
  top: number
  x: number
}
export type TBlock = { kind: 'table'; rows: Run[][][]; top: number; x: number; w: number }
export type IBlock = { kind: 'image'; id: string; w: number; h: number; top: number }
export type Block = PBlock | TBlock | IBlock

export type DocStats = { bodySize: number; headingSizes: number[]; medianLead: number }
export type LayoutOptions = { stats: DocStats; pageWidth: number }

const LIGATURES: Record<string, string> = { 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬀ': 'ff', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st', '\u00a0': ' ', '\u00ad': '' }
export const cleanText = (s: string): string => s.replace(/[ﬁﬂﬀﬃﬄﬅﬆ\u00a0\u00ad]/g, (c) => LIGATURES[c] ?? c)

const BULLET = /^[•●▪◦○■□‣⁃·▫◆◇➢➤✓✔*–—-]$/
const BULLET_PREFIX = /^([•●▪◦○■□‣⁃·▫◆◇➢➤✓✔*–—-])\s+/
const NUMBER_PREFIX = /^(\(?\d{1,3}[.)]|\(?[ivxIVX]{1,5}[.)]|\(?[a-z]\))\s+/
const ALPHA_DOT_PREFIX = /^([A-Za-z]\.)\s+/

/** True for a lone list marker such as "•", "1." or "(a)". */
export function isMarkerText(t: string): boolean {
  const s = t.trim()
  return BULLET.test(s) || /^\(?\d{1,3}[.)]$/.test(s) || /^\(?[a-zA-Z]\)$/.test(s) || /^[ivxIVX]{1,5}\.$/.test(s)
}

const round2 = (n: number) => Math.round(n * 2) / 2

function mergeRuns(runs: Run[]): Run[] {
  const out: Run[] = []
  for (const r of runs) {
    if (!r.text) continue
    const last = out[out.length - 1]
    if (last && last.bold === r.bold && last.italic === r.italic && Math.abs(last.size - r.size) < 0.6) last.text += r.text
    else out.push({ ...r })
  }
  return out
}

function segFromRuns(runs: Run[], x: number, w: number, baseline: number): Seg {
  const merged = mergeRuns(runs)
  const weight = new Map<number, number>()
  for (const r of merged) weight.set(round2(r.size), (weight.get(round2(r.size)) ?? 0) + r.text.length)
  let size = merged[0]?.size ?? 10
  let best = -1
  for (const [s, n] of weight) {
    if (n > best) {
      best = n
      size = s
    }
  }
  return { kind: 'text', x, w, baseline, size, top: baseline - size * 0.82, h: size * 1.1, runs: merged, text: merged.map((r) => r.text).join('') }
}

/** Groups loose text pieces into lines and breaks lines into segments wherever there is a gap wider than ~1 em. */
export function buildSegments(items: RawItem[]): Seg[] {
  const its = items.map((i) => ({ ...i, str: cleanText(i.str) })).filter((i) => i.str.trim().length > 0 && i.size > 0)
  its.sort((a, b) => a.baseline - b.baseline || a.x - b.x)
  const lines: (typeof its)[] = []
  for (const it of its) {
    const line = lines[lines.length - 1]
    const ref = line?.[0]
    if (line && ref && Math.abs(it.baseline - ref.baseline) <= Math.max(it.size, ref.size) * 0.35) line.push(it)
    else lines.push([it])
  }
  const segs: Seg[] = []
  for (const line of lines) {
    line.sort((a, b) => a.x - b.x)
    let runs: Run[] = []
    let sx = 0
    let end = 0
    let baseSum = 0
    let count = 0
    const flush = () => {
      if (runs.length) segs.push(segFromRuns(runs, sx, end - sx, baseSum / count))
      runs = []
      baseSum = 0
      count = 0
    }
    for (const it of line) {
      const gap = it.x - end
      const curText = runs.map((r) => r.text).join('')
      // Words are ~0.3 em apart and justified text stays under ~0.6 em; table cells are usually further apart than that.
      const breakGap = it.size * 0.75
      const joins = runs.length > 0 && (gap <= breakGap || (isMarkerText(curText) && gap <= it.size * 4))
      if (!joins) {
        flush()
        sx = it.x
      } else if (gap > it.size * 0.12 && !curText.endsWith(' ') && !it.str.startsWith(' ')) {
        runs.push({ text: ' ', bold: it.bold, italic: it.italic, size: it.size })
      }
      runs.push({ text: it.str, bold: it.bold, italic: it.italic, size: it.size })
      end = Math.max(end, it.x + it.w)
      baseSum += it.baseline
      count++
    }
    flush()
  }
  return segs
}

export function computeStats(pages: Seg[][]): DocStats {
  const sizes = new Map<number, number>()
  const leads: number[] = []
  for (const segs of pages) {
    for (const s of segs) for (const r of s.runs) sizes.set(round2(r.size), (sizes.get(round2(r.size)) ?? 0) + r.text.length)
    const sorted = [...segs].sort((a, b) => a.baseline - b.baseline)
    for (let i = 1; i < sorted.length; i++) {
      const p = sorted[i - 1]
      const c = sorted[i]
      if (!p || !c) continue
      const lead = c.baseline - p.baseline
      if (Math.abs(c.x - p.x) <= p.size && lead > p.size * 0.9 && lead < p.size * 2.2) leads.push(lead)
    }
  }
  let bodySize = 11
  let best = -1
  for (const [s, n] of sizes) {
    if (n > best) {
      best = n
      bodySize = s
    }
  }
  const headingSizes = [...sizes.keys()].filter((s) => s >= bodySize * 1.12).sort((a, b) => b - a)
  leads.sort((a, b) => a - b)
  const medianLead = leads.length ? (leads[Math.floor(leads.length / 2)] ?? bodySize * 1.2) : bodySize * 1.2
  return { bodySize, headingSizes, medianLead }
}

/* ---------------------------------------------------------------- headers, footers and page numbers */

const PAGE_NUMBER = /^(page\s*|trang\s*)?\d{1,4}(\s*(of|\/|-|trên)\s*\d{1,4})?$/i
const PAGE_WORDS = /\b(page|pag|trang|seite|página|pagina)\b/i
/**
 * Running headers repeat word for word. Only text that is clearly a page counter ("Page 3 of 10", "3 / 10") is matched
 * with its digits ignored, so a real heading such as "Section 7" at the top of every page is never mistaken for one.
 */
const keyOf = (t: string) => {
  const s = t.toLowerCase().replace(/\s+/g, ' ').trim()
  return PAGE_NUMBER.test(s) || PAGE_WORDS.test(s) ? s.replace(/\d+/g, '#') : s
}

/** Drops lines that repeat in the top or bottom margin of many pages, and bare page numbers. Returns how many were removed. */
export function stripRepeatedMargins(pages: { height: number; segs: Seg[] }[]): number {
  const band = 0.09
  const counts = new Map<string, number>()
  for (const p of pages) {
    const keys = new Set<string>()
    for (const s of p.segs) if (s.top < p.height * band || s.top > p.height * (1 - band)) keys.add(keyOf(s.text))
    for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const need = Math.max(2, Math.ceil(pages.length * 0.5))
  let removed = 0
  for (const p of pages) {
    p.segs = p.segs.filter((s) => {
      const inBand = s.top < p.height * band || s.top > p.height * (1 - band)
      if (!inBand) return true
      const drop = PAGE_NUMBER.test(s.text.trim()) || (pages.length >= 2 && (counts.get(keyOf(s.text)) ?? 0) >= need)
      if (drop) removed++
      return !drop
    })
  }
  return removed
}

/* ---------------------------------------------------------------- tables */

type Row = { segs: Seg[]; baseline: number; top: number; size: number }

function groupRows(segs: Seg[]): Row[] {
  const sorted = [...segs].sort((a, b) => a.baseline - b.baseline || a.x - b.x)
  const rows: Row[] = []
  for (const s of sorted) {
    const row = rows[rows.length - 1]
    if (row && Math.abs(s.baseline - row.baseline) <= Math.max(s.size, row.size) * 0.4) {
      row.segs.push(s)
    } else rows.push({ segs: [s], baseline: s.baseline, top: s.top, size: s.size })
  }
  for (const r of rows) r.segs.sort((a, b) => a.x - b.x)
  return rows
}

function mergeSpans(rows: Row[], tol: number): { l: number; r: number }[] {
  const iv = rows.flatMap((r) => r.segs.map((s) => ({ l: s.x, r: s.x + s.w }))).sort((a, b) => a.l - b.l)
  const spans: { l: number; r: number }[] = []
  for (const i of iv) {
    const last = spans[spans.length - 1]
    if (last && i.l <= last.r + tol) last.r = Math.max(last.r, i.r)
    else spans.push({ ...i })
  }
  return spans
}

const cellRuns = (segs: Seg[]): Run[] => {
  const runs: Run[] = []
  segs.forEach((s, i) => {
    if (i > 0) runs.push({ text: ' ', bold: false, italic: false, size: s.size })
    runs.push(...s.runs)
  })
  return mergeRuns(runs)
}

/** Finds blocks of aligned short cells and turns them into tables. Returns the tables and the segments left over. */
export function extractTables(segs: Seg[], pageWidth: number): { tables: (TBlock & { bottom: number })[]; rest: Seg[] } {
  const rows = groupRows(segs)
  const words = (s: Seg) => s.text.trim().split(/\s+/).length
  const candidate = (r: Row) => r.segs.length >= 2 && r.segs.every((s) => s.text.length <= 42 && words(s) <= 6 && s.w < pageWidth * 0.45)
  const used = new Set<Seg>()
  const tables: (TBlock & { bottom: number })[] = []
  let i = 0
  while (i < rows.length) {
    const first = rows[i]
    if (!first || !candidate(first)) {
      i++
      continue
    }
    let j = i + 1
    while (j < rows.length) {
      const prev = rows[j - 1]
      const row = rows[j]
      if (!prev || !row || !candidate(row)) break
      if (row.baseline - prev.baseline > Math.max(row.size, prev.size) * 3) break
      j++
    }
    const run = rows.slice(i, j)
    const tol = Math.max(4, first.size * 0.5)
    const spans = mergeSpans(run, tol)
    const coverage = spans.map((sp) => run.filter((r) => r.segs.some((s) => s.x < sp.r && s.x + s.w > sp.l)).length / run.length)
    // Newspaper-style columns are made of full lines of words (a median of 4+ words per piece); table cells are short
    // labels and numbers. This is what keeps text columns out of tables.
    const counts = run.flatMap((r) => r.segs.map(words)).sort((a, b) => a - b)
    const median = counts[Math.floor(counts.length / 2)] ?? 1
    const numeric = run.flatMap((r) => r.segs).filter((sg) => /^[\d\s.,%$€£¥+\-–()/:]+$/.test(sg.text.trim())).length / counts.length
    const wellFormed = spans.length >= 2 && coverage.every((c) => c >= 0.5) && (median <= 3 || numeric >= 0.4)
    if (wellFormed && (run.length >= 3 || (run.length >= 2 && spans.length >= 3))) {
      const out: Run[][][] = run.map((r) => spans.map((sp) => cellRuns(r.segs.filter((s) => s.x + s.w / 2 >= sp.l - tol && s.x + s.w / 2 <= sp.r + tol))))
      tables.push({ kind: 'table', rows: out, top: first.top, x: spans[0]?.l ?? 0, w: (spans[spans.length - 1]?.r ?? 0) - (spans[0]?.l ?? 0), bottom: (run[run.length - 1]?.baseline ?? 0) + first.size })
      for (const r of run) for (const s of r.segs) used.add(s)
    }
    i = j
  }
  return { tables, rest: segs.filter((s) => !used.has(s)) }
}

/* ---------------------------------------------------------------- reading order (columns) */

type Item = Seg | ImgBox | (TBlock & { bottom: number })
const bbox = (it: Item) => {
  if (it.kind === 'text') return { l: it.x, r: it.x + it.w, t: it.top, b: it.top + it.h }
  if (it.kind === 'image') return { l: it.x, r: it.x + it.w, t: it.top, b: it.top + it.h }
  return { l: it.x, r: it.x + it.w, t: it.top, b: it.bottom }
}

export function findGutters(items: Item[], bodySize: number): { l: number; r: number }[] {
  if (items.length < 6) return []
  const all = items.map(bbox)
  const left = Math.min(...all.map((b) => b.l))
  const right = Math.max(...all.map((b) => b.r))
  const width = right - left
  if (width < 100) return []
  // Full-width lines (titles, intro paragraphs, wide rules) say nothing about columns below them, so only pieces that
  // are clearly narrower than the page body are used to look for a gutter.
  const boxes = all.filter((b) => b.r - b.l < width * 0.55)
  if (boxes.length < 6) return []
  // How many boxes cover each x position. A few centred headings, captions or wide table rows may cross a gutter
  // without cancelling the columns, so a small number of crossings is tolerated.
  const bins = Math.ceil(width)
  const cover = new Array<number>(bins + 1).fill(0)
  for (const b of boxes) for (let x = Math.max(0, Math.floor(b.l - left)); x <= Math.min(bins, Math.ceil(b.r - left)); x++) cover[x] = (cover[x] ?? 0) + 1
  const allowance = Math.max(1, Math.floor(boxes.length * 0.12))
  const minGap = Math.max(8, bodySize * 0.9)
  const inner: [number, number] = [left + width * 0.12, right - width * 0.12]
  // Stretches where (almost) nothing crosses; each is a candidate split point at its centre.
  const centres: number[] = []
  let start = -1
  for (let x = 0; x <= bins + 1; x++) {
    const low = x <= bins && (cover[x] ?? 0) <= allowance
    if (low && start < 0) start = x
    if (!low && start >= 0) {
      centres.push(left + (start + x - 1) / 2)
      start = -1
    }
  }
  const gutters: { l: number; r: number }[] = []
  for (const c of centres) {
    if (c < inner[0] || c > inner[1]) continue
    const leftSide = boxes.filter((b) => b.r <= c)
    const rightSide = boxes.filter((b) => b.l >= c)
    if (leftSide.length < 3 || rightSide.length < 3) continue
    const g = { l: Math.max(...leftSide.map((b) => b.r)), r: Math.min(...rightSide.map((b) => b.l)) }
    if (g.r - g.l < minGap) continue
    const ly = [Math.min(...leftSide.map((b) => b.t)), Math.max(...leftSide.map((b) => b.b))]
    const ry = [Math.min(...rightSide.map((b) => b.t)), Math.max(...rightSide.map((b) => b.b))]
    const overlap = Math.min(ly[1] ?? 0, ry[1] ?? 0) - Math.max(ly[0] ?? 0, ry[0] ?? 0)
    const shorter = Math.min((ly[1] ?? 0) - (ly[0] ?? 0), (ry[1] ?? 0) - (ry[0] ?? 0))
    if (shorter > 0 && overlap >= shorter * 0.4 && !gutters.some((o) => Math.abs(o.l - g.l) < 1 && Math.abs(o.r - g.r) < 1)) gutters.push(g)
  }
  return gutters.sort((a, b) => a.l - b.l)
}

/** Orders items top-to-bottom, reading column by column where the page has real gutters. */
export function orderItems(items: Item[], bodySize: number): { ordered: Item[]; columns: boolean; gutters: { l: number; r: number }[] } {
  const byTop = [...items].sort((a, b) => bbox(a).t - bbox(b).t || bbox(a).l - bbox(b).l)
  const gutters = findGutters(items, bodySize)
  if (!gutters.length) return { ordered: byTop, columns: false, gutters }
  const out: Item[] = []
  let band: Item[] = []
  const column = (it: Item) => {
    const b = bbox(it)
    const c = (b.l + b.r) / 2
    return gutters.filter((g) => (g.l + g.r) / 2 < c).length
  }
  const flush = () => {
    const cols = new Map<number, Item[]>()
    for (const it of band) cols.set(column(it), [...(cols.get(column(it)) ?? []), it])
    for (const k of [...cols.keys()].sort((a, b) => a - b)) out.push(...(cols.get(k) ?? []))
    band = []
  }
  for (const it of byTop) {
    const b = bbox(it)
    const crosses = gutters.some((g) => b.l < g.r && b.r > g.l)
    if (crosses) {
      flush()
      out.push(it)
    } else band.push(it)
  }
  flush()
  return { ordered: out, columns: true, gutters }
}

/* ---------------------------------------------------------------- paragraphs, headings, lists */

const TERMINAL = /[.!?:;。！？”’"')\]]$/

function stripMarker(runs: Run[]): { runs: Run[]; ordered: boolean } | null {
  const text = runs.map((r) => r.text).join('')
  let m = BULLET_PREFIX.exec(text)
  let ordered = false
  if (!m) {
    m = NUMBER_PREFIX.exec(text)
    ordered = !!m
  }
  if (!m) {
    m = ALPHA_DOT_PREFIX.exec(text)
    // "A." only counts as a marker when followed by a lower-case or capitalised word, never for initials like "J. Smith".
    if (m && /^[A-Z]\.\s+[A-Z][a-z]+\s[A-Z]/.test(text)) m = null
    ordered = !!m
  }
  if (!m) return null
  let drop = m[0].length
  const out: Run[] = []
  for (const r of runs) {
    if (drop >= r.text.length) {
      drop -= r.text.length
      continue
    }
    out.push({ ...r, text: r.text.slice(drop) })
    drop = 0
  }
  return out.length ? { runs: out, ordered } : null
}

function joinLines(lines: Seg[]): Run[] {
  const runs: Run[] = []
  lines.forEach((line, idx) => {
    const prev = runs[runs.length - 1]
    if (idx > 0 && prev) {
      const first = line.runs[0]?.text.charAt(0) ?? ''
      const before = prev.text.charAt(prev.text.length - 2)
      if (prev.text.endsWith('-') && /[a-z]/.test(first) && /[A-Za-z]/.test(before)) prev.text = prev.text.slice(0, -1)
      else if (!prev.text.endsWith(' ')) prev.text += ' '
    }
    for (const r of line.runs) runs.push({ ...r })
  })
  return mergeRuns(runs.map((r) => ({ ...r, text: r.text.replace(/\s{2,}/g, ' ') })))
}

const weightedSize = (runs: Run[]) => {
  let n = 0
  let s = 0
  for (const r of runs) {
    n += r.text.length
    s += r.size * r.text.length
  }
  return n ? s / n : 0
}

function finishParagraph(lines: Seg[], stats: DocStats, content: { l: number; r: number; centerOk: boolean }): PBlock | null {
  let runs = joinLines(lines)
  if (!runs.some((r) => r.text.trim())) return null
  runs[0] = { ...(runs[0]), text: (runs[0]?.text ?? '').replace(/^\s+/, '') }
  const last = runs[runs.length - 1]
  runs[runs.length - 1] = { ...last, text: last.text.replace(/\s+$/, '') }
  runs = runs.filter((r) => r.text.length)
  const first = lines[0]
  const block: PBlock = { kind: 'p', runs, top: first.top, x: first.x }
  const marker = stripMarker(runs)
  if (marker) {
    block.runs = marker.runs
    block.list = { ordered: marker.ordered, level: 0 }
    return block
  }
  const chars = runs.reduce((n, r) => n + r.text.length, 0)
  const size = weightedSize(runs)
  const allBold = runs.every((r) => r.bold || !r.text.trim())
  if (lines.length <= 3 && chars <= 160 && size >= stats.bodySize * 1.12) {
    const idx = stats.headingSizes.findIndex((h) => Math.abs(h - round2(size)) < 0.75)
    block.heading = (Math.min(3, (idx < 0 ? stats.headingSizes.length : idx) + 1) || 1) as 1 | 2 | 3
  } else if (lines.length === 1 && allBold && chars <= 90 && !/[.,;]$/.test(runs[runs.length - 1]?.text ?? '')) {
    block.heading = 3
  }
  if (lines.length <= 2 && content.centerOk) {
    const w = Math.max(...lines.map((l) => l.x + l.w)) - Math.min(...lines.map((l) => l.x))
    const cx = Math.min(...lines.map((l) => l.x)) + w / 2
    const cw = content.r - content.l
    if (cw > 0 && w < cw * 0.85 && Math.abs(cx - (content.l + cw / 2)) <= cw * 0.02 && Math.min(...lines.map((l) => l.x)) - content.l > cw * 0.06) block.align = 'center'
    else if (cw > 0 && lines.length === 1 && Math.abs(first.x + first.w - content.r) <= cw * 0.01 && first.x - content.l > cw * 0.3) block.align = 'right'
  }
  return block
}

export function layoutPage(page: { width: number; segs: Seg[]; images: ImgBox[] }, opts: LayoutOptions): { blocks: Block[]; columns: boolean } {
  const { stats } = opts
  const { tables, rest } = extractTables(page.segs, page.width)
  const items: Item[] = [...rest, ...page.images, ...tables]
  const { ordered, columns, gutters } = orderItems(items, stats.bodySize)
  const texts = rest
  const colOf = (sg: Seg) => gutters.filter((g) => (g.l + g.r) / 2 < sg.x + sg.w / 2).length
  const colEdges = new Map<number, { l: number; r: number }>()
  const crossesGutter = (sg: Seg) => gutters.some((g) => sg.x < g.r && sg.x + sg.w > g.l)
  for (const sg of texts) {
    // Full-width lines say nothing about where a column ends.
    if (crossesGutter(sg)) continue
    const k = colOf(sg)
    const e = colEdges.get(k)
    colEdges.set(k, { l: Math.min(e?.l ?? Infinity, sg.x), r: Math.max(e?.r ?? -Infinity, sg.x + sg.w) })
  }
  const content = {
    l: texts.length ? Math.min(...texts.map((s) => s.x)) : 0,
    r: texts.length ? Math.max(...texts.map((s) => s.x + s.w)) : page.width,
    centerOk: !columns,
  }
  const blocks: Block[] = []
  let cur: Seg[] = []
  let curLeft = 0
  let curRight = 0
  const flush = () => {
    if (cur.length) {
      const p = finishParagraph(cur, stats, content)
      if (p) blocks.push(p)
    }
    cur = []
  }
  const continues = (prev: Seg, seg: Seg): boolean => {
    const lead = seg.baseline - prev.baseline
    if (lead <= 1) return false
    if (lead > Math.max(prev.size, seg.size) * 1.65 || lead > stats.medianLead * 1.5) return false
    if (Math.abs(prev.size - seg.size) > Math.max(1, prev.size * 0.12)) return false
    const bold = (s: Seg) => s.runs.every((r) => r.bold || !r.text.trim())
    if (bold(prev) !== bold(seg)) return false
    if (isMarkerStart(seg.text)) return false
    const head = cur[0]
    const listy = !!head && isMarkerStart(head.text)
    if (!listy && seg.x - curLeft > seg.size * 0.9 && seg.x - prev.x > seg.size * 0.9) return false
    if (Math.abs(seg.x - prev.x) > seg.size * 6 && seg.x < prev.x - seg.size * 6) return false
    if (prev.x + prev.w < curRight - seg.size * 4 && TERMINAL.test(prev.text.trim())) return false
    // A line that stops well short of the column edge ends its paragraph (list items without bullets, addresses, short notes).
    const edge = colEdges.get(colOf(prev))
    if (edge) {
      const colW = edge.r - edge.l
      const missing = edge.r - (prev.x + prev.w)
      if (colW > seg.size * 15 && missing > Math.max(seg.size * 6, colW * 0.25) && (TERMINAL.test(prev.text.trim()) || !/^[a-zà-ỹ]/.test(seg.text) || missing > colW * 0.5)) return false
    }
    return true
  }
  for (const it of ordered) {
    if (it.kind === 'image') {
      flush()
      blocks.push({ kind: 'image', id: it.id, w: it.w, h: it.h, top: it.top })
    } else if (it.kind === 'table') {
      flush()
      blocks.push({ kind: 'table', rows: it.rows, top: it.top, x: it.x, w: it.w })
    } else {
      const prev = cur[cur.length - 1]
      if (prev && continues(prev, it)) {
        cur.push(it)
        curLeft = Math.min(curLeft, it.x)
        curRight = Math.max(curRight, it.x + it.w)
      } else {
        flush()
        cur = [it]
        curLeft = it.x
        curRight = it.x + it.w
      }
    }
  }
  flush()
  assignListLevels(blocks, stats.bodySize)
  return { blocks, columns }
}

const isMarkerStart = (t: string) => BULLET_PREFIX.test(t) || NUMBER_PREFIX.test(t)

function assignListLevels(blocks: Block[], body: number) {
  const lists = blocks.filter((b): b is PBlock => b.kind === 'p' && !!b.list)
  if (!lists.length) return
  const base = Math.min(...lists.map((b) => b.x))
  for (const b of lists) if (b.list) b.list.level = Math.max(0, Math.min(2, Math.round((b.x - base) / (body * 1.6))))
}

/** Plain text of a block, used for tests and for the empty-document check. */
export function blockText(b: Block): string {
  if (b.kind === 'p') return b.runs.map((r) => r.text).join('')
  if (b.kind === 'table') return b.rows.map((r) => r.map((c) => c.map((x) => x.text).join('')).join('\t')).join('\n')
  return ''
}
