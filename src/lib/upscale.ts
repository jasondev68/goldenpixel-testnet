import { translate, type Msg } from '@/i18n'
import { canvasToBlob, makeCanvas, releaseCanvas, type LoadedImage } from './image'

export const MAX_OUTPUT_PIXELS = 36_000_000
export const MAX_OUTPUT_SIDE = 8192

export function upscaleProblem(img: LoadedImage, scale: number): Msg | null {
  const w = img.width * scale
  const h = img.height * scale
  if (Math.max(w, h) > MAX_OUTPUT_SIDE) return { key: 'up.err.side', vars: { w, h, max: MAX_OUTPUT_SIDE } }
  if (w * h > MAX_OUTPUT_PIXELS) return { key: 'up.err.pixels' }
  return null
}

function sharpen(canvas: HTMLCanvasElement, amount: number) {
  if (amount <= 0) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const { width: w, height: h } = canvas
  const src = ctx.getImageData(0, 0, w, h)
  const out = ctx.createImageData(w, h)
  const s = src.data
  const o = out.data
  const k = amount
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      for (let c = 0; c < 3; c++) {
        const up = y > 0 ? s[i - w * 4 + c] : s[i + c]
        const dn = y < h - 1 ? s[i + w * 4 + c] : s[i + c]
        const lf = x > 0 ? s[i - 4 + c] : s[i + c]
        const rt = x < w - 1 ? s[i + 4 + c] : s[i + c]
        const center = s[i + c]
        const laplacian = 4 * center - up - dn - lf - rt
        o[i + c] = center + k * laplacian
      }
      o[i + 3] = s[i + 3]
    }
  }
  ctx.putImageData(out, 0, 0)
}

/** High-quality multi-step upscale followed by an adjustable sharpen. Runs entirely in the browser. */
export async function upscaleImage(img: LoadedImage, scale: 2 | 4, sharpness: number): Promise<{ blob: Blob; width: number; height: number }> {
  const problem = upscaleProblem(img, scale)
  if (problem) throw new Error(translate(problem.key, problem.vars))

  let current: HTMLCanvasElement | HTMLImageElement = img.img
  let cw = img.width
  let ch = img.height
  for (let step = 0; step < Math.log2(scale); step++) {
    const { canvas, ctx } = makeCanvas(cw * 2, ch * 2)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(current, 0, 0, canvas.width, canvas.height)
    if (current instanceof HTMLCanvasElement) releaseCanvas(current) // free the previous step right away
    current = canvas
    cw = canvas.width
    ch = canvas.height
  }
  const final = current as HTMLCanvasElement
  sharpen(final, sharpness / 100)
  const { width, height } = final
  const blob = await canvasToBlob(final, 'png')
  releaseCanvas(final)
  return { blob, width, height }
}
