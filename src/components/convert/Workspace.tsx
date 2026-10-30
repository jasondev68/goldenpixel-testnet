import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, Archive, CheckCircle2, Download, FileText, ImagePlus, RotateCcw, Trash2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { BatchUpsell } from '@/components/premium/BatchUpsell'
import { PremiumNote, usePriceText } from '@/components/premium/PremiumNote'
import { Notice, Spinner } from '@/components/swapbridge/parts'
import { Dropzone, PickButton } from '@/components/ui'
import type { PremiumFeatureId } from '@/config/payments'
import { useBatchPlan } from '@/hooks/useBatchPlan'
import { translate, useI18n, type Msg, type TKey } from '@/i18n'
import { ApiError } from '@/lib/apiError'
import { downloadBlob } from '@/lib/image'
import { ConvertError } from '@/lib/convert/errors'
import { extOf, labelOf, validateInput } from '@/lib/convert/formats'
import { pdfPageCount } from '@/lib/convert/pdfTools'
import { browserCanvas } from '@/lib/convert/pdfRender'
import { tesseractFactory } from '@/lib/convert/ocr'
import type { Ctx, Env, RunResult, WorkOutput } from '@/lib/convert/runners'
import { zipBlobs } from '@/lib/zip'

export type Item = { id: string; file: File; pages?: number; error?: Msg; status: 'ready' | 'processing' | 'done' | 'failed' }

export type ToolUi<O> = {
  id: string
  accept: string[]
  multiple: boolean
  /** Show move up/down (merge order). */
  ordered?: boolean
  defaults: O
  action: TKey
  ops?: (opts: O) => PremiumFeatureId[]
  run: (ctx: Ctx<O>) => Promise<RunResult>
  Options?: (p: { opts: O; set: (patch: Partial<O>) => void; items: Item[] }) => ReactNode
  /** Returns a message when the current inputs/options cannot run yet. */
  check?: (items: Item[], opts: O) => Msg | null
  /** Shown before running: this engine has documented limits. */
  limits?: TKey
}

const fontCache = new Map<string, Promise<Uint8Array>>()
const loadFont = (file: string) => {
  let p = fontCache.get(file)
  if (!p) {
    p = fetch(`/fonts/${file}`).then(async (r) => {
      if (!r.ok) throw new ConvertError('cv.err.font')
      return new Uint8Array(await r.arrayBuffer())
    })
    fontCache.set(file, p)
  }
  return p
}
const env: Env = { loadFont, canvas: browserCanvas as never, ocr: tesseractFactory }

let counter = 0
const uid = () => `f-${Date.now().toString(36)}-${(counter++).toString(36)}`

const toMsg = (e: unknown): Msg => (e instanceof ApiError ? e.msg : e instanceof ConvertError ? { key: e.key, vars: e.vars } : { key: 'err.withDetail', vars: { detail: e instanceof Error ? e.message : String(e) } })

const isImage = (o: WorkOutput) => /^(PNG|JPG)$/.test(o.format)

export function Workspace<O>({ def }: { def: ToolUi<O> }) {
  const { t, m, fmt } = useI18n()
  const plan = useBatchPlan()
  const costText = usePriceText()
  const [items, setItems] = useState<Item[]>([])
  const [opts, setOpts] = useState<O>(def.defaults)
  const [outputs, setOutputs] = useState<WorkOutput[]>([])
  const [notes, setNotes] = useState<Msg[]>([])
  const [runError, setRunError] = useState<Msg | null>(null)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const itemsRef = useRef(items)
  useEffect(() => {
    itemsRef.current = items
  }, [items])

  const ops = def.ops?.(opts) ?? []
  const ready = items.filter((i) => !i.error)
  const blocked = def.check?.(ready, opts) ?? null

  const add = async (files: File[]) => {
    const current = itemsRef.current.filter((i) => !i.error).length
    const room = def.multiple ? Math.max(0, plan.limits.maxFiles - current) : 1
    const next: Item[] = []
    let used = 0
    for (const file of files) {
      const err = await validateInput(file, def.accept)
      if (err) {
        next.push({ id: uid(), file, status: 'failed', error: { key: err.key, vars: err.vars } })
        continue
      }
      if (file.size > plan.limits.maxFileBytes || (def.multiple && used >= room)) {
        plan.addHeld([file])
        continue
      }
      used++
      const item: Item = { id: uid(), file, status: 'ready' }
      if (extOf(file.name) === 'pdf') {
        try {
          item.pages = await pdfPageCount(new Uint8Array(await file.arrayBuffer()))
        } catch (e) {
          item.error = toMsg(e)
          item.status = 'failed'
        }
      }
      next.push(item)
    }
    setOutputs([])
    setNotes([])
    setRunError(null)
    setItems((prev) => (def.multiple ? [...prev, ...next] : next))
  }

  // After a Pro batch session is unlocked, add the files that were held back.
  useEffect(() => {
    if (plan.pro) {
      const files = plan.takeHeld()
      if (files.length) void add(files)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.pro])

  // Image results get small previews. They are released as soon as the results change or the page closes.
  useEffect(() => {
    const urls: Record<string, string> = {}
    outputs.filter(isImage).slice(0, 24).forEach((o) => (urls[o.name] = URL.createObjectURL(o.blob)))
    setPreviews(urls)
    return () => Object.values(urls).forEach((u) => URL.revokeObjectURL(u))
  }, [outputs])

  const move = (i: number, d: -1 | 1) =>
    setItems((prev) => {
      const j = i + d
      if (j < 0 || j >= prev.length) return prev
      const copy = [...prev]
      ;[copy[i], copy[j]] = [copy[j], copy[i]]
      return copy
    })

  const run = async () => {
    if (running || ready.length === 0 || blocked) return
    setRunning(true)
    setRunError(null)
    setOutputs([])
    setNotes([])
    setProgress(0)
    setItems((prev) => prev.map((i) => (i.error ? i : { ...i, status: 'processing' })))
    try {
      const produce = async () => {
        const inputs = await Promise.all(ready.map(async (i) => ({ file: i.file, bytes: new Uint8Array(await i.file.arrayBuffer()) })))
        const result = await def.run({ inputs, opts, env, progress: setProgress })
        // No usable output means the run failed: the error is thrown so the tool reports it (a paid unlock stays valid for a free retry).
        if (result.outputs.length === 0) {
          const first = result.errors[0]
          setItems((prev) => prev.map((i) => (i.error ? i : { ...i, status: 'failed', error: result.errors.find((e) => e.name === i.file.name)?.msg })))
          throw first ? new ConvertError(first.msg.key, first.msg.vars) : new ConvertError('cv.err.noOutput')
        }
        return result
      }
      // Premium runs: the payment is verified on-chain first; the unlock stays valid if production fails, so retrying is free.
      const result = ops.length ? await plan.px.run(ops, produce) : await produce()
      const failedNames = new Set(result.errors.map((e) => e.name))
      setItems((prev) =>
        prev.map((i) => {
          if (i.error) return i
          const err = result.errors.find((e) => e.name === i.file.name)
          return failedNames.has(i.file.name) ? { ...i, status: 'failed', error: err?.msg } : { ...i, status: 'done' }
        }),
      )
      setOutputs(result.outputs)
      setNotes(result.notes)
      setProgress(1)
    } catch (e) {
      setItems((prev) => prev.map((i) => (i.status === 'processing' ? { ...i, status: 'ready' } : i)))
      setRunError(toMsg(e))
    } finally {
      setRunning(false)
    }
  }

  const downloadOne = (o: WorkOutput) => {
    downloadBlob(o.blob, o.name)
    void plan.settle()
  }

  const downloadAll = async () => {
    if (outputs.length === 1) return downloadOne(outputs[0])
    const build = async () => {
      downloadBlob(await zipBlobs(outputs.map((o) => ({ name: o.name, blob: o.blob }))), 'goldenpixel-converted.zip')
      toast.success(translate('common.zipSaved'))
    }
    try {
      // ZIP is included in a Pro batch session; otherwise it is a priced operation, reserved before the ZIP is built.
      if (plan.pro) {
        await build()
        await plan.settle()
      } else await plan.px.run(['zip'], build)
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : translate('common.zipFail'))
    }
  }

  const totalIn = useMemo(() => ready.reduce((s, i) => s + i.file.size, 0), [ready])
  const formats = def.accept.map((a) => labelOf(a)).join(', ')
  const Options = def.Options

  return (
    <div>
      <BatchUpsell plan={plan} />
      {items.length === 0 ? (
        <Dropzone
          multiple={def.multiple}
          accept={def.accept.map((a) => `.${a}`).join(',')}
          onFiles={add}
          title={t('cv.drop.title', { formats })}
          hint={t('cv.drop.hint', { files: plan.limits.maxFiles, mb: Math.round(plan.limits.maxFileBytes / 1048576) })}
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
          <div className="min-w-0">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="gp-eyebrow">{t('cv.inputs', { n: items.length })}</h3>
              <PickButton onFiles={add} multiple={def.multiple} accept={def.accept.map((a) => `.${a}`).join(',')}>
                <ImagePlus size={14} /> {def.multiple ? t('cv.addFiles') : t('common.change')}
              </PickButton>
            </div>
            <ul className="grid gap-2.5">
              {items.map((it, idx) => (
                <li key={it.id} className="gp-card flex items-center gap-3 p-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[var(--gp-line)] bg-black/30 text-[var(--gp-gold)]">
                    <FileText size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{it.file.name}</p>
                    <p className="flex flex-wrap items-center gap-x-2 text-xs tabular-nums text-mist">
                      <span className="gp-chip !px-1.5 !py-0">{labelOf(extOf(it.file.name))}</span>
                      <span>{fmt.bytes(it.file.size)}</span>
                      {it.pages !== undefined && <span>{it.pages === 1 ? t('cv.pages.one') : t('cv.pages.many', { n: it.pages })}</span>}
                    </p>
                    {it.error && (
                      <p className="mt-1 flex items-start gap-1 text-xs text-red-300" role="alert">
                        <XCircle size={13} className="mt-0.5 shrink-0" /> {m(it.error)}
                      </p>
                    )}
                  </div>
                  <StatusBadge status={it.error ? 'failed' : it.status} />
                  {def.ordered && (
                    <span className="flex">
                      <button type="button" className="grid h-9 w-8 place-items-center text-mist hover:text-[var(--gp-gold)] disabled:opacity-30" disabled={idx === 0} aria-label={t('cv.moveUp', { name: it.file.name })} onClick={() => move(idx, -1)}>
                        <ArrowUp size={15} />
                      </button>
                      <button type="button" className="grid h-9 w-8 place-items-center text-mist hover:text-[var(--gp-gold)] disabled:opacity-30" disabled={idx === items.length - 1} aria-label={t('cv.moveDown', { name: it.file.name })} onClick={() => move(idx, 1)}>
                        <ArrowDown size={15} />
                      </button>
                    </span>
                  )}
                  <button type="button" className="grid h-10 w-10 place-items-center text-mist hover:text-red-400" aria-label={t('common.remove', { name: it.file.name })} onClick={() => setItems((p) => p.filter((x) => x.id !== it.id))}>
                    <Trash2 size={15} />
                  </button>
                </li>
              ))}
            </ul>

            {runError && (
              <div className="mt-4">
                <Notice tone="error">{m(runError)}</Notice>
              </div>
            )}
            {notes.length > 0 && (
              <div className="mt-4">
                <Notice tone="warn">
                  <p className="flex items-center gap-1.5 font-semibold">
                    <AlertTriangle size={14} /> {t('cv.notes')}
                  </p>
                  <ul className="mt-1 list-inside list-disc">
                    {notes.map((n, i) => (
                      <li key={i}>{m(n)}</li>
                    ))}
                  </ul>
                </Notice>
              </div>
            )}

            {outputs.length > 0 && (
              <section className="mt-6" aria-label={t('cv.results', { n: outputs.length })}>
                <h3 className="gp-eyebrow mb-3 flex items-center gap-1.5">
                  <CheckCircle2 size={14} className="text-emerald-400" /> {t('cv.results', { n: outputs.length })}
                </h3>
                <ul className="grid gap-2.5">
                  {outputs.map((o) => (
                    <li key={o.name} className="gp-card flex items-center gap-3 p-3">
                      {previews[o.name] ? (
                        <img src={previews[o.name]} alt="" className="h-11 w-11 shrink-0 rounded-xl object-cover" />
                      ) : (
                        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[var(--gp-line)] bg-black/30 text-emerald-400">
                          <FileText size={18} />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{o.name}</p>
                        <p className="flex items-center gap-2 text-xs tabular-nums text-mist">
                          <span className="gp-chip !px-1.5 !py-0">{o.format}</span>
                          <span className="text-ink">{fmt.bytes(o.blob.size)}</span>
                        </p>
                      </div>
                      <button type="button" className="gp-btn gp-btn-ghost gp-btn-sm" aria-label={t('common.downloadFile', { name: o.name })} onClick={() => downloadOne(o)}>
                        <Download size={14} /> <span className="hidden sm:inline">{t('common.save')}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="gp-btn gp-btn-outline gp-btn-sm mt-3"
                  onClick={() => {
                    setItems([])
                    setOutputs([])
                    setNotes([])
                    setRunError(null)
                    setProgress(0)
                  }}
                >
                  <RotateCcw size={14} /> {t('cv.another')}
                </button>
              </section>
            )}
          </div>

          <aside className="grid content-start gap-4" aria-label={t('cv.settings.aria')}>
            <div className="gp-card grid gap-4 p-4 sm:p-5">
              {def.limits && <Notice tone="warn">{t(def.limits)}</Notice>}
              {Options && <Options opts={opts} set={(p) => setOpts((o) => ({ ...o, ...p }))} items={ready} />}
              <p className="text-xs tabular-nums text-mist">{t('cv.summary', { n: ready.length, size: fmt.bytes(totalIn) })}</p>
              {blocked && <p className="text-sm text-amber-300" role="status">{m(blocked)}</p>}
              {running && (
                <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label={t('cv.progress')}>
                  <div className="gp-progress"><span style={{ width: `${Math.max(4, Math.round(progress * 100))}%` }} /></div>
                  <p className="mt-1 text-xs tabular-nums text-mist">{t('cv.progressPct', { pct: fmt.number(Math.round(progress * 100), 0) })}</p>
                </div>
              )}
              <button type="button" className="gp-btn gp-btn-primary w-full" disabled={running || ready.length === 0 || Boolean(blocked) || (ops.length > 0 && !plan.px.available)} onClick={() => void run()}>
                {running ? <Spinner label={t('cv.working')} /> : ops.length ? t('cv.run.premium', { action: t(def.action), cost: costText(ops) }) : t(def.action)}
              </button>
              {ops.length > 0 && <PremiumNote ops={ops} px={plan.px} />}
              {outputs.length > 1 && (
                <>
                  <button type="button" className="gp-btn gp-btn-ghost w-full" onClick={() => void downloadAll()}>
                    <Archive size={16} /> {plan.pro ? t('common.downloadAllZip') : t('zip.cta', { cost: costText(['zip']) })}
                  </button>
                  {!plan.pro && <PremiumNote ops={['zip']} px={plan.px} />}
                </>
              )}
              {outputs.length === 1 && (
                <button type="button" className="gp-btn gp-btn-primary w-full" onClick={() => downloadOne(outputs[0])}>
                  <Download size={16} /> {t('convert.downloadFile')}
                </button>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: Item['status'] }) {
  const { t } = useI18n()
  const map = {
    ready: ['cv.status.ready', 'text-mist'],
    processing: ['cv.status.processing', 'text-[var(--gp-gold)]'],
    done: ['cv.status.done', 'text-emerald-400'],
    failed: ['cv.status.failed', 'text-red-300'],
  } as const
  const [key, color] = map[status]
  return <span className={`hidden shrink-0 text-xs font-medium sm:inline ${color}`}>{t(key)}</span>
}
