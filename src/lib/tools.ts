import { Combine, FileOutput, Minimize2, Wand2, type LucideIcon } from 'lucide-react'
import type { TKey } from '@/i18n'

export type ToolId = 'editor' | 'collage' | 'compress' | 'convert'

export type Tool = {
  id: ToolId
  path: string
  title: TKey
  short: TKey
  description: TKey
  icon: LucideIcon
  /** A translation key, or `{ raw }` for format names that are never translated (PNG, ZIP...). */
  tags: (TKey | { raw: string })[]
}

export const TOOLS: Tool[] = [
  {
    id: 'editor',
    path: '/editor',
    title: 'tool.editor.title',
    short: 'tool.editor.short',
    description: 'tool.editor.desc',
    icon: Wand2,
    tags: ['tag.filters', 'tag.crop', 'tag.resize'],
  },
  {
    id: 'collage',
    path: '/collage',
    title: 'tool.collage.title',
    short: 'tool.collage.short',
    description: 'tool.collage.desc',
    icon: Combine,
    tags: ['tag.layouts', 'tag.spacing', 'tag.backgrounds'],
  },
  {
    id: 'compress',
    path: '/compress',
    title: 'tool.compress.title',
    short: 'tool.compress.short',
    description: 'tool.compress.desc',
    icon: Minimize2,
    tags: ['tag.batch', 'tag.compare', { raw: 'ZIP' }],
  },
  {
    id: 'convert',
    path: '/convert',
    title: 'tool.convert.title',
    short: 'tool.convert.short',
    description: 'tool.convert.desc',
    icon: FileOutput,
    tags: [{ raw: 'PNG' }, { raw: 'JPG' }, { raw: 'WebP' }, { raw: 'PDF' }],
  },
]

export const toolById = (id: ToolId) => TOOLS.find((t) => t.id === id)!

// Hands dropped files from the dashboard to the tool that opens next.
let pending: { files: File[]; tool: ToolId; at: number } | null = null

export function setHandoff(files: File[], tool: ToolId) {
  pending = { files, tool, at: Date.now() }
}

export function peekHandoff(tool: ToolId): File[] {
  if (!pending || pending.tool !== tool || Date.now() - pending.at > 8000) return []
  return pending.files
}
