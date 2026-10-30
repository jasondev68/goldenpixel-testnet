import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import { ConvertError } from './errors'

type Pdfjs = typeof import('pdfjs-dist')

/** Canvas operations the renderer needs. The browser implementation is below; tests inject a Node canvas. */
// Standard fonts ship with the app. The big optional assets (CJK character maps, JPEG2000/JBIG2 decoders,
// ICC profiles) load on demand from a version-pinned CDN copy so the deploy bundle stays small.
const PDFJS_CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299'

export type CanvasAdapter<C = unknown> = {
  create(width: number, height: number): C
  context(canvas: C): unknown
  toBytes(canvas: C, mime: 'image/png' | 'image/jpeg', quality: number): Promise<Uint8Array>
  dispose(canvas: C): void
}

export const browserCanvas: CanvasAdapter<HTMLCanvasElement> = {
  create(w, h) {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    return c
  },
  context: (c) => c.getContext('2d'),
  toBytes: (c, mime, quality) =>
    new Promise((resolve, reject) =>
      c.toBlob(
        (b) => (b ? void b.arrayBuffer().then((a) => resolve(new Uint8Array(a))) : reject(new ConvertError('cv.err.render'))),
        mime,
        mime === 'image/jpeg' ? quality : undefined,
      ),
    ),
  dispose(c) {
    c.width = 0
    c.height = 0
  },
}

let loaded: Promise<Pdfjs> | null = null

/** Loads pdf.js on demand (only when a PDF tool is used) and wires its worker in the browser. */
export function loadPdfjs(): Promise<Pdfjs> {
  loaded ??= (async () => {
    const pdfjs = await import('pdfjs-dist')
    if (typeof window !== 'undefined' && typeof Worker !== 'undefined' && !pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = (await import('./pdfWorker')).default
    }
    return pdfjs
  })()
  return loaded
}

export async function openForRender(bytes: Uint8Array, pdfjs?: Pdfjs): Promise<PDFDocumentProxy> {
  const lib = pdfjs ?? (await loadPdfjs())
  try {
    // In the browser, pdf.js loads its font, CMap and image-codec data from /pdfjs (copied from the package, on demand).
    const assets =
      typeof window !== 'undefined'
        ? { standardFontDataUrl: '/pdfjs/standard_fonts/', cMapUrl: `${PDFJS_CDN}/cmaps/`, cMapPacked: true, wasmUrl: `${PDFJS_CDN}/wasm/`, iccUrl: `${PDFJS_CDN}/iccs/` }
        : {}
    return await lib.getDocument({ data: bytes.slice(), ...assets }).promise
  } catch (e) {
    const name = (e as { name?: string })?.name ?? ''
    if (name === 'PasswordException') throw new ConvertError('cv.err.encrypted')
    throw new ConvertError('cv.err.badPdf')
  }
}

export const MAX_RENDER_SIDE = 8000
export const MAX_RENDER_PIXELS = 60_000_000

/** Renders one page to PNG or JPEG bytes on a white background. The scale is clamped to protect memory. */
export async function renderPageBytes<C>(
  page: PDFPageProxy,
  opts: { dpi: number; format: 'png' | 'jpeg'; quality: number },
  adapter: CanvasAdapter<C>,
): Promise<{ bytes: Uint8Array; width: number; height: number; clamped: boolean }> {
  const base = page.getViewport({ scale: 1 })
  let scale = opts.dpi / 72
  const maxScale = Math.min(MAX_RENDER_SIDE / Math.max(base.width, base.height), Math.sqrt(MAX_RENDER_PIXELS / (base.width * base.height)))
  const clamped = scale > maxScale
  if (clamped) scale = maxScale
  const viewport = page.getViewport({ scale })
  const canvas = adapter.create(Math.max(1, Math.floor(viewport.width)), Math.max(1, Math.floor(viewport.height)))
  const ctx = adapter.context(canvas) as { fillStyle: string; fillRect(x: number, y: number, w: number, h: number): void }
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, Math.floor(viewport.width), Math.floor(viewport.height))
  try {
    await page.render({ canvas: canvas as never, canvasContext: ctx as never, viewport }).promise
    const mime = opts.format === 'png' ? 'image/png' : 'image/jpeg'
    const bytes = await adapter.toBytes(canvas, mime, opts.quality)
    return { bytes, width: Math.floor(viewport.width), height: Math.floor(viewport.height), clamped }
  } catch (e) {
    if (e instanceof ConvertError) throw e
    throw new ConvertError('cv.err.render')
  } finally {
    adapter.dispose(canvas)
  }
}

/** Text of every page, in reading order as reported by pdf.js. Scanned (image-only) PDFs yield empty strings. */
export async function extractPdfText(doc: PDFDocumentProxy): Promise<string[]> {
  const pages: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    let out = ''
    let lastY: number | null = null
    for (const item of content.items) {
      if (!('str' in item)) continue
      const y = item.transform[5] as number
      if (lastY !== null && Math.abs(y - lastY) > 2 && !out.endsWith('\n')) out += '\n'
      out += item.str
      if (item.hasEOL) out += '\n'
      lastY = y
    }
    pages.push(out.replace(/[ \t]+\n/g, '\n').trim())
    page.cleanup()
  }
  return pages
}

/** Releases a document and its worker resources. Safe to call more than once. */
export async function closePdf(doc: PDFDocumentProxy): Promise<void> {
  try {
    await doc.loadingTask.destroy()
  } catch {
    /* already destroyed */
  }
}
