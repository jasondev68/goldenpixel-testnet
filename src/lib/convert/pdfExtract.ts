/**
 * Reads positioned text and embedded images from a pdf.js page, in the orientation a person would read the page.
 * The pdf.js module and the canvas are injected so this works in the browser and under test.
 */
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import type { TextItem, TextMarkedContent } from 'pdfjs-dist/types/src/display/api'
import { buildSegments, type ImgBox, type RawItem, type Seg } from './pdfLayout'
import type { CanvasAdapter } from './pdfRender'

export type PdfJs = typeof import('pdfjs-dist')
export type StoredImage = { bytes: Uint8Array; mime: 'image/png' | 'image/jpeg'; w: number; h: number }
export type ImageStore = Map<string, StoredImage>
export type ImageBudget = { bytes: number; count: number; skipped: number }

export type ExtractedPage = {
  width: number
  height: number
  rotated: boolean
  segs: Seg[]
  images: ImgBox[]
  /** Non-whitespace characters of real text. */
  chars: number
  /** Text pieces that run vertically or at an angle and were left out. */
  skippedAngled: number
  /** The image that covers most of the page (a scan), if any. */
  pageImage: { id: string; coverage: number } | null
}

type Matrix = number[]
type ImgObj = { width: number; height: number; data?: ArrayLike<number>; bitmap?: ImageBitmap }
type Objs = { get(id: string, cb?: (o: unknown) => void): unknown }
type Ctx2D = {
  createImageData(w: number, h: number): { data: Uint8ClampedArray }
  putImageData(d: unknown, x: number, y: number): void
  drawImage(img: unknown, x: number, y: number, w?: number, h?: number): void
  fillStyle: string
  fillRect(x: number, y: number, w: number, h: number): void
}

const MAX_IMAGE_SIDE = 1800
const MAX_IMAGES_PER_DOC = 150
const MAX_IMAGE_BYTES_PER_DOC = 40 * 1024 * 1024

export const newBudget = (): ImageBudget => ({ bytes: 0, count: 0, skipped: 0 })

const fontFlags = (page: PDFPageProxy) => {
  const cache = new Map<string, { bold: boolean; italic: boolean }>()
  return (name: string) => {
    const hit = cache.get(name)
    if (hit) return hit
    let flags = { bold: false, italic: false }
    try {
      const f = (page.commonObjs as unknown as Objs).get(name) as { name?: string; bold?: boolean; italic?: boolean } | undefined
      const n = f?.name ?? ''
      flags = { bold: !!f?.bold || /bold|black|heavy|semibold|demi/i.test(n), italic: !!f?.italic || /italic|oblique/i.test(n) }
    } catch {
      /* font not resolved: treat as regular */
    }
    cache.set(name, flags)
    return flags
  }
}

type Item = TextItem
const isItem = (i: TextItem | TextMarkedContent): i is TextItem => 'str' in i && typeof i.str === 'string' && Array.isArray(i.transform)

/** pdf.js transforms a point in place, so work on a copy. */
function apply(pdfjs: PdfJs, point: [number, number], m: number[]): [number, number] {
  const p: [number, number] = [point[0], point[1]]
  pdfjs.Util.applyTransform(p, m)
  return p
}

function project(pdfjs: PdfJs, it: Item, vt: number[]) {
  const [a = 0, b = 0, , , e = 0, f = 0] = it.transform as number[]
  const size = Math.hypot(a, b)
  if (size <= 0) return null
  const p0 = apply(pdfjs, [e, f], vt)
  const p1 = apply(pdfjs, [e + (a / size) * it.width, f + (b / size) * it.width], vt)
  const dx = (p1[0] ?? 0) - (p0[0] ?? 0)
  const dy = (p1[1] ?? 0) - (p0[1] ?? 0)
  const scale = Math.hypot(vt[0] ?? 1, vt[1] ?? 0)
  return { x: p0[0] ?? 0, baseline: p0[1] ?? 0, w: Math.hypot(dx, dy), size: size * scale, horizontal: Math.abs(dy) <= Math.abs(dx) * 0.25 + 0.5 && dx >= 0 }
}

function getObject(objs: Objs, id: string): Promise<unknown> {
  return new Promise((resolve) => {
    let done = false
    const t = setTimeout(() => !done && ((done = true), resolve(null)), 4000)
    try {
      objs.get(id, (o) => {
        if (!done) {
          done = true
          clearTimeout(t)
          resolve(o)
        }
      })
    } catch {
      clearTimeout(t)
      resolve(null)
    }
  })
}

function toRgba(img: ImgObj): Uint8ClampedArray | null {
  const { width: w, height: h, data } = img
  if (!data || !w || !h) return null
  const n = w * h
  const out = new Uint8ClampedArray(n * 4)
  const row = Math.ceil(w / 8)
  if (data.length >= n * 4) {
    for (let i = 0; i < n * 4; i++) out[i] = data[i] ?? 0
  } else if (data.length >= n * 3) {
    for (let i = 0; i < n; i++) {
      out[i * 4] = data[i * 3] ?? 0
      out[i * 4 + 1] = data[i * 3 + 1] ?? 0
      out[i * 4 + 2] = data[i * 3 + 2] ?? 0
      out[i * 4 + 3] = 255
    }
  } else if (data.length >= n) {
    for (let i = 0; i < n; i++) {
      const v = data[i] ?? 0
      out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v
      out[i * 4 + 3] = 255
    }
  } else if (data.length >= row * h) {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const bit = ((data[y * row + (x >> 3)] ?? 0) >> (7 - (x & 7))) & 1
        const o = (y * w + x) * 4
        out[o] = out[o + 1] = out[o + 2] = bit ? 255 : 0
        out[o + 3] = 255
      }
  } else return null
  return out
}

async function encodeImage<C>(img: ImgObj, adapter: CanvasAdapter<C>): Promise<StoredImage | null> {
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.width, img.height))
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  let canvas: C | null = null
  try {
    if (img.bitmap) {
      canvas = adapter.create(w, h)
      const ctx = adapter.context(canvas) as Ctx2D
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, w, h)
      ctx.drawImage(img.bitmap, 0, 0, w, h)
    } else {
      const rgba = toRgba(img)
      if (!rgba) return null
      const src = adapter.create(img.width, img.height)
      const sctx = adapter.context(src) as Ctx2D
      const id = sctx.createImageData(img.width, img.height)
      id.data.set(rgba)
      sctx.putImageData(id, 0, 0)
      if (scale === 1) canvas = src
      else {
        canvas = adapter.create(w, h)
        const ctx = adapter.context(canvas) as Ctx2D
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, w, h)
        ctx.drawImage(src, 0, 0, w, h)
        adapter.dispose(src)
      }
    }
    const photo = w * h > 400_000
    const mime = photo ? 'image/jpeg' : 'image/png'
    return { bytes: await adapter.toBytes(canvas, mime, 0.85), mime, w, h }
  } catch {
    return null
  } finally {
    if (canvas) adapter.dispose(canvas)
  }
}

export async function extractPage<C>(
  pdfjs: PdfJs,
  page: PDFPageProxy,
  pageNo: number,
  opts: { images: boolean; adapter: CanvasAdapter<C>; store: ImageStore; budget: ImageBudget },
): Promise<ExtractedPage> {
  const opList = await page.getOperatorList()
  const content = await page.getTextContent()
  const items = content.items.filter(isItem).filter((i) => i.str.trim().length > 0)

  // Choose the orientation in which most text runs horizontally (handles /Rotate and sideways scans).
  let best = { rot: 0, horizontal: -1 }
  for (const extra of [0, 90, 270, 180]) {
    const vp = page.getViewport({ scale: 1, rotation: (page.rotate + extra) % 360 })
    const horizontal = items.reduce((n, it) => n + (project(pdfjs, it, vp.transform)?.horizontal ? it.str.length : 0), 0)
    if (horizontal > best.horizontal * 1.05 + 1) best = { rot: extra, horizontal }
    if (extra === 0 && items.length && horizontal >= items.reduce((n, it) => n + it.str.length, 0) * 0.7) break
  }
  const viewport = page.getViewport({ scale: 1, rotation: (page.rotate + best.rot) % 360 })
  const vt = viewport.transform
  const flags = fontFlags(page)
  const raw: RawItem[] = []
  let skippedAngled = 0
  for (const it of items) {
    const p = project(pdfjs, it, vt)
    if (!p) continue
    if (!p.horizontal) {
      skippedAngled++
      continue
    }
    const f = flags(it.fontName)
    raw.push({ str: it.str, x: p.x, baseline: p.baseline, w: p.w, size: p.size, bold: f.bold, italic: f.italic })
  }
  const segs = buildSegments(raw)
  const chars = segs.reduce((n, s) => n + s.text.replace(/\s/g, '').length, 0)

  const images: ImgBox[] = []
  let pageImage: ExtractedPage['pageImage'] = null
  if (opts.images) {
    const OPS = pdfjs.OPS
    let ctm: Matrix = [...vt]
    const stack: Matrix[] = []
    for (let i = 0; i < opList.fnArray.length; i++) {
      const fn = opList.fnArray[i]
      const args = opList.argsArray[i] as unknown[] | null
      if (fn === OPS.save) stack.push([...ctm])
      else if (fn === OPS.restore) ctm = stack.pop() ?? ctm
      else if (fn === OPS.transform && args) ctm = pdfjs.Util.transform(ctm, args)
      else if (fn === OPS.paintFormXObjectBegin && args) {
        stack.push([...ctm])
        if (Array.isArray(args[0])) ctm = pdfjs.Util.transform(ctm, args[0] as number[])
      } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm
      else if ((fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) && args) {
        const corners = ([[0, 0], [1, 0], [0, 1], [1, 1]] as [number, number][]).map((c) => apply(pdfjs, c, ctm))
        const xs = corners.map((c) => c[0] ?? 0)
        const ys = corners.map((c) => c[1] ?? 0)
        const x = Math.min(...xs)
        const top = Math.min(...ys)
        const w = Math.max(...xs) - x
        const h = Math.max(...ys) - top
        if (w < 14 || h < 14) continue
        const key = typeof args[0] === 'string' ? args[0] : `inline${i}`
        const id = `p${pageNo}-${key}`
        let stored = opts.store.get(id)
        if (!stored) {
          if (opts.budget.count >= MAX_IMAGES_PER_DOC || opts.budget.bytes >= MAX_IMAGE_BYTES_PER_DOC) {
            opts.budget.skipped++
            continue
          }
          const obj = (typeof args[0] === 'string' ? await getObject(page.objs, args[0]) : args[0]) as ImgObj | null
          if (!obj || !obj.width || !obj.height) continue
          const enc = await encodeImage(obj, opts.adapter)
          if (!enc) {
            opts.budget.skipped++
            continue
          }
          stored = enc
          opts.store.set(id, enc)
          opts.budget.count++
          opts.budget.bytes += enc.bytes.length
        }
        const coverage = (w * h) / (viewport.width * viewport.height)
        if (!pageImage || coverage > pageImage.coverage) pageImage = { id, coverage }
        images.push({ kind: 'image', id, x, top, w, h })
      }
    }
    // A page-sized picture behind real text is a scan with a text layer: the text is the content, so drop the picture.
    if (chars >= 25) {
      for (let k = images.length - 1; k >= 0; k--) {
        const im = images[k]
        if (im && (im.w * im.h) / (viewport.width * viewport.height) > 0.75) images.splice(k, 1)
      }
    }
  }
  page.cleanup()
  return { width: viewport.width, height: viewport.height, rotated: best.rot !== 0, segs, images, chars, skippedAngled, pageImage }
}

export async function extractAll<C>(
  pdfjs: PdfJs,
  doc: PDFDocumentProxy,
  opts: { images: boolean; adapter: CanvasAdapter<C>; maxPages: number; onProgress?: (done: number, total: number) => void },
) {
  const store: ImageStore = new Map()
  const budget = newBudget()
  const pages: ExtractedPage[] = []
  const total = Math.min(doc.numPages, opts.maxPages)
  for (let i = 1; i <= total; i++) {
    pages.push(await extractPage(pdfjs, await doc.getPage(i), i, { images: opts.images, adapter: opts.adapter, store, budget }))
    opts.onProgress?.(i, total)
  }
  return { pages, store, budget }
}
