/**
 * Gapless playback of Gemini Live's 24 kHz PCM16 replies. `flush()` cuts the tutor off
 * instantly when the student interrupts.
 */
import { OUTPUT_RATE, pcm16Base64ToFloat, rms } from './pcm'

export interface Player {
  play(base64Pcm: string): void
  flush(): void
  /** RMS of what is playing right now. */
  level(): number
  isPlaying(): boolean
  close(): void
}

const START_LEAD_S = 0.02 // a tiny lead on the first chunk avoids a click

export function scheduleStart(currentTime: number, playhead: number, lead = START_LEAD_S): number {
  return Math.max(currentTime + lead, playhead)
}

export function createPlayer(): Player {
  const ctx = new AudioContext({ sampleRate: OUTPUT_RATE })
  void ctx.resume()
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  analyser.connect(ctx.destination)
  const frame = new Float32Array(analyser.fftSize)
  const sources = new Set<AudioBufferSourceNode>()
  let playhead = 0

  const flush = () => {
    sources.forEach((source) => source.stop())
    sources.clear()
    playhead = 0
  }

  return {
    play(base64Pcm) {
      const samples = pcm16Base64ToFloat(base64Pcm)
      if (samples.length === 0) return
      const buffer = ctx.createBuffer(1, samples.length, OUTPUT_RATE)
      buffer.copyToChannel(samples, 0)
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(analyser)
      const startAt = scheduleStart(ctx.currentTime, playhead)
      source.start(startAt)
      playhead = startAt + buffer.duration
      sources.add(source)
      source.onended = () => sources.delete(source)
    },
    flush,
    level() {
      analyser.getFloatTimeDomainData(frame)
      return rms(frame)
    },
    isPlaying: () => ctx.currentTime < playhead,
    close() {
      flush()
      void ctx.close()
    },
  }
}
