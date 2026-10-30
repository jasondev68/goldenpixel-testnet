/**
 * Optional OCR for scanned pages, powered by tesseract.js. It is loaded only when the user turns OCR on.
 * Recognition runs in the browser. The engine and the language data are downloaded once from a public CDN
 * (jsDelivr), which is disclosed in the UI; the PDF itself is never uploaded.
 */
export type OcrLang = 'eng' | 'vie' | 'vie+eng'
export type OcrLine = { text: string; x0: number; y0: number; x1: number; y1: number; confidence: number }
export type OcrStatus = { status: string; progress: number }
export type OcrEngine = { recognize(image: Uint8Array): Promise<OcrLine[]>; terminate(): Promise<void> }
export type OcrFactory = (lang: OcrLang, onStatus?: (s: OcrStatus) => void) => Promise<OcrEngine>

export const tesseractFactory: OcrFactory = async (lang, onStatus) => {
  const T = await import('tesseract.js')
  const worker = await T.createWorker(lang.split('+'), 1, { logger: (m) => onStatus?.({ status: m.status, progress: m.progress }) })
  return {
    async recognize(image) {
      // Browsers take a Blob; Node (tests, scripts) takes a Buffer.
      const input = typeof window !== 'undefined' ? new Blob([image as BlobPart], { type: 'image/png' }) : (globalThis as unknown as { Buffer: { from(b: Uint8Array): Blob } }).Buffer.from(image)
      const res = await worker.recognize(input, {}, { blocks: true })
      const lines: OcrLine[] = []
      for (const block of res.data.blocks ?? [])
        for (const para of block.paragraphs)
          for (const line of para.lines) lines.push({ text: line.text, x0: line.bbox.x0, y0: line.bbox.y0, x1: line.bbox.x1, y1: line.bbox.y1, confidence: line.confidence })
      return lines
    },
    terminate: async () => {
      await worker.terminate()
    },
  }
}
