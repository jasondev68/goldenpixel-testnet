import * as Tools from './tools'
import { Workspace, type ToolUi } from './Workspace'

const GENERIC: Record<string, ToolUi<never>> = {
  'pdf-merge': Tools.MERGE as never,
  'pdf-split': Tools.SPLIT as never,
  'pdf-to-images': Tools.PDF_TO_IMAGES as never,
  'pdf-compress': Tools.PDF_COMPRESS as never,
  'pdf-to-docx': Tools.PDF_TO_DOCX as never,
  'docx-to-pdf': Tools.DOCX_TO_PDF as never,
  'docx-to-txt': Tools.DOCX_TO_TXT as never,
  'txt-to-docx': Tools.TXT_TO_DOCX as never,
  'extract-text': Tools.EXTRACT as never,
  'xlsx-to-csv': Tools.XLSX_TO_CSV as never,
  'csv-to-xlsx': Tools.CSV_TO_XLSX as never,
}

/** Loads the workspace for a tool id. Lazy-loaded so the heavy PDF engines stay out of the main Convert bundle. */
export default function GenericTool({ id }: { id: string }) {
  const def = GENERIC[id]
  return def ? <Workspace def={def} /> : null
}
