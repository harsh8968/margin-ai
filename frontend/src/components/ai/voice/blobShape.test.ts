import { describe, expect, it } from 'vitest'

import type { BlobFrame, BlobState } from './blobShape'
import { MAX_DEFORM, STATE_TOKENS, mix, outline, radiusAt, withAlpha } from './blobShape'

const STATES: BlobState[] = ['idle', 'connecting', 'listening', 'thinking', 'speaking', 'ended', 'error']
const frame = (over: Partial<BlobFrame> = {}): BlobFrame => ({ time: 1.3, level: 0, state: 'idle', lean: { x: 0, y: 0 }, reducedMotion: false, ...over })
const meanRadius = (f: BlobFrame) => {
  let sum = 0
  for (let i = 0; i < 360; i++) sum += radiusAt((i / 360) * Math.PI * 2, f)
  return sum / 360
}

describe('blob shape', () => {
  it('never leaves its bounds, whatever the state, loudness or pointer', () => {
    for (const state of STATES) {
      for (const level of [0, 0.5, 1, 7]) {
        for (let t = 0; t < 20; t += 0.7) {
          for (let a = 0; a < Math.PI * 2; a += 0.2) {
            const r = radiusAt(a, frame({ state, level, time: t, lean: { x: 3, y: -3 } }))
            expect(r).toBeGreaterThanOrEqual(1 - MAX_DEFORM)
            expect(r).toBeLessThanOrEqual(1 + MAX_DEFORM)
          }
        }
      }
    }
  })

  it("swells with the tutor's voice", () => {
    expect(meanRadius(frame({ state: 'speaking', level: 1 }))).toBeGreaterThan(meanRadius(frame({ state: 'speaking', level: 0 })) + 0.05)
  })

  it('holds still over time when the user prefers reduced motion', () => {
    const a = radiusAt(0.8, frame({ state: 'thinking', time: 0, reducedMotion: true }))
    const b = radiusAt(0.8, frame({ state: 'thinking', time: 9, reducedMotion: true }))
    expect(a).toBe(b)
  })

  it('outlines a closed ring of points around the centre', () => {
    const points = outline(frame(), 100, 100, 50)
    expect(points.length).toBeGreaterThan(60)
    points.forEach(([x, y]) => expect(Math.hypot(x - 100, y - 100)).toBeLessThanOrEqual(50 * (1 + MAX_DEFORM) + 1e-9))
  })

  it('paints every state from theme tokens', () => {
    STATES.forEach((s) => expect(STATE_TOKENS[s].body).toMatch(/^--color-/))
  })
})

describe('colour helpers', () => {
  it('adds alpha to hex colours and mixes them', () => {
    expect(withAlpha('#c43d2f', 0.5)).toBe('rgba(196, 61, 47, 0.5)')
    expect(mix('#000000', '#ffffff', 0.5)).toBe('rgb(128, 128, 128)')
    expect(withAlpha('red', 0.5)).toBe('red') // non-hex values pass through
  })
})
