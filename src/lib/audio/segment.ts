/** Splits a recording into windows Whisper can take (at most 30 s), cutting in the quietest moment near each boundary. */
export const SAMPLE_RATE = 16000

export type Segment = { start: number; end: number; silent: boolean }

export type SplitOptions = {
  maxSeconds?: number
  /** How far before a boundary to look for a pause. */
  searchSeconds?: number
  /** Windows whose loudest 20 ms stays below this RMS contain no speech and are not sent to the model. */
  silenceRms?: number
}

const FRAME = 320 // 20 ms at 16 kHz

/** RMS of every 20 ms frame. */
export function frameLevels(samples: Float32Array): Float32Array {
  const n = Math.ceil(samples.length / FRAME)
  const out = new Float32Array(n)
  for (let f = 0; f < n; f++) {
    const s = f * FRAME
    const e = Math.min(samples.length, s + FRAME)
    let sum = 0
    for (let i = s; i < e; i++) sum += (samples[i] ?? 0) ** 2
    out[f] = Math.sqrt(sum / Math.max(1, e - s))
  }
  return out
}

export function splitAudio(samples: Float32Array, opts: SplitOptions = {}): Segment[] {
  const max = Math.round((opts.maxSeconds ?? 30) * SAMPLE_RATE)
  const search = Math.round((opts.searchSeconds ?? 4) * SAMPLE_RATE)
  const silenceRms = opts.silenceRms ?? 0.004
  const levels = frameLevels(samples)
  const segments: Segment[] = []
  let start = 0
  while (start < samples.length) {
    let end = Math.min(samples.length, start + max)
    if (end < samples.length) {
      // Cut at the quietest frame in the last few seconds of the window so words are not split.
      const lo = Math.max(start + Math.round(SAMPLE_RATE * 5), end - search)
      let best = Math.floor(end / FRAME)
      let bestLevel = Infinity
      for (let f = Math.floor(lo / FRAME); f <= Math.floor(end / FRAME) && f < levels.length; f++) {
        const l = levels[f] ?? 0
        if (l < bestLevel) {
          bestLevel = l
          best = f
        }
      }
      const cut = best * FRAME + Math.floor(FRAME / 2)
      if (cut > start + SAMPLE_RATE) end = Math.min(samples.length, cut)
    }
    let loudest = 0
    for (let f = Math.floor(start / FRAME); f < Math.ceil(end / FRAME) && f < levels.length; f++) loudest = Math.max(loudest, levels[f] ?? 0)
    segments.push({ start, end, silent: loudest < silenceRms || end - start < SAMPLE_RATE * 0.2 })
    start = end
  }
  return segments
}

export function audioStats(samples: Float32Array): { peak: number; rms: number } {
  let peak = 0
  let sum = 0
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i] ?? 0)
    if (v > peak) peak = v
    sum += v * v
  }
  return { peak, rms: samples.length ? Math.sqrt(sum / samples.length) : 0 }
}

/**
 * Whisper sometimes repeats a phrase endlessly on noisy audio. Collapse runs of the same sentence to one and
 * normalize whitespace, without altering anything else.
 */
export function cleanTranscript(parts: string[]): string {
  const sentences = parts
    .map((p) => p.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?…。])\s+/)
  const out: string[] = []
  let run = 0
  for (const s of sentences) {
    if (out.length && out[out.length - 1]?.toLowerCase() === s.toLowerCase()) {
      run++
      if (run >= 2) continue
    } else run = 0
    out.push(s)
  }
  return out.join(' ').trim()
}
