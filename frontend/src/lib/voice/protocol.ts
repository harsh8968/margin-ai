/**
 * The parts of Gemini Live's server messages the voice tutor uses, routed to plain callbacks.
 * Kept free of the SDK so it can be unit-tested; the SDK's LiveServerMessage fits this shape.
 */

export type Speaker = 'you' | 'tutor'
export type TopicVerdict = 'strong' | 'shaky' | 'missed'

export interface VivaResult {
  score: number
  summary: string
  topics: { topic: string; verdict: TopicVerdict }[]
}

export interface LiveMessage {
  serverContent?: {
    modelTurn?: { parts?: { inlineData?: { data?: string } }[] }
    inputTranscription?: { text?: string }
    outputTranscription?: { text?: string }
    interrupted?: boolean
    turnComplete?: boolean
  }
  toolCall?: { functionCalls?: { id?: string; name?: string; args?: Record<string, unknown> }[] }
  sessionResumptionUpdate?: { newHandle?: string; resumable?: boolean }
  goAway?: { timeLeft?: string }
}

export interface LiveEvents {
  audio: (base64Pcm: string) => void
  interrupted: () => void
  turnComplete: () => void
  caption: (who: Speaker, text: string) => void
  vivaResult: (result: VivaResult) => void
}

export interface ToolReply {
  id?: string
  name?: string
  response: Record<string, unknown>
}

export interface Routed {
  resumeHandle?: string
  goAway: boolean
  toolReplies: ToolReply[]
}

const VERDICTS = new Set<string>(['strong', 'shaky', 'missed'])

export function routeServerMessage(message: LiveMessage, events: LiveEvents): Routed {
  const content = message.serverContent
  if (content?.interrupted) events.interrupted() // the student talked over the tutor: stop old audio first
  for (const part of content?.modelTurn?.parts ?? []) {
    if (part.inlineData?.data) events.audio(part.inlineData.data)
  }
  if (content?.inputTranscription?.text) events.caption('you', content.inputTranscription.text)
  if (content?.outputTranscription?.text) events.caption('tutor', content.outputTranscription.text)
  if (content?.turnComplete) events.turnComplete()

  const toolReplies = (message.toolCall?.functionCalls ?? []).map((call): ToolReply => {
    const result = call.name === 'finish_viva' ? parseVivaResult(call.args) : null
    if (result) events.vivaResult(result)
    return { id: call.id, name: call.name, response: result ? { ok: true } : { ok: false, error: 'Unrecognised or invalid call' } }
  })

  const update = message.sessionResumptionUpdate
  return {
    resumeHandle: update?.resumable && update.newHandle ? update.newHandle : undefined,
    goAway: Boolean(message.goAway),
    toolReplies,
  }
}

/** The model's finish_viva arguments are untrusted output: validate before showing them. */
export function parseVivaResult(args: unknown): VivaResult | null {
  if (!args || typeof args !== 'object') return null
  const { score, summary, topics } = args as Record<string, unknown>
  if (typeof score !== 'number' || !Number.isFinite(score)) return null
  const list = Array.isArray(topics) ? topics : []
  return {
    score: Math.round(Math.min(10, Math.max(0, score))),
    summary: typeof summary === 'string' ? summary.slice(0, 400) : '',
    topics: list
      .flatMap((item) => {
        const { topic, verdict } = (item ?? {}) as Record<string, unknown>
        return typeof topic === 'string' && topic.trim() && typeof verdict === 'string' && VERDICTS.has(verdict)
          ? [{ topic: topic.trim().slice(0, 80), verdict: verdict as TopicVerdict }]
          : []
      })
      .slice(0, 12),
  }
}
