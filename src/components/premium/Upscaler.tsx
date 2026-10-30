import { useEffect, useRef, useState } from 'react'
import { Download, ImagePlus, Sparkles } from 'lucide-react'
import { Dropzone, Field, PickButton, Segmented, Slider } from '@/components/ui'
import { Notice, Spinner } from '@/components/swapbridge/parts'
import { type PremiumFeatureId } from '@/config/payments'
import { useI18n, type Msg } from '@/i18n'
import { baseName, downloadBlob, loadImageFiles, revoke, type LoadedImage } from '@/lib/image'
import { ApiError } from '@/lib/apiError'
import { parseOnchainError } from '@/lib/web3'
import { usePremiumAction } from '@/hooks/usePremiumAction'
import { PremiumNote, usePriceText } from './PremiumNote'
import { upscaleImage, upscaleProblem } from '@/lib/upscale'

type Done = { blob: Blob; width: number; height: number; name: string }

export function Upscaler() {
  const { t, m, fmt } = useI18n()
  const px = usePremiumAction()
  const cost = usePriceText()
  const [image, setImage] = useState<LoadedImage | null>(null)
  const [scale, setScale] = useState<2 | 4>(2)
  const [sharpness, setSharpness] = useState(40)
  const [stage, setStage] = useState<'idle' | 'processing' | 'reserving'>('idle')
  const [error, setError] = useState<Msg | null>(null)
  const [done, setDone] = useState<Done | null>(null)
  const ref = useRef<LoadedImage | null>(null)
  useEffect(() => {
    ref.current = image
  }, [image])

  useEffect(() => () => { if (ref.current) revoke([ref.current]) }, [])

  const open = async (files: File[]) => {
    const [first] = await loadImageFiles(files.slice(0, 1), 1)
    if (!first) return
    if (ref.current) revoke([ref.current])
    setImage(first)
    setDone(null)
    setError(null)
  }

  const opId = `upscale-${scale}x` as PremiumFeatureId
    const sizeProblem = image ? upscaleProblem(image, scale) : null
  const busy = stage !== 'idle'

  const run = async () => {
    if (!image || sizeProblem) return
    setError(null)
    setDone(null)
    try {
      // Payment first: the price is shown, the wallet approves one direct USDC transfer, and the browser verifies it
      // from chain data. Only then is the upscaled file generated. If generation fails, the unlock stays: retry is free.
      setStage('reserving')
      await px.ensurePaid([opId])
      setStage('processing')
      const out = await upscaleImage(image, scale, sharpness)
      const name = `${baseName(image.name)}-${scale}x-goldenpixel.png`
      setDone({ ...out, name })
      downloadBlob(out.blob, name)
    } catch (e) {
      if (e instanceof ApiError) {
        // The user closing the payment sheet is a choice, not an error.
        if (e.code !== 'CANCELLED') setError(e.msg)
      } else {
        const p = parseOnchainError(e)
        setError(p.rejected ? { key: 'up.err.sigCancelled' } : p.msg)
      }
    } finally {
      setStage('idle')
    }
  }

  return (
    <div className="grid gap-4">
      {!image ? (
        <Dropzone multiple={false} onFiles={open} compact title={t('up.drop.title')} hint={t('up.drop.hint')} />
      ) : (
        <>
          <div className="gp-checker grid min-h-[200px] place-items-center overflow-hidden rounded-xl p-2">
            <img src={done ? URL.createObjectURL(done.blob) : image.url} alt={done ? t('up.alt.result') : t('up.alt.selected')} className="max-h-[320px] max-w-full rounded-md object-contain" onLoad={(e) => { if (done) URL.revokeObjectURL((e.target as HTMLImageElement).src) }} />
          </div>
          <div className="flex items-center justify-between gap-3 text-sm text-mist">
            <span className="min-w-0 truncate"><span className="text-ink">{image.name}</span> · {fmt.number(image.width, 0)} × {fmt.number(image.height, 0)} · {fmt.bytes(image.size)}</span>
            <PickButton onFiles={open}><ImagePlus size={14} /> {t('common.change')}</PickButton>
          </div>

          <Field label={t('up.factor')}>
            <Segmented label={t('up.factor')} value={scale} onChange={(v) => { setScale(v); setDone(null) }} options={[{ value: 2, label: t('up.opt', { x: 2, cost: cost(['upscale-2x']) }) }, { value: 4, label: t('up.opt', { x: 4, cost: cost(['upscale-4x']) }) }]} />
          </Field>
          <Slider label={t('up.sharpen')} value={sharpness} min={0} max={100} unit="%" onChange={setSharpness} />
          <p className="text-sm text-mist tabular-nums">{t('up.outputCost', { w: fmt.number(image.width * scale, 0), h: fmt.number(image.height * scale, 0), cost: cost([opId]) })}</p>

          {sizeProblem && <Notice tone="warn">{m(sizeProblem)}</Notice>}
          {px.available && !px.isConnected && <Notice tone="warn">{t('up.connectNote')}</Notice>}
          {error && <Notice tone="error">{m(error)}</Notice>}
          {done && <Notice tone="success"><p className="font-semibold">{t('up.done', { w: fmt.number(done.width, 0), h: fmt.number(done.height, 0) })}</p><p className="mt-1">{t('up.done.body')}</p></Notice>}

          {done ? (
            <button type="button" className="gp-btn gp-btn-primary w-full" onClick={() => downloadBlob(done.blob, done.name)}><Download size={16} /> {t('up.again', { size: fmt.bytes(done.blob.size) })}</button>
          ) : (
            <button type="button" className="gp-btn gp-btn-primary w-full" disabled={busy || !px.available || Boolean(sizeProblem)} onClick={() => void run()}>
              {stage === 'processing' ? <Spinner label={t('up.working')} /> : stage === 'reserving' ? <Spinner label={t('pay.confirmWallet')} /> : <><Sparkles size={16} /> {px.isUnlocked([opId]) ? t('up.cta.unlocked') : t('up.cta', { cost: cost([opId]) })}</>}
            </button>
          )}
          {!done && <PremiumNote ops={[opId]} px={px} />}
        </>
      )}
    </div>
  )
}
