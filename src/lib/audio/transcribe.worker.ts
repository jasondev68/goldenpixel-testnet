/// Runs the Whisper model off the main thread so the page stays responsive during download and inference.
import { env, pipeline } from '@huggingface/transformers'
import type { Dtype } from './models'
import type { Segment } from './segment'

export type WorkerIn =
  | { type: 'load'; repo: string; device: 'webgpu' | 'wasm'; dtype: Dtype }
  | { type: 'run'; samples: Float32Array; segments: Segment[]; language: string; from: number }
  | { type: 'cancel' }
  | { type: 'dispose' }

export type WorkerOut =
  | { type: 'progress'; loaded: number; total: number; file: string }
  | { type: 'ready'; device: 'webgpu' | 'wasm' }
  | { type: 'segment'; index: number; total: number; text: string }
  | { type: 'done'; cancelled: boolean }
  | { type: 'error'; phase: 'load' | 'run'; message: string }

type Result = { text: string } | { text: string }[]
type Asr = ((audio: Float32Array, options: Record<string, unknown>) => Promise<Result>) & { dispose?: () => Promise<void> | void }

const scope = self as unknown as { postMessage(m: WorkerOut): void; onmessage: ((e: MessageEvent<WorkerIn>) => void) | null }
const send = (m: WorkerOut) => scope.postMessage(m)

// Model files come from the Hugging Face Hub and are kept in the browser's Cache API ("transformers-cache").
env.allowLocalModels = false
env.useBrowserCache = true

let asr: Asr | null = null
let device: 'webgpu' | 'wasm' = 'wasm'
let cancelled = false

async function load(m: Extract<WorkerIn, { type: 'load' }>) {
  const make = pipeline as unknown as (task: string, model: string, options: Record<string, unknown>) => Promise<Asr>
  try {
    asr = await make('automatic-speech-recognition', m.repo, {
      device: m.device,
      dtype: m.dtype,
      progress_callback: (p: { status?: string; file?: string; loaded?: number; total?: number }) => {
        // Transformers.js reports the combined progress of every file in "progress_total" events.
        if (p.status === 'progress_total') send({ type: 'progress', loaded: p.loaded ?? 0, total: p.total ?? 0, file: '' })
      },
    })
    device = m.device
    send({ type: 'ready', device })
  } catch (e) {
    asr = null
    send({ type: 'error', phase: 'load', message: e instanceof Error ? e.message : String(e) })
  }
}

async function run(m: Extract<WorkerIn, { type: 'run' }>) {
  if (!asr) return send({ type: 'error', phase: 'run', message: 'model not loaded' })
  cancelled = false
  try {
    for (let i = m.from; i < m.segments.length; i++) {
      // Yield to the event loop so a "cancel" message sent while the previous window was running is seen now.
      await new Promise((resolve) => setTimeout(resolve, 0))
      if (cancelled) return send({ type: 'done', cancelled: true })
      const seg = m.segments[i]
      if (!seg) continue
      let text = ''
      if (!seg.silent) {
        const out = await asr(m.samples.subarray(seg.start, seg.end), { language: m.language, task: 'transcribe' })
        text = (Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text).trim()
      }
      send({ type: 'segment', index: i, total: m.segments.length, text })
    }
    send({ type: 'done', cancelled: false })
  } catch (e) {
    send({ type: 'error', phase: 'run', message: e instanceof Error ? e.message : String(e) })
  }
}

scope.onmessage = (e) => {
  const m = e.data
  if (m.type === 'load') void load(m)
  else if (m.type === 'run') void run(m)
  else if (m.type === 'cancel') cancelled = true
  else if (m.type === 'dispose') {
    void Promise.resolve(asr?.dispose?.()).finally(() => {
      asr = null
    })
  }
}
