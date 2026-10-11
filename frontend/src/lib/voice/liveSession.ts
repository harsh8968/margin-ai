/**
 * One spoken session with Gemini Live, opened with the single-use token from our backend.
 * Survives the ~10-minute connection rollover by resuming with the latest session handle.
 */
import type { Session } from '@google/genai'

import { INPUT_RATE } from './pcm'
import type { LiveEvents, LiveMessage } from './protocol'
import { routeServerMessage } from './protocol'

export interface LiveSessionEvents extends LiveEvents {
  /** The connection ended without us closing it. */
  closed: (reason: string) => void
}

export interface LiveHandle {
  sendAudio(base64Pcm: string): void
  sendText(text: string): void
  /** Latest handle for resuming this conversation on a new connection, if the server sent one. */
  resumeHandle(): string | undefined
  close(): void
}

interface Connection {
  session: Session
  retire: () => void
}

export async function connectLive(token: string, model: string, events: LiveSessionEvents, resumeFrom?: string): Promise<LiveHandle> {
  const { GoogleGenAI } = await import('@google/genai') // ~100 kB: load only when a session starts
  const ai = new GoogleGenAI({ apiKey: token })
  let handle = resumeFrom
  let current: Connection | null = null
  let closedByUs = false
  let rolling = false

  const open = async (): Promise<Connection> => {
    let retired = false
    let self: Session | null = null
    const session = await ai.live.connect({
      model,
      config: { sessionResumption: handle ? { handle } : {} },
      callbacks: {
        onmessage: (message) => {
          if (retired) return
          const routed = routeServerMessage(message as LiveMessage, events)
          if (routed.resumeHandle) handle = routed.resumeHandle
          if (routed.toolReplies.length) self?.sendToolResponse({ functionResponses: routed.toolReplies })
          if (routed.goAway) void rollOver()
        },
        onerror: () => undefined, // onclose follows with the reason
        onclose: (event) => {
          if (!retired && !closedByUs) events.closed(event.reason || 'The connection to Gemini closed.')
        },
      },
    })
    self = session
    return {
      session,
      retire: () => {
        retired = true
        session.close()
      },
    }
  }

  const rollOver = async () => {
    if (rolling || closedByUs || !handle) return
    rolling = true
    const previous = current
    try {
      current = await open()
      previous?.retire()
    } catch (error) {
      events.closed(error instanceof Error ? error.message : 'Could not resume the session.')
    } finally {
      rolling = false
    }
  }

  current = await open()
  return {
    sendAudio: (data) => current?.session.sendRealtimeInput({ audio: { data, mimeType: `audio/pcm;rate=${INPUT_RATE}` } }),
    sendText: (text) => current?.session.sendRealtimeInput({ text }),
    resumeHandle: () => handle,
    close: () => {
      closedByUs = true
      current?.retire()
      current = null
    },
  }
}
