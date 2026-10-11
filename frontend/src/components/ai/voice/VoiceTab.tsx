import { Mic, MicOff, PhoneOff, Play, RotateCcw, SendHorizontal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'

import type { VoiceMode } from '../../../api/types'
import { useAiStore } from '../../../store/aiStore'
import type { VoiceScope } from '../../../store/voiceStore'
import { useVoiceStore, voiceFrame } from '../../../store/voiceStore'
import { Card, Segmented } from '../shared'
import { VoiceBlob } from './VoiceBlob'

const MODES: { value: VoiceMode; label: string; hint: string }[] = [
  { value: 'viva', label: 'Viva', hint: 'An oral exam on your notes: one question at a time, then a score.' },
  { value: 'explain', label: 'Explain', hint: 'Ask about any concept. It explains from your notes, with an analogy.' },
  { value: 'buddy', label: 'Study buddy', hint: 'Hints and guiding questions so you work it out yourself.' },
]

const VERDICT_STYLE = {
  strong: 'bg-grounded-soft text-grounded',
  shaky: 'bg-partial-soft text-partial',
  missed: 'bg-missing-soft text-missing',
} as const

export function VoiceTab() {
  const { status, mode, muted, captions, vivaResult, error, canResume } = useVoiceStore()
  const { setMode, start, end, toggleMute, sendText } = useVoiceStore.getState()
  const aiScope = useAiStore((s) => s.scope)
  const scope: VoiceScope = aiScope === 'project' ? 'project' : 'page'
  const [draft, setDraft] = useState('')
  const captionsEnd = useRef<HTMLLIElement | null>(null)
  const busy = status === 'starting' || status === 'live'

  useEffect(() => () => useVoiceStore.getState().end(), []) // leaving the tab or notebook ends the call
  useEffect(() => {
    captionsEnd.current?.scrollIntoView({ block: 'nearest' }) // newer browsers return a promise here; never hand it to React
  }, [captions])

  const activate = () => {
    if (status === 'live') toggleMute()
    else if (status !== 'starting') void start(scope)
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    sendText(draft)
    setDraft('')
  }

  const statusLine =
    status === 'starting'
      ? 'Getting your notes ready…'
      : status === 'live'
        ? muted
          ? 'Muted. Tap the blob to talk again.'
          : 'Listening. Just talk, and interrupt any time.'
        : status === 'ended'
          ? 'Session ended.'
          : status === 'error'
            ? error
            : 'Tap the blob to start talking.'

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Segmented<VoiceMode>
          label="Voice mode"
          value={mode}
          onChange={setMode}
          options={MODES.map((m) => ({ value: m.value, label: m.label, disabled: busy && m.value !== mode, title: busy ? 'End the session to switch modes' : m.hint }))}
        />
        <p className="mt-1.5 text-[0.72rem] leading-snug text-ink-faint">{MODES.find((m) => m.value === mode)?.hint}</p>
      </div>

      <div className="flex flex-col items-center gap-2 pt-1">
        <VoiceBlob
          frame={voiceFrame}
          onActivate={activate}
          label={status === 'live' ? (muted ? 'Unmute microphone' : 'Mute microphone') : 'Start voice session'}
        />
        <p className={`min-h-[2.5em] max-w-[18rem] text-center text-sm ${status === 'error' ? 'text-missing' : 'text-ink-soft'}`} role="status" aria-live="polite">
          {statusLine}
        </p>
        <div className="flex gap-2">
          {busy ? (
            <>
              <button className="btn btn-outline" onClick={toggleMute} disabled={status !== 'live'} aria-pressed={muted}>
                {muted ? <MicOff size={16} /> : <Mic size={16} />} {muted ? 'Unmute' : 'Mute'}
              </button>
              <button className="btn btn-ink" onClick={end}>
                <PhoneOff size={16} /> End
              </button>
            </>
          ) : (
            <>
              {status === 'error' && canResume && (
                <button className="btn btn-outline" onClick={() => void start(scope, { resume: true })}>
                  <RotateCcw size={16} /> Reconnect
                </button>
              )}
              <button className="btn btn-ink" onClick={() => void start(scope)}>
                <Play size={16} /> {status === 'idle' ? 'Start' : 'Start again'}
              </button>
            </>
          )}
        </div>
      </div>

      {vivaResult && (
        <Card>
          <div className="flex items-baseline justify-between gap-3">
            <p className="eyebrow">Viva result</p>
            <p className="font-display text-3xl font-semibold">
              {vivaResult.score}
              <span className="text-base text-ink-faint">/10</span>
            </p>
          </div>
          {vivaResult.summary && <p className="mt-1 text-sm text-ink-soft">{vivaResult.summary}</p>}
          {vivaResult.topics.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {vivaResult.topics.map((t) => (
                <li key={t.topic} className={`rounded-full px-2.5 py-1 text-xs font-bold ${VERDICT_STYLE[t.verdict]}`}>
                  {t.topic} · {t.verdict}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {captions.length > 0 && (
        <ol className="flex flex-col gap-2" aria-label="Conversation captions">
          {captions.map((c) => (
            <li key={c.id} className={`max-w-[92%] rounded-2xl px-3 py-2 text-sm leading-snug ${c.who === 'you' ? 'self-end bg-desk-deep/70 text-ink' : 'self-start bg-paper text-ink shadow-[0_1px_2px_rgba(31,42,68,0.08)]'} ${c.final ? '' : 'opacity-80'}`}>
              <span className="mb-0.5 block text-[0.65rem] font-bold uppercase tracking-wide text-ink-faint">{c.who === 'you' ? 'You' : 'Tutor'}</span>
              {c.text}
            </li>
          ))}
          <li ref={captionsEnd} aria-hidden />
        </ol>
      )}

      {status === 'live' && (
        <form onSubmit={submit} className="flex gap-2">
          <input className="field py-1.5 text-sm" placeholder="Or type instead…" value={draft} maxLength={500} onChange={(e) => setDraft(e.target.value)} aria-label="Type a message to the tutor" />
          <button className="btn btn-outline px-2.5" disabled={!draft.trim()} aria-label="Send">
            <SendHorizontal size={16} />
          </button>
        </form>
      )}

      <p className="text-[0.7rem] leading-snug text-ink-faint">Uses your microphone. While a session is live, audio streams to Google Gemini.</p>
    </div>
  )
}
