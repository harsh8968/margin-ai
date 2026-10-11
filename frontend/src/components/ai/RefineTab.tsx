import { diffWords } from 'diff'
import { BookMarked, CheckCheck, FilePlus2, Plus, Sparkles, SpellCheck, Table2, WandSparkles, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { api, errorMessage } from '../../api/client'
import type { RefineAction, RefineResult } from '../../api/types'
import type { ReplaceTarget } from '../../lib/insertActions'
import { addAsNewPages, addBelowOnCurrentPage, replaceWithText } from '../../lib/insertActions'
import { markdownToPlain } from '../../lib/markdown'
import { currentSelectionPayload, useAiStore } from '../../store/aiStore'
import { useCanvasStore } from '../../store/canvasStore'
import { useCurrentPage, useProjectStore } from '../../store/projectStore'
import { toastError } from '../../store/toastStore'
import { Modal } from '../ui/Modal'
import { Spinner } from '../ui/Toasts'
import { Markdown } from './shared'
import { scopeWords, useEffectiveScope } from './useScope'

const ACTIONS: { id: RefineAction; label: string; hint: string; icon: LucideIcon }[] = [
  { id: 'simplify', label: 'Simplify', hint: 'Plainer words, same facts', icon: Sparkles },
  { id: 'grammar', label: 'Fix grammar', hint: 'Spelling & grammar only', icon: SpellCheck },
  { id: 'structure', label: 'Structure', hint: 'Headings, bullets or a table', icon: Table2 },
  { id: 'improve', label: 'Improve answer', hint: 'Definition → explanation → example', icon: WandSparkles },
  { id: 'exam', label: 'Exam-ready', hint: 'Condensed, keywords in bold', icon: BookMarked },
]

/** Content refinement (A6) with the confirm-before-replace flow (A9). */
export function RefineTab() {
  const scope = useEffectiveScope(false)
  const page = useCurrentPage()
  const pending = useAiStore((s) => s.pending)
  const [action, setAction] = useState<RefineAction>('improve')
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState(false)
  const [proposal, setProposal] = useState<(RefineResult & { target: ReplaceTarget; pageTitle: string }) | null>(null)

  useEffect(() => {
    if (pending) useAiStore.getState().take('refine') // arriving from the selection bar: scope is already "selection"
  }, [pending])

  const run = async () => {
    const project = useProjectStore.getState().project
    if (!project || !page) return
    const refineScope = scope === 'selection' ? 'selection' : 'page'
    const selection = refineScope === 'selection' ? currentSelectionPayload() : null
    // Remember exactly what this proposal is about, in case the student moves on meanwhile.
    const target: ReplaceTarget = { pageId: page.id, selectionIds: refineScope === 'selection' ? useCanvasStore.getState().selection : [] }
    const pageTitle = page.title
    setBusy(true)
    try {
      await useAiStore.getState().ensureRead('page')
      const result = await api.refine({
        project_id: project.id,
        page_id: page.id,
        action,
        scope: refineScope,
        selection,
        instruction: instruction.trim() || undefined,
      })
      setProposal({ ...result, target, pageTitle })
    } catch (error) {
      toastError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-ink-soft">
        The AI writes a <strong className="text-ink">proposal</strong>. Nothing on your page changes until you review it and choose what to do.
      </p>

      <div className="grid gap-2">
        {ACTIONS.map(({ id, label, hint, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setAction(id)}
            aria-pressed={action === id}
            className={`flex items-center gap-3 rounded-xl border-[1.5px] px-3 py-2.5 text-left transition ${
              action === id ? 'border-ink bg-paper shadow-lift' : 'border-line bg-paper/60 hover:border-ink-soft'
            }`}
          >
            <span className={`grid h-8 w-8 place-items-center rounded-lg ${action === id ? 'bg-pen text-white' : 'bg-desk-deep text-ink-soft'}`}>
              <Icon size={16} />
            </span>
            <span>
              <span className="block text-sm font-bold">{label}</span>
              <span className="block text-xs text-ink-faint">{hint}</span>
            </span>
          </button>
        ))}
      </div>

      <input
        className="field text-sm"
        placeholder="Optional: anything specific? (e.g. keep it under 100 words)"
        value={instruction}
        maxLength={500}
        onChange={(e) => setInstruction(e.target.value)}
      />

      <button className="btn btn-pen w-full" onClick={run} disabled={busy}>
        {busy ? <Spinner /> : <WandSparkles size={15} />} Refine {scopeWords(scope)}
      </button>

      {proposal && <ProposalReview proposal={proposal} pageTitle={proposal.pageTitle} onClose={() => setProposal(null)} />}
    </div>
  )
}

function ProposalReview({ proposal, pageTitle, onClose }: { proposal: RefineResult & { target: ReplaceTarget }; pageTitle: string; onClose: () => void }) {
  const [view, setView] = useState<'clean' | 'changes'>('clean')
  const [confirming, setConfirming] = useState(false)
  const label = ACTIONS.find((a) => a.id === proposal.action)?.label ?? 'Refined'
  const newTitle = `${pageTitle} - ${label.toLowerCase()}`

  const parts = useMemo(() => diffWords(proposal.original_reading, markdownToPlain(proposal.proposed_markdown)), [proposal])

  const act = async (fn: () => Promise<void>) => {
    await fn()
    onClose()
  }

  return (
    <Modal
      wide
      title={`Review: ${label}`}
      onClose={onClose}
      footer={
        confirming ? (
          <>
            <span className="mr-auto text-sm text-ink-soft">
              Replace the original {proposal.scope === 'selection' ? 'selection' : 'content'} on "{pageTitle}"? You can undo with Ctrl+Z.
            </span>
            <button className="btn btn-ghost" onClick={() => setConfirming(false)}>
              Back
            </button>
            <button className="btn btn-pen" autoFocus onClick={() => void act(() => replaceWithText(proposal.proposed_markdown, proposal.scope, proposal.target))}>
              <CheckCheck size={15} /> Yes, replace
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-ghost mr-auto" onClick={onClose}>
              <X size={15} /> Discard
            </button>
            <button className="btn btn-outline" onClick={() => void act(() => addAsNewPages(proposal.proposed_markdown, newTitle, proposal.target.pageId))}>
              <FilePlus2 size={15} /> Insert as new page
            </button>
            <button className="btn btn-outline" onClick={() => void act(() => addBelowOnCurrentPage(proposal.proposed_markdown, newTitle, proposal.target.pageId))}>
              <Plus size={15} /> Insert below
            </button>
            <button className="btn btn-ink" onClick={() => setConfirming(true)}>
              <CheckCheck size={15} /> Accept &amp; replace…
            </button>
          </>
        )
      }
    >
      <p className="mb-4 rounded-xl bg-highlight-soft px-3 py-2 text-sm">
        <strong>What changed:</strong> {proposal.change_summary}
      </p>
      <div className="grid gap-5 md:grid-cols-2">
        <section>
          <p className="eyebrow mb-2">Original (as the AI read it)</p>
          <div className="max-h-[48vh] overflow-y-auto whitespace-pre-wrap rounded-xl border border-line bg-card p-4 text-sm leading-relaxed text-ink-soft">
            {proposal.original_reading || '(empty)'}
          </div>
        </section>
        <section>
          <div className="mb-2 flex items-center justify-between">
            <p className="eyebrow">Proposed</p>
            <div className="flex gap-1">
              {(['clean', 'changes'] as const).map((v) => (
                <button key={v} className="chip" data-on={view === v} onClick={() => setView(v)}>
                  {v === 'clean' ? 'Clean' : 'Show changes'}
                </button>
              ))}
            </div>
          </div>
          <div className="max-h-[48vh] overflow-y-auto rounded-xl border-[1.5px] border-ink/70 bg-paper p-4">
            {view === 'clean' ? (
              <Markdown text={proposal.proposed_markdown} />
            ) : (
              <p className="whitespace-pre-wrap text-sm leading-relaxed">
                {parts.map((part, i) =>
                  part.added ? (
                    <ins key={i} className="rounded bg-grounded-soft px-0.5 text-grounded no-underline">
                      {part.value}
                    </ins>
                  ) : part.removed ? (
                    <del key={i} className="rounded bg-missing-soft px-0.5 text-missing">
                      {part.value}
                    </del>
                  ) : (
                    <span key={i}>{part.value}</span>
                  ),
                )}
              </p>
            )}
          </div>
        </section>
      </div>
    </Modal>
  )
}
