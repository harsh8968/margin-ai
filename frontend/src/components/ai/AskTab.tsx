import { Copy, Globe2, Lightbulb, MessageSquareText, Plus, SendHorizontal, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { api, errorMessage } from '../../api/client'
import type { AskResult, Citation, Grounding, Scope } from '../../api/types'
import { addBelowOnCurrentPage, copyText } from '../../lib/insertActions'
import { prepareScope, useAiStore } from '../../store/aiStore'
import { useProjectStore } from '../../store/projectStore'
import { toastError } from '../../store/toastStore'
import { Spinner } from '../ui/Toasts'
import { EmptyState, GroundingBadge, Markdown, PageCite, Segmented, Thinking, UnreadWarning } from './shared'
import { scopeWords, useEffectiveScope } from './useScope'

interface Turn {
  id: string
  role: 'user' | 'assistant'
  content: string
  scope: Scope
  pageId?: string | null
  mode?: 'answer' | 'explain'
  question?: string
  citations?: Citation[]
  grounding?: Grounding | null
  missingInfo?: string | null
  unread?: number[]
  dropped?: number
}

const SUGGESTIONS: Record<Scope, string[]> = {
  page: ['Summarise this page in 3 points', 'What is the hardest idea on this page?', 'Which terms here should I memorise?'],
  project: ['How do the topics in this notebook connect?', 'What are the most important definitions?', 'What would an exam most likely ask?'],
  selection: ['Explain this in simpler words', 'Give me an example of this', 'Is anything missing from this part?'],
}

export function AskTab() {
  const project = useProjectStore((s) => s.project)
  const scope = useEffectiveScope()
  const pending = useAiStore((s) => s.pending)
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<'answer' | 'explain'>('answer')
  const [busy, setBusy] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!project) return
    let alive = true
    api
      .chat(project.id)
      .then((messages) => {
        if (!alive) return
        // Prepend: a question asked before the history arrived must not be overwritten.
        const history: Turn[] = messages.map((m, i) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            scope: m.scope,
            pageId: m.page_id,
            citations: m.citations,
            grounding: m.grounding,
            missingInfo: m.missing_info,
            question: m.role === 'assistant' ? messages[i - 1]?.content : undefined,
          }))
        setTurns((current) => [...history, ...current])
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [project])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turns.length, busy])

  const send = useCallback(
    async (question: string, askMode: 'answer' | 'explain', askScope: Scope, allowGeneral = false) => {
      const q = question.trim()
      if (!q || busy) return
      setBusy(true)
      if (!allowGeneral) {
        const pageId = useProjectStore.getState().currentPageId
        setTurns((t) => [...t, { id: `u${Date.now()}`, role: 'user', content: q, scope: askScope, mode: askMode, pageId }])
        setInput('')
      }
      try {
        const args = await prepareScope(askScope)
        if (!args) return
        // Only earlier turns about the same scope (and page) may inform this answer.
        const sameScope = turns.filter((t) => t.scope === askScope && (askScope === 'project' || t.pageId === args.page_id))
        const history = sameScope.slice(-6).map((t) => ({ role: t.role, content: t.content || t.missingInfo || '', scope: t.scope, page_id: t.pageId ?? null }))
        const result: AskResult = await api.ask({ ...args, question: q, mode: askMode, history, allow_general: allowGeneral })
        setTurns((t) => [
          ...t,
          {
            id: `a${Date.now()}`,
            role: 'assistant',
            content: result.answer_markdown,
            scope: result.scope,
            pageId: args.page_id,
            mode: result.mode,
            question: q,
            citations: result.citations,
            grounding: result.grounding,
            missingInfo: result.missing_info,
            unread: result.unread_pages,
            dropped: result.dropped_citations,
          },
        ])
      } catch (error) {
        toastError(errorMessage(error))
      } finally {
        setBusy(false)
      }
    },
    [busy, turns],
  )

  // Requests from the selection bar ("Explain") or Insights ("practice question").
  useEffect(() => {
    if (!pending) return
    const action = useAiStore.getState().take('ask')
    if (!action) return
    if (action.kind === 'explain') {
      setMode('explain')
      void send(action.text ?? 'Explain the selected part of my notes.', 'explain', 'selection')
    } else if (action.text) {
      void send(action.text, 'answer', 'project')
    }
  }, [pending, send])

  const clear = async () => {
    if (!project) return
    await api.clearChat(project.id).catch(() => undefined)
    setTurns([])
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1 space-y-4">
        {turns.length === 0 && !busy && (
          <EmptyState icon={<MessageSquareText size={20} />} title="Ask your notes">
            Answers come only from {scopeWords(scope)}, with page citations. If your notes don't cover it, you'll be told.
            <div className="mt-4 flex flex-col gap-2">
              {SUGGESTIONS[scope].map((s) => (
                <button key={s} className="rounded-xl border border-line bg-paper px-3 py-2 text-left text-xs font-bold text-ink-soft transition hover:border-ink-soft hover:text-ink" onClick={() => void send(s, mode, scope)}>
                  {s}
                </button>
              ))}
            </div>
          </EmptyState>
        )}

        {turns.map((turn) =>
          turn.role === 'user' ? (
            <div key={turn.id} className="rise ml-8 rounded-2xl rounded-br-sm bg-ink px-3.5 py-2.5 text-sm text-paper">
              {turn.content}
              <span className="mt-1 block text-[0.66rem] font-bold uppercase tracking-wider text-paper/50">
                {turn.mode === 'explain' ? 'Explain · ' : ''}
                {scopeWords(turn.scope)}
              </span>
            </div>
          ) : (
            <AnswerCard key={turn.id} turn={turn} busy={busy} onGeneral={() => turn.question && void send(turn.question, 'answer', turn.scope, true)} />
          ),
        )}

        {busy && <Thinking label={`Reading ${scopeWords(scope)}…`} />}
        <div ref={endRef} />
      </div>

      <div className="sticky bottom-0 -mx-1 mt-4 bg-gradient-to-t from-card via-card to-transparent px-1 pt-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="w-44">
            <Segmented
              label="Answer style"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'answer', label: 'Answer' },
                { value: 'explain', label: (<><Lightbulb size={12} /> Explain</>), title: 'Step-by-step explanation built from your notes' },
              ]}
            />
          </div>
          {turns.length > 0 && (
            <button className="btn btn-ghost px-2 py-1 text-xs" onClick={clear}>
              <Trash2 size={13} /> Clear
            </button>
          )}
        </div>
        <form
          className="flex items-end gap-2 rounded-2xl border-[1.5px] border-line bg-paper p-1.5 pl-3 focus-within:border-ink-soft"
          onSubmit={(e) => {
            e.preventDefault()
            void send(input, mode, scope)
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send(input, mode, scope)
              }
            }}
            rows={2}
            maxLength={2000}
            placeholder={mode === 'explain' ? 'Which concept should I explain?' : `Ask about ${scopeWords(scope)}…`}
            className="max-h-32 min-h-[2.5rem] flex-1 resize-none bg-transparent py-1.5 text-sm outline-none placeholder:text-ink-faint"
          />
          <button className="btn btn-pen h-9 w-9 shrink-0 p-0" disabled={busy || !input.trim()} aria-label="Send">
            {busy ? <Spinner size={14} /> : <SendHorizontal size={16} />}
          </button>
        </form>
      </div>
    </div>
  )
}

function AnswerCard({ turn, busy, onGeneral }: { turn: Turn; busy: boolean; onGeneral: () => void }) {
  const grounding = turn.grounding ?? 'grounded'
  const canGoGeneral = (grounding === 'not_in_notes' || grounding === 'partial') && !!turn.question
  return (
    <div className="rise rounded-2xl rounded-bl-sm border border-line bg-paper p-4 shadow-[0_1px_2px_rgba(31,42,68,0.06)]">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <GroundingBadge grounding={grounding} />
        {turn.content && (
          <div className="flex gap-0.5">
            <button className="btn btn-ghost p-1.5" onClick={() => void copyText(turn.content)} title="Copy" aria-label="Copy answer">
              <Copy size={13} />
            </button>
            <button
              className="btn btn-ghost p-1.5"
              onClick={() => void addBelowOnCurrentPage(grounding === 'general' ? `(Outside my notes, general knowledge)\n${turn.content}` : turn.content, 'AI answer')}
              title="Add to this page, below your notes"
              aria-label="Add to page"
            >
              <Plus size={14} />
            </button>
          </div>
        )}
      </div>

      {turn.content && <Markdown text={turn.content} />}

      {turn.missingInfo && (
        <div className={`mt-3 rounded-xl px-3 py-2 text-[0.8rem] leading-snug ${grounding === 'not_in_notes' ? 'bg-missing-soft text-missing' : 'bg-partial-soft text-partial'}`}>
          <strong>{grounding === 'not_in_notes' ? 'Not in your notes: ' : 'Missing from your notes: '}</strong>
          {turn.missingInfo}
        </div>
      )}

      {!!turn.citations?.length && (
        <div className="mt-3 space-y-1.5 border-t border-dashed border-line pt-3">
          <p className="eyebrow">Evidence from your notes</p>
          {turn.citations.map((c, i) => (
            <div key={i} className="flex items-start gap-2 text-[0.8rem] leading-snug text-ink-soft">
              <PageCite number={c.page} />
              <q className="italic">{c.quote}</q>
            </div>
          ))}
        </div>
      )}

      {!!turn.dropped && (
        <p className="mt-2 text-[0.7rem] text-ink-faint">
          {turn.dropped} citation{turn.dropped === 1 ? ' was' : 's were'} removed because the quote couldn't be found in your notes.
        </p>
      )}
      <UnreadWarning pages={turn.unread ?? []} />

      {canGoGeneral && (
        <button className="btn btn-outline mt-3 w-full text-xs" onClick={onGeneral} disabled={busy}>
          <Globe2 size={14} /> Explain from general knowledge
          <span className="font-normal text-ink-faint">(clearly labelled)</span>
        </button>
      )}
    </div>
  )
}
