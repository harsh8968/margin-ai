/**
 * The voice tutor: one live spoken session at a time, wired mic → Gemini Live → speaker.
 * Audio objects live outside React state; the store holds only what the UI renders.
 */
import { create } from 'zustand'

import { api, errorMessage } from '../api/client'
import type { VoiceMode } from '../api/types'
import type { Caption } from '../lib/voice/captions'
import { appendCaption, finalizeCaptions } from '../lib/voice/captions'
import type { LiveHandle, LiveSessionEvents } from '../lib/voice/liveSession'
import { connectLive } from '../lib/voice/liveSession'
import type { MicHandle } from '../lib/voice/mic'
import { micErrorMessage, openMic } from '../lib/voice/mic'
import { loudness } from '../lib/voice/pcm'
import type { Player } from '../lib/voice/player'
import { createPlayer } from '../lib/voice/player'
import type { VivaResult } from '../lib/voice/protocol'
import { useAiStore } from './aiStore'
import { useProjectStore } from './projectStore'

export type VoiceStatus = 'idle' | 'starting' | 'live' | 'ended' | 'error'
export type VoiceScope = 'page' | 'project'
export type VoiceVisual = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'ended' | 'error'

export const KICKOFF = 'Start the session now.'
export const RESUME_KICKOFF = 'We got disconnected for a moment. Carry on exactly where we left off.'
const SPEAKING_OVER = 0.35 // mic loudness above which the student is still talking

interface VoiceState {
  status: VoiceStatus
  mode: VoiceMode
  muted: boolean
  awaitingReply: boolean
  captions: Caption[]
  vivaResult: VivaResult | null
  error: string | null
  canResume: boolean
  setMode: (mode: VoiceMode) => void
  start: (scope: VoiceScope, options?: { resume?: boolean }) => Promise<void>
  end: () => void
  toggleMute: () => void
  sendText: (text: string) => void
}

let mic: MicHandle | null = null
let player: Player | null = null
let live: LiveHandle | null = null
let resumeHandle: string | undefined
let attempt = 0 // bumps on every start/end, so a start that was cancelled cleans up after itself

function teardown(): void {
  live?.close()
  mic?.stop()
  player?.close()
  live = null
  mic = null
  player = null
}

const isBusy = (status: VoiceStatus) => status === 'starting' || status === 'live'

export const useVoiceStore = create<VoiceState>((set, get) => {
  const events: LiveSessionEvents = {
    audio: (base64Pcm) => {
      player?.play(base64Pcm)
      if (get().awaitingReply) set({ awaitingReply: false })
    },
    interrupted: () => {
      player?.flush()
      set({ captions: finalizeCaptions(get().captions) })
    },
    turnComplete: () => set({ awaitingReply: false, captions: finalizeCaptions(get().captions) }),
    caption: (who, text) =>
      set({ captions: appendCaption(get().captions, who, text), awaitingReply: who === 'you' ? true : get().awaitingReply }),
    vivaResult: (result) => set({ vivaResult: result }),
    closed: (reason) => {
      resumeHandle = live?.resumeHandle() ?? resumeHandle
      teardown()
      set({ status: 'error', error: `Disconnected: ${reason}`, awaitingReply: false, canResume: Boolean(resumeHandle) })
    },
  }

  return {
    status: 'idle',
    mode: 'viva',
    muted: false,
    awaitingReply: false,
    captions: [],
    vivaResult: null,
    error: null,
    canResume: false,

    setMode: (mode) => {
      if (!isBusy(get().status)) set({ mode })
    },

    start: async (scope, options = {}) => {
      const { project, currentPageId } = useProjectStore.getState()
      if (isBusy(get().status) || !project) return
      const mine = ++attempt
      const stale = () => mine !== attempt
      const resumeFrom = options.resume ? resumeHandle : undefined
      set({ status: 'starting', error: null, muted: false, awaitingReply: false, canResume: false, ...(resumeFrom ? {} : { captions: [], vivaResult: null }) })

      let ownMic: MicHandle | null = null
      let ownPlayer: Player | null = null
      let ownLive: LiveHandle | null = null
      const abandon = () => {
        ownLive?.close()
        ownMic?.stop()
        ownPlayer?.close()
      }
      try {
        // Order matters: the token only allows a minute to connect, so slow steps go first.
        await useAiStore.getState().ensureRead(scope)
        if (stale()) return
        ownMic = await openMic((chunk) => ownLive?.sendAudio(chunk))
        if (stale()) return abandon()
        const session = await api.voiceSession({ project_id: project.id, page_id: currentPageId, scope, mode: get().mode })
        if (stale()) return abandon()
        ownPlayer = createPlayer()
        ownLive = await connectLive(session.token, session.model, events, resumeFrom)
        if (stale()) return abandon()
        mic = ownMic
        player = ownPlayer
        live = ownLive
        live.sendText(resumeFrom ? RESUME_KICKOFF : KICKOFF)
        set({ status: 'live' })
      } catch (error) {
        abandon()
        if (!stale()) set({ status: 'error', error: micErrorMessage(error) ?? errorMessage(error) })
      }
    },

    end: () => {
      attempt++
      resumeHandle = undefined
      teardown()
      if (get().status !== 'idle') set({ status: 'ended', awaitingReply: false, muted: false, canResume: false })
    },

    toggleMute: () => {
      const muted = !get().muted
      mic?.setMuted(muted)
      set({ muted })
    },

    sendText: (text) => {
      const clean = text.trim()
      if (!live || !clean) return
      live.sendText(clean)
      set({ captions: finalizeCaptions(appendCaption(get().captions, 'you', clean)), awaitingReply: true })
    },
  }
})

export interface VisualInput {
  status: VoiceStatus
  muted: boolean
  awaitingReply: boolean
  playing: boolean
  micLevel: number
}

export function pickVisual({ status, muted, awaitingReply, playing, micLevel }: VisualInput): VoiceVisual {
  if (status === 'starting') return 'connecting'
  if (status === 'idle' || status === 'ended' || status === 'error') return status
  if (playing) return 'speaking'
  if (muted) return 'idle'
  if (awaitingReply && micLevel < SPEAKING_OVER) return 'thinking'
  return 'listening'
}

/** Read every animation frame by the blob: what to show and how loud it is right now. */
export function voiceFrame(): { visual: VoiceVisual; level: number } {
  const { status, muted, awaitingReply } = useVoiceStore.getState()
  const playing = Boolean(player?.isPlaying())
  const micLevel = muted ? 0 : loudness(mic?.level() ?? 0)
  const visual = pickVisual({ status, muted, awaitingReply, playing, micLevel })
  const level = visual === 'speaking' ? loudness(player?.level() ?? 0) : visual === 'listening' ? micLevel : 0
  return { visual, level }
}
