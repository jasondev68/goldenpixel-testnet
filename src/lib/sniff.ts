/** Detects the real image type from the first bytes, so a renamed or spoofed file is not trusted. */
export async function sniffImageType(file: Blob): Promise<string | null> {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to))
  if (b[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (ascii(0, 4) === 'GIF8') return 'image/gif'
  if (ascii(0, 2) === 'BM') return 'image/bmp'
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp'
  return null
}
