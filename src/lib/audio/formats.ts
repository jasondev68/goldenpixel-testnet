import type { TKey } from '@/i18n'

/** An audio failure that carries a translatable message. */
export class AudioError extends Error {
  constructor(
    readonly key: TKey,
    readonly vars?: Record<string, string | number>,
  ) {
    super(key)
    this.name = 'AudioError'
  }
}

export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'webm', 'ogg', 'flac', 'aac', 'mp4'] as const
export const AUDIO_ACCEPT = 'audio/*,video/webm,.mp3,.wav,.m4a,.webm,.ogg,.flac,.aac'
export const MAX_AUDIO_BYTES = 120 * 1024 * 1024

const ascii = (b: Uint8Array, s: number, e: number) => String.fromCharCode(...b.slice(s, e))

/** Recognizes the container from the first bytes so a renamed file is not mistaken for audio. */
export function sniffAudio(head: Uint8Array): 'wav' | 'mp3' | 'mp4' | 'webm' | 'ogg' | 'flac' | 'aac' | null {
  if (head.length < 12) return null
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WAVE') return 'wav'
  if (ascii(head, 0, 3) === 'ID3') return 'mp3'
  if (head[0] === 0xff && ((head[1] ?? 0) & 0xe0) === 0xe0) return (head[1] ?? 0) & 0x06 ? 'mp3' : 'aac'
  if (ascii(head, 4, 8) === 'ftyp') return 'mp4'
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return 'webm'
  if (ascii(head, 0, 4) === 'OggS') return 'ogg'
  if (ascii(head, 0, 4) === 'fLaC') return 'flac'
  return null
}

export const extensionOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? ''

/** Validates a chosen file before any work: size, type and container. */
export async function validateAudioFile(file: File): Promise<void> {
  if (file.size === 0) throw new AudioError('audio.err.empty')
  if (file.size > MAX_AUDIO_BYTES) throw new AudioError('audio.err.tooBig', { mb: Math.round(MAX_AUDIO_BYTES / 1048576) })
  const ext = extensionOf(file.name)
  const typeOk = file.type.startsWith('audio/') || file.type === 'video/webm' || file.type === 'video/mp4'
  if (!typeOk && !(AUDIO_EXTENSIONS as readonly string[]).includes(ext)) throw new AudioError('audio.err.format', { ext: ext ? `.${ext}` : file.type || '?' })
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  if (!sniffAudio(head)) throw new AudioError('audio.err.notAudio')
}
