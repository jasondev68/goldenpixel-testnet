import { Field, Segmented, Slider } from '@/components/ui'
import type { TKey } from '@/i18n'
import { useI18n } from '@/i18n'
import type { CsvDelimiter } from '@/lib/convert/csv'
import * as R from '@/lib/convert/runners'
import type { Item, ToolUi } from './Workspace'

function RangeInput({ value, onChange, pages, label, hint }: { value: string; onChange: (v: string) => void; pages?: number; label: TKey; hint: TKey }) {
  const { t } = useI18n()
  return (
    <Field label={t(label)}>
      <input className="gp-input" value={value} onChange={(e) => onChange(e.target.value)} placeholder={t(hint)} inputMode="text" autoComplete="off" spellCheck={false} aria-label={t(label)} />
      {pages !== undefined && <p className="mt-1.5 text-xs text-mist">{t('cv.rangeOf', { n: pages })}</p>}
    </Field>
  )
}

const pagesOf = (items: Item[]) => items[0]?.pages

export const MERGE: ToolUi<Record<string, never>> = {
  id: 'pdf-merge',
  accept: ['pdf'],
  multiple: true,
  ordered: true,
  defaults: {},
  action: 'cv.run.merge',
  run: (c) => R.runMerge(c),
  check: (items) => (items.length < 2 ? { key: 'cv.err.needTwo' } : null),
}

export const SPLIT: ToolUi<R.SplitOpts> = {
  id: 'pdf-split',
  accept: ['pdf'],
  multiple: false,
  defaults: { mode: 'ranges', spec: '' },
  action: 'cv.run.split',
  run: (c) => R.runSplit(c),
  check: (items, o) => (o.mode === 'ranges' && !o.spec.trim() ? { key: 'cv.err.rangeEmpty' } : items.length === 0 ? { key: 'cv.err.noPages' } : null),
  Options: function SplitOptions({ opts, set, items }) {
    const { t } = useI18n()
    return (
      <>
        <Field label={t('cv.split.mode')}>
          <Segmented label={t('cv.split.mode')} value={opts.mode} onChange={(mode) => set({ mode })} options={[{ value: 'ranges', label: t('cv.split.ranges') }, { value: 'each', label: t('cv.split.each') }]} />
        </Field>
        {opts.mode === 'ranges' && <RangeInput value={opts.spec} onChange={(spec) => set({ spec })} pages={pagesOf(items)} label="cv.split.rangeLabel" hint="cv.split.rangeHint" />}
      </>
    )
  },
}

export const PDF_TO_IMAGES: ToolUi<R.ImagesOpts> = {
  id: 'pdf-to-images',
  accept: ['pdf'],
  multiple: true,
  defaults: { format: 'png', dpi: 150, quality: 90, spec: '' },
  action: 'cv.run.pdf2img',
  ops: () => ['pdf-to-images'],
  run: (c) => R.runPdfToImages(c),
  Options: function ImagesOptions({ opts, set, items }) {
    const { t } = useI18n()
    return (
      <>
        <Field label={t('common.format')}>
          <Segmented label={t('common.format')} value={opts.format} onChange={(format) => set({ format })} options={[{ value: 'png', label: 'PNG' }, { value: 'jpeg', label: 'JPG' }]} />
        </Field>
        <Field label={t('cv.dpi')}>
          <Segmented label={t('cv.dpi')} value={opts.dpi} onChange={(dpi) => set({ dpi })} options={[72, 150, 200, 300].map((v) => ({ value: v, label: String(v) }))} />
        </Field>
        {opts.format === 'jpeg' && <Slider label={t('common.quality')} value={opts.quality} min={40} max={100} unit="%" onChange={(quality) => set({ quality })} />}
        <RangeInput value={opts.spec} onChange={(spec) => set({ spec })} pages={items.length === 1 ? pagesOf(items) : undefined} label="cv.img.pages" hint="cv.img.pagesHint" />
      </>
    )
  },
}

export const PDF_COMPRESS: ToolUi<R.CompressOpts> = {
  id: 'pdf-compress',
  accept: ['pdf'],
  multiple: true,
  defaults: { mode: 'lossless', dpi: 120, quality: 70 },
  action: 'cv.run.compress',
  ops: (o) => (o.mode === 'strong' ? ['pdf-compress'] : []),
  run: (c) => R.runPdfCompress(c),
  limits: undefined,
  Options: function CompressOptions({ opts, set }) {
    const { t } = useI18n()
    return (
      <>
        <Field label={t('cv.compress.mode')}>
          <Segmented label={t('cv.compress.mode')} value={opts.mode} onChange={(mode) => set({ mode })} options={[{ value: 'lossless', label: t('cv.compress.lossless') }, { value: 'strong', label: t('cv.compress.strong') }]} />
        </Field>
        <p className="text-xs text-mist">{opts.mode === 'lossless' ? t('cv.compress.losslessNote') : t('cv.compress.strongNote')}</p>
        {opts.mode === 'strong' && (
          <>
            <Field label={t('cv.dpi')}>
              <Segmented label={t('cv.dpi')} value={opts.dpi} onChange={(dpi) => set({ dpi })} options={[72, 96, 120, 150].map((v) => ({ value: v, label: String(v) }))} />
            </Field>
            <Slider label={t('common.quality')} value={opts.quality} min={30} max={95} unit="%" onChange={(quality) => set({ quality })} />
          </>
        )}
      </>
    )
  },
}

export const PDF_TO_DOCX: ToolUi<R.PdfDocxOpts> = {
  id: 'pdf-to-docx',
  accept: ['pdf'],
  multiple: true,
  defaults: { pageBreaks: 'keep', images: true, stripMargins: true, ocr: false, ocrLang: 'eng' },
  action: 'cv.run.pdf2docx',
  run: (c) => R.runPdfToDocx(c),
  limits: 'cv.docx.limits',
  Options: function PdfDocxOptions({ opts, set }) {
    const { t } = useI18n()
    const check = (checked: boolean, on: (v: boolean) => void, label: TKey) => (
      <label className="flex min-h-[44px] items-center gap-2.5 text-sm">
        <input type="checkbox" checked={checked} onChange={(e) => on(e.target.checked)} className="h-4 w-4 accent-[var(--gp-gold)]" />
        {t(label)}
      </label>
    )
    return (
      <>
        <Field label={t('cv.docx.pages')}>
          <Segmented label={t('cv.docx.pages')} value={opts.pageBreaks} onChange={(pageBreaks) => set({ pageBreaks })} options={[{ value: 'keep', label: t('cv.docx.keep') }, { value: 'flow', label: t('cv.docx.flow') }]} />
          <p className="mt-1.5 text-xs text-mist">{opts.pageBreaks === 'keep' ? t('cv.docx.keepHint') : t('cv.docx.flowHint')}</p>
        </Field>
        {check(opts.images, (images) => set({ images }), 'cv.docx.images')}
        {check(opts.stripMargins, (stripMargins) => set({ stripMargins }), 'cv.docx.margins')}
        <div className="grid gap-2 rounded-xl border border-[var(--gp-line)] bg-black/20 p-3">
          {check(opts.ocr, (ocr) => set({ ocr }), 'cv.docx.ocr')}
          {opts.ocr && (
            <>
              <Segmented
                label={t('cv.docx.ocrLang')}
                value={opts.ocrLang}
                onChange={(ocrLang) => set({ ocrLang })}
                options={[{ value: 'eng', label: t('cv.docx.lang.eng') }, { value: 'vie', label: t('cv.docx.lang.vie') }, { value: 'vie+eng', label: t('cv.docx.lang.both') }]}
              />
              <p className="text-xs text-mist">{t('cv.docx.ocrDisclosure')}</p>
            </>
          )}
          {!opts.ocr && <p className="text-xs text-mist">{t('cv.docx.ocrOff')}</p>}
        </div>
      </>
    )
  },
}

export const DOCX_TO_PDF: ToolUi<Record<string, never>> = {
  id: 'docx-to-pdf',
  accept: ['docx'],
  multiple: true,
  defaults: {},
  action: 'cv.run.docx2pdf',
  ops: () => ['docx-to-pdf'],
  run: (c) => R.runDocxToPdf(c),
  limits: 'cv.basicEngine',
}

export const DOCX_TO_TXT: ToolUi<Record<string, never>> = { id: 'docx-to-txt', accept: ['docx'], multiple: true, defaults: {}, action: 'cv.run.docx2txt', run: (c) => R.runDocxToTxt(c) }
export const TXT_TO_DOCX: ToolUi<Record<string, never>> = { id: 'txt-to-docx', accept: ['txt'], multiple: true, defaults: {}, action: 'cv.run.txt2docx', run: (c) => R.runTxtToDocx(c) }

export const EXTRACT: ToolUi<R.ExtractOpts> = {
  id: 'extract-text',
  accept: ['pdf', 'docx'],
  multiple: true,
  defaults: { format: 'txt', pageMarkers: false },
  action: 'cv.run.extract',
  run: (c) => R.runExtractText(c),
  Options: function ExtractOptions({ opts, set }) {
    const { t } = useI18n()
    return (
      <>
        <Field label={t('common.format')}>
          <Segmented label={t('common.format')} value={opts.format} onChange={(format) => set({ format })} options={[{ value: 'txt', label: 'TXT' }, { value: 'docx', label: 'DOCX' }]} />
        </Field>
        <label className="flex min-h-[44px] items-center gap-2.5 text-sm">
          <input type="checkbox" checked={opts.pageMarkers} onChange={(e) => set({ pageMarkers: e.target.checked })} className="h-4 w-4 accent-[var(--gp-gold)]" />
          {t('cv.extract.markers')}
        </label>
        <p className="text-xs text-mist">{opts.format === 'docx' ? t('cv.extract.docxNote') : t('cv.extract.ocrNote')}</p>
      </>
    )
  },
}

const DELIMS: { value: CsvDelimiter; label: string }[] = [
  { value: ',', label: ',' },
  { value: ';', label: ';' },
  { value: '\t', label: 'Tab' },
]

export const XLSX_TO_CSV: ToolUi<R.XlsxCsvOpts> = {
  id: 'xlsx-to-csv',
  accept: ['xlsx'],
  multiple: true,
  defaults: { delimiter: ',', bom: true },
  action: 'cv.run.xlsx2csv',
  run: (c) => R.runXlsxToCsv(c),
  Options: function XlsxOptions({ opts, set }) {
    const { t } = useI18n()
    return (
      <>
        <Field label={t('cv.delimiter')}>
          <Segmented label={t('cv.delimiter')} value={opts.delimiter} onChange={(delimiter) => set({ delimiter })} options={DELIMS} />
        </Field>
        <label className="flex min-h-[44px] items-center gap-2.5 text-sm">
          <input type="checkbox" checked={opts.bom} onChange={(e) => set({ bom: e.target.checked })} className="h-4 w-4 accent-[var(--gp-gold)]" />
          {t('cv.csv.bom')}
        </label>
      </>
    )
  },
}

export const CSV_TO_XLSX: ToolUi<R.CsvXlsxOpts> = {
  id: 'csv-to-xlsx',
  accept: ['csv'],
  multiple: true,
  defaults: { delimiter: 'auto', combine: false },
  action: 'cv.run.csv2xlsx',
  run: (c) => R.runCsvToXlsx(c),
  Options: function CsvOptions({ opts, set, items }) {
    const { t } = useI18n()
    return (
      <>
        <Field label={t('cv.delimiter')}>
          <Segmented label={t('cv.delimiter')} value={opts.delimiter} onChange={(delimiter) => set({ delimiter })} options={[{ value: 'auto' as const, label: t('cv.delimiter.auto') }, ...DELIMS]} />
        </Field>
        {items.length > 1 && (
          <label className="flex min-h-[44px] items-center gap-2.5 text-sm">
            <input type="checkbox" checked={opts.combine} onChange={(e) => set({ combine: e.target.checked })} className="h-4 w-4 accent-[var(--gp-gold)]" />
            {t('cv.csv.combine')}
          </label>
        )}
      </>
    )
  },
}
