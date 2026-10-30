import { toast } from 'sonner'
import { translate } from '@/i18n'
import { HARD_LIMITS, PREMIUM_LIMITS } from '@/config/plans'
import { sniffImageType } from './sniff'

export { sniffImageType }

export type LoadedImage = {
  id: string
  file: File
  name: string
  url: string
  width: number
  height: number
  size: number
  type: string
  img: HTMLImageElement
}

export type OutFormat = 'png' | 'jpeg' | 'webp'

export const MIME: Record<OutFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

export const EXT: Record<OutFormat, string> = { png: 'png', jpeg: 'jpg', webp: 'webp' }

let counter = 0
const uid = () => `img-${Date.now().toString(36)}-${(counter++).toString(36)}`

export function baseName(name: string) {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(0, i) : name
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export function formatFromMime(type: string): OutFormat {
  if (type === 'image/jpeg') return 'jpeg'
  if (type === 'image/webp') return 'webp'
  return 'png'
}

/** Decode an image File into a ready-to-draw LoadedImage. Rejects on failure. */
export function loadImageFile(file: File): Promise<LoadedImage> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      if (img.naturalWidth * img.naturalHeight > HARD_LIMITS.maxPixels) {
        URL.revokeObjectURL(url)
        reject(new Error(translate('upload.tooManyPixels', { name: file.name, mp: Math.round(HARD_LIMITS.maxPixels / 1_000_000) })))
        return
      }
      resolve({
        id: uid(),
        file,
        name: file.name,
        url,
        width: img.naturalWidth,
        height: img.naturalHeight,
        size: file.size,
        type: file.type,
        img,
      })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(translate('upload.readFail', { name: file.name })))
    }
    img.src = url
  })
}

export type LoadReport = {
  images: LoadedImage[]
  /** Valid files left out because the plan allows fewer files at once. */
  overCount: File[]
  /** Valid files left out because they exceed the plan's per-file size limit. */
  overSize: File[]
}

/**
 * Validates (real type, size, pixel count) and decodes dropped files, entirely in the browser.
 * Files that are valid but exceed the plan limits are returned, not discarded, so the UI can offer an upgrade
 * without making the user pick them again.
 */
export async function loadWithLimits(files: File[], opts: { maxFiles: number; maxBytes: number }): Promise<LoadReport> {
  const report: LoadReport = { images: [], overCount: [], overSize: [] }
  const accepted: File[] = []
  for (const f of files) {
    const real = await sniffImageType(f)
    if (!real || !(HARD_LIMITS.allowedTypes as readonly string[]).includes(real)) {
      toast.error(translate('upload.notImage', { name: f.name }))
      continue
    }
    if (f.size > PREMIUM_LIMITS.maxFileBytes) {
      toast.error(translate('upload.tooLarge', { name: f.name, max: Math.round(PREMIUM_LIMITS.maxFileBytes / 1048576) }))
      continue
    }
    if (f.size > opts.maxBytes) report.overSize.push(f)
    else if (accepted.length >= opts.maxFiles) report.overCount.push(f)
    else accepted.push(f)
  }
  const settled = await Promise.allSettled(accepted.map(loadImageFile))
  for (const r of settled) {
    if (r.status === 'fulfilled') report.images.push(r.value)
    else toast.error(r.reason instanceof Error ? r.reason.message : translate('upload.readFailGeneric'))
  }
  return report
}

/** Simple loader for single-image tools (Editor, Collage, Upscaler): accepts up to 40 MB per file. */
export async function loadImageFiles(files: File[], limit = 50): Promise<LoadedImage[]> {
  const r = await loadWithLimits(files, { maxFiles: limit, maxBytes: PREMIUM_LIMITS.maxFileBytes })
  if (r.overCount.length) toast.message(translate('upload.limit', { n: limit }))
  return r.images
}

/** Frees the pixel memory behind a canvas as soon as it has been exported. */
export function releaseCanvas(canvas: HTMLCanvasElement) {
  canvas.width = 0
  canvas.height = 0
}

export function revoke(images: LoadedImage[]) {
  images.forEach((i) => URL.revokeObjectURL(i.url))
}

export function canvasToBlob(canvas: HTMLCanvasElement, format: OutFormat, quality = 0.9): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error(translate('err.exportFailed')))),
      MIME[format],
      format === 'png' ? undefined : quality,
    )
  })
}

export function makeCanvas(w: number, h: number) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w))
  canvas.height = Math.max(1, Math.round(h))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error(translate('err.canvas'))
  return { canvas, ctx }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export function fitWithin(w: number, h: number, maxDim: number) {
  const longest = Math.max(w, h)
  if (!maxDim || longest <= maxDim) return { w, h }
  const s = maxDim / longest
  return { w: Math.round(w * s), h: Math.round(h * s) }
}

export function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, radius)
  else ctx.rect(x, y, w, h)
}

/** Draw `img` covering the box (x,y,w,h), center-cropped. */
export function drawCover(ctx: CanvasRenderingContext2D, img: CanvasImageSource, iw: number, ih: number, x: number, y: number, w: number, h: number) {
  const s = Math.max(w / iw, h / ih)
  const sw = w / s
  const sh = h / s
  ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h)
}
