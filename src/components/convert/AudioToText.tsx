import { Copy, Download, FileAudio, Mic, RotateCcw, Square, Trash2, Cpu, Zap } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Notice, Spinner } from '@/components/swapbridge/parts'
import { Dropzone, Field, Segmented } from '@/components/ui'
import { PremiumNote, usePriceText } from '@/components/premium/PremiumNote'
import { FREE_LIMITS, PREMIUM_LIMITS } from '@/config/plans'
import { usePremiumAction } from '@/hooks/usePremiumAction'
import { type Msg, type TKey, useI18n } from '@/i18n'
import { TranscriberClient, type DownloadProgress } from '@/lib/audio/client'
import { decodeToMono16k, probeDuration } from '@/lib/audio/decode'
import { AUDIO_ACCEPT, AudioError, MAX_AUDIO_BYTES, validateAudioFile } from '@/lib/audio/formats'
import { DEFAULT_MODEL, MODEL_KEYS, type Device, type ModelKey, canUseGpu, checkCapability, detectWebGpu, isModelCached, loadPlan } from '@/lib/audio/models'
import { audioStats, cleanTranscript, splitAudio } from '@/lib/audio/segment'
import { downloadBlob } from '@/lib/image'
import { translate } from '@/i18n'

type Lang = 'vi' | 'en'
type Phase = 'idle' | 'downloading' | 'preparing' | 'transcribing'
const WHISPER_LANG: Record<Lang, string> = { vi: 'vietnamese', en: 'english' }
const MODEL_LABEL: Record<ModelKey, TKey> = { tiny: 'audio.model.tiny', base: 'audio.model.base', small: 'audio.model.small' }
const MODEL_HINT: Record<ModelKey, TKey> = { tiny: 'audio.model.tiny.hint', base: 'audio.model.base.hint', small: 'audio.model.small.hint' }
const UNSUPPORTED: Record<'worker' | 'wasm' | 'audio', TKey> = { worker: 'audio.unsupported.worker', wasm: 'audio.unsupported.wasm', audio: 'audio.unsupported.audio' }
type LoadedPlan = ReturnType<typeof loadPlan>

const toMsg = (e: unknown): Msg => {
  if (e instanceof AudioError) return { key: e.key, vars: e.vars }
  const carried = (e as { msg?: Msg } | null)?.msg
  if (carried?.key) return carried
  return { key: 'err.withDetail', vars: { detail: e instanceof Error ? e.message : String(e) } }
}
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export default function AudioToText() {
  const { t, m, lang: uiLang, fmt } = useI18n()
  const px = usePremiumAction()
  const priceText = usePriceText()
  const cap = useMemo(() => checkCapability(), [])

  const [file, setFile] = useState<File | null>(null)
  const [duration, setDuration] = useState<number | null>(null)
  const [language, setLanguage] = useState<Lang>(uiLang === 'vi' ? 'vi' : 'en')
  const [model, setModel] = useState<ModelKey>(DEFAULT_MODEL)
  const [cpuOnly, setCpuOnly] = useState(false)
  const [gpu, setGpu] = useState<boolean | null>(null)
  const [cached, setCached] = useState(false)
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [dl, setDl] = useState<DownloadProgress | null>(null)
  const [parts, setParts] = useState({ done: 0, total: 0 })
  const [text, setText] = useState('')
  const [error, setError] = useState<Msg | null>(null)
  const [notice, setNotice] = useState<Msg | null>(null)
  const [summary, setSummary] = useState<Msg | null>(null)
  const clientRef = useRef<TranscriberClient | null>(null)

  useEffect(() => {
    void detectWebGpu().then(setGpu)
  }, [])

  const wanted: Device = gpu && !cpuOnly ? 'webgpu' : 'wasm'
  const plan = loadPlan(model, wanted)
  const planKey = `${plan.repo}|${plan.device}`
  const modelReady = loadedKey === planKey
  useEffect(() => {
    let live = true
    void isModelCached(plan).then((c) => live && setCached(c))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey, modelReady])

  // Release the worker (and the model memory) when the tool is left.
  useEffect(
    () => () => {
      clientRef.current?.dispose()
      clientRef.current = null
    },
    [],
  )

  const busy = phase !== 'idle'
  const long = duration !== null && duration > FREE_LIMITS.maxAudioSeconds
  const tooLong = duration !== null && duration > PREMIUM_LIMITS.maxAudioSeconds

  const pickFile = async (files: File[]) => {
    const f = files[0]
    if (!f || busy) return
    setError(null)
    setSummary(null)
    try {
      await validateAudioFile(f)
    } catch (e) {
      setFile(null)
      setDuration(null)
      setError(toMsg(e))
      return
    }
    setFile(f)
    setText('')
    setDuration(await probeDuration(f))
  }

  const removeFile = () => {
    if (busy) return
    setFile(null)
    setDuration(null)
    setError(null)
  }

  /** Downloads (or restores from the cache) and starts the model, falling back from GPU to CPU if needed. */
  const loadModel = useCallback(
    async (target = plan): Promise<LoadedPlan> => {
      setPhase('downloading')
      setDl(null)
      setError(null)
      clientRef.current?.dispose()
      const client = new TranscriberClient()
      clientRef.current = client
      try {
        await client.load(target, setDl)
        setLoadedKey(`${target.repo}|${target.device}`)
        return target
      } catch (e) {
        client.dispose()
        clientRef.current = null
        if (target.device === 'webgpu') {
          setCpuOnly(true)
          setNotice({ key: 'audio.fallback' })
          return loadModel(loadPlan(target.key, 'wasm'))
        }
        throw e
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [planKey],
  )
  const downloadModel = async () => {
    if (busy) return
    try {
      await loadModel()
    } catch (e) {
      setError(toMsg(e))
    } finally {
      setPhase('idle')
    }
  }

  const transcribe = async () => {
    if (!file || busy) return
    setError(null)
    setSummary(null)
    setNotice(null)
    const started = Date.now()
    let samples: Float32Array | null = null
    try {
      let active = plan
      if (!modelReady || !clientRef.current) active = await loadModel()
      const client = clientRef.current as TranscriberClient

      setPhase('preparing')
      const decoded = await decodeToMono16k(file)
      samples = decoded.samples
      if (decoded.duration > PREMIUM_LIMITS.maxAudioSeconds) throw new AudioError('audio.err.tooLong', { min: Math.round(PREMIUM_LIMITS.maxAudioSeconds / 60) })
      setDuration(decoded.duration)
      // Recordings over the free length need the long-audio unlock (verified payment). Shorter ones are free.
      if (decoded.duration > FREE_LIMITS.maxAudioSeconds) await px.ensurePaid(['audio-long'])

      const segments = splitAudio(samples)
      if (segments.every((s) => s.silent) || audioStats(samples).rms < 1e-4) throw new AudioError('audio.err.noSpeech')
      const done: string[] = []
      setText('')
      setParts({ done: 0, total: segments.length })
      setPhase('transcribing')

      const onSegment = (i: number, total: number, piece: string) => {
        done[i] = piece
        setParts({ done: i + 1, total })
        setText(cleanTranscript(done))
      }
      // A GPU run keeps one copy so a failure can continue on the CPU; a CPU run hands the buffer over without copying.
      const backup = active.device === 'webgpu' ? samples.slice() : null
      const language_ = WHISPER_LANG[language]
      let cancelled = false
      try {
        const r = await client.run(samples, segments, language_, 0, onSegment)
        cancelled = r.cancelled
      } catch (e) {
        if (!(backup && e instanceof AudioError && e.key === 'audio.err.runFailed')) throw e
        setNotice({ key: 'audio.gpuFailed' })
        setCpuOnly(true)
        await loadModel(loadPlan(active.key, 'wasm'))
        setPhase('transcribing')
        const from = done.filter((x) => x !== undefined).length
        const r = await (clientRef.current as TranscriberClient).run(backup, segments, language_, from, onSegment)
        cancelled = r.cancelled
      }
      samples = null
      setText(cleanTranscript(done))
      const words = cleanTranscript(done).split(/\s+/).filter(Boolean).length
      setSummary(cancelled ? { key: 'audio.cancelled' } : { key: 'audio.done', vars: { words: fmt.number(words, 0), time: clock((Date.now() - started) / 1000) } })
    } catch (e) {
      setError(toMsg(e))
    } finally {
      samples = null
      setPhase('idle')
    }
  }

  const cancel = () => clientRef.current?.cancel()

  const reset = () => {
    if (busy) return
    setFile(null)
    setDuration(null)
    setText('')
    setError(null)
    setNotice(null)
    setSummary(null)
    setParts({ done: 0, total: 0 })
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(translate('audio.copied'))
    } catch {
      const ta = document.getElementById('audio-transcript') as HTMLTextAreaElement | null
      ta?.select()
      toast.success(document.execCommand('copy') ? translate('audio.copied') : translate('audio.copyFail'))
    }
  }

  const saveTxt = () => downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${(file?.name ?? 'transcript').replace(/\.[^.]+$/, '')}.txt`)

  if (!cap.ok) {
    return (
      <Notice tone="error">
        <p className="font-semibold">{t('audio.unsupported.title')}</p>
        <p className="mt-1">{t(UNSUPPORTED[cap.missing])}</p>
      </Notice>
    )
  }

  const pct = dl && dl.total > 0 ? Math.min(100, Math.round((dl.loaded / dl.total) * 100)) : 0
  const seg = parts.total ? Math.round((parts.done / parts.total) * 100) : 0
  const words = text.split(/\s+/).filter(Boolean).length

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      <div className="grid content-start gap-5">
        {!file ? (
          <Dropzone
            multiple={false}
            accept={AUDIO_ACCEPT}
            onFiles={pickFile}
            title={t('audio.upload')}
            hint={t('audio.drop.hint', { mb: Math.round(MAX_AUDIO_BYTES / 1048576) })}
          />
        ) : (
          <div className="gp-card flex items-center gap-3 p-3 sm:p-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-[var(--gp-line)] bg-black/30 text-[var(--gp-gold)]">
              <FileAudio size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{file.name}</p>
              <p className="text-xs tabular-nums text-mist">
                {fmt.bytes(file.size)} · {duration !== null ? t('audio.file.duration', { d: clock(duration) }) : t('audio.file.unknownDuration')}
              </p>
            </div>
            <button type="button" className="gp-btn gp-btn-ghost gp-btn-sm" disabled={busy} onClick={removeFile} aria-label={t('common.remove', { name: file.name })}>
              <Trash2 size={14} /> <span className="hidden sm:inline">{t('audio.file.remove')}</span>
            </button>
          </div>
        )}

        {error && <Notice tone="error">{m(error)}</Notice>}
        {notice && <Notice tone="warn">{m(notice)}</Notice>}
        {tooLong && <Notice tone="error">{t('audio.err.tooLong', { min: Math.round(PREMIUM_LIMITS.maxAudioSeconds / 60) })}</Notice>}

        {(text || phase === 'transcribing') && (
          <section className="gp-card p-4 sm:p-5" aria-labelledby="audio-t-h">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 id="audio-t-h" className="gp-eyebrow">{t('audio.transcript')}</h3>
              <span className="text-xs tabular-nums text-mist">{t('audio.words', { n: fmt.number(words, 0) })}</span>
            </div>
            <textarea
              id="audio-transcript"
              className="gp-input min-h-[220px] w-full resize-y leading-relaxed"
              value={text}
              readOnly={phase === 'transcribing'}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('audio.transcript.ph')}
              aria-label={t('audio.transcript')}
              spellCheck={false}
            />
            {summary && <p className="mt-2 text-xs text-mist" role="status">{m(summary)}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="gp-btn gp-btn-primary gp-btn-sm" disabled={!text || phase === 'transcribing'} onClick={() => void copy()}>
                <Copy size={14} /> {t('audio.copy')}
              </button>
              <button type="button" className="gp-btn gp-btn-ghost gp-btn-sm" disabled={!text || phase === 'transcribing'} onClick={saveTxt}>
                <Download size={14} /> {t('audio.download')}
              </button>
              <button type="button" className="gp-btn gp-btn-outline gp-btn-sm" disabled={busy} onClick={reset}>
                <RotateCcw size={14} /> {t('audio.new')}
              </button>
            </div>
          </section>
        )}
      </div>

      <aside className="grid content-start gap-4" aria-label={t('audio.settings.aria')}>
        <div className="gp-card grid gap-4 p-4 sm:p-5">
          <Field label={t('audio.lang')}>
            <Segmented label={t('audio.lang')} value={language} onChange={setLanguage} options={[{ value: 'vi', label: t('audio.lang.vi') }, { value: 'en', label: t('audio.lang.en') }]} />
          </Field>

          <Field label={t('audio.model')}>
            <Segmented
              label={t('audio.model')}
              value={model}
              onChange={(k) => !busy && setModel(k)}
              options={MODEL_KEYS.map((k) => ({ value: k, label: t(MODEL_LABEL[k]) }))}
            />
            <p className="mt-1.5 text-xs text-mist">{t(MODEL_HINT[model])}</p>
          </Field>

          <div className="flex flex-wrap items-center gap-2 text-xs text-mist">
            <span className="gp-chip !py-0.5">{plan.device === 'webgpu' ? <Zap size={12} /> : <Cpu size={12} />} {plan.device === 'webgpu' ? t('audio.device.gpu') : t('audio.device.cpu')}</span>
            {gpu && canUseGpu(model) && (
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={cpuOnly} disabled={busy} onChange={(e) => setCpuOnly(e.target.checked)} className="h-4 w-4 accent-[var(--gp-gold)]" />
                {t('audio.device.forceCpu')}
              </label>
            )}
            {gpu === false && <span>{t('audio.device.nogpu')}</span>}
          </div>

          {language === 'vi' && model !== 'small' && <Notice tone="warn">{t('audio.warn.viSmall')}</Notice>}
          {plan.device === 'wasm' && <p className="text-xs text-mist">{t('audio.warn.cpu')}</p>}
          {cap.lowMemory && <Notice tone="warn">{t('audio.warn.lowMemory')}</Notice>}
          {cap.mobile && model === 'small' && <Notice tone="warn">{t('audio.warn.mobile')}</Notice>}
          {!cap.cache && <Notice tone="warn">{t('audio.warn.noCache')}</Notice>}

          {phase === 'downloading' && (
            <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t('audio.model.downloading', { done: '', total: '' })}>
              <div className="gp-progress"><span style={{ width: `${Math.max(4, pct)}%` }} /></div>
              <p className="mt-1 text-xs tabular-nums text-mist">
                {dl && dl.total > 0 ? t('audio.model.downloading', { done: fmt.bytes(dl.loaded), total: fmt.bytes(dl.total) }) : t('audio.model.initializing')}
              </p>
            </div>
          )}
          {(phase === 'transcribing' || phase === 'preparing') && (
            <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={seg} aria-label={t('audio.transcribing')}>
              <div className="gp-progress"><span style={{ width: `${Math.max(4, seg)}%` }} /></div>
              <p className="mt-1 text-xs tabular-nums text-mist">{phase === 'preparing' ? t('audio.preparing') : t('audio.progress', { done: parts.done, total: parts.total })}</p>
            </div>
          )}

          {!modelReady && phase === 'idle' && (
            <button type="button" className="gp-btn gp-btn-outline w-full" onClick={() => void downloadModel()}>
              <Download size={16} /> {cached ? t('audio.btn.load') : t('audio.btn.download')} · {t('audio.model.size', { mb: plan.megabytes })}
            </button>
          )}
          {modelReady && phase === 'idle' && <p className="flex items-center gap-1.5 text-xs text-emerald-300"><Zap size={13} /> {t('audio.model.ready', { device: plan.device === 'webgpu' ? 'GPU' : 'CPU' })}</p>}

          {long && <PremiumNote ops={['audio-long']} px={px} />}

          {phase === 'transcribing' ? (
            <button type="button" className="gp-btn gp-btn-outline w-full" onClick={cancel}>
              <Square size={14} /> {t('audio.btn.cancel')}
            </button>
          ) : (
            <button type="button" className="gp-btn gp-btn-primary w-full" disabled={!file || busy || tooLong || (long && !px.available && !px.isUnlocked(['audio-long']))} onClick={() => void transcribe()}>
              {busy ? (
                <Spinner label={phase === 'downloading' ? t('audio.model.initializing') : phase === 'preparing' ? t('audio.preparing') : t('audio.transcribing')} />
              ) : (
                <>
                  <Mic size={16} /> {long ? t('audio.btn.transcribePaid', { cost: priceText(['audio-long']) }) : t('audio.btn.transcribe')}
                </>
              )}
            </button>
          )}
          {phase === 'transcribing' && (
            <p className="flex items-center gap-2 text-xs text-mist" role="status"><Spinner label={t('audio.transcribing')} /></p>
          )}
        </div>

        <div className="gp-card p-4 text-xs leading-relaxed text-mist sm:p-5">
          <p>{t('audio.privacy', { mb: plan.megabytes })}</p>
          <p className="mt-2">{t('audio.sources')}</p>
          <p className="mt-2">{t('audio.free', { min: Math.round(FREE_LIMITS.maxAudioSeconds / 60), max: Math.round(PREMIUM_LIMITS.maxAudioSeconds / 60) })}</p>
        </div>
      </aside>
    </div>
  )
}
