export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="gp-lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff1b8" />
          <stop offset="0.5" stopColor="#f5c542" />
          <stop offset="1" stopColor="#c99a2e" />
        </linearGradient>
      </defs>
      <rect x="3" y="3" width="12" height="12" rx="3" fill="url(#gp-lg)" />
      <rect x="17" y="3" width="12" height="12" rx="3" fill="url(#gp-lg)" opacity="0.55" />
      <rect x="3" y="17" width="12" height="12" rx="3" fill="url(#gp-lg)" opacity="0.55" />
      <rect x="17" y="17" width="12" height="12" rx="3" fill="url(#gp-lg)" opacity="0.22" />
    </svg>
  )
}

/**
 * `tightEn` hides the text under 460px in English only: the English header (longer wallet label) cannot fit the
 * wordmark text together with the language switch, wallet button and menu button between 420px and 460px.
 */
export function Wordmark({ tightEn = false }: { tightEn?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <span className={`hidden font-display text-lg font-bold tracking-tight min-[420px]:inline${tightEn ? ' [:lang(en)_&]:max-[459px]:hidden' : ''}`}>
        Golden<span className="gp-gold-text">Pixel</span>
      </span>
    </span>
  )
}
