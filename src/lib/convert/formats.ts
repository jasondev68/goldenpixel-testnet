import type { TKey } from '@/i18n'
import { ConvertError } from './errors'

export const extOf = (name: string) => (name.includes('.') ? (name.split('.').pop() as string).toLowerCase() : '')
export const baseOf = (name: string) => name.replace(/\.[^.]+$/, '')
export const safeName = (name: string) => name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120) || 'file'

/** Formats GoldenPixel recognises but cannot convert, with the reason shown to the user. */
const UNSUPPORTED: Record<string, TKey> = {
  doc: 'cv.unsup.doc',
  xls: 'cv.unsup.xls',
  ppt: 'cv.unsup.ppt',
  pptx: 'cv.unsup.pptx',
  odt: 'cv.unsup.odf',
  ods: 'cv.unsup.odf',
  odp: 'cv.unsup.odf',
  rtf: 'cv.unsup.rtf',
  pages: 'cv.unsup.apple',
  numbers: 'cv.unsup.apple',
  key: 'cv.unsup.apple',
  heic: 'cv.unsup.heic',
  heif: 'cv.unsup.heic',
  epub: 'cv.unsup.generic',
  mobi: 'cv.unsup.generic',
}

const MAGIC_ZIP = [0x50, 0x4b, 0x03, 0x04]

/**
 * Checks that a file is acceptable for a tool BEFORE any work or payment: allowed extension, not empty and
 * the first bytes really match the claimed format (a renamed file is not trusted).
 */
export async function validateInput(file: File, allowed: readonly string[]): Promise<ConvertError | null> {
  const ext = extOf(file.name)
  if (!allowed.includes(ext)) {
    return new ConvertError(UNSUPPORTED[ext] ?? 'cv.unsup.generic', { ext: ext ? `.${ext}` : file.name, allowed: allowed.map((a) => `.${a}`).join(', ') })
  }
  if (file.size === 0) return new ConvertError('cv.err.empty')
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer())
  if (ext === 'pdf') {
    const text = new TextDecoder('latin1').decode(head)
    if (!text.includes('%PDF-')) return new ConvertError('cv.err.badPdf')
  } else if (ext === 'docx' || ext === 'xlsx') {
    if (!MAGIC_ZIP.every((b, i) => head[i] === b)) return new ConvertError(ext === 'docx' ? 'cv.err.badDocx' : 'cv.err.badXlsx')
  } else if (ext === 'txt' || ext === 'csv') {
    if (head.includes(0)) return new ConvertError('cv.err.notText')
  }
  return null
}

export const FORMAT_LABEL: Record<string, string> = { pdf: 'PDF', docx: 'DOCX', xlsx: 'XLSX', csv: 'CSV', txt: 'TXT', png: 'PNG', jpg: 'JPG', jpeg: 'JPG', webp: 'WebP' }
export const labelOf = (ext: string) => FORMAT_LABEL[ext] ?? ext.toUpperCase()
