import { AudioError } from './formats'
import { SAMPLE_RATE, audioStats } from './segment'

/** Duration from the file's metadata without decoding it. Null when the browser cannot tell (e.g. some WebM). */
export function probeDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const el = document.createElement('audio')
    const done = (v: number | null) => {
      el.removeAttribute('src')
      el.load()
      URL.revokeObjectURL(url)
      resolve(v)
    }
    const timer = setTimeout(() => done(null), 8000)
    el.preload = 'metadata'
    el.onloadedmetadata = () => {
      clearTimeout(timer)
      done(Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null)
    }
    el.onerror = () => {
      clearTimeout(timer)
      done(null)
    }
    el.src = url
  })
}

type OfflineCtor = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext

/**
 * Decodes with the browser's own decoder straight to 16 kHz (the rate Whisper expects) and mixes down to mono.
 * Decoding at 16 kHz instead of the file's rate keeps memory several times lower for long recordings.
 */
export async function decodeToMono16k(file: File): Promise<{ samples: Float32Array; duration: number }> {
  const Ctor: OfflineCtor | undefined = (globalThis as { OfflineAudioContext?: OfflineCtor }).OfflineAudioContext ?? (globalThis as { webkitOfflineAudioContext?: OfflineCtor }).webkitOfflineAudioContext
  if (!Ctor) throw new AudioError('audio.err.unsupportedBrowser')
  let buffer: AudioBuffer
  try {
    const bytes = await file.arrayBuffer()
    const ctx = new Ctor(1, 1, SAMPLE_RATE)
    buffer = await new Promise<AudioBuffer>((resolve, reject) => {
      // The callback form works in every browser, including older Safari.
      const p = ctx.decodeAudioData(bytes, resolve, reject) as Promise<AudioBuffer> | undefined
      p?.catch?.(reject)
    })
  } catch (e) {
    if (e instanceof RangeError) throw new AudioError('audio.err.memory')
    const name = (e as { name?: string } | null)?.name
    if (name === 'NotSupportedError') throw new AudioError('audio.err.decodeFormat', { ext: file.name.split('.').pop() ?? '' })
    throw new AudioError('audio.err.decode')
  }
  try {
    const n = buffer.length
    if (n === 0) throw new AudioError('audio.err.empty')
    const mono = new Float32Array(n)
    const channels = buffer.numberOfChannels
    for (let c = 0; c < channels; c++) {
      const data = buffer.getChannelData(c)
      for (let i = 0; i < n; i++) mono[i] = (mono[i] ?? 0) + (data[i] ?? 0) / channels
    }
    const { peak } = audioStats(mono)
    if (peak < 1e-4) throw new AudioError('audio.err.silent')
    return { samples: mono, duration: n / SAMPLE_RATE }
  } catch (e) {
    if (e instanceof RangeError) throw new AudioError('audio.err.memory')
    throw e
  }
}
