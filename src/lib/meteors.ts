/**
 * Meteor shower model and renderer (pure logic plus a small Canvas 2D painter, no React).
 *
 * Every meteor travels the same way: it enters from the right edge or the upper-right part of the top edge and moves
 * diagonally to the lower left, at roughly 30 to 40 degrees below the horizontal. The head always leads; the tail is a
 * tapered ribbon of light that trails exactly opposite to the direction of travel.
 */
export type Rand = () => number

export const ANGLE_MIN_DEG = 30
export const ANGLE_MAX_DEG = 40

export type MeteorConfig = {
  mobile: boolean
  /** 0.55 to 1: trail length and thickness follow the screen size. */
  scale: number
  maxActive: number
  /** Seconds between meteors. */
  minGap: number
  maxGap: number
}

export function configFor(width: number, height: number): MeteorConfig {
  const mobile = width < 640
  return {
    mobile,
    scale: Math.min(1, Math.max(0.55, Math.max(width, height) / 1500)),
    maxActive: mobile ? 2 : 3,
    minGap: mobile ? 3.2 : 2.2,
    maxGap: mobile ? 8 : 6.5,
  }
}

export type Meteor = {
  /** Head position in CSS pixels. */
  x: number
  y: number
  /** Unit direction of travel: dx < 0 (leftwards) and dy > 0 (downwards). */
  dx: number
  dy: number
  speed: number
  length: number
  /** Half-width of the tail at the head, in pixels. */
  width: number
  glow: number
  brightness: number
  travelled: number
  fadeIn: number
  /** Distance along the path at which the meteor has fully burned out. */
  lifePath: number
  phase: number
}

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a || 1)))
  return t * t * (3 - 2 * t)
}

/** Seconds until the next meteor. Mostly relaxed gaps, occasionally a quick follow-up. */
export function nextDelay(rand: Rand, cfg: MeteorConfig): number {
  if (rand() < 0.12) return 0.35 + rand() * 0.6
  return cfg.minGap + rand() * (cfg.maxGap - cfg.minGap)
}

export function spawnMeteor(rand: Rand, width: number, height: number, cfg: MeteorConfig): Meteor {
  const angle = ((ANGLE_MIN_DEG + rand() * (ANGLE_MAX_DEG - ANGLE_MIN_DEG)) * Math.PI) / 180
  const dx = -Math.cos(angle)
  const dy = Math.sin(angle)
  // Entry point: the right edge (upper half) or the far-right part of the top edge, so meteors clearly come from the right.
  const fromRight = rand() < 0.6
  const entryX = fromRight ? width : width * (0.62 + 0.38 * rand())
  const entryY = fromRight ? height * 0.5 * rand() : 0
  const lead = 24 * cfg.scale
  const x = entryX - dx * lead
  const y = entryY - dy * lead

  const pad = 40 * cfg.scale
  const speed = Math.min(1500, Math.max(380, (0.5 + 0.5 * rand()) * Math.max(width, height) * 0.85))
  const speedNorm = (speed - 380) / 1120
  const length = (150 + rand() * 190) * cfg.scale * (0.85 + 0.3 * speedNorm)
  // Distance the head travels before it leaves the viewport on the left or at the bottom.
  const toLeft = (x + pad) / -dx
  const toBottom = (height + pad - y) / dy
  const pathLen = Math.max(1, Math.min(toLeft, toBottom))
  return {
    x,
    y,
    dx,
    dy,
    speed,
    length,
    width: (0.85 + rand() * 0.7) * (0.8 + 0.2 * cfg.scale),
    glow: (5 + rand() * 4) * (0.8 + 0.2 * cfg.scale),
    brightness: 0.6 + 0.4 * rand(),
    travelled: 0,
    fadeIn: Math.max(140 * cfg.scale, speed * 0.2),
    // About half of the meteors burn out on screen, the rest streak all the way to the edge.
    lifePath: rand() < 0.5 ? pathLen * (0.55 + 0.4 * rand()) : pathLen + length + 40,
    phase: rand() * Math.PI * 2,
  }
}

export function stepMeteor(m: Meteor, dt: number): void {
  const d = m.speed * dt
  m.x += m.dx * d
  m.y += m.dy * d
  m.travelled += d
}

/** 0 to 1 light level: eases in as the meteor enters and eases out as it burns away. */
export function envelope(m: Meteor): number {
  // The light eases in and out over at least a fifth of a second, however fast the meteor is.
  const fadeOut = Math.min(m.lifePath * 0.6, m.speed * 0.5)
  return smooth(0, m.fadeIn, m.travelled) * smooth(0, fadeOut, m.lifePath - m.travelled)
}

export function isDone(m: Meteor, height: number): boolean {
  if (m.travelled >= m.lifePath) return true
  const tailX = m.x - m.dx * m.length
  const tailY = m.y - m.dy * m.length
  return tailX < -20 || tailY > height + 20
}

/** Light colour along the tail, from the white-hot head to a dim amber end. */
const stops: [number, string][] = [
  [0, '255,248,228'],
  [0.12, '255,226,150'],
  [0.45, '245,197,66'],
  [1, '200,120,30'],
]

const SAMPLES = 14

/** Tapered ribbon from the head backwards: `halfWidth` at the head shrinking to a point at the tail end. */
function ribbon(ctx: CanvasRenderingContext2D, m: Meteor, length: number, halfWidth: number) {
  const nx = -m.dy
  const ny = m.dx
  const top: [number, number][] = []
  const bottom: [number, number][] = []
  for (let i = 0; i <= SAMPLES; i++) {
    const s = i / SAMPLES
    const w = halfWidth * Math.pow(1 - s, 1.35)
    const px = m.x - m.dx * length * s
    const py = m.y - m.dy * length * s
    top.push([px + nx * w, py + ny * w])
    bottom.push([px - nx * w, py - ny * w])
  }
  ctx.beginPath()
  ctx.moveTo(top[0][0], top[0][1])
  for (const p of top) ctx.lineTo(p[0], p[1])
  for (let i = bottom.length - 1; i >= 0; i--) ctx.lineTo(bottom[i][0], bottom[i][1])
  ctx.closePath()
}

function trailGradient(ctx: CanvasRenderingContext2D, m: Meteor, length: number, alpha: number) {
  const g = ctx.createLinearGradient(m.x, m.y, m.x - m.dx * length, m.y - m.dy * length)
  const fade = [1, 0.62, 0.2, 0]
  stops.forEach(([at, rgb], i) => g.addColorStop(at, `rgba(${rgb},${(alpha * (fade[i] ?? 0)).toFixed(3)})`))
  return g
}

/** Paints one meteor with additive light: soft outer glow, tapered tail, bright core and a small illuminated head. */
export function drawMeteor(ctx: CanvasRenderingContext2D, m: Meteor, time: number, level = envelope(m)): void {
  // A slow, small shimmer; never a flicker.
  const a = level * m.brightness * (0.95 + 0.05 * Math.sin(time * 9 + m.phase))
  if (a <= 0.003) return
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.fillStyle = trailGradient(ctx, m, m.length, a * 0.16)
  ribbon(ctx, m, m.length, m.width * 3.4)
  ctx.fill()
  ctx.fillStyle = trailGradient(ctx, m, m.length, a * 0.68)
  ribbon(ctx, m, m.length, m.width * 1.75)
  ctx.fill()
  ctx.fillStyle = trailGradient(ctx, m, m.length * 0.5, a)
  ribbon(ctx, m, m.length * 0.5, m.width * 0.65)
  ctx.fill()
  const halo = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.glow)
  halo.addColorStop(0, `rgba(255,244,214,${(a * 0.85).toFixed(3)})`)
  halo.addColorStop(0.35, `rgba(255,214,120,${(a * 0.32).toFixed(3)})`)
  halo.addColorStop(1, 'rgba(245,197,66,0)')
  ctx.fillStyle = halo
  ctx.beginPath()
  ctx.arc(m.x, m.y, m.glow, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = `rgba(255,252,240,${Math.min(1, a * 1.1).toFixed(3)})`
  ctx.beginPath()
  ctx.arc(m.x, m.y, Math.max(0.9, m.width * 0.95), 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** A single frozen meteor for visitors who prefer reduced motion. */
export function staticMeteor(width: number, height: number, cfg: MeteorConfig): Meteor {
  const angle = (35 * Math.PI) / 180
  return {
    x: width * 0.66,
    y: height * 0.2,
    dx: -Math.cos(angle),
    dy: Math.sin(angle),
    speed: 0,
    length: 230 * cfg.scale,
    width: 1.1,
    glow: 6,
    brightness: 0.45,
    travelled: 1000,
    fadeIn: 1,
    lifePath: 1e9,
    phase: 0,
  }
}
