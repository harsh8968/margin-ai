import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LiveSessionEvents } from '../lib/voice/liveSession'

const h = vi.hoisted(() => {
  const calls: string[] = []
  const mic = { stop: vi.fn(() => calls.push('mic.stop')), setMuted: vi.fn(), level: vi.fn(() => 0) }
  const player = { play: vi.fn(), flush: vi.fn(), level: vi.fn(() => 0), isPlaying: vi.fn(() => false), close: vi.fn() }
  const live = { sendAudio: vi.fn(), sendText: vi.fn(), resumeHandle: vi.fn(() => 'h1'), close: vi.fn(() => calls.push('live.close')) }
  return {
    calls,
    mic,
    player,
    live,
    events: null as LiveSessionEvents | null,
    ensureRead: vi.fn(async () => {
      calls.push('ensureRead')
    }),
    openMic: vi.fn(async () => {
      calls.push('openMic')
      return mic
    }),
    voiceSession: vi.fn(async () => {
      calls.push('voiceSession')
      return { token: 'auth_tokens/t', model: 'gemini-3.8-live', mode: 'viva', scope: 'project', unread_pages: [] }
    }),
  }
})

vi.mock('../lib/voice/mic', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/voice/mic')>()),
  openMic: h.openMic,
}))
vi.mock('../lib/voice/player', () => ({ createPlayer: () => h.player }))
vi.mock('../lib/voice/liveSession', () => ({
  connectLive: vi.fn(async (_token: string, _model: string, events: LiveSessionEvents) => {
    h.calls.push('connectLive')
    h.events = events
    return h.live
  }),
}))
vi.mock('../api/client', () => ({
  api: { voiceSession: h.voiceSession },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong'),
}))
vi.mock('./aiStore', () => ({ useAiStore: { getState: () => ({ ensureRead: h.ensureRead }) } }))
vi.mock('./projectStore', () => ({ useProjectStore: { getState: () => ({ project: { id: 'p1' }, currentPageId: 'pg1' }) } }))

const { KICKOFF, pickVisual, useVoiceStore } = await import('./voiceStore')
const { connectLive } = await import('../lib/voice/liveSession')

beforeEach(() => {
  useVoiceStore.getState().end()
  useVoiceStore.setState({ status: 'idle', mode: 'viva', error: null, captions: [], vivaResult: null, muted: false, awaitingReply: false })
  vi.clearAllMocks()
  h.calls.length = 0
})

describe('voice store', () => {
  it('reads the notes, then opens the mic, then mints the token and connects', async () => {
    await useVoiceStore.getState().start('project')
    expect(h.calls).toEqual(['ensureRead', 'openMic', 'voiceSession', 'connectLive'])
    expect(h.voiceSession).toHaveBeenCalledWith({ project_id: 'p1', page_id: 'pg1', scope: 'project', mode: 'viva' })
    expect(h.live.sendText).toHaveBeenCalledWith(KICKOFF)
    expect(useVoiceStore.getState().status).toBe('live')
  })

  it('ignores Start while a session is already starting', async () => {
    const first = useVoiceStore.getState().start('project')
    const second = useVoiceStore.getState().start('project')
    await Promise.all([first, second])
    expect(h.voiceSession).toHaveBeenCalledTimes(1)
  })

  it('End during start releases the mic and never connects', async () => {
    let release = () => {}
    h.voiceSession.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ token: 't', model: 'm', mode: 'viva', scope: 'project', unread_pages: [] })
        }),
    )
    const starting = useVoiceStore.getState().start('project')
    await vi.waitFor(() => expect(h.voiceSession).toHaveBeenCalled())
    useVoiceStore.getState().end()
    release()
    await starting
    expect(connectLive).not.toHaveBeenCalled()
    expect(h.mic.stop).toHaveBeenCalled()
    expect(useVoiceStore.getState().status).toBe('ended')
  })

  it('explains a blocked microphone and mints no token', async () => {
    h.openMic.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'))
    await useVoiceStore.getState().start('page')
    expect(useVoiceStore.getState()).toMatchObject({ status: 'error', error: expect.stringMatching(/Microphone blocked/) })
    expect(h.voiceSession).not.toHaveBeenCalled()
  })

  it('stops the tutor at once when the student interrupts', async () => {
    await useVoiceStore.getState().start('project')
    h.events?.interrupted()
    expect(h.player.flush).toHaveBeenCalled()
  })

  it('shows captions and the viva scorecard, and offers to resume after a drop', async () => {
    await useVoiceStore.getState().start('project')
    h.events?.caption('tutor', 'Question one.')
    h.events?.vivaResult({ score: 8, summary: 'Solid', topics: [] })
    h.events?.closed('network lost')
    const state = useVoiceStore.getState()
    expect(state.captions.map((c) => c.text)).toEqual(['Question one.'])
    expect(state.vivaResult?.score).toBe(8)
    expect(state).toMatchObject({ status: 'error', canResume: true, error: 'Disconnected: network lost' })
    expect(h.mic.stop).toHaveBeenCalled()
  })
})

describe('pickVisual', () => {
  const base = { status: 'live' as const, muted: false, awaitingReply: false, playing: false, micLevel: 0 }
  it('maps session state to what the blob shows', () => {
    expect(pickVisual({ ...base, status: 'starting' })).toBe('connecting')
    expect(pickVisual({ ...base, playing: true })).toBe('speaking')
    expect(pickVisual({ ...base, awaitingReply: true })).toBe('thinking')
    expect(pickVisual({ ...base, awaitingReply: true, micLevel: 0.8 })).toBe('listening')
    expect(pickVisual({ ...base, muted: true })).toBe('idle')
    expect(pickVisual({ ...base, status: 'error' })).toBe('error')
  })
})
