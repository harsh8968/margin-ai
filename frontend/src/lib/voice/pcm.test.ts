import { describe, expect, it } from 'vitest'

import { createDownsampler, floatToPcm16Base64, loudness, pcm16Base64ToFloat, rms } from './pcm'

const bytesOf = (base64: string) => Array.from(atob(base64), (c) => c.charCodeAt(0))

describe('PCM16 encoding', () => {
  it('round-trips samples within one quantisation step', () => {
    const samples = Float32Array.from([0, 0.5, -0.5, 0.999, -1])
    const back = pcm16Base64ToFloat(floatToPcm16Base64(samples))
    samples.forEach((s, i) => expect(back[i]).toBeCloseTo(s, 4))
  })

  it('writes little-endian 16-bit and clips out-of-range input', () => {
    expect(bytesOf(floatToPcm16Base64(Float32Array.from([2, -2])))).toEqual([0xff, 0x7f, 0x00, 0x80])
  })

  it('ignores a trailing odd byte', () => {
    expect(Array.from(pcm16Base64ToFloat(btoa('\x00\x40\x01')))).toEqual([0.5])
  })
})

describe('createDownsampler', () => {
  it('turns 48 kHz into 16 kHz', () => {
    expect(createDownsampler(48_000)(new Float32Array(4800)).length).toBe(1600)
  })

  it('keeps a 44.1 kHz stream in step across odd-sized chunks', () => {
    const down = createDownsampler(44_100)
    let total = 0
    let input = 0
    for (let i = 0; i < 100; i++) {
      const chunk = new Float32Array(441 + (i % 3)).fill(0.25)
      input += chunk.length
      const out = down(chunk)
      total += out.length
      out.forEach((v) => expect(v).toBeCloseTo(0.25, 6))
    }
    expect(Math.abs(total - Math.floor((input * 16_000) / 44_100))).toBeLessThanOrEqual(1)
  })

  it('passes 16 kHz through unchanged', () => {
    expect(Array.from(createDownsampler(16_000)(Float32Array.from([0.1, 0.2])))).toEqual([Math.fround(0.1), Math.fround(0.2)])
  })

  it('rejects microphones slower than 16 kHz', () => {
    expect(() => createDownsampler(8_000)).toThrow(/16 kHz/)
  })
})

describe('levels', () => {
  it('measures RMS', () => {
    expect(rms(new Float32Array(8))).toBe(0)
    expect(rms(Float32Array.from([0.5, -0.5]))).toBeCloseTo(0.5)
  })

  it('maps RMS onto a 0..1 loudness that rises with volume', () => {
    expect(loudness(0)).toBe(0)
    expect(loudness(1)).toBe(1)
    expect(loudness(0.05)).toBeGreaterThan(loudness(0.01))
  })
})
