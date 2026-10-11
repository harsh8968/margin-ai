import { describe, expect, it } from 'vitest'

import { appendCaption, finalizeCaptions, MAX_CAPTIONS } from './captions'
import type { LiveEvents, LiveMessage } from './protocol'
import { parseVivaResult, routeServerMessage } from './protocol'

function recorder() {
  const log: string[] = []
  const events: LiveEvents = {
    audio: (b64) => log.push(`audio:${b64}`),
    interrupted: () => log.push('interrupted'),
    turnComplete: () => log.push('turnComplete'),
    caption: (who, text) => log.push(`${who}:${text}`),
    vivaResult: (r) => log.push(`viva:${r.score}`),
  }
  return { log, events }
}

describe('routeServerMessage', () => {
  it('plays audio parts in order and forwards both caption streams', () => {
    const { log, events } = recorder()
    const message: LiveMessage = {
      serverContent: {
        modelTurn: { parts: [{ inlineData: { data: 'AAA' } }, {}, { inlineData: { data: 'BBB' } }] },
        inputTranscription: { text: 'what is mitosis' },
        outputTranscription: { text: 'Mitosis is' },
        turnComplete: true,
      },
    }
    expect(routeServerMessage(message, events)).toEqual({ resumeHandle: undefined, goAway: false, toolReplies: [] })
    expect(log).toEqual(['audio:AAA', 'audio:BBB', 'you:what is mitosis', 'tutor:Mitosis is', 'turnComplete'])
  })

  it('stops old audio before anything new in the same message', () => {
    const { log, events } = recorder()
    routeServerMessage({ serverContent: { interrupted: true, modelTurn: { parts: [{ inlineData: { data: 'NEW' } }] } } }, events)
    expect(log).toEqual(['interrupted', 'audio:NEW'])
  })

  it('reports a finished viva and acknowledges the tool call', () => {
    const { log, events } = recorder()
    const routed = routeServerMessage(
      { toolCall: { functionCalls: [{ id: 'c1', name: 'finish_viva', args: { score: 7, summary: 'Good', topics: [{ topic: 'Mitosis', verdict: 'strong' }] } }] } },
      events,
    )
    expect(log).toEqual(['viva:7'])
    expect(routed.toolReplies).toEqual([{ id: 'c1', name: 'finish_viva', response: { ok: true } }])
  })

  it('answers malformed or unknown tool calls without crashing', () => {
    const { log, events } = recorder()
    const routed = routeServerMessage({ toolCall: { functionCalls: [{ id: 'c2', name: 'finish_viva', args: { score: 'lots' } }, { id: 'c3', name: 'delete_everything' }] } }, events)
    expect(log).toEqual([])
    expect(routed.toolReplies.map((r) => r.response.ok)).toEqual([false, false])
  })

  it('keeps only resumable session handles and flags GoAway', () => {
    const { events } = recorder()
    expect(routeServerMessage({ sessionResumptionUpdate: { newHandle: 'h1', resumable: true } }, events).resumeHandle).toBe('h1')
    expect(routeServerMessage({ sessionResumptionUpdate: { newHandle: 'h2', resumable: false } }, events).resumeHandle).toBeUndefined()
    expect(routeServerMessage({ goAway: { timeLeft: '10s' } }, events).goAway).toBe(true)
  })
})

describe('parseVivaResult', () => {
  it('clamps the score and drops invalid topics', () => {
    expect(parseVivaResult({ score: 14.4, summary: 'Great', topics: [{ topic: ' 2NF ', verdict: 'shaky' }, { topic: '', verdict: 'strong' }, { topic: 'x', verdict: 'meh' }] })).toEqual({
      score: 10,
      summary: 'Great',
      topics: [{ topic: '2NF', verdict: 'shaky' }],
    })
  })

  it('rejects arguments without a numeric score', () => {
    expect(parseVivaResult(undefined)).toBeNull()
    expect(parseVivaResult({ summary: 'x' })).toBeNull()
  })
})

describe('captions', () => {
  it('joins streamed fragments and starts a new caption when the speaker changes', () => {
    let captions = appendCaption([], 'tutor', ' Hello')
    captions = appendCaption(captions, 'tutor', ' there.')
    captions = appendCaption(captions, 'you', 'Hi')
    expect(captions).toEqual([
      { id: 1, who: 'tutor', text: 'Hello there.', final: true },
      { id: 2, who: 'you', text: 'Hi', final: false },
    ])
  })

  it('finalizes open captions and keeps the newest few', () => {
    expect(finalizeCaptions(appendCaption([], 'you', 'a'))[0].final).toBe(true)
    let captions = appendCaption([], 'you', 'x')
    for (let i = 0; i < MAX_CAPTIONS + 5; i++) captions = appendCaption(captions, i % 2 ? 'you' : 'tutor', `t${i}`)
    expect(captions).toHaveLength(MAX_CAPTIONS)
    expect(captions.at(-1)?.text).toBe(`t${MAX_CAPTIONS + 4}`)
  })
})
