import { AudioError } from './formats'
import type { LoadPlan } from './models'
import type { Segment } from './segment'
import type { WorkerIn, WorkerOut } from './transcribe.worker'

export type DownloadProgress = { loaded: number; total: number }

const NETWORK = /failed to fetch|networkerror|load failed|network|could not locate|unauthorized|forbidden|404|timeout|offline|fetch/i

/**
 * Owns the transcription worker. The worker (and the Transformers.js library inside it) is created only when a
 * model is actually requested, so nothing heavy loads while the user just browses GoldenPixel.
 */
export class TranscriberClient {
  private worker: Worker | null = null
  private listener: ((m: WorkerOut) => void) | null = null
  device: 'webgpu' | 'wasm' | null = null

  private ensure(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./transcribe.worker.ts', import.meta.url), { type: 'module' })
      this.worker.onmessage = (e: MessageEvent<WorkerOut>) => this.listener?.(e.data)
      this.worker.onerror = (e) => this.listener?.({ type: 'error', phase: 'load', message: e.message || 'worker error' })
    }
    return this.worker
  }

  private post(m: WorkerIn, transfer: Transferable[] = []) {
    this.ensure().postMessage(m, transfer)
  }

  /** Downloads (or reads from the browser cache) and initializes the model. */
  load(plan: LoadPlan, onProgress: (p: DownloadProgress) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      this.listener = (m) => {
        if (m.type === 'progress') onProgress({ loaded: m.loaded, total: m.total })
        else if (m.type === 'ready') {
          this.device = m.device
          this.listener = null
          resolve()
        } else if (m.type === 'error') {
          this.listener = null
          reject(new AudioError(NETWORK.test(m.message) ? 'audio.err.download' : 'audio.err.loadFailed', { detail: m.message.slice(0, 200) }))
        }
      }
      this.post({ type: 'load', repo: plan.repo, device: plan.device, dtype: plan.dtype })
    })
  }

  /** Transcribes the given segments; calls back after each one. The sample buffer is handed to the worker (not copied). */
  run(samples: Float32Array, segments: Segment[], language: string, from: number, onSegment: (index: number, total: number, text: string) => void): Promise<{ cancelled: boolean }> {
    return new Promise((resolve, reject) => {
      this.listener = (m) => {
        if (m.type === 'segment') onSegment(m.index, m.total, m.text)
        else if (m.type === 'done') {
          this.listener = null
          resolve({ cancelled: m.cancelled })
        } else if (m.type === 'error') {
          this.listener = null
          reject(new AudioError(/memory|alloc|out of/i.test(m.message) ? 'audio.err.memory' : 'audio.err.runFailed', { detail: m.message.slice(0, 200) }))
        }
      }
      this.post({ type: 'run', samples, segments, language, from }, [samples.buffer])
    })
  }

  cancel() {
    this.worker?.postMessage({ type: 'cancel' } satisfies WorkerIn)
  }

  dispose() {
    this.listener = null
    if (this.worker) {
      this.worker.postMessage({ type: 'dispose' } satisfies WorkerIn)
      const w = this.worker
      this.worker = null
      setTimeout(() => w.terminate(), 300)
    }
    this.device = null
  }
}
