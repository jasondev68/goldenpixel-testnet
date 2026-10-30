import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Download, ImagePlus, RotateCcw, RotateCw, Trash2, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { Notice, Spinner } from '@/components/swapbridge/parts'
import { Dropzone, PickButton } from '@/components/ui'
import { FREE_LIMITS } from '@/config/plans'
import { translate, useI18n, type Msg } from '@/i18n'
import { ConvertError } from '@/lib/convert/errors'
import { baseOf, safeName, validateInput } from '@/lib/convert/formats'
import { browserCanvas, closePdf, openForRender, renderPageBytes } from '@/lib/convert/pdfRender'
import { buildFromPlan } from '@/lib/convert/pdfTools'
import { downloadBlob } from '@/lib/image'

type Page = { src: number; rotate: number; removed: boolean; selected: boolean; thumb?: string }
const MAX_PAGES = 200

/** Extract, reorder, rotate and remove PDF pages with live thumbnails. Free, and entirely local. */
export function PdfOrganizer() {
  const { t, m, fmt } = useI18n()
  const [file, setFile] = useState<File | null>(null)
  const [bytes, setBytes] = useState<Uint8Array | null>(null)
  const [pages, setPages] = useState<Page[]>([])
  const [error, setError] = useState<Msg | null>(null)
  const [busy, setBusy] = useState(false)
  const urls = useRef<string[]>([])

  const clearThumbs = () => {
    urls.current.forEach((u) => URL.revokeObjectURL(u))
    urls.current = []
  }
  useEffect(() => clearThumbs, [])

  const open = async (files: File[]) => {
    const f = files[0]
    if (!f) return
    setError(null)
    const bad = await validateInput(f, ['pdf'])
    if (bad) return setError({ key: bad.key, vars: bad.vars })
    if (f.size > FREE_LIMITS.maxFileBytes) return setError({ key: 'cv.err.tooBig', vars: { mb: Math.round(FREE_LIMITS.maxFileBytes / 1048576) } })
    try {
      const data = new Uint8Array(await f.arrayBuffer())
      const doc = await openForRender(data)
      if (doc.numPages > MAX_PAGES) {
        await closePdf(doc)
        return setError({ key: 'cv.err.tooManyPages', vars: { max: MAX_PAGES, n: doc.numPages } })
      }
      clearThumbs()
      setFile(f)
      setBytes(data)
      setPages(Array.from({ length: doc.numPages }, (_, i) => ({ src: i, rotate: 0, removed: false, selected: false })))
      // Thumbnails are rendered one by one so the page list appears immediately.
      for (let i = 0; i < doc.numPages; i++) {
        const page = await doc.getPage(i + 1)
        const img = await renderPageBytes(page, { dpi: 40, format: 'jpeg', quality: 0.6 }, browserCanvas)
        page.cleanup()
        const url = URL.createObjectURL(new Blob([img.bytes as BlobPart], { type: 'image/jpeg' }))
        urls.current.push(url)
        setPages((prev) => prev.map((p) => (p.src === i ? { ...p, thumb: url } : p)))
      }
      await closePdf(doc)
    } catch (e) {
      setError(e instanceof ConvertError ? { key: e.key, vars: e.vars } : { key: 'cv.err.badPdf' })
    }
  }

  const update = (src: number, patch: Partial<Page>) => setPages((p) => p.map((x) => (x.src === src ? { ...x, ...patch } : x)))
  const move = (i: number, d: -1 | 1) =>
    setPages((prev) => {
      const j = i + d
      if (j < 0 || j >= prev.length) return prev
      const c = [...prev]
      ;[c[i], c[j]] = [c[j], c[i]]
      return c
    })
  const selected = pages.filter((p) => p.selected && !p.removed)
  const kept = pages.filter((p) => !p.removed)
  const bulk = (patch: (p: Page) => Partial<Page>) => setPages((prev) => prev.map((p) => (p.selected ? { ...p, ...patch(p) } : p)))

  const save = async (which: 'all' | 'selected') => {
    if (!bytes || !file) return
    const list = which === 'all' ? kept : selected
    if (list.length === 0) return setError({ key: 'cv.err.noPages' })
    setBusy(true)
    setError(null)
    try {
      const out = await buildFromPlan(bytes, list.map((p) => ({ src: p.src, rotate: p.rotate })))
      downloadBlob(new Blob([out as BlobPart], { type: 'application/pdf' }), `${safeName(baseOf(file.name))}-${which === 'all' ? 'organized' : 'extract'}.pdf`)
      toast.success(translate('org.saved', { n: list.length }))
    } catch (e) {
      setError(e instanceof ConvertError ? { key: e.key, vars: e.vars } : { key: 'cv.err.badPdf' })
    } finally {
      setBusy(false)
    }
  }

  if (!file) {
    return (
      <div className="grid gap-3">
        <Dropzone multiple={false} accept=".pdf" onFiles={open} title={t('cv.drop.title', { formats: 'PDF' })} hint={t('org.drop.hint', { mb: Math.round(FREE_LIMITS.maxFileBytes / 1048576), max: MAX_PAGES })} />
        {error && <Notice tone="error">{m(error)}</Notice>}
      </div>
    )
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="truncate text-sm text-mist"><span className="text-ink">{file.name}</span> · {fmt.bytes(file.size)} · {t('cv.pages.many', { n: pages.length })}</p>
          <PickButton onFiles={open} accept=".pdf"><ImagePlus size={14} /> {t('common.change')}</PickButton>
        </div>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4" aria-label={t('org.pages.aria')}>
          {pages.map((p, i) => (
            <li key={p.src} className={`gp-card p-2 transition-opacity ${p.removed ? 'opacity-40' : ''} ${p.selected ? 'ring-1 ring-[var(--gp-gold)]' : ''}`}>
              <label className="flex items-center gap-2 pb-1.5 text-xs">
                <input type="checkbox" checked={p.selected} disabled={p.removed} onChange={(e) => update(p.src, { selected: e.target.checked })} className="h-4 w-4 accent-[var(--gp-gold)]" aria-label={t('org.select', { n: p.src + 1 })} />
                <span className="tabular-nums text-mist">{t('org.page', { n: p.src + 1 })}</span>
                {p.removed && <span className="ml-auto text-red-300">{t('org.removed')}</span>}
              </label>
              <div className="grid aspect-[3/4] place-items-center overflow-hidden rounded-lg bg-white/5">
                {p.thumb ? <img src={p.thumb} alt={t('org.page', { n: p.src + 1 })} className="max-h-full max-w-full object-contain transition-transform" style={{ transform: `rotate(${p.rotate}deg)` }} /> : <Spinner label="" />}
              </div>
              <div className="mt-1.5 flex items-center justify-between">
                <button type="button" className="grid h-9 w-9 place-items-center text-mist hover:text-[var(--gp-gold)] disabled:opacity-30" disabled={i === 0} aria-label={t('org.moveLeft', { n: p.src + 1 })} onClick={() => move(i, -1)}><ArrowLeft size={15} /></button>
                <button type="button" className="grid h-9 w-9 place-items-center text-mist hover:text-[var(--gp-gold)]" aria-label={t('org.rotateLeft', { n: p.src + 1 })} onClick={() => update(p.src, { rotate: (p.rotate + 270) % 360 })}><RotateCcw size={15} /></button>
                <button type="button" className="grid h-9 w-9 place-items-center text-mist hover:text-[var(--gp-gold)]" aria-label={t('org.rotateRight', { n: p.src + 1 })} onClick={() => update(p.src, { rotate: (p.rotate + 90) % 360 })}><RotateCw size={15} /></button>
                <button type="button" className="grid h-9 w-9 place-items-center text-mist hover:text-red-400" aria-label={p.removed ? t('org.restore', { n: p.src + 1 }) : t('org.remove', { n: p.src + 1 })} onClick={() => update(p.src, { removed: !p.removed, selected: false })}>
                  {p.removed ? <Undo2 size={15} /> : <Trash2 size={15} />}
                </button>
                <button type="button" className="grid h-9 w-9 place-items-center text-mist hover:text-[var(--gp-gold)] disabled:opacity-30" disabled={i === pages.length - 1} aria-label={t('org.moveRight', { n: p.src + 1 })} onClick={() => move(i, 1)}><ArrowRight size={15} /></button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <aside className="grid content-start gap-4" aria-label={t('cv.settings.aria')}>
        <div className="gp-card grid gap-3 p-4 sm:p-5">
          <p className="gp-eyebrow">{t('org.bulk')}</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="gp-btn gp-btn-ghost gp-btn-sm" onClick={() => setPages((p) => p.map((x) => ({ ...x, selected: !x.removed })))}>{t('org.selectAll')}</button>
            <button type="button" className="gp-btn gp-btn-ghost gp-btn-sm" onClick={() => setPages((p) => p.map((x) => ({ ...x, selected: false })))}>{t('org.selectNone')}</button>
            <button type="button" className="gp-btn gp-btn-ghost gp-btn-sm" disabled={!selected.length} onClick={() => bulk((p) => ({ rotate: (p.rotate + 270) % 360 }))}><RotateCcw size={14} /> {t('org.rotateSel')}</button>
            <button type="button" className="gp-btn gp-btn-ghost gp-btn-sm" disabled={!selected.length} onClick={() => bulk((p) => ({ rotate: (p.rotate + 90) % 360 }))}><RotateCw size={14} /> {t('org.rotateSel')}</button>
            <button type="button" className="gp-btn gp-btn-ghost gp-btn-sm" disabled={!selected.length} onClick={() => bulk(() => ({ removed: true, selected: false }))}><Trash2 size={14} /> {t('org.removeSel')}</button>
            <button type="button" className="gp-btn gp-btn-ghost gp-btn-sm" onClick={() => setPages((p) => [...p].reverse())}>{t('org.reverse')}</button>
          </div>
          <p className="text-xs tabular-nums text-mist">{t('org.summary', { kept: kept.length, total: pages.length, sel: selected.length })}</p>
          {error && <Notice tone="error">{m(error)}</Notice>}
          <button type="button" className="gp-btn gp-btn-primary w-full" disabled={busy || kept.length === 0} onClick={() => void save('all')}>
            {busy ? <Spinner label={t('common.preparing')} /> : <><Download size={16} /> {t('org.saveAll')}</>}
          </button>
          <button type="button" className="gp-btn gp-btn-ghost w-full" disabled={busy || selected.length === 0} onClick={() => void save('selected')}>
            {t('org.saveSelected', { n: selected.length })}
          </button>
        </div>
      </aside>
    </div>
  )
}
