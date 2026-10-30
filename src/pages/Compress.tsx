import { useEffect, useRef, useState } from 'react'
import { Archive, Download, ImagePlus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { CompareSlider, Dropzone, Field, Panel, PickButton, Segmented, Slider, ToolHeader } from '@/components/ui'
import { EXT, baseName, canvasToBlob, downloadBlob, fitWithin, formatFromMime, loadWithLimits, makeCanvas, releaseCanvas, revoke, type LoadedImage, type OutFormat } from '@/lib/image'
import { peekHandoff } from '@/lib/tools'
import { translate, useI18n } from '@/i18n'
import { FREE_LIMITS } from '@/config/plans'
import { useBatchPlan } from '@/hooks/useBatchPlan'
import { BatchUpsell } from '@/components/premium/BatchUpsell'
import { PremiumNote, usePriceText } from '@/components/premium/PremiumNote'
import { zipBlobs } from '@/lib/zip'

type Result = { blob: Blob; url: string; format: OutFormat; width: number; height: number }
type Mode = 'keep' | 'webp' | 'jpeg'


export default function Compress() {
  const { t, fmt } = useI18n()
  const plan = useBatchPlan()
  const costText = usePriceText()
  const maxDims = [{ value: 0, label: t('compress.dim.original') }, ...[2560, 1920, 1280, 800].map((v) => ({ value: v, label: String(v) }))]
  const [items, setItems] = useState<LoadedImage[]>([])
  const [results, setResults] = useState<Record<string, Result>>({})
  const [quality, setQuality] = useState(75)
  const [maxDim, setMaxDim] = useState(0)
  const [mode, setMode] = useState<Mode>('keep')
  const [selected, setSelected] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const itemsRef = useRef<LoadedImage[]>([])
  const resultsRef = useRef<Record<string, Result>>({})
  itemsRef.current = items

  const add = async (files: File[]) => {
    // Everything is validated and decoded locally. Valid files beyond the plan limits are held, not discarded.
    const r = await loadWithLimits(files, { maxFiles: Math.max(0, plan.limits.maxFiles - itemsRef.current.length), maxBytes: plan.limits.maxFileBytes })
    if (r.images.length) setItems((prev) => [...prev, ...r.images])
    if (r.overCount.length || r.overSize.length) plan.addHeld([...r.overSize, ...r.overCount])
  }

  // After a Pro batch session is unlocked, load the files that were held back.
  useEffect(() => {
    if (plan.pro) {
      const files = plan.takeHeld()
      if (files.length) void add(files)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.pro])

  useEffect(() => {
    const files = peekHandoff('compress')
    if (files.length) void add(files)
    return () => {
      revoke(itemsRef.current)
      Object.values(resultsRef.current).forEach((r) => URL.revokeObjectURL(r.url))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (items.length === 0) {
      Object.values(resultsRef.current).forEach((r) => URL.revokeObjectURL(r.url))
      resultsRef.current = {}
      setResults({})
      return
    }
    let cancelled = false
    setProcessing(true)
    const run = async () => {
      const next: Record<string, Result> = {}
      for (const im of items) {
        if (cancelled) return
        try {
          const format: OutFormat = mode === 'keep' ? formatFromMime(im.type) : mode
          const { w, h } = fitWithin(im.width, im.height, maxDim)
          const { canvas, ctx } = makeCanvas(w, h)
          if (format === 'jpeg') {
            ctx.fillStyle = '#ffffff'
            ctx.fillRect(0, 0, canvas.width, canvas.height)
          }
          ctx.drawImage(im.img, 0, 0, canvas.width, canvas.height)
          const { width: cw, height: chh } = canvas
          const blob = await canvasToBlob(canvas, format, quality / 100)
          releaseCanvas(canvas)
          next[im.id] = { blob, url: URL.createObjectURL(blob), format, width: cw, height: chh }
        } catch {
          toast.error(translate('compress.fail', { name: im.name }))
        }
      }
      if (cancelled) {
        Object.values(next).forEach((r) => URL.revokeObjectURL(r.url))
        return
      }
      Object.values(resultsRef.current).forEach((r) => URL.revokeObjectURL(r.url))
      resultsRef.current = next
      setResults(next)
      setProcessing(false)
    }
    const timer = setTimeout(() => void run(), 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [items, quality, maxDim, mode])

  const remove = (id: string) => {
    const im = items.find((i) => i.id === id)
    if (im) revoke([im])
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  const active = items.find((i) => i.id === selected) ?? items[0]
  const activeResult = active ? results[active.id] : undefined

  const totalBefore = items.reduce((s, i) => s + (results[i.id] ? i.size : 0), 0)
  const totalAfter = items.reduce((s, i) => s + (results[i.id]?.blob.size ?? 0), 0)
  const saved = totalBefore > 0 ? Math.round((1 - totalAfter / totalBefore) * 100) : 0

  const fileName = (im: LoadedImage, r: Result) => `${baseName(im.name)}-compressed.${EXT[r.format]}`

  const downloadAll = async () => {
    const ready = items.filter((i) => results[i.id])
    if (!ready.length) return
    if (ready.length === 1) {
      downloadBlob(results[ready[0].id].blob, fileName(ready[0], results[ready[0].id]))
      return void plan.settle()
    }
    const buildZip = async () => {
      const zip = await zipBlobs(ready.map((i) => ({ name: fileName(i, results[i.id]), blob: results[i.id].blob })))
      downloadBlob(zip, 'goldenpixel-compressed.zip')
      toast.success(translate('common.zipSaved'))
    }
    try {
      // ZIP is included in a Pro batch session; otherwise it is a priced premium operation reserved before the ZIP is built.
      if (plan.pro) {
        await buildZip()
        await plan.settle()
      } else await plan.px.run(['zip'], buildZip)
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : translate('common.zipFail'))
    }
  }

  const downloadOne = (im: LoadedImage, r: Result) => {
    downloadBlob(r.blob, fileName(im, r))
    void plan.settle()
  }

  return (
    <div className="gp-page mx-auto max-w-6xl px-4 pb-8 pt-8 sm:px-6">
      <ToolHeader
        id="compress"
        actions={
          items.length > 0 && (
            <PickButton onFiles={add} multiple>
              <ImagePlus size={14} /> {t('common.addImages')}
            </PickButton>
          )
        }
      />

      <BatchUpsell plan={plan} />
      {items.length === 0 ? (
        <Dropzone onFiles={add} title={t('compress.drop.title')} hint={t('compress.drop.hint', { files: FREE_LIMITS.maxFiles, mb: FREE_LIMITS.maxFileBytes / 1048576 })} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
          <div className="min-w-0">
            {active && activeResult && (
              <div className="gp-card p-3 sm:p-4">
                <CompareSlider before={active.url} after={activeResult.url} width={active.width} height={active.height} />
                <p className="mt-3 truncate text-sm text-mist">
                  <span className="text-ink">{active.name}</span> · {t('compress.dragHint')}
                </p>
              </div>
            )}
            {!activeResult && (
              <div className="gp-card grid min-h-[240px] place-items-center p-6 text-sm text-mist" role="status">
                {t('compress.working')}
              </div>
            )}

            <ul className="mt-4 grid gap-2.5">
              {items.map((im) => {
                const r = results[im.id]
                const delta = r ? Math.round((1 - r.blob.size / im.size) * 100) : 0
                const isActive = active?.id === im.id
                return (
                  <li key={im.id} className={`gp-inner flex items-center gap-3 p-2.5 transition-colors ${isActive ? '!border-[var(--gp-line-strong)] bg-[rgba(245,197,66,0.06)]' : ''}`}>
                    <button type="button" onClick={() => setSelected(im.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-label={t('compress.preview', { name: im.name })} aria-pressed={isActive}>
                      <img src={im.url} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{im.name}</span>
                        <span className="block text-xs tabular-nums text-mist">
                          {fmt.bytes(im.size)}
                          {r && <> → <span className="text-ink">{fmt.bytes(r.blob.size)}</span></>}
                        </span>
                      </span>
                    </button>
                    {r && (
                      <span className={`gp-chip shrink-0 tabular-nums ${delta < 0 ? '!border-red-400/30 !bg-red-400/10 !text-red-300' : ''}`}>
                        {delta >= 0 ? `-${fmt.number(delta, 0)}%` : `+${fmt.number(Math.abs(delta), 0)}%`}
                      </span>
                    )}
                    <button type="button" disabled={!r} className="gp-btn gp-btn-ghost gp-btn-sm !px-0 w-10" aria-label={t('common.downloadFile', { name: im.name })} onClick={() => r && downloadOne(im, r)}>
                      <Download size={15} />
                    </button>
                    <button type="button" className="grid h-10 w-10 place-items-center text-mist hover:text-red-400" aria-label={t('common.remove', { name: im.name })} onClick={() => remove(im.id)}>
                      <Trash2 size={15} />
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>

          <aside className="grid content-start gap-4" aria-label={t('compress.settings.aria')}>
            <Panel title={t('common.settings')}>
              <Field label={t('compress.outFormat')}>
                <Segmented label={t('compress.outFormat')} value={mode} onChange={setMode} options={[{ value: 'keep', label: t('compress.keep') }, { value: 'webp', label: 'WebP' }, { value: 'jpeg', label: 'JPG' }]} />
              </Field>
              <Slider label={t('common.quality')} value={quality} min={10} max={100} unit="%" onChange={setQuality} />
              {mode === 'keep' && <p className="-mt-2 text-xs text-mist">{t('compress.pngNote')}</p>}
              <Field label={t('compress.maxDim')}>
                <div className="grid grid-cols-5 gap-1">
                  <Segmented label={t('compress.maxDim')} value={maxDim} onChange={setMaxDim} options={maxDims} />
                </div>
              </Field>
            </Panel>

            <Panel title={t('compress.summary')}>
              <dl className="grid grid-cols-2 gap-3 text-sm tabular-nums">
                <div>
                  <dt className="text-mist">{t('compress.before')}</dt>
                  <dd className="font-display text-lg font-semibold">{fmt.bytes(totalBefore)}</dd>
                </div>
                <div>
                  <dt className="text-mist">{t('compress.after')}</dt>
                  <dd className="font-display text-lg font-semibold text-[var(--gp-gold)]">{fmt.bytes(totalAfter)}</dd>
                </div>
              </dl>
              <p className="text-sm text-mist" role="status">
                {processing ? t('compress.optimizing') : totalBefore === 0 ? t('compress.waiting') : saved >= 0 ? (items.length === 1 ? t('compress.saved.one', { pct: fmt.number(saved, 0) }) : t('compress.saved.many', { pct: fmt.number(saved, 0), n: items.length })) : t('compress.larger')}
              </p>
              <button type="button" className="gp-btn gp-btn-primary w-full" disabled={processing || totalAfter === 0} onClick={() => void downloadAll()}>
                {items.length > 1 ? <Archive size={16} /> : <Download size={16} />}
                {items.length > 1 ? (plan.pro ? t('common.downloadAllZip') : t('zip.cta', { cost: costText(['zip']) })) : t('common.downloadImage')}
              </button>
              {items.length > 1 && !plan.pro && <PremiumNote ops={['zip']} px={plan.px} />}
            </Panel>
          </aside>
        </div>
      )}
    </div>
  )
}
