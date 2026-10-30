import { useEffect, useRef, useState } from 'react'
import { Archive, Download, ImagePlus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Dropzone, Field, Panel, PickButton, Segmented, Slider } from '@/components/ui'
import { EXT, baseName, canvasToBlob, downloadBlob, loadWithLimits, makeCanvas, releaseCanvas, revoke, type LoadedImage, type OutFormat } from '@/lib/image'
import { buildPdf, type PdfPage } from '@/lib/pdf'
import { peekHandoff } from '@/lib/tools'
import { translate, useI18n } from '@/i18n'
import { FREE_LIMITS } from '@/config/plans'
import { useBatchPlan } from '@/hooks/useBatchPlan'
import { BatchUpsell } from '@/components/premium/BatchUpsell'
import { PremiumNote, usePriceText } from '@/components/premium/PremiumNote'
import { zipBlobs } from '@/lib/zip'

export type Target = OutFormat | 'pdf'
type Output = { key: string; name: string; blob: Blob; thumb: string; from: string; fromKey?: 'convert.fromImages'; sources: number }

const typeLabel = (t: string) => (t.split('/')[1] ?? 'image').replace('jpeg', 'jpg').toUpperCase()

async function toJpegBytes(im: LoadedImage, quality: number, bg: string) {
  const { canvas, ctx } = makeCanvas(im.width, im.height)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(im.img, 0, 0)
  const { width, height } = canvas
  const blob = await canvasToBlob(canvas, 'jpeg', quality)
  releaseCanvas(canvas)
  return { jpeg: new Uint8Array(await blob.arrayBuffer()), width, height } satisfies PdfPage
}

export function ImageConverter({ initialTarget = 'webp' }: { initialTarget?: Target }) {
  const { t, fmt } = useI18n()
  const plan = useBatchPlan()
  const costText = usePriceText()
  const bgs = [{ value: '#ffffff', label: t('color.white') }, { value: '#000000', label: t('color.black') }, { value: '#f5c542', label: t('color.gold') }]
  const [items, setItems] = useState<LoadedImage[]>([])
  const [target, setTarget] = useState<Target>(initialTarget)
  const [quality, setQuality] = useState(90)
  const [bg, setBg] = useState('#ffffff')
  const [merge, setMerge] = useState(true)
  const [outputs, setOutputs] = useState<Output[]>([])
  const [processing, setProcessing] = useState(false)
  const itemsRef = useRef<LoadedImage[]>([])
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
    const files = peekHandoff('convert')
    if (files.length) void add(files)
    return () => revoke(itemsRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (items.length === 0) {
      setOutputs([])
      return
    }
    let cancelled = false
    setProcessing(true)
    const run = async () => {
      try {
        const next: Output[] = []
        if (target === 'pdf') {
          const pages: PdfPage[] = []
          for (const im of items) {
            if (cancelled) return
            const page = await toJpegBytes(im, quality / 100, bg)
            if (merge) pages.push(page)
            else next.push({ key: im.id, name: `${baseName(im.name)}.pdf`, blob: buildPdf([page]), thumb: im.url, from: typeLabel(im.type), sources: 1 })
          }
          if (merge) next.push({ key: 'merged', name: 'goldenpixel-converted.pdf', blob: buildPdf(pages), thumb: items[0].url, from: '', fromKey: 'convert.fromImages', sources: items.length })
        } else {
          for (const im of items) {
            if (cancelled) return
            const { canvas, ctx } = makeCanvas(im.width, im.height)
            if (target === 'jpeg') {
              ctx.fillStyle = bg
              ctx.fillRect(0, 0, canvas.width, canvas.height)
            }
            ctx.drawImage(im.img, 0, 0)
            const blob = await canvasToBlob(canvas, target, quality / 100)
            releaseCanvas(canvas)
            next.push({ key: im.id, name: `${baseName(im.name)}.${EXT[target]}`, blob, thumb: im.url, from: typeLabel(im.type), sources: 1 })
          }
        }
        if (!cancelled) {
          setOutputs(next)
          setProcessing(false)
        }
      } catch (e) {
        if (!cancelled) {
          toast.error(e instanceof Error ? e.message : translate('convert.fail'))
          setProcessing(false)
        }
      }
    }
    const timer = setTimeout(() => void run(), 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [items, target, quality, bg, merge])

  const remove = (id: string) => {
    const im = items.find((i) => i.id === id)
    if (im) revoke([im])
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  const downloadAll = async () => {
    if (outputs.length === 1) {
      downloadBlob(outputs[0].blob, outputs[0].name)
      return void plan.settle()
    }
    const buildZip = async () => {
      downloadBlob(await zipBlobs(outputs.map((o) => ({ name: o.name, blob: o.blob }))), 'goldenpixel-converted.zip')
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

  const downloadOne = (o: Output) => {
    downloadBlob(o.blob, o.name)
    void plan.settle()
  }

  const lossy = target === 'jpeg' || target === 'webp' || target === 'pdf'
  const needsBg = target === 'jpeg' || target === 'pdf'
  const label = target === 'jpeg' ? 'JPG' : target.toUpperCase()

  return (
    <div>
      <BatchUpsell plan={plan} />
      {items.length === 0 ? (
        <Dropzone onFiles={add} title={t('convert.drop.title')} hint={t('convert.drop.hint', { files: FREE_LIMITS.maxFiles, mb: FREE_LIMITS.maxFileBytes / 1048576 })} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
          <div className="min-w-0">
            <div className="gp-card p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="gp-eyebrow">{t('convert.sources', { n: items.length })}</h3>
                <PickButton onFiles={add} multiple>
                  <ImagePlus size={14} /> {t('common.addImages')}
                </PickButton>
              </div>
              <ul className="grid gap-2.5">
                {items.map((im) => (
                  <li key={im.id} className="gp-inner flex items-center gap-3 p-2.5">
                    <img src={im.url} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{im.name}</p>
                      <p className="text-xs tabular-nums text-mist">
                        {typeLabel(im.type)} · {fmt.number(im.width, 0)} × {fmt.number(im.height, 0)} · {fmt.bytes(im.size)}
                      </p>
                    </div>
                    <button type="button" className="grid h-10 w-10 place-items-center text-mist hover:text-red-400" aria-label={t('common.remove', { name: im.name })} onClick={() => remove(im.id)}>
                      <Trash2 size={15} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="gp-card mt-4 p-4">
              <h3 className="gp-eyebrow mb-3">{t('convert.convertedTo', { format: label })}</h3>
              {processing && outputs.length === 0 ? (
                <p className="py-6 text-center text-sm text-mist" role="status">{t('convert.working')}</p>
              ) : (
                <ul className="grid gap-2.5" aria-busy={processing}>
                  {outputs.map((o) => (
                    <li key={o.key} className="gp-inner flex items-center gap-3 p-2.5">
                      <img src={o.thumb} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{o.name}</p>
                        <p className="text-xs tabular-nums text-mist">
                          {o.fromKey ? t(o.fromKey, { n: o.sources }) : o.from} → {label} · <span className="text-ink">{fmt.bytes(o.blob.size)}</span>
                        </p>
                      </div>
                      <button type="button" className="gp-btn gp-btn-ghost gp-btn-sm" aria-label={t('common.downloadFile', { name: o.name })} onClick={() => downloadOne(o)}>
                        <Download size={15} /> <span className="hidden sm:inline">{t('common.save')}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <aside className="grid content-start gap-4" aria-label={t('convert.settings.aria')}>
            <Panel title={t('convert.to')}>
              <Segmented label={t('convert.targetFormat')} value={target} onChange={setTarget} options={[{ value: 'png', label: 'PNG' }, { value: 'jpeg', label: 'JPG' }, { value: 'webp', label: 'WebP' }, { value: 'pdf', label: 'PDF' }]} />
              {lossy && <Slider label={t('common.quality')} value={quality} min={40} max={100} unit="%" onChange={setQuality} />}
              {needsBg && (
                <Field label={t('convert.transparent')}>
                  <Segmented label={t('collage.background')} value={bg} onChange={setBg} options={bgs} />
                </Field>
              )}
              {target === 'pdf' && items.length > 1 && (
                <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 text-sm font-medium">
                  {t('convert.merge')}
                  <input type="checkbox" checked={merge} onChange={(e) => setMerge(e.target.checked)} className="h-5 w-5 accent-[#f5c542]" />
                </label>
              )}
            </Panel>

            <Panel title={t('common.download')}>
              <p className="text-sm text-mist" role="status">
                {processing ? t('convert.working') : outputs.length === 1 ? t('convert.ready.one') : t('convert.ready.many', { n: outputs.length })}
              </p>
              <button type="button" className="gp-btn gp-btn-primary w-full" disabled={processing || outputs.length === 0} onClick={() => void downloadAll()}>
                {outputs.length > 1 ? <Archive size={16} /> : <Download size={16} />}
                {outputs.length > 1 ? (plan.pro ? t('common.downloadAllZip') : t('zip.cta', { cost: costText(['zip']) })) : t('convert.downloadFile')}
              </button>
              {outputs.length > 1 && !plan.pro && <PremiumNote ops={['zip']} px={plan.px} />}
            </Panel>
          </aside>
        </div>
      )}
    </div>
  )
}
