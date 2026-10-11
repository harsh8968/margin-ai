import { AudioLines, BarChart3, BookOpenCheck, Eye, FileText, Layers, Lasso, Library, ListChecks, MessageSquareText, NotebookPen, WandSparkles, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import type { Scope } from '../../api/types'
import type { AiTab } from '../../store/aiStore'
import { useAiStore } from '../../store/aiStore'
import { useCanvasStore } from '../../store/canvasStore'
import { useCurrentPage, useProjectStore } from '../../store/projectStore'
import { useVoiceStore } from '../../store/voiceStore'
import { AiStatus } from './AiStatus'
import { AskTab } from './AskTab'
import { FlashcardsTab } from './FlashcardsTab'
import { InsightsTab } from './InsightsTab'
import { QuizTab } from './QuizTab'
import { RefineTab } from './RefineTab'
import { RevisionTab } from './RevisionTab'
import { Segmented } from './shared'
import { SummaryTab } from './SummaryTab'
import { VoiceTab } from './voice/VoiceTab'
import { WhatAISees } from './WhatAISees'

const TABS: { id: AiTab; label: string; icon: LucideIcon }[] = [
  { id: 'ask', label: 'Ask', icon: MessageSquareText },
  { id: 'voice', label: 'Voice', icon: AudioLines },
  { id: 'summary', label: 'Summary', icon: BookOpenCheck },
  { id: 'quiz', label: 'Quiz', icon: ListChecks },
  { id: 'refine', label: 'Refine', icon: WandSparkles },
  { id: 'cards', label: 'Cards', icon: Layers },
  { id: 'revise', label: 'Revise', icon: NotebookPen },
  { id: 'insights', label: 'Insights', icon: BarChart3 },
]

/** Tabs that only make sense for the whole project. */
const PROJECT_ONLY: AiTab[] = ['revise', 'insights']

export function AIPanel({ onClose }: { onClose?: () => void }) {
  const tab = useAiStore((s) => s.tab)
  const seesOpen = useAiStore((s) => s.seesOpen)
  const { setTab, setSeesOpen } = useAiStore.getState()

  return (
    <aside className="relative flex h-full min-h-0 flex-col border-l border-desk-shade/70 bg-card/85 backdrop-blur-sm">
      {/* the red margin rule: the AI writes in the margin of your notebook */}
      <span className="pointer-events-none absolute inset-y-0 left-3 w-px bg-pen/35" aria-hidden />

      <header className="flex items-center justify-between gap-2 pb-2 pl-7 pr-4 pt-4">
        <div>
          <h2 className="font-display text-xl font-semibold italic leading-none">Margin notes</h2>
          <div className="mt-1.5">
            <AiStatus compact />
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button className="btn btn-outline px-2.5 py-1.5 text-xs" onClick={() => setSeesOpen(true)} title="See exactly what the AI reads from your pages">
            <Eye size={14} /> What the AI sees
          </button>
          {onClose && (
            <button className="btn btn-ghost p-1.5" onClick={onClose} aria-label="Close AI panel">
              <X size={16} />
            </button>
          )}
        </div>
      </header>

      {!PROJECT_ONLY.includes(tab) && <ScopeSwitch />}

      <nav className="grid grid-cols-8 gap-0.5 border-b border-line px-3 pl-6" role="tablist" aria-label="AI tools">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`relative flex flex-col items-center gap-1 px-0.5 pb-2 pt-1.5 text-[0.66rem] font-bold transition ${
              tab === id ? 'text-ink' : 'text-ink-faint hover:text-ink-soft'
            }`}
          >
            <Icon size={17} />
            {label}
            {tab === id && <span className="absolute inset-x-1.5 -bottom-px h-[3px] rounded-full bg-pen" />}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto pb-6 pl-7 pr-4 pt-4" role="tabpanel">
        {tab === 'ask' && <AskTab />}
        {tab === 'voice' && <VoiceTab />}
        {tab === 'summary' && <SummaryTab />}
        {tab === 'quiz' && <QuizTab />}
        {tab === 'refine' && <RefineTab />}
        {tab === 'cards' && <FlashcardsTab />}
        {tab === 'revise' && <RevisionTab />}
        {tab === 'insights' && <InsightsTab />}
      </div>

      {seesOpen && <WhatAISees onClose={() => setSeesOpen(false)} />}
    </aside>
  )
}

/** "This selection / This page / Whole project" (doc §11.3, A1). */
function ScopeSwitch() {
  const scope = useAiStore((s) => s.scope)
  const setScope = useAiStore((s) => s.setScope)
  const tab = useAiStore((s) => s.tab)
  const selectionCount = useCanvasStore((s) => s.selection.length)
  const page = useCurrentPage()
  const pageCount = useProjectStore((s) => s.pages.length)
  const voiceTab = tab === 'voice'
  const voiceBusy = useVoiceStore((s) => s.status === 'starting' || s.status === 'live')
  const locked = voiceTab && voiceBusy
  const lockedTitle = locked ? 'End the voice session to change this' : undefined
  const effective: Scope = scope === 'selection' && (selectionCount === 0 || voiceTab) ? 'page' : scope
  const refineMode = tab === 'refine'

  const caption =
    effective === 'selection'
      ? `Reads only your selection on p.${page?.number} (${selectionCount} item${selectionCount === 1 ? '' : 's'}).`
      : effective === 'page'
        ? `Reads only p.${page?.number}${page ? `, "${page.title}"` : ''}.`
        : `Reads all ${pageCount} pages; p.${page?.number} is marked as the one you're on.`

  return (
    <div className="pb-3 pl-7 pr-4">
      <Segmented<Scope>
        label="What the AI reads"
        value={effective}
        onChange={setScope}
        options={[
          {
            value: 'selection',
            label: (
              <>
                <Lasso size={13} /> Selection
              </>
            ),
            disabled: selectionCount === 0 || voiceTab,
            title: voiceTab ? 'Voice works on a page or the whole project' : selectionCount === 0 ? 'Use the Select tool (V) and loop around part of your notes' : undefined,
          },
          { value: 'page', label: (<><FileText size={13} /> This page</>), disabled: locked, title: lockedTitle },
          { value: 'project', label: (<><Library size={13} /> Whole project</>), disabled: refineMode || locked, title: refineMode ? 'Refine works on a page or a selection' : lockedTitle },
        ]}
      />
      <p className="mt-1.5 text-[0.72rem] leading-snug text-ink-faint">{caption}</p>
    </div>
  )
}
