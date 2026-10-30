import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react'

// Tiny path-based router (no dependency). Works with Vite's SPA fallback.
const listeners = new Set<() => void>()

function subscribe(cb: () => void) {
  listeners.add(cb)
  window.addEventListener('popstate', cb)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('popstate', cb)
  }
}

export function usePath(): string {
  return useSyncExternalStore(
    subscribe,
    () => window.location.pathname.replace(/\/+$/, '') || '/',
    () => '/',
  )
}

export function navigate(to: string) {
  if (to === window.location.pathname) return
  window.history.pushState({}, '', to)
  listeners.forEach((l) => l())
  window.scrollTo({ top: 0 })
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { to: string }

export function Link({ to, onClick, children, ...rest }: LinkProps) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e)
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    navigate(to)
  }
  return (
    <a href={to} onClick={handle} {...rest}>
      {children}
    </a>
  )
}
