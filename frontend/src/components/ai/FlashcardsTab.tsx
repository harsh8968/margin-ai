import { Layers, RotateCw, Sparkles, ThumbsDown, ThumbsUp, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { api, errorMessage } from '../../api/client'
import type { Flashcard, Scope } from '../../api/types'
import { parseServerDate } from '../../lib/format'
import { prepareScope, useAiStore } from '../../store/aiStore'
import { useProjectStore } from '../../store/projectStore'
import { toast, toastError } from '../../store/toastStore'
import { Spinner } from '../ui/Toasts'
import { EmptyState, PageCite, Segmented } from './shared'
import { scopeWords, useEffectiveScope } from './useScope'

const BOX_LABELS = ['', 'New', '1 day', '3 days', '1 week', '2 weeks']

const isDue = (card: Flashcard) => parseServerDate(card.due_at) <= Date.now() + 1000

/** AI flashcards with Leitner-box spaced repetition (doc B1). */
export function FlashcardsTab() {
  const project = useProjectStore((s) => s.project)
  const scope = useEffectiveScope()
  const pending = useAiStore((s) => s.pending)
  const [cards, setCards] = useState<Flashcard[] | null>(null)
  const [count, setCount] = useState('8')
  const [busy, setBusy] = useState(false)
  const [flipped, setFlipped] = useState(false)
  const [mode, setMode] = useState<'study' | 'deck'>('study')

  useEffect(() => {
    if (!project) return
    api.flashcards(project.id).then(setCards).catch(() => setCards([]))
  }, [project])

  const generate = useCallback(
    async (genScope: Scope, topics: string[] = []) => {
      setBusy(true)
      try {
        const args = await prepareScope(genScope)
        if (!args) return
        const { created } = await api.generateFlashcards({ ...args, count: Number(count), focus_topics: topics })
        setCards((c) => [...created, ...(c ?? [])])
        toast(created.length ? `${created.length} new cards` : 'No new cards: these ideas are already in your deck', { tone: 'success' })
        setMode('study')
      } catch (error) {
        toastError(errorMessage(error))
      } finally {
        setBusy(false)
      }
    },
    [count],
  )

  useEffect(() => {
    if (!pending) return
    const action = useAiStore.getState().take('cards')
    if (action) void generate(action.topics?.length ? 'project' : 'selection', action.topics ?? [])
  }, [pending, generate])

  const due = useMemo(() => (cards ?? []).filter(isDue).sort((a, b) => a.box - b.box), [cards])
  const current = due[0]

  const review = async (result: 'got_it' | 'missed') => {
    if (!current) return
    setFlipped(false)
    try {
      const updated = await api.reviewFlashcard(current.id, result)
      setCards((c) => (c ?? []).map((card) => (card.id === updated.id ? updated : card)))
    } catch (error) {
      toastError(errorMessage(error))
    }
  }

  const remove = async (id: string) => {
    try {
      await api.deleteFlashcard(id)
      setCards((c) => (c ?? []).filter((card) => card.id !== id))
    } catch (error) {
      toastError(errorMessage(error))
    }
  }

  const boxes = [1, 2, 3, 4, 5].map((b) => (cards ?? []).filter((c) => c.box === b).length)

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="w-28">
          <Segmented label="Cards to make" value={count} onChange={setCount} options={['5', '8', '12'].map((v) => ({ value: v, label: v }))} />
        </div>
        <button className="btn btn-ink flex-1" onClick={() => void generate(scope)} disabled={busy}>
          {busy ? <Spinner /> : <Sparkles size={15} />} Make cards from {scope === 'project' ? 'project' : scope}
        </button>
      </div>

      {cards && cards.length > 0 && (
        <>
          <div className="grid grid-cols-5 gap-1" title="Leitner boxes: cards move right each time you know them">
            {boxes.map((n, i) => (
              <div key={i} className="rounded-lg bg-paper px-1 py-1.5 text-center shadow-[0_1px_2px_rgba(31,42,68,0.08)]">
                <div className="font-display text-lg font-semibold leading-none">{n}</div>
                <div className="mt-1 text-[0.6rem] font-bold uppercase tracking-wide text-ink-faint">{BOX_LABELS[i + 1]}</div>
              </div>
            ))}
          </div>
          <Segmented
            label="Flashcard view"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'study', label: `Study (${due.length} due)` },
              { value: 'deck', label: `Deck (${cards.length})` },
            ]}
          />
        </>
      )}

      {mode === 'study' && current && (
        <div>
          <div
            role="button"
            tabIndex={0}
            className="flip-scene block h-60 w-full cursor-pointer text-left"
            onClick={() => setFlipped((f) => !f)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setFlipped((f) => !f)
              }
            }}
            aria-label={flipped ? 'Show question' : 'Show answer'}
          >
            <div className="flip-card h-full w-full" data-flipped={flipped}>
              <div className="flip-face flex flex-col rounded-2xl border border-line bg-paper p-5 shadow-lift">
                <span className="eyebrow">{current.topic || 'Card'} · question</span>
                <p className="my-auto font-display text-xl font-medium leading-snug">{current.front}</p>
                <span className="flex items-center gap-1 text-[0.7rem] text-ink-faint">
                  <RotateCw size={11} /> Tap to flip
                </span>
              </div>
              <div className="flip-face flip-back flex flex-col rounded-2xl bg-ink p-5 text-paper shadow-lift">
                <span className="eyebrow !text-highlight">Answer</span>
                <p className="my-auto text-[0.95rem] leading-relaxed">{current.back}</p>
                {current.source_page && (
                  <span className="text-[0.7rem] text-paper/60" onClick={(e) => e.stopPropagation()}>
                    From <PageCite number={current.source_page} />
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button className="btn btn-outline" onClick={() => void review('missed')}>
              <ThumbsDown size={15} /> Review again
            </button>
            <button className="btn btn-pen" onClick={() => void review('got_it')}>
              <ThumbsUp size={15} /> Got it
            </button>
          </div>
        </div>
      )}

      {mode === 'study' && cards && cards.length > 0 && !current && (
        <EmptyState icon={<Layers size={20} />} title="All caught up">
          No cards are due right now. Cards you know come back later; ones you miss come back first.
        </EmptyState>
      )}

      {mode === 'deck' && cards && (
        <ul className="space-y-2">
          {cards.map((card) => (
            <li key={card.id} className="group flex items-start gap-3 rounded-xl border border-line bg-paper p-3">
              <span className="mt-0.5 rounded-md bg-desk-deep px-1.5 py-0.5 text-[0.62rem] font-bold text-ink-soft" title="Leitner box">
                B{card.box}
              </span>
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-bold leading-snug">{card.front}</p>
                <p className="mt-0.5 text-ink-soft">{card.back}</p>
              </div>
              <button className="opacity-0 transition group-hover:opacity-100" onClick={() => void remove(card.id)} aria-label="Delete card">
                <Trash2 size={14} className="text-ink-faint hover:text-pen" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {cards && cards.length === 0 && !busy && (
        <EmptyState icon={<Layers size={20} />} title="Flashcards from your notes">
          Turn {scopeWords(scope)} into flip cards. They come back on a schedule: missed cards sooner, known cards later.
        </EmptyState>
      )}
    </div>
  )
}
