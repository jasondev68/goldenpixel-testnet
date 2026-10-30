import { memo, useMemo } from 'react'
import { MeteorShower } from '@/components/MeteorShower'

// Deterministic pseudo-random so stars do not jump between renders.
function rng(seed: number) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

type Star = { x: number; y: number; size: number; d: number; delay: number; gold: boolean }

/** Lightweight galaxy: CSS twinkling stars plus a canvas meteor shower. */
function GalaxyBase() {
  const stars = useMemo<Star[]>(() => {
    const r = rng(42)
    const count = typeof window !== 'undefined' && window.innerWidth < 640 ? 40 : 70
    return Array.from({ length: count }, () => ({
      x: r() * 100,
      y: r() * 100,
      size: 1 + r() * 1.8,
      d: 3 + r() * 5,
      delay: r() * 6,
      gold: r() > 0.82,
    }))
  }, [])

  return (
    <div className="gp-galaxy" aria-hidden="true">
      {stars.map((s, i) => (
        <span
          key={i}
          className={`gp-star${s.gold ? ' is-gold' : ''}`}
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: s.size,
            height: s.size,
            ['--d' as string]: `${s.d}s`,
            ['--delay' as string]: `${s.delay}s`,
          }}
        />
      ))}
      <MeteorShower />
    </div>
  )
}

export const Galaxy = memo(GalaxyBase)
