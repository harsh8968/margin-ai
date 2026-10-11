import { BookOpenCheck, Lightbulb, ListChecks, Trash2, WandSparkles } from 'lucide-react'

import { removeElements } from '../../canvas/engine'
import type { AiTab, PendingAction } from '../../store/aiStore'
import { useAiStore } from '../../store/aiStore'
import { useCanvasStore } from '../../store/canvasStore'
import { useProjectStore } from '../../store/projectStore'

interface Props {
  pageId: string
  left: number
  top: number
  /** Width of the page on screen, so the bar can stay inside it. */
  pageWidth: number
}

const ACTIONS: { label: string; icon: typeof Lightbulb; tab: AiTab; kind: PendingAction['kind'] }[] = [
  { label: 'Explain', icon: Lightbulb, tab: 'ask', kind: 'explain' },
  { label: 'Summarise', icon: BookOpenCheck, tab: 'summary', kind: 'summarize' },
  { label: 'Improve', icon: WandSparkles, tab: 'refine', kind: 'refine' },
  { label: 'Quiz me', icon: ListChecks, tab: 'quiz', kind: 'quiz' },
]

/** Floating actions for "selected content assistance" (doc B4). */
export function SelectionBar({ pageId, left, top, pageWidth }: Props) {
  const compact = pageWidth < 600
  const barWidth = compact ? 230 : 470
  const clampedLeft = Math.min(Math.max(left, barWidth / 2 + 4), Math.max(barWidth / 2 + 4, pageWidth - barWidth / 2 - 4))
  const selection = useCanvasStore((s) => s.selection)

  const send = (tab: AiTab, kind: PendingAction['kind']) => {
    useAiStore.getState().request({ tab, kind })
    useAiStore.setState({ scope: 'selection' })
  }

  const remove = () => {
    const store = useProjectStore.getState()
    const page = store.pages.find((p) => p.id === pageId)
    if (!page) return
    store.commit(pageId, removeElements(page.elements, new Set(selection)))
    useCanvasStore.getState().clearSelection()
  }

  return (
    <div
      className="rise absolute z-10 flex -translate-x-1/2 -translate-y-full items-center gap-0.5 rounded-xl bg-ink p-1 text-paper shadow-tool"
      style={{ left: clampedLeft, top: Math.max(top, 52) }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {!compact && <span className="whitespace-nowrap px-2 text-[0.68rem] font-bold uppercase tracking-wider text-highlight">Ask AI</span>}
      {ACTIONS.map(({ label, icon: Icon, tab, kind }) => (
        <button
          key={label}
          className="flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-bold transition hover:bg-white/12"
          onClick={() => send(tab, kind)}
          title={label}
          aria-label={label}
        >
          <Icon size={14} /> {!compact && label}
        </button>
      ))}
      <span className="mx-1 h-5 w-px bg-white/20" />
      <button className="rounded-lg p-1.5 text-white/80 transition hover:bg-pen hover:text-white" onClick={remove} aria-label="Delete selection" title="Delete (Del)">
        <Trash2 size={14} />
      </button>
    </div>
  )
}
