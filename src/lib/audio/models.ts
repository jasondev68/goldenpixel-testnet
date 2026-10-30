/**
 * Whisper models used for local transcription (open-source, exported to ONNX by Hugging Face, run by Transformers.js).
 * Weights are downloaded from the Hugging Face Hub the first time they are needed and cached by the browser.
 * No account, API key or transcription service is involved.
 */
export type ModelKey = 'tiny' | 'base' | 'small'
export type Device = 'webgpu' | 'wasm'
export type Dtype = string | Record<string, string>

type ModelInfo = { repo: string; megabytes: { wasm: number; webgpu?: number } }

/** Sizes are the real file sizes of the ONNX files that get downloaded for each processing mode. */
export const MODELS: Record<ModelKey, ModelInfo> = {
  tiny: { repo: 'onnx-community/whisper-tiny', megabytes: { wasm: 41, webgpu: 120 } },
  base: { repo: 'onnx-community/whisper-base', megabytes: { wasm: 77, webgpu: 206 } },
  // The small model is only offered in its 8-bit CPU form: its GPU files are several hundred MB.
  small: { repo: 'onnx-community/whisper-small', megabytes: { wasm: 249 } },
}
export const MODEL_KEYS = Object.keys(MODELS) as ModelKey[]
export const DEFAULT_MODEL: ModelKey = 'base'

export type LoadPlan = { key: ModelKey; repo: string; device: Device; dtype: Dtype; megabytes: number }

/** What to download and how to run it. A model without GPU files always runs on the CPU (WebAssembly). */
export function loadPlan(key: ModelKey, wanted: Device): LoadPlan {
  const info = MODELS[key]
  const device: Device = wanted === 'webgpu' && info.megabytes.webgpu ? 'webgpu' : 'wasm'
  return {
    key,
    repo: info.repo,
    device,
    // 8-bit quantized weights on the CPU; full-precision encoder + 4-bit decoder on the GPU (the combination
    // Transformers.js recommends for Whisper on WebGPU).
    dtype: device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
    megabytes: info.megabytes[device] ?? info.megabytes.wasm,
  }
}

export const canUseGpu = (key: ModelKey) => !!MODELS[key].megabytes.webgpu

/** True when the browser exposes a usable WebGPU adapter. */
export async function detectWebGpu(): Promise<boolean> {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
    return !!gpu && !!(await gpu.requestAdapter())
  } catch {
    return false
  }
}

export type Capability = { ok: true; cache: boolean; lowMemory: boolean; mobile: boolean } | { ok: false; missing: 'worker' | 'wasm' | 'audio' }

/** What this browser can do. Never claims support it does not have. */
export function checkCapability(): Capability {
  if (typeof Worker === 'undefined') return { ok: false, missing: 'worker' }
  if (typeof WebAssembly === 'undefined') return { ok: false, missing: 'wasm' }
  if (typeof OfflineAudioContext === 'undefined' && typeof (globalThis as { webkitOfflineAudioContext?: unknown }).webkitOfflineAudioContext === 'undefined') return { ok: false, missing: 'audio' }
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory
  return {
    ok: true,
    cache: typeof caches !== 'undefined',
    lowMemory: typeof mem === 'number' && mem < 4,
    mobile: /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent),
  }
}

/** Whether the model files for this plan are already in the browser cache (so no download is needed). */
export async function isModelCached(plan: LoadPlan): Promise<boolean> {
  try {
    if (typeof caches === 'undefined') return false
    const cache = await caches.open('transformers-cache')
    const keys = await cache.keys()
    const urls = keys.map((r) => r.url)
    const dtypes = typeof plan.dtype === 'string' ? ['onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx'] : ['onnx/encoder_model.onnx', 'onnx/decoder_model_merged_q4.onnx']
    return dtypes.every((f) => urls.some((u) => u.includes(`/${plan.repo}/`) && u.includes(f)))
  } catch {
    return false
  }
}
