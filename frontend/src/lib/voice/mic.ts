/**
 * Microphone → 16 kHz PCM16 chunks for Gemini Live. An AudioWorklet copies raw frames off the
 * audio thread; we downsample, batch ~100 ms and hand back base64 chunks.
 */
import { INPUT_RATE, concatFloat, createDownsampler, floatToPcm16Base64, rms } from './pcm'

export interface MicHandle {
  stop(): void
  setMuted(muted: boolean): void
  /** RMS of the latest frame (0 while muted). */
  level(): number
}

const CHUNK_SAMPLES = INPUT_RATE / 10 // ~100 ms per message, as the Live API recommends

const TAP_WORKLET = `
class MicTap extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (channel) this.port.postMessage(channel.slice(0))
    return true
  }
}
registerProcessor('mic-tap', MicTap)
`

let workletUrl: string | null = null
const tapUrl = () => (workletUrl ??= URL.createObjectURL(new Blob([TAP_WORKLET], { type: 'text/javascript' })))

export async function openMic(onChunk: (base64Pcm: string) => void): Promise<MicHandle> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot record audio.')
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  })
  const ctx = new AudioContext()
  try {
    await ctx.resume()
    await ctx.audioWorklet.addModule(tapUrl())
    const source = ctx.createMediaStreamSource(stream)
    const tap = new AudioWorkletNode(ctx, 'mic-tap')
    source.connect(tap)
    tap.connect(ctx.destination) // the tap outputs silence; connecting keeps it scheduled

    const downsample = createDownsampler(ctx.sampleRate)
    let pending: Float32Array[] = []
    let pendingLength = 0
    let muted = false
    let level = 0

    tap.port.onmessage = ({ data }: MessageEvent<Float32Array>) => {
      level = muted ? 0 : rms(data)
      if (muted) return
      const down = downsample(data)
      pending.push(down)
      pendingLength += down.length
      if (pendingLength < CHUNK_SAMPLES) return
      onChunk(floatToPcm16Base64(concatFloat(pending)))
      pending = []
      pendingLength = 0
    }

    return {
      stop: () => {
        tap.port.onmessage = null
        source.disconnect()
        tap.disconnect()
        stream.getTracks().forEach((track) => track.stop())
        void ctx.close()
      },
      setMuted: (next) => {
        muted = next
        pending = []
        pendingLength = 0
      },
      level: () => level,
    }
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop())
    void ctx.close()
    throw error
  }
}

/** A student-friendly message for getUserMedia failures, or null for anything else. */
export function micErrorMessage(error: unknown): string | null {
  const name = typeof error === 'object' && error !== null && 'name' in error ? String((error as { name: unknown }).name) : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return "Microphone blocked. Allow it from the browser's address bar, then press Start again."
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone found. Plug one in, then press Start again.'
  if (name === 'NotReadableError') return 'The microphone is busy in another app. Close it there, then press Start again.'
  return null
}
