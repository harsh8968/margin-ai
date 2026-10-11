/**
 * Audio sample plumbing for the voice tutor. Gemini Live takes 16-bit little-endian PCM at
 * 16 kHz mono and answers at 24 kHz; browsers record at 44.1 or 48 kHz.
 */

export const INPUT_RATE = 16_000
export const OUTPUT_RATE = 24_000

export function concatFloat(chunks: Float32Array[]): Float32Array<ArrayBuffer> {
  const out = new Float32Array(chunks.reduce((sum, c) => sum + c.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

/**
 * Box-filter downsampler that carries leftover samples *and* the fractional read position
 * between calls, so odd-sized frames (and 44.1 kHz's non-integer ratio) never drift or click.
 */
export function createDownsampler(fromRate: number, toRate = INPUT_RATE): (input: Float32Array) => Float32Array<ArrayBuffer> {
  if (fromRate < toRate) throw new Error(`Microphones below ${toRate / 1000} kHz are not supported`)
  const ratio = fromRate / toRate
  let pending: Float32Array = new Float32Array(0)
  let phase = 0 // where the next output sample starts inside `pending`, in input samples (0 ≤ phase < 1)
  return (input) => {
    const samples = concatFloat([pending, input])
    const count = Math.floor((samples.length - phase) / ratio)
    const out = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      const start = Math.floor(phase + i * ratio)
      const end = Math.floor(phase + (i + 1) * ratio)
      let sum = 0
      for (let j = start; j < end; j++) sum += samples[j]
      out[i] = sum / (end - start)
    }
    const consumed = phase + count * ratio
    pending = samples.slice(Math.floor(consumed))
    phase = consumed - Math.floor(consumed)
    return out
  }
}

export function floatToPcm16Base64(samples: Float32Array): string {
  const view = new DataView(new ArrayBuffer(samples.length * 2))
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return bytesToBase64(new Uint8Array(view.buffer))
}

export function pcm16Base64ToFloat(base64: string): Float32Array<ArrayBuffer> {
  const bytes = base64ToBytes(base64)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out = new Float32Array(Math.floor(bytes.byteLength / 2))
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 0x8000
  return out
}

export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (const s of samples) sum += s * s
  return Math.sqrt(sum / samples.length)
}

/** RMS → 0..1 on a decibel scale: -60 dB (room hiss) is 0, -10 dB (close, loud speech) is 1. */
export function loudness(value: number): number {
  if (value <= 0) return 0
  return Math.min(1, Math.max(0, (20 * Math.log10(value) + 60) / 50))
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000 // String.fromCharCode has an argument-count limit
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(binary)
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
