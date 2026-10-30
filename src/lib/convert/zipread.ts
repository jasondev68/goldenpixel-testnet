import { ConvertError } from './errors'

export type ZipFile = { name: string; method: number; compressedSize: number; size: number; offset: number; flags: number }

const dec = new TextDecoder()

/** Reads the central directory of a ZIP (the container used by DOCX and XLSX). ZIP64 and encryption are rejected. */
export function listZip(buf: Uint8Array): Map<string, ZipFile> {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new ConvertError('cv.err.notZip')
  const count = v.getUint16(eocd + 10, true)
  let p = v.getUint32(eocd + 16, true)
  if (count === 0xffff || p === 0xffffffff) throw new ConvertError('cv.err.zip64')
  const files = new Map<string, ZipFile>()
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || v.getUint32(p, true) !== 0x02014b50) throw new ConvertError('cv.err.notZip')
    const flags = v.getUint16(p + 8, true)
    const method = v.getUint16(p + 10, true)
    const compressedSize = v.getUint32(p + 20, true)
    const size = v.getUint32(p + 24, true)
    const nameLen = v.getUint16(p + 28, true)
    const extraLen = v.getUint16(p + 30, true)
    const commentLen = v.getUint16(p + 32, true)
    const offset = v.getUint32(p + 42, true)
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen))
    files.set(name, { name, method, compressedSize, size, offset, flags })
    p += 46 + nameLen + extraLen + commentLen
  }
  return files
}

/** Inflates raw deflate data with the platform's DecompressionStream (browsers and Bun). */
async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function readZipEntry(buf: Uint8Array, entry: ZipFile): Promise<Uint8Array> {
  if (entry.flags & 1) throw new ConvertError('cv.err.encrypted')
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const start = entry.offset + 30 + v.getUint16(entry.offset + 26, true) + v.getUint16(entry.offset + 28, true)
  const raw = buf.subarray(start, start + entry.compressedSize)
  if (entry.method === 0) return raw
  if (entry.method === 8) return inflateRaw(raw)
  throw new ConvertError('cv.err.zipMethod')
}

export async function readZipText(buf: Uint8Array, files: Map<string, ZipFile>, name: string): Promise<string | null> {
  const e = files.get(name)
  return e ? dec.decode(await readZipEntry(buf, e)) : null
}
