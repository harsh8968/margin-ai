/**
 * The voice blob's outline and colours as pure maths, so the canvas component only draws.
 * Radius is a few layered sine "lobes" whose speed and depth depend on what the tutor is doing
 * and how loud the active speaker is.
 */

export type BlobState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'ended' | 'error'

export interface BlobFrame {
  time: number
  level: number
  state: BlobState
  lean: { x: number; y: number }
  reducedMotion: boolean
}

/** The blob never stretches beyond ±MAX_DEFORM of its base radius, so it always fits its canvas. */
export const MAX_DEFORM = 0.3
const OUTLINE_POINTS = 120

interface Motion {
  calm: number
  speed: number
  react: number
  lobes: readonly [number, number, number]
}

const MOTION: Record<BlobState, Motion> = {
  idle: { calm: 0.03, speed: 0.5, react: 0, lobes: [2, 3, 5] },
  connecting: { calm: 0.07, speed: 2.4, react: 0, lobes: [3, 5, 7] },
  listening: { calm: 0.035, speed: 1.0, react: 0.16, lobes: [3, 4, 6] },
  thinking: { calm: 0.06, speed: 1.8, react: 0, lobes: [2, 5, 7] },
  speaking: { calm: 0.04, speed: 1.5, react: 0.22, lobes: [3, 5, 8] },
  ended: { calm: 0.02, speed: 0.3, react: 0, lobes: [2, 3, 5] },
  error: { calm: 0.02, speed: 0.3, react: 0, lobes: [2, 3, 5] },
}

/** Green = your turn, red pen = the tutor talking, amber = working on it. */
export const STATE_TOKENS: Record<BlobState, { body: string; glow: string }> = {
  idle: { body: '--color-ink', glow: '--color-pen' },
  connecting: { body: '--color-ink', glow: '--color-partial' },
  listening: { body: '--color-grounded', glow: '--color-grounded' },
  thinking: { body: '--color-ink', glow: '--color-partial' },
  speaking: { body: '--color-pen', glow: '--color-pen' },
  ended: { body: '--color-ink-soft', glow: '--color-ink-faint' },
  error: { body: '--color-missing', glow: '--color-missing' },
}

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value))

/** Radius at `angle`, as a multiple of the base radius. */
export function radiusAt(angle: number, f: BlobFrame): number {
  const m = MOTION[f.state]
  const level = clamp(f.level, 0, 1)
  const t = f.reducedMotion ? 0 : f.time * m.speed
  const [a, b, c] = m.lobes
  const ripple = Math.sin(a * angle + t) * 0.5 + Math.sin(b * angle - t * 1.3 + 1.7) * 0.3 + Math.sin(c * angle + t * 0.7 + 4.1) * 0.2
  const depth = (f.reducedMotion ? m.calm * 0.5 : m.calm) + level * m.react
  const swell = level * m.react * 0.5
  const breath = f.reducedMotion ? 0 : Math.sin(f.time * 0.9) * 0.015
  const lean = clamp(f.lean.x, -1, 1) * Math.cos(angle) * 0.05 + clamp(f.lean.y, -1, 1) * Math.sin(angle) * 0.05
  return clamp(1 + breath + swell + depth * ripple + lean, 1 - MAX_DEFORM, 1 + MAX_DEFORM)
}

export function outline(f: BlobFrame, cx: number, cy: number, base: number): [number, number][] {
  return Array.from({ length: OUTLINE_POINTS }, (_, i): [number, number] => {
    const angle = (i / OUTLINE_POINTS) * Math.PI * 2
    const r = radiusAt(angle, f) * base
    return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]
  })
}

function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return null
  const n = parseInt(match[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function withAlpha(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex)
  return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})` : hex
}

export function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a)
  const y = hexToRgb(b)
  if (!x || !y) return a
  const channel = (i: number) => Math.round(x[i] + (y[i] - x[i]) * t)
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`
}
