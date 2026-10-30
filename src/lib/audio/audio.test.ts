import { describe, expect, test } from 'bun:test'
import { AudioError, sniffAudio, validateAudioFile } from './formats'
import { MODELS, MODEL_KEYS, canUseGpu, loadPlan } from './models'
import { SAMPLE_RATE, audioStats, cleanTranscript, splitAudio } from './segment'

/** A tone-and-silence signal: `speechSeconds` of a 220 Hz tone followed by a gap, repeated. */
function signal(parts: { seconds: number; loud: boolean }[]): Float32Array {
  const total = parts.reduce((n, p) => n + Math.round(p.seconds * SAMPLE_RATE), 0)
  const out = new Float32Array(total)
  let at = 0
  for (const p of parts) {
    const n = Math.round(p.seconds * SAMPLE_RATE)
    if (p.loud) for (let i = 0; i < n; i++) out[at + i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE)
    at += n
  }
  return out
}

describe('splitting a recording for Whisper', () => {
  test('short audio is a single, non-silent segment', () => {
    const segs = splitAudio(signal([{ seconds: 8, loud: true }]))
    expect(segs.length).toBe(1)
    expect(segs[0]?.silent).toBe(false)
  })

  test('segments are at most 30 s, contiguous and cover every sample', () => {
    const s = signal(Array.from({ length: 12 }, (_, i) => [{ seconds: 9, loud: true }, { seconds: 1, loud: false }][i % 2]))
    const segs = splitAudio(s)
    expect(segs.length).toBeGreaterThan(1)
    expect(segs[0]?.start).toBe(0)
    expect(segs[segs.length - 1]?.end).toBe(s.length)
    for (let i = 0; i < segs.length; i++) {
      expect(((segs[i]?.end ?? 0) - (segs[i]?.start ?? 0)) / SAMPLE_RATE).toBeLessThan(30.01)
      if (i > 0) expect(segs[i]?.start).toBe(segs[i - 1]?.end)
    }
  })

  test('cuts land in a pause, not in the middle of speech', () => {
    // 27 s of tone, a 1 s pause, then more tone: the first window must end inside the pause.
    const s = signal([{ seconds: 27, loud: true }, { seconds: 1, loud: false }, { seconds: 10, loud: true }])
    const cut = splitAudio(s)[0]?.end ?? 0
    expect(cut / SAMPLE_RATE).toBeGreaterThan(26.9)
    expect(cut / SAMPLE_RATE).toBeLessThan(28.1)
  })

  test('silent windows are marked so the model is never asked to invent text for them', () => {
    const segs = splitAudio(signal([{ seconds: 20, loud: false }]))
    expect(segs.every((x) => x.silent)).toBe(true)
    expect(audioStats(signal([{ seconds: 2, loud: false }])).peak).toBe(0)
  })
})

describe('transcript cleanup', () => {
  test('joins parts and collapses a runaway repeated sentence', () => {
    const out = cleanTranscript(['Hello there.', ' Thank you. Thank you. Thank you. Thank you.', 'The end.'])
    expect(out).toBe('Hello there. Thank you. Thank you. The end.')
  })
  test('leaves normal text alone', () => {
    expect(cleanTranscript(['Xin chào, hôm nay trời đẹp.', 'Tôi muốn đi chơi.'])).toBe('Xin chào, hôm nay trời đẹp. Tôi muốn đi chơi.')
  })
})

describe('audio file validation', () => {
  const file = (bytes: number[] | string, name: string, type = 'audio/mpeg') => new File([typeof bytes === 'string' ? bytes : new Uint8Array(bytes)], name, { type })
  const riff = [...'RIFF'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [...'WAVE'].map((c) => c.charCodeAt(0)), [0, 0, 0, 0])

  test('recognizes real containers from their first bytes', () => {
    expect(sniffAudio(new Uint8Array(riff))).toBe('wav')
    expect(sniffAudio(new Uint8Array([...'ID3'].map((c) => c.charCodeAt(0)), ))).toBe(null) // too short to decide
    expect(sniffAudio(new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('mp3')
    expect(sniffAudio(new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]))).toBe('mp4')
    expect(sniffAudio(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('webm')
  })

  test('accepts a real WAV header', async () => {
    await validateAudioFile(file(riff.concat(new Array(40).fill(0)), 'a.wav', 'audio/wav'))
  })

  test('rejects empty files, text pretending to be audio, and unsupported types with clear keys', async () => {
    await expect(validateAudioFile(file('', 'e.mp3'))).rejects.toMatchObject({ key: 'audio.err.empty' })
    await expect(validateAudioFile(file('plain text, not audio at all', 'x.mp3'))).rejects.toMatchObject({ key: 'audio.err.notAudio' })
    await expect(validateAudioFile(file('hello', 'notes.txt', 'text/plain'))).rejects.toMatchObject({ key: 'audio.err.format' })
    await expect(validateAudioFile(file('hello', 'notes.txt', 'text/plain'))).rejects.toBeInstanceOf(AudioError)
  })
})

describe('model plans', () => {
  test('CPU uses 8-bit weights; GPU uses full-precision encoder and 4-bit decoder', () => {
    expect(loadPlan('base', 'wasm').dtype).toBe('q8')
    expect(loadPlan('base', 'webgpu').dtype).toEqual({ encoder_model: 'fp32', decoder_model_merged: 'q4' })
  })
  test('the small model has no GPU files and always runs on the CPU', () => {
    expect(canUseGpu('small')).toBe(false)
    expect(loadPlan('small', 'webgpu').device).toBe('wasm')
    expect(loadPlan('small', 'webgpu').megabytes).toBe(MODELS.small.megabytes.wasm)
  })
  test('every model is an open-source Whisper export on the Hugging Face Hub, with a download size', () => {
    for (const k of MODEL_KEYS) {
      expect(MODELS[k].repo.startsWith('onnx-community/whisper-')).toBe(true)
      expect(MODELS[k].megabytes.wasm).toBeGreaterThan(10)
    }
  })
})
