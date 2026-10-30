import { useId, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { ArrowLeft, ImagePlus, UploadCloud } from 'lucide-react'
import { Link } from '@/lib/router'
import { toolById, type ToolId } from '@/lib/tools'
import { useI18n } from '@/i18n'

/* ---------------------------------------------------------------- Dropzone */
type DropzoneProps = {
  onFiles: (files: File[]) => void | Promise<void>
  multiple?: boolean
  compact?: boolean
  title?: string
  hint?: string
  /** Value for the file input's accept attribute. Defaults to images. */
  accept?: string
}

export function Dropzone({ onFiles, multiple = true, compact = false, title, hint, accept = 'image/*' }: DropzoneProps) {
  const { t } = useI18n()
  const inputRef = useRef<HTMLInputElement>(null)
  const [active, setActive] = useState(false)
  const depth = useRef(0)

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    depth.current = 0
    setActive(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length) void onFiles(multiple ? files : files.slice(0, 1))
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={title ?? t('drop.aria')}
      data-active={active}
      className={`gp-drop flex flex-col items-center justify-center text-center ${compact ? 'gap-2 px-4 py-6' : 'gap-4 px-6 py-14 sm:py-20'}`}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          inputRef.current?.click()
        }
      }}
      onDragEnter={(e) => {
        e.preventDefault()
        depth.current++
        setActive(true)
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setActive(false)
      }}
      onDrop={handleDrop}
    >
      <span className={`grid place-items-center rounded-2xl border border-[var(--gp-line-strong)] bg-[rgba(245,197,66,0.08)] text-[var(--gp-gold)] ${compact ? 'h-10 w-10' : 'h-14 w-14'}`}>
        {compact ? <ImagePlus size={18} /> : <UploadCloud size={26} />}
      </span>
      <div>
        <p className={`font-display font-semibold ${compact ? 'text-sm' : 'text-lg'}`}>
          {title ?? (multiple ? t('drop.titleMany') : t('drop.titleOne'))}
        </p>
        <p className="mt-1 text-sm text-mist">
          {hint ?? t('drop.hint')}
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          if (files.length) void onFiles(files)
          e.target.value = ''
        }}
      />
    </div>
  )
}

/* ----------------------------------------------------------------- Slider */
type SliderProps = {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  onChange: (v: number) => void
}

export function Slider({ label, value, min, max, step = 1, unit = '', onChange }: SliderProps) {
  const id = useId()
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <label htmlFor={id} className="font-medium text-ink">
          {label}
        </label>
        <span className="tabular-nums text-mist">
          {value}
          {unit}
        </span>
      </div>
      <input
        id={id}
        type="range"
        className="gp-range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ['--pct' as string]: `${pct}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}

/* -------------------------------------------------------------- Segmented */
type SegmentedProps<T extends string | number> = {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}

export function Segmented<T extends string | number>({ label, value, options, onChange }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className="gp-seg">
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ Panel */
export function Panel({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="gp-inner p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="gp-eyebrow">{title}</h3>
        {action}
      </div>
      <div className="grid gap-4">{children}</div>
    </section>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-sm font-medium">{label}</p>
      {children}
    </div>
  )
}

/* ------------------------------------------------------------- Tool header */
export function ToolHeader({ id, actions }: { id: ToolId; actions?: ReactNode }) {
  const { t } = useI18n()
  const tool = toolById(id)
  const Icon = tool.icon
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <Link to="/tools" className="mb-3 inline-flex min-h-[32px] items-center gap-1.5 text-sm text-mist transition-colors hover:text-[var(--gp-gold)]">
          <ArrowLeft size={14} /> {t('tool.all')}
        </Link>
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl border border-[var(--gp-line-strong)] bg-[rgba(245,197,66,0.08)] text-[var(--gp-gold)]">
            <Icon size={20} />
          </span>
          <div>
            <h1 className="font-display text-2xl font-bold sm:text-3xl">{t(tool.title)}</h1>
            <p className="max-w-xl text-pretty text-sm text-mist">{t(tool.description)}</p>
          </div>
        </div>
      </div>
      {actions}
    </div>
  )
}

/* ----------------------------------------------------------- Compare view */
export function CompareSlider({ before, after, width, height }: { before: string; after: string; width: number; height: number }) {
  const { t } = useI18n()
  const [pos, setPos] = useState(50)
  return (
    <div className="relative mx-auto max-h-[60vh] w-full select-none overflow-hidden rounded-xl gp-checker" style={{ aspectRatio: `${width} / ${height}`, maxWidth: `min(100%, calc(60vh * ${width / height}))` }}>
      <img src={after} alt={t('compare.alt.after')} className="absolute inset-0 h-full w-full object-contain" draggable={false} />
      <img src={before} alt={t('compare.alt.before')} className="absolute inset-0 h-full w-full object-contain" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }} draggable={false} />
      <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-ink">{t('compare.original')}</span>
      <span className="absolute right-2 top-2 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--gp-gold)]">{t('compare.compressed')}</span>
      <span className="pointer-events-none absolute inset-y-0 w-px bg-[var(--gp-gold)] shadow-[0_0_10px_var(--gp-gold)]" style={{ left: `${pos}%` }}>
        <span className="absolute left-1/2 top-1/2 grid h-8 w-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-[var(--gp-gold)] bg-black/80 text-[10px] font-bold text-[var(--gp-gold)]">
          ‹ ›
        </span>
      </span>
      <input type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} aria-label={t('compare.aria')} className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0" />
    </div>
  )
}

/* ------------------------------------------------------------ Pick button */
export function PickButton({ onFiles, multiple = false, children, className = 'gp-btn gp-btn-ghost gp-btn-sm', accept = 'image/*' }: { onFiles: (f: File[]) => void | Promise<void>; multiple?: boolean; children: ReactNode; className?: string; accept?: string }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <>
      <button type="button" className={className} onClick={() => ref.current?.click()}>
        {children}
      </button>
      <input
        ref={ref}
        type="file"
        accept={accept}
        multiple={multiple}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          if (files.length) void onFiles(files)
          e.target.value = ''
        }}
      />
    </>
  )
}
