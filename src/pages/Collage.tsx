import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Crown, Download, ImagePlus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Dropzone, Field, Panel, PickButton, Segmented, Slider, ToolHeader } from '@/components/ui'
import { EXT, canvasToBlob, downloadBlob, drawCover, loadImageFiles, makeCanvas, releaseCanvas, revoke, roundRectPath, type LoadedImage, type OutFormat } from '@/lib/image'
import { peekHandoff } from '@/lib/tools'
import { translate, useI18n, type TKey } from '@/i18n'
import { FREE_LIMITS, PREMIUM_COLLAGE_LAYOUTS } from '@/config/plans'
import type { PremiumFeatureId } from '@/config/payments'
import { usePremiumAction } from '@/hooks/usePremiumAction'
import { PremiumNote, usePriceText } from '@/components/premium/PremiumNote'

type Cell = [number, number, number, number]
type Layout = { id: string; name: TKey; cells: Cell[] }

const grid = (cols: number, rows: number): Cell[] =>
  Array.from({ length: cols * rows }, (_, i) => [(i % cols) / cols, Math.floor(i / cols) / rows, 1 / cols, 1 / rows] as Cell)

const LAYOUTS: Layout[] = [
  { id: 'duo-h', name: 'collage.l.duoH', cells: grid(2, 1) },
  { id: 'duo-v', name: 'collage.l.duoV', cells: grid(1, 2) },
  { id: 'trio-row', name: 'collage.l.trio', cells: grid(3, 1) },
  { id: 'quad', name: 'collage.l.quad', cells: grid(2, 2) },
  { id: 'hero-left', name: 'collage.l.heroLeft', cells: [[0, 0, 0.6, 1], [0.6, 0, 0.4, 0.5], [0.6, 0.5, 0.4, 0.5]] },
  { id: 'hero-top', name: 'collage.l.heroTop', cells: [[0, 0, 1, 0.6], [0, 0.6, 0.5, 0.4], [0.5, 0.6, 0.5, 0.4]] },
  { id: 'six', name: 'collage.l.six', cells: grid(3, 2) },
  { id: 'nine', name: 'collage.l.nine', cells: grid(3, 3) },
]

const RATIOS: { value: string; label: string; r: number }[] = [
  { value: '1:1', label: '1:1', r: 1 },
  { value: '4:5', label: '4:5', r: 4 / 5 },
  { value: '4:3', label: '4:3', r: 4 / 3 },
  { value: '16:9', label: '16:9', r: 16 / 9 },
  { value: '9:16', label: '9:16', r: 9 / 16 },
]

const BACKGROUNDS = ['#05050a', '#ffffff', '#f5c542', '#1b1630', '#f4efe3']

type Settings = { layout: string; ratio: string; gap: number; pad: number; radius: number; bg: string }

function drawCollage(canvas: HTMLCanvasElement, images: LoadedImage[], s: Settings, longSide: number, empties: boolean) {
  const ratio = RATIOS.find((r) => r.value === s.ratio)?.r ?? 1
  const W = ratio >= 1 ? longSide : Math.round(longSide * ratio)
  const H = ratio >= 1 ? Math.round(longSide / ratio) : longSide
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const k = longSide / 1000
  const gap = s.gap * k
  const pad = s.pad * k
  const radius = s.radius * k
  ctx.fillStyle = s.bg
  ctx.fillRect(0, 0, W, H)

  const layout = LAYOUTS.find((l) => l.id === s.layout) ?? LAYOUTS[3]
  const ix = pad - gap / 2
  const iy = pad - gap / 2
  const iw = W - 2 * pad + gap
  const ih = H - 2 * pad + gap

  layout.cells.forEach((c, i) => {
    const x = ix + c[0] * iw + gap / 2
    const y = iy + c[1] * ih + gap / 2
    const w = c[2] * iw - gap
    const h = c[3] * ih - gap
    if (w <= 0 || h <= 0) return
    const im = images[i]
    ctx.save()
    roundRectPath(ctx, x, y, w, h, radius)
    ctx.clip()
    if (im) {
      drawCover(ctx, im.img, im.width, im.height, x, y, w, h)
    } else if (empties) {
      ctx.fillStyle = 'rgba(245,197,66,0.08)'
      ctx.fillRect(x, y, w, h)
      ctx.strokeStyle = 'rgba(245,197,66,0.55)'
      ctx.lineWidth = 2 * k
      ctx.setLineDash([10 * k, 8 * k])
      roundRectPath(ctx, x + k, y + k, w - 2 * k, h - 2 * k, radius)
      ctx.stroke()
    }
    ctx.restore()
  })
}

function LayoutThumb({ cells, active }: { cells: Cell[]; active: boolean }) {
  return (
    <svg viewBox="0 0 40 40" className="h-9 w-9" aria-hidden="true">
      {cells.map((c, i) => (
        <rect key={i} x={2 + c[0] * 36 + 0.8} y={2 + c[1] * 36 + 0.8} width={c[2] * 36 - 1.6} height={c[3] * 36 - 1.6} rx={2} fill={active ? '#f5c542' : 'rgba(255,255,255,0.28)'} />
      ))}
    </svg>
  )
}

export default function Collage() {
  const { t } = useI18n()
  const px = usePremiumAction()
  const costText = usePriceText()
  const [images, setImages] = useState<LoadedImage[]>([])
  const [s, setS] = useState<Settings>({ layout: 'quad', ratio: '1:1', gap: 16, pad: 24, radius: 16, bg: '#05050a' })
  const [size, setSize] = useState(1600)
  const [format, setFormat] = useState<OutFormat>('png')
  const [busy, setBusy] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imagesRef = useRef<LoadedImage[]>([])
  imagesRef.current = images

  const add = async (files: File[]) => {
    const room = 9 - imagesRef.current.length
    if (room <= 0) {
      toast.message(translate('collage.max'))
      return
    }
    const loaded = await loadImageFiles(files, room)
    if (loaded.length) setImages((prev) => [...prev, ...loaded].slice(0, 9))
  }

  useEffect(() => {
    const files = peekHandoff('collage')
    if (files.length) void add(files)
    return () => revoke(imagesRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Pick a sensible layout when the first batch arrives.
  const autoPicked = useRef(false)
  useEffect(() => {
    if (images.length > 0 && !autoPicked.current) {
      autoPicked.current = true
      const n = images.length
      const id = n <= 2 ? 'duo-h' : n === 3 ? 'hero-left' : 'quad' // free templates by default
      setS((p) => ({ ...p, layout: id }))
    }
  }, [images.length])

  useEffect(() => {
    if (!canvasRef.current) return
    const id = requestAnimationFrame(() => canvasRef.current && drawCollage(canvasRef.current, images, s, 900, true))
    return () => cancelAnimationFrame(id)
  }, [images, s])

  const move = (i: number, dir: -1 | 1) =>
    setImages((prev) => {
      const j = i + dir
      if (j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  const remove = (i: number) =>
    setImages((prev) => {
      revoke([prev[i]])
      return prev.filter((_, k) => k !== i)
    })

  // What this export would use. Premium items are priced up front; nothing premium is generated before credits are reserved.
  const premiumOps: PremiumFeatureId[] = []
  if (PREMIUM_COLLAGE_LAYOUTS.includes(s.layout)) premiumOps.push('advanced-collage')
  if (size > FREE_LIMITS.maxCollageSide) premiumOps.push('hd-export')
  const onlyHd = premiumOps.length === 1 && premiumOps[0] === 'hd-export'

  const exportNow = async (side: number) => {
    const { canvas } = makeCanvas(1, 1)
    drawCollage(canvas, images, s, side, false)
    const blob = await canvasToBlob(canvas, format, 0.92)
    releaseCanvas(canvas)
    downloadBlob(blob, `goldenpixel-collage.${EXT[format]}`)
    toast.success(translate('collage.saved'))
  }

  const download = async (free = false) => {
    setBusy(true)
    try {
      if (free) await exportNow(Math.min(size, FREE_LIMITS.maxCollageSide))
      else if (premiumOps.length) await px.run(premiumOps, () => exportNow(size))
      else await exportNow(size)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : translate('err.exportFailed'))
    } finally {
      setBusy(false)
    }
  }

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((p) => ({ ...p, [k]: v }))
  const cellCount = LAYOUTS.find((l) => l.id === s.layout)?.cells.length ?? 0

  return (
    <div className="gp-page mx-auto max-w-6xl px-4 pb-8 pt-8 sm:px-6">
      <ToolHeader
        id="collage"
        actions={
          images.length > 0 && (
            <PickButton onFiles={add} multiple>
              <ImagePlus size={14} /> {t('common.addImages')}
            </PickButton>
          )
        }
      />

      {images.length === 0 ? (
        <Dropzone onFiles={add} title={t('collage.drop.title')} hint={t('collage.drop.hint')} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
          <div className="min-w-0">
            <div className="gp-card p-3 sm:p-4">
              <div className="gp-checker grid place-items-center overflow-hidden rounded-xl p-2 sm:p-4">
                <canvas ref={canvasRef} className="max-h-[65vh] max-w-full rounded-md shadow-[0_10px_50px_rgba(0,0,0,0.6)]" aria-label={t('collage.preview.aria')} />
              </div>
            </div>

            <div className="gp-card mt-4 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="gp-eyebrow">{t('collage.images', { n: images.length })}</h3>
                <p className="text-xs text-mist">{cellCount > images.length ? (cellCount - images.length === 1 ? t('collage.empty.one') : t('collage.empty.many', { n: cellCount - images.length })) : t('collage.orderHint')}</p>
              </div>
              <ul className="grid grid-cols-3 gap-3 sm:grid-cols-5 md:grid-cols-6">
                {images.map((im, i) => (
                  <li key={im.id} className="gp-inner overflow-hidden">
                    <div className="relative aspect-square">
                      <img src={im.url} alt={im.name} className="h-full w-full object-cover" />
                      <span className="absolute left-1 top-1 grid h-5 min-w-5 place-items-center rounded-full bg-black/75 px-1 text-[10px] font-bold tabular-nums text-[var(--gp-gold)]">{i + 1}</span>
                    </div>
                    <div className="grid grid-cols-3">
                      <button type="button" className="grid min-h-[40px] place-items-center text-mist hover:text-[var(--gp-gold)] disabled:opacity-30" disabled={i === 0} aria-label={t('collage.moveEarlier', { name: im.name })} onClick={() => move(i, -1)}><ArrowLeft size={14} /></button>
                      <button type="button" className="grid min-h-[40px] place-items-center text-mist hover:text-red-400" aria-label={t('common.remove', { name: im.name })} onClick={() => remove(i)}><Trash2 size={14} /></button>
                      <button type="button" className="grid min-h-[40px] place-items-center text-mist hover:text-[var(--gp-gold)] disabled:opacity-30" disabled={i === images.length - 1} aria-label={t('collage.moveLater', { name: im.name })} onClick={() => move(i, 1)}><ArrowRight size={14} /></button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <aside className="grid content-start gap-4" aria-label={t('collage.settings.aria')}>
            <Panel title={t('collage.layout')}>
              <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label={t('collage.layout')}>
                {LAYOUTS.map((l) => (
                  <button key={l.id} type="button" role="radio" aria-checked={s.layout === l.id} title={PREMIUM_COLLAGE_LAYOUTS.includes(l.id) ? `${t(l.name)} · ${t('collage.premiumTemplate')}` : t(l.name)} aria-label={PREMIUM_COLLAGE_LAYOUTS.includes(l.id) ? `${t(l.name)} · ${t('collage.premiumTemplate')}` : t(l.name)} onClick={() => set('layout', l.id)} className={`relative grid min-h-[52px] place-items-center rounded-xl border transition-colors ${s.layout === l.id ? 'border-[var(--gp-gold)] bg-[rgba(245,197,66,0.1)]' : 'border-white/10 hover:border-[var(--gp-line-strong)]'}`}>
                    <LayoutThumb cells={l.cells} active={s.layout === l.id} />
                    {PREMIUM_COLLAGE_LAYOUTS.includes(l.id) && <Crown size={10} aria-hidden="true" className="absolute right-1 top-1 text-[var(--gp-gold)]" />}
                  </button>
                ))}
              </div>
              <Field label={t('collage.shape')}>
                <Segmented label={t('editor.aspect')} value={s.ratio} onChange={(v) => set('ratio', v)} options={RATIOS.map((r) => ({ value: r.value, label: r.label }))} />
              </Field>
            </Panel>

            <Panel title={t('collage.style')}>
              <Slider label={t('collage.spacing')} value={s.gap} min={0} max={60} unit="px" onChange={(v) => set('gap', v)} />
              <Slider label={t('collage.margin')} value={s.pad} min={0} max={100} unit="px" onChange={(v) => set('pad', v)} />
              <Slider label={t('collage.radius')} value={s.radius} min={0} max={80} unit="px" onChange={(v) => set('radius', v)} />
              <Field label={t('collage.background')}>
                <div className="flex flex-wrap items-center gap-2">
                  {BACKGROUNDS.map((c) => (
                    <button key={c} type="button" aria-label={t('collage.bg.aria', { color: c })} aria-pressed={s.bg === c} onClick={() => set('bg', c)} className={`h-9 w-9 rounded-full border-2 transition-transform hover:scale-110 ${s.bg === c ? 'border-[var(--gp-gold)] shadow-[0_0_12px_rgba(245,197,66,0.6)]' : 'border-white/20'}`} style={{ background: c }} />
                  ))}
                  <label className="relative grid h-9 w-9 cursor-pointer place-items-center overflow-hidden rounded-full border-2 border-dashed border-white/30 text-xs text-mist">
                    <span aria-hidden="true">+</span>
                    <span className="sr-only">{t('collage.bg.custom')}</span>
                    <input type="color" value={s.bg} onChange={(e) => set('bg', e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
                  </label>
                </div>
              </Field>
            </Panel>

            <Panel title={t('common.export')}>
              <Segmented label={t('common.format')} value={format} onChange={setFormat} options={[{ value: 'png', label: 'PNG' }, { value: 'jpeg', label: 'JPG' }, { value: 'webp', label: 'WebP' }]} />
              <Field label={t('collage.longest')}>
                <Segmented label={t('collage.exportSize')} value={size} onChange={setSize} options={[{ value: 1080, label: '1080' }, { value: 1600, label: '1600' }, { value: 2400, label: '2400 HD' }]} />
              </Field>
              <button type="button" className="gp-btn gp-btn-primary w-full" disabled={busy || (premiumOps.length > 0 && !px.available)} onClick={() => void download()}>
                <Download size={16} /> {busy ? t('common.preparing') : premiumOps.length ? t('collage.download.premium', { cost: costText(premiumOps) }) : t('collage.download')}
              </button>
              {onlyHd && (
                <button type="button" className="gp-btn gp-btn-ghost w-full" disabled={busy} onClick={() => void download(true)}>
                  {t('collage.download.free', { side: FREE_LIMITS.maxCollageSide })}
                </button>
              )}
              {premiumOps.length > 0 && (
                <>
                  <ul className="mt-2 list-inside list-disc text-xs text-mist">
                    {premiumOps.includes('advanced-collage') && <li>{t('collage.px.template')}</li>}
                    {premiumOps.includes('hd-export') && <li>{t('collage.px.hd', { side: FREE_LIMITS.maxCollageSide })}</li>}
                  </ul>
                  <PremiumNote ops={premiumOps} px={px} />
                </>
              )}
            </Panel>
          </aside>
        </div>
      )}
    </div>
  )
}
