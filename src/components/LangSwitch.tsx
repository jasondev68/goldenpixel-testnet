import { LANGS, useI18n, type Lang } from '@/i18n'

const NAMES: Record<Lang, string> = { en: 'English', vi: 'Tiếng Việt' }

/** Segmented EN | VI switcher. Switching re-renders in place: no reload, no state loss. */
export function LangSwitch() {
  const { lang, setLang, t } = useI18n()
  return (
    <div role="radiogroup" aria-label={t('lang.label')} className="gp-seg !grid-flow-col !p-[3px]">
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          role="radio"
          aria-checked={lang === l}
          lang={l}
          title={NAMES[l]}
          aria-label={NAMES[l]}
          onClick={() => setLang(l)}
          className="!min-h-[34px] !min-w-[34px] !px-1.5 text-xs uppercase tracking-wider"
        >
          {l}
        </button>
      ))}
    </div>
  )
}
