import { useEffect, useRef, useState } from 'react'
import { Download, FlipHorizontal2, FlipVertical2, ImagePlus, RotateCcw, RotateCw, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { Dropzone, Field, Panel, PickButton, Segmented, Slider, ToolHeader } from '@/components/ui'
import { EXT, baseName, canvasToBlob, downloadBlob, loadImageFiles, makeCanvas, releaseCanvas, revoke, type LoadedImage, type OutFormat } from '@/lib/image'
import { peekHandoff } from '@/lib/tools'
import { translate, useI18n, type TKey } from '@/i18n'
import { FREE_LIMITS } from '@/config/plans'
import { usePremiumAction } from '@/hooks/usePremiumAction'
import { PremiumNote, usePriceText } from '@/components/premium/PremiumNote'

type Adjust = { brightness: number; contrast: number; saturate: number; blur: number; grayscale: number; sepia: number; hue: number }
type EditState = { adj: Adjust; rotation: number; flipX: boolean; flipY: boolean; aspect: string }

const DEFAULT_ADJ: Adjust = { brightness: 100, contrast: 100, saturate: 100, blur: 0, grayscale: 0, sepia: 0, hue: 0 }
const DEFAULT_STATE: EditState = { adj: DEFAULT_ADJ, rotation: 0, flipX: false, flipY: false, aspect: 'original' }

const PRESETS: { name: TKey; adj: Adjust }[] = [
  { name: 'preset.original', adj: DEFAULT_ADJ },
  { name: 'preset.golden', adj: { ...DEFAULT_ADJ, brightness: 105, contrast: 108, saturate: 122, sepia: 24, hue: -8 } },
  { name: 'preset.noir', adj: { ...DEFAULT_ADJ, grayscale: 100, contrast: 125, brightness: 95 } },
  { name: 'preset.vivid', adj: { ...DEFAULT_ADJ, saturate: 150, contrast: 112 } },
  { name: 'preset.fade', adj: { ...DEFAULT_ADJ, contrast: 88, brightness: 108, saturate: 85, sepia: 10 } },
]

const ASPECTS: { value: string; label: TKey | { raw: string }; ratio: number | null }[] = [
  { value: 'original', label: 'editor.aspect.free', ratio: null },
  { value: '1:1', label: { raw: '1:1' }, ratio: 1 },
  { value: '4:3', label: { raw: '4:3' }, ratio: 4 / 3 },
  { value: '3:4', label: { raw: '3:4' }, ratio: 3 / 4 },
  { value: '16:9', label: { raw: '16:9' }, ratio: 16 / 9 },
  { value: '9:16', label: { raw: '9:16' }, ratio: 9 / 16 },
]

function geometry(img: LoadedImage, s: EditState) {
  const ratio = ASPECTS.find((a) => a.value === s.aspect)?.ratio ?? null
  let sw = img.width
  let sh = img.height
  if (ratio) {
    if (sw / sh > ratio) sw = sh * ratio
    else sh = sw / ratio
  }
  const sx = (img.width - sw) / 2
  const sy = (img.height - sh) / 2
  const turned = s.rotation % 180 !== 0
  return { sx, sy, sw, sh, rw: turned ? sh : sw, rh: turned ? sw : sh }
}

function renderEdit(canvas: HTMLCanvasElement, img: LoadedImage, s: EditState, maxDim: number, scaleMul: number, bg: string | null) {
  const g = geometry(img, s)
  const fit = Math.min(1, maxDim / Math.max(g.rw, g.rh)) * scaleMul
  canvas.width = Math.max(1, Math.round(g.rw * fit))
  canvas.height = Math.max(1, Math.round(g.rh * fit))
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  if (bg) {
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  const a = s.adj
  ctx.save()
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate((s.rotation * Math.PI) / 180)
  ctx.scale(s.flipX ? -1 : 1, s.flipY ? -1 : 1)
  ctx.filter = `brightness(${a.brightness}%) contrast(${a.contrast}%) saturate(${a.saturate}%) grayscale(${a.grayscale}%) sepia(${a.sepia}%) hue-rotate(${a.hue}deg) blur(${a.blur * fit}px)`
  ctx.drawImage(img.img, g.sx, g.sy, g.sw, g.sh, (-g.sw * fit) / 2, (-g.sh * fit) / 2, g.sw * fit, g.sh * fit)
  ctx.restore()
}

export default function Editor() {
  const { t, fmt } = useI18n()
  const px = usePremiumAction()
  const costText = usePriceText()
  const [image, setImage] = useState<LoadedImage | null>(null)
  const [state, setState] = useState<EditState>(DEFAULT_STATE)
  const [comparing, setComparing] = useState(false)
  const [format, setFormat] = useState<OutFormat>('png')
  const [quality, setQuality] = useState(90)
  const [scale, setScale] = useState(100)
  const [busy, setBusy] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imageRef = useRef<LoadedImage | null>(null)
  imageRef.current = image

  const open = async (files: File[]) => {
    const [first] = await loadImageFiles(files.slice(0, 1), 1)
    if (!first) return
    if (imageRef.current) revoke([imageRef.current])
    setImage(first)
    setState(DEFAULT_STATE)
    if (first.type === 'image/jpeg') setFormat('jpeg')
  }

  useEffect(() => {
    const files = peekHandoff('editor')
    if (files.length) void open(files)
    return () => {
      if (imageRef.current) revoke([imageRef.current])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!image || !canvasRef.current) return
    const id = requestAnimationFrame(() => {
      if (canvasRef.current) renderEdit(canvasRef.current, image, comparing ? { ...state, adj: DEFAULT_ADJ } : state, 1400, 1, null)
    })
    return () => cancelAnimationFrame(id)
  }, [image, state, comparing])

  const setAdj = (k: keyof Adjust, v: number) => setState((s) => ({ ...s, adj: { ...s.adj, [k]: v } }))
  const rotate = (dir: 1 | -1) => setState((s) => ({ ...s, rotation: (s.rotation + dir * 90 + 360) % 360 }))

  const out = image ? geometry(image, state) : null
  const outW = out ? Math.round(out.rw * (scale / 100)) : 0
  const outH = out ? Math.round(out.rh * (scale / 100)) : 0

  // Free exports are capped at FREE_LIMITS.maxExportSide; anything larger is a premium "high-resolution export".
  const longest = Math.max(outW, outH)
  const needsHd = longest > FREE_LIMITS.maxExportSide
  const stdFactor = needsHd ? FREE_LIMITS.maxExportSide / longest : 1
  const stdW = Math.round(outW * stdFactor)
  const stdH = Math.round(outH * stdFactor)

  const exportNow = async (factor: number) => {
    if (!image) return
    const { canvas } = makeCanvas(1, 1)
    renderEdit(canvas, image, state, Infinity, (scale / 100) * factor, format === 'jpeg' ? '#ffffff' : null)
    const blob = await canvasToBlob(canvas, format, quality / 100)
    releaseCanvas(canvas)
    downloadBlob(blob, `${baseName(image.name)}-goldenpixel.${EXT[format]}`)
    toast.success(translate('editor.saved'))
  }

  const download = async (hd: boolean) => {
    if (!image) return
    setBusy(true)
    try {
      // HD: credits are reserved (and the wallet signature checked by the server) BEFORE the full-size file is generated.
      if (hd) await px.run(['hd-export'], () => exportNow(1))
      else await exportNow(stdFactor)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : translate('err.exportFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="gp-page mx-auto max-w-6xl px-4 pb-8 pt-8 sm:px-6">
      <ToolHeader
        id="editor"
        actions={
          image && (
            <PickButton onFiles={open}>
              <ImagePlus size={14} /> {t('common.changeImage')}
            </PickButton>
          )
        }
      />

      {!image ? (
        <Dropzone multiple={false} onFiles={open} title={t('editor.drop')} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
          <div className="gp-card min-w-0 p-3 sm:p-4">
            <div className="gp-checker grid min-h-[260px] place-items-center overflow-hidden rounded-xl p-2 sm:min-h-[420px]">
              <canvas ref={canvasRef} className="max-h-[65vh] max-w-full rounded-md object-contain shadow-[0_10px_50px_rgba(0,0,0,0.6)]" aria-label={t('editor.preview.aria')} />
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="min-w-0 truncate text-sm text-mist">
                <span className="text-ink">{image.name}</span> <span className="tabular-nums">· {fmt.number(image.width, 0)} × {fmt.number(image.height, 0)}</span>
              </p>
              <button
                type="button"
                className="gp-btn gp-btn-ghost gp-btn-sm touch-none select-none"
                onPointerDown={() => setComparing(true)}
                onPointerUp={() => setComparing(false)}
                onPointerLeave={() => setComparing(false)}
                onPointerCancel={() => setComparing(false)}
                onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && setComparing(true)}
                onKeyUp={() => setComparing(false)}
              >
                {t('editor.compare')}
              </button>
            </div>
          </div>

          <aside className="grid content-start gap-4" aria-label={t('editor.panel.aria')}>
            <Panel title={t('editor.presets')}>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p) => (
                  <button key={p.name} type="button" className="gp-chip min-h-[36px] cursor-pointer transition-colors hover:border-[var(--gp-gold)]" onClick={() => setState((s) => ({ ...s, adj: p.adj }))}>
                    {t(p.name)}
                  </button>
                ))}
              </div>
            </Panel>

            <Panel
              title={t('editor.adjust')}
              action={
                <button type="button" className="inline-flex min-h-[32px] items-center gap-1 text-xs text-mist hover:text-[var(--gp-gold)]" onClick={() => setState(DEFAULT_STATE)}>
                  <Undo2 size={12} /> {t('editor.resetAll')}
                </button>
              }
            >
              <Slider label={t('editor.brightness')} value={state.adj.brightness} min={50} max={150} unit="%" onChange={(v) => setAdj('brightness', v)} />
              <Slider label={t('editor.contrast')} value={state.adj.contrast} min={50} max={150} unit="%" onChange={(v) => setAdj('contrast', v)} />
              <Slider label={t('editor.saturation')} value={state.adj.saturate} min={0} max={200} unit="%" onChange={(v) => setAdj('saturate', v)} />
              <Slider label={t('editor.warmth')} value={state.adj.sepia} min={0} max={60} unit="%" onChange={(v) => setAdj('sepia', v)} />
              <Slider label={t('editor.hue')} value={state.adj.hue} min={-90} max={90} unit="°" onChange={(v) => setAdj('hue', v)} />
              <Slider label={t('editor.blur')} value={state.adj.blur} min={0} max={12} unit="px" onChange={(v) => setAdj('blur', v)} />
              <Slider label={t('editor.bw')} value={state.adj.grayscale} min={0} max={100} unit="%" onChange={(v) => setAdj('grayscale', v)} />
            </Panel>

            <Panel title={t('editor.crop')}>
              <Field label={t('editor.aspect')}>
                <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6 lg:grid-cols-3">
                  {ASPECTS.map((a) => (
                    <button key={a.value} type="button" aria-pressed={state.aspect === a.value} className={`gp-btn gp-btn-ghost gp-btn-sm !px-2 ${state.aspect === a.value ? '!border-[var(--gp-gold)] !text-[var(--gp-gold)]' : ''}`} onClick={() => setState((s) => ({ ...s, aspect: a.value }))}>
                      {typeof a.label === 'string' ? t(a.label) : a.label.raw}
                    </button>
                  ))}
                </div>
              </Field>
              <div className="grid grid-cols-4 gap-1.5">
                <button type="button" className="gp-btn gp-btn-ghost gp-btn-sm !px-0" aria-label={t('editor.rotateLeft')} onClick={() => rotate(-1)}><RotateCcw size={16} /></button>
                <button type="button" className="gp-btn gp-btn-ghost gp-btn-sm !px-0" aria-label={t('editor.rotateRight')} onClick={() => rotate(1)}><RotateCw size={16} /></button>
                <button type="button" className="gp-btn gp-btn-ghost gp-btn-sm !px-0" aria-label={t('editor.flipH')} onClick={() => setState((s) => ({ ...s, flipX: !s.flipX }))}><FlipHorizontal2 size={16} /></button>
                <button type="button" className="gp-btn gp-btn-ghost gp-btn-sm !px-0" aria-label={t('editor.flipV')} onClick={() => setState((s) => ({ ...s, flipY: !s.flipY }))}><FlipVertical2 size={16} /></button>
              </div>
            </Panel>

            <Panel title={t('common.export')}>
              <Segmented label={t('common.format')} value={format} onChange={setFormat} options={[{ value: 'png', label: 'PNG' }, { value: 'jpeg', label: 'JPG' }, { value: 'webp', label: 'WebP' }]} />
              {format !== 'png' && <Slider label={t('common.quality')} value={quality} min={40} max={100} unit="%" onChange={setQuality} />}
              <Field label={t('editor.size')}>
                <Segmented label={t('editor.outputSize')} value={scale} onChange={setScale} options={[{ value: 100, label: '100%' }, { value: 75, label: '75%' }, { value: 50, label: '50%' }, { value: 25, label: '25%' }]} />
                <p className="mt-2 text-xs tabular-nums text-mist">
                  {t('editor.output', { w: fmt.number(outW, 0), h: fmt.number(outH, 0) })}
                </p>
              </Field>
              {needsHd ? (
                <div className="grid gap-2">
                  <button type="button" className="gp-btn gp-btn-primary w-full" disabled={busy || !px.available} onClick={() => void download(true)}>
                    <Download size={16} /> {busy ? t('common.preparing') : t('editor.download.hd', { w: fmt.number(outW, 0), h: fmt.number(outH, 0), cost: costText(['hd-export']) })}
                  </button>
                  <button type="button" className="gp-btn gp-btn-ghost w-full" disabled={busy} onClick={() => void download(false)}>
                    {t('editor.download.std', { w: fmt.number(stdW, 0), h: fmt.number(stdH, 0) })}
                  </button>
                  <PremiumNote ops={['hd-export']} px={px} />
                </div>
              ) : (
                <button type="button" className="gp-btn gp-btn-primary w-full" disabled={busy} onClick={() => void download(false)}>
                  <Download size={16} /> {busy ? t('common.preparing') : t('editor.download')}
                </button>
              )}
            </Panel>
          </aside>
        </div>
      )}
    </div>
  )
}
