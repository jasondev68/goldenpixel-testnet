import { useEffect, useState } from 'react'
import { Menu, X } from 'lucide-react'
import { Link, usePath } from '@/lib/router'
import { TOOLS } from '@/lib/tools'
import { Wordmark } from './Logo'
import { WalletButton } from './wallet/WalletButton'
import { LangSwitch } from './LangSwitch'
import { useI18n, type TKey } from '@/i18n'

const LINKS: { to: string; label: TKey }[] = [
  { to: '/tools', label: 'nav.dashboard' },
  ...TOOLS.map((tool) => ({ to: tool.path, label: tool.short })),
  { to: '/swap-bridge', label: 'nav.swapBridge' },
  { to: '/premium', label: 'nav.premium' },
]

export function Nav() {
  const path = usePath()
  const { t } = useI18n()
  const [openFor, setOpenFor] = useState<string | null>(null)
  const open = openFor === path
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])

  const isActive = (to: string) => path === to || path.startsWith(`${to}/`)

  return (
    <header
      className={`sticky top-0 z-40 border-b transition-colors duration-300 ${
        scrolled || open ? 'border-[var(--gp-line)] bg-[#05050a]/80 backdrop-blur-xl' : 'border-transparent bg-transparent'
      }`}
    >
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6" aria-label={t('nav.main')}>
        <Link to="/" aria-label={t('nav.home.aria')} className="rounded-lg">
          <Wordmark tightEn />
        </Link>

        <ul className="hidden items-center gap-0.5 xl:flex">
          {LINKS.map((l) => (
            <li key={l.to}>
              <Link
                to={l.to}
                aria-current={isActive(l.to) ? 'page' : undefined}
                className={`relative inline-flex min-h-[44px] items-center px-3 text-sm font-medium transition-colors ${
                  isActive(l.to) ? 'text-[var(--gp-gold)]' : 'text-mist hover:text-ink'
                }`}
              >
                {t(l.label)}
                {isActive(l.to) && <span className="absolute inset-x-3 bottom-1.5 h-px bg-[var(--gp-gold)] shadow-[0_0_8px_var(--gp-gold)]" />}
              </Link>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2">
          <LangSwitch />
          <WalletButton />
          <button
            type="button"
            className="gp-btn gp-btn-ghost !px-0 w-11 xl:hidden"
            aria-label={open ? t('nav.menu.close') : t('nav.menu.open')}
            aria-expanded={open}
            aria-controls="mobile-menu"
            onClick={() => setOpenFor(open ? null : path)}
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </nav>

      {open && (
        <div id="mobile-menu" className="gp-page border-t border-[var(--gp-line)] px-4 pb-4 pt-2 xl:hidden">
          <ul className="mx-auto grid max-w-6xl gap-1">
            {[{ to: '/', label: 'nav.home' as TKey }, ...LINKS].map((l) => (
              <li key={l.to}>
                <Link
                  to={l.to}
                  aria-current={isActive(l.to) ? 'page' : undefined}
                  className={`flex min-h-[48px] items-center rounded-xl px-4 text-base font-medium ${
                    isActive(l.to) ? 'bg-[rgba(245,197,66,0.1)] text-[var(--gp-gold)]' : 'text-ink hover:bg-white/5'
                  }`}
                >
                  {t(l.label)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </header>
  )
}
