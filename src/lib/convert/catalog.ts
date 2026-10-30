import type { PremiumFeatureId } from '@/config/payments'
import type { TKey } from '@/i18n'

export type Category = 'image' | 'pdf' | 'docs' | 'sheets' | 'audio' | 'more'
/** ready = full local engine. basic = works locally with documented limits. unsupported = needs an engine we do not have. */
export type ToolStatus = 'ready' | 'basic' | 'unsupported'

export type CatalogTool = {
  id: string
  category: Category
  title: TKey
  desc: TKey
  from: string
  to: string
  status: ToolStatus
  /** Premium feature paid for by the default run (some tools only need it for their stronger mode). */
  premium?: PremiumFeatureId
  /** Unsupported tools: why, and which supported tool is the closest alternative. */
  reason?: TKey
  alternative?: string
}

export const CATEGORIES: { id: Category; label: TKey }[] = [
  { id: 'image', label: 'cv.cat.image' },
  { id: 'pdf', label: 'cv.cat.pdf' },
  { id: 'docs', label: 'cv.cat.docs' },
  { id: 'sheets', label: 'cv.cat.sheets' },
  { id: 'audio', label: 'cv.cat.audio' },
  { id: 'more', label: 'cv.cat.more' },
]

export const CATALOG: CatalogTool[] = [
  { id: 'image-convert', category: 'image', title: 'cv.t.image.title', desc: 'cv.t.image.desc', from: 'JPG · PNG · WebP', to: 'JPG · PNG · WebP', status: 'ready' },
  { id: 'images-to-pdf', category: 'pdf', title: 'cv.t.img2pdf.title', desc: 'cv.t.img2pdf.desc', from: 'JPG · PNG · WebP', to: 'PDF', status: 'ready' },
  { id: 'pdf-merge', category: 'pdf', title: 'cv.t.merge.title', desc: 'cv.t.merge.desc', from: 'PDF', to: 'PDF', status: 'ready' },
  { id: 'pdf-split', category: 'pdf', title: 'cv.t.split.title', desc: 'cv.t.split.desc', from: 'PDF', to: 'PDF', status: 'ready' },
  { id: 'pdf-organize', category: 'pdf', title: 'cv.t.organize.title', desc: 'cv.t.organize.desc', from: 'PDF', to: 'PDF', status: 'ready' },
  { id: 'pdf-to-images', category: 'pdf', title: 'cv.t.pdf2img.title', desc: 'cv.t.pdf2img.desc', from: 'PDF', to: 'JPG · PNG', status: 'ready', premium: 'pdf-to-images' },
  { id: 'pdf-compress', category: 'pdf', title: 'cv.t.pdfcompress.title', desc: 'cv.t.pdfcompress.desc', from: 'PDF', to: 'PDF', status: 'ready', premium: 'pdf-compress' },
  { id: 'docx-to-pdf', category: 'docs', title: 'cv.t.docx2pdf.title', desc: 'cv.t.docx2pdf.desc', from: 'DOCX', to: 'PDF', status: 'basic', premium: 'docx-to-pdf' },
  { id: 'docx-to-txt', category: 'docs', title: 'cv.t.docx2txt.title', desc: 'cv.t.docx2txt.desc', from: 'DOCX', to: 'TXT', status: 'ready' },
  { id: 'txt-to-docx', category: 'docs', title: 'cv.t.txt2docx.title', desc: 'cv.t.txt2docx.desc', from: 'TXT', to: 'DOCX', status: 'ready' },
  { id: 'extract-text', category: 'docs', title: 'cv.t.extract.title', desc: 'cv.t.extract.desc', from: 'PDF · DOCX', to: 'TXT · DOCX', status: 'ready' },
  { id: 'pdf-to-docx', category: 'docs', title: 'cv.t.pdf2docx.title', desc: 'cv.t.pdf2docx.desc', from: 'PDF', to: 'DOCX', status: 'basic' },
  { id: 'xlsx-to-csv', category: 'sheets', title: 'cv.t.xlsx2csv.title', desc: 'cv.t.xlsx2csv.desc', from: 'XLSX', to: 'CSV', status: 'ready' },
  { id: 'csv-to-xlsx', category: 'sheets', title: 'cv.t.csv2xlsx.title', desc: 'cv.t.csv2xlsx.desc', from: 'CSV', to: 'XLSX', status: 'ready' },
  { id: 'audio-to-text', category: 'audio', title: 'cv.t.audio.title', desc: 'cv.t.audio.desc', from: 'MP3 · WAV · M4A · WEBM', to: 'TXT', status: 'ready' },
  { id: 'pptx-to-pdf', category: 'more', title: 'cv.t.pptx2pdf.title', desc: 'cv.t.pptx2pdf.desc', from: 'PPTX', to: 'PDF', status: 'unsupported', reason: 'cv.reason.pptx' },
  { id: 'legacy-office', category: 'more', title: 'cv.t.legacy.title', desc: 'cv.t.legacy.desc', from: 'DOC · XLS · PPT', to: 'DOCX · XLSX · PPTX', status: 'unsupported', reason: 'cv.reason.legacy' },
]

export const toolInfo = (id: string) => CATALOG.find((t) => t.id === id)
