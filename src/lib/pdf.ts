// Minimal PDF writer: one JPEG image per page, no dependencies.
export type PdfPage = { jpeg: Uint8Array; width: number; height: number }

const enc = new TextEncoder()

export function buildPdf(pages: PdfPage[]): Blob {
  const chunks: Uint8Array[] = []
  const offsets: number[] = []
  let length = 0

  const push = (data: Uint8Array | string) => {
    const bytes = typeof data === 'string' ? enc.encode(data) : data
    chunks.push(bytes)
    length += bytes.length
  }
  const startObj = (n: number) => {
    offsets[n] = length
    push(`${n} 0 obj\n`)
  }

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')

  // Object numbering: 1 catalog, 2 pages, then (page, content, image) triplets.
  const pageObj = (i: number) => 3 + i * 3
  startObj(1)
  push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
  startObj(2)
  push(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] >>\nendobj\n`)

  pages.forEach((p, i) => {
    // Scale so the longest side is at most A4 length in points.
    const s = Math.min(1, 842 / Math.max(p.width, p.height))
    const w = Math.round(p.width * s)
    const h = Math.round(p.height * s)
    const po = pageObj(i)
    const co = po + 1
    const io = po + 2
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`

    startObj(po)
    push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${io} 0 R >> >> /Contents ${co} 0 R >>\nendobj\n`)
    startObj(co)
    push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`)
    startObj(io)
    push(`<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`)
    push(p.jpeg)
    push('\nendstream\nendobj\n')
  })

  const total = 3 + pages.length * 3
  const xrefAt = length
  push(`xref\n0 ${total}\n0000000000 65535 f \n`)
  for (let n = 1; n < total; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`)
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`)

  return new Blob(chunks as BlobPart[], { type: 'application/pdf' })
}
