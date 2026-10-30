import { memo, useEffect, useRef } from 'react'
import { type Meteor, configFor, drawMeteor, isDone, nextDelay, spawnMeteor, staticMeteor, stepMeteor } from '@/lib/meteors'

/**
 * Decorative meteor shower on a single canvas behind the page. All animation state lives in refs and a
 * requestAnimationFrame loop, so React never re-renders per frame. Meteors move by elapsed time (frame-rate
 * independent), the canvas follows the device pixel ratio, and everything is cleaned up on unmount.
 */
function MeteorShowerBase() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let width = 0
    let height = 0
    let cfg = configFor(window.innerWidth, window.innerHeight)
    let meteors: Meteor[] = []
    let raf = 0
    let last = 0
    let clock = 0
    let untilNext = 0.8 + Math.random() * 1.2
    let dirty = false

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      width = window.innerWidth
      height = window.innerHeight
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      cfg = configFor(width, height)
      if (motion.matches) paintStill()
    }

    const paintStill = () => {
      ctx.clearRect(0, 0, width, height)
      drawMeteor(ctx, staticMeteor(width, height, cfg), 0, 1)
    }

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      // Elapsed time, clamped so a background tab or a long frame never makes a meteor jump.
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016)
      last = now
      clock += dt
      untilNext -= dt
      if (untilNext <= 0 && meteors.length < cfg.maxActive) {
        meteors.push(spawnMeteor(Math.random, width, height, cfg))
        untilNext = nextDelay(Math.random, cfg)
      } else if (untilNext <= 0) untilNext = 0.5
      if (!meteors.length) {
        if (dirty) {
          ctx.clearRect(0, 0, width, height)
          dirty = false
        }
        return
      }
      ctx.clearRect(0, 0, width, height)
      for (const m of meteors) {
        stepMeteor(m, dt)
        drawMeteor(ctx, m, clock)
      }
      dirty = true
      meteors = meteors.filter((m) => !isDone(m, height))
    }

    const start = () => {
      cancelAnimationFrame(raf)
      last = 0
      if (motion.matches) {
        meteors = []
        paintStill()
        return
      }
      ctx.clearRect(0, 0, width, height)
      raf = requestAnimationFrame(frame)
    }

    const onVisibility = () => {
      if (document.hidden) cancelAnimationFrame(raf)
      else start()
    }
    let resizeTimer = 0
    const onResize = () => {
      window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(resize, 120)
    }

    resize()
    start()
    window.addEventListener('resize', onResize)
    document.addEventListener('visibilitychange', onVisibility)
    motion.addEventListener('change', start)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(resizeTimer)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVisibility)
      motion.removeEventListener('change', start)
      ctx.clearRect(0, 0, width, height)
    }
  }, [])

  return <canvas ref={canvasRef} className="gp-meteors" aria-hidden="true" />
}

export const MeteorShower = memo(MeteorShowerBase)
