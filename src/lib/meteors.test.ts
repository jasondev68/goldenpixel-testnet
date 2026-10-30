import { describe, expect, test } from 'bun:test'
import { ANGLE_MAX_DEG, ANGLE_MIN_DEG, configFor, envelope, isDone, nextDelay, spawnMeteor, stepMeteor } from './meteors'

// Small deterministic generator so the tests are repeatable.
const seeded = (seed: number) => {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}
const SIZES: [number, number][] = [[390, 844], [768, 1024], [1280, 720], [1440, 900], [1920, 1080], [2560, 1440]]

describe('meteor trajectories', () => {
  test('every meteor enters from the right or the top-right and starts off screen', () => {
    for (const [w, h] of SIZES) {
      const rand = seeded(w + h)
      const cfg = configFor(w, h)
      for (let i = 0; i < 200; i++) {
        const m = spawnMeteor(rand, w, h, cfg)
        expect(m.x > w || m.y < 0).toBe(true)
        expect(m.x > w * 0.6).toBe(true)
      }
    }
  })

  test('direction is always right-to-left and downward at 30 to 40 degrees', () => {
    for (const [w, h] of SIZES) {
      const rand = seeded(7 * w)
      for (let i = 0; i < 300; i++) {
        const m = spawnMeteor(rand, w, h, configFor(w, h))
        expect(m.dx < 0).toBe(true)
        expect(m.dy > 0).toBe(true)
        expect(Math.abs(Math.hypot(m.dx, m.dy) - 1) < 1e-9).toBe(true)
        const deg = (Math.atan2(m.dy, -m.dx) * 180) / Math.PI
        expect(deg >= ANGLE_MIN_DEG - 1e-9 && deg <= ANGLE_MAX_DEG + 1e-9).toBe(true)
      }
    }
  })

  test('the head leads: it moves left and down while the tail stays up and to the right of it', () => {
    const rand = seeded(99)
    const m = spawnMeteor(rand, 1440, 900, configFor(1440, 900))
    let px = m.x
    let py = m.y
    for (let i = 0; i < 60; i++) {
      stepMeteor(m, 1 / 60)
      expect(m.x < px && m.y > py).toBe(true)
      px = m.x
      py = m.y
      const tailX = m.x - m.dx * m.length
      const tailY = m.y - m.dy * m.length
      expect(tailX > m.x && tailY < m.y).toBe(true)
    }
  })

  test('movement depends on elapsed time, not on the frame rate', () => {
    const a = spawnMeteor(seeded(5), 1440, 900, configFor(1440, 900))
    const b = spawnMeteor(seeded(5), 1440, 900, configFor(1440, 900))
    for (let i = 0; i < 60; i++) stepMeteor(a, 1 / 60)
    for (let i = 0; i < 30; i++) stepMeteor(b, 1 / 30)
    expect(Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6).toBe(true)
  })

  test('every meteor eventually finishes, fades in and out smoothly, and never lingers', () => {
    for (const [w, h] of SIZES) {
      const rand = seeded(w * 3)
      const cfg = configFor(w, h)
      for (let i = 0; i < 150; i++) {
        const m = spawnMeteor(rand, w, h, cfg)
        expect(envelope(m)).toBe(0)
        let t = 0
        let prev = 0
        let maxStep = 0
        while (!isDone(m, h) && t < 10) {
          stepMeteor(m, 1 / 60)
          t += 1 / 60
          const e = envelope(m)
          maxStep = Math.max(maxStep, Math.abs(e - prev))
          prev = e
        }
        expect(t < 10).toBe(true)
        expect(maxStep < 0.16).toBe(true)
      }
    }
  })

  test('meteors are sparse and irregular, with fewer on phones', () => {
    expect(configFor(390, 844).maxActive < configFor(1440, 900).maxActive).toBe(true)
    const rand = seeded(11)
    const cfg = configFor(1440, 900)
    const gaps = Array.from({ length: 200 }, () => nextDelay(rand, cfg))
    expect(Math.min(...gaps) > 0.3 && Math.max(...gaps) <= cfg.maxGap).toBe(true)
    expect(new Set(gaps.map((g) => g.toFixed(2))).size > 150).toBe(true)
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length
    expect(mean > 2 && mean < 6).toBe(true)
  })
})
