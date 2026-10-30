import { useState } from 'react'
import { Link } from '@/lib/router'
import { TOOLS } from '@/lib/tools'
import { useI18n } from '@/i18n'
import { Wordmark } from './Logo'

/** The creator's logo image. Place the file at public/jasondev-logo.jpg (any square image works). */
const SIGNATURE_LOGO = '/jasondev-logo.jpg'

/** Small personal credit: the creator's logo on the left, the credit line to its right, on one centered line. */
function DeveloperSignature() {
  const { t } = useI18n()
  const [logoOk, setLogoOk] = useState(true)
  return (
    <div className="mx-auto mt-8 flex max-w-6xl items-center gap-2.5 border-t border-white/[0.06] px-4 pt-5 sm:px-6">
      {logoOk && (
        <img
          src={SIGNATURE_LOGO}
          alt=""
          width={28}
          height={28}
          loading="lazy"
          decoding="async"
          onError={() => setLogoOk(false)}
          className="h-6 w-6 shrink-0 rounded-full object-cover ring-1 ring-[var(--gp-line)] sm:h-7 sm:w-7"
        />
      )}
      <p className="min-w-0 text-pretty text-xs leading-snug tracking-wide text-mist/80 sm:text-[13px]">{t('footer.credit')}</p>
    </div>
  )
}

export function Footer() {
  const { t } = useI18n()
  return (
    <footer className="mt-24 border-t border-[var(--gp-line)] pb-24 pt-12">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <Wordmark />
          <p className="mt-4 max-w-xs text-pretty text-sm leading-relaxed text-mist">{t('footer.blurb')}</p>
        </div>
        <div>
          <p className="gp-eyebrow">{t('footer.tools')}</p>
          <ul className="mt-4 grid gap-2.5 text-sm">
            {TOOLS.map((tool) => (
              <li key={tool.id}>
                <Link to={tool.path} className="text-mist transition-colors hover:text-[var(--gp-gold)]">
                  {t(tool.title)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="gp-eyebrow">{t('footer.explore')}</p>
          <ul className="mt-4 grid gap-2.5 text-sm">
            {([['/', 'nav.home'], ['/tools', 'footer.dashboard'], ['/swap-bridge', 'nav.swapBridge'], ['/premium', 'nav.premium']] as const).map(([to, key]) => (
              <li key={to}>
                <Link to={to} className="text-mist transition-colors hover:text-[var(--gp-gold)]">
                  {t(key)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="mx-auto mt-10 max-w-6xl px-4 text-xs text-mist/70 sm:px-6">{t('footer.tagline')}</p>
      <DeveloperSignature />
    </footer>
  )
}
