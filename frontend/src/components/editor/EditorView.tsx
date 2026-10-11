import { ChevronLeft, ChevronRight, Minus, PanelRightClose, PanelRightOpen, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { removeElements } from '../../canvas/engine'
import { needsVision } from '../../canvas/types'
import type { Background, Tool } from '../../canvas/types'
import { navigate, useMediaQuery } from '../../lib/hooks'
import { importIntoCurrentProject } from '../../lib/importActions'
import { entriesFromDrop } from '../../lib/importNotes'
import { useAiStore } from '../../store/aiStore'
import { useCanvasStore } from '../../store/canvasStore'
import { hasUnsavedWork, useCurrentPage, useProjectStore } from '../../store/projectStore'
import { AIPanel } from '../ai/AIPanel'
import { Spinner } from '../ui/Toasts'
import { CanvasStage } from './CanvasStage'
import { PageSidebar } from './PageSidebar'
import { Toolbar } from './Toolbar'

const TOOL_KEYS: Record<string, Tool> = { p: 'pen', h: 'highlighter', e: 'eraser', t: 'text', v: 'select' }
const AUTO_READ_DELAY_MS = 6000

export function EditorView({ projectId }: { projectId: string }) {
  const loading = useProjectStore((s) => s.loading)
  const loadError = useProjectStore((s) => s.loadError)
  const project = useProjectStore((s) => s.project)
  const page = useCurrentPage()
  // Wide screens dock the AI panel; narrower ones show it as a drawer over the page.
  const wide = useMediaQuery('(min-width: 1200px)')
  const [panelPreference, setPanelPreference] = useState<boolean | null>(null)
  const panelOpen = panelPreference ?? wide
  const togglePanel = () => setPanelPreference(!panelOpen)
  const [dropping, setDropping] = useState(false)
  const pendingAi = useAiStore((s) => s.pending)

  // Selection-bar and Insights actions need the panel visible to run.
  useEffect(() => {
    if (pendingAi) setPanelPreference(true)
  }, [pendingAi])

  useEffect(() => {
    useAiStore.getState().reset()
    void useProjectStore.getState().loadProject(projectId)
    return () => useProjectStore.getState().closeProject()
  }, [projectId])

  useEffect(() => {
    if (project) void useAiStore.getState().refreshTranscripts().catch(() => undefined)
  }, [project?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useKeyboardShortcuts()
  useAutoRead()

  // A newly opened page starts at its top, not wherever the previous page was scrolled.
  useEffect(() => {
    document.getElementById('page-scroll')?.scrollTo({ top: 0 })
  }, [page?.id])

  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (hasUnsavedWork()) e.preventDefault()
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [])

  if (loadError) {
    return (
      <div className="grid h-full place-items-center p-8 text-center">
        <div>
          <p className="font-display text-2xl">Couldn't open this notebook</p>
          <p className="mt-2 text-ink-soft">{loadError}</p>
          <button className="btn btn-ink mt-6" onClick={() => navigate({ name: 'home' })}>
            Back to notebooks
          </button>
        </div>
      </div>
    )
  }

  if (loading || !project || !page) {
    return (
      <div className="grid h-full place-items-center text-ink-soft">
        <Spinner size={22} />
      </div>
    )
  }

  return (
    <div className={`grid h-full ${panelOpen && wide ? 'grid-cols-[236px_minmax(0,1fr)_400px]' : 'grid-cols-[236px_minmax(0,1fr)]'}`}>
      <PageSidebar />

      <main
        className="relative flex min-h-0 flex-col"
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return
          e.preventDefault()
          setDropping(true)
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDropping(false)
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return
          e.preventDefault()
          setDropping(false)
          void entriesFromDrop(e.dataTransfer).then((entries) => importIntoCurrentProject(entries))
        }}
      >
        {dropping && (
          <div className="pointer-events-none absolute inset-3 z-40 grid place-items-center rounded-2xl border-[3px] border-dashed border-pen bg-paper/85 backdrop-blur-sm">
            <div className="text-center">
              <p className="font-display text-2xl font-semibold">Drop to import</p>
              <p className="mt-1 text-sm text-ink-soft">PDFs, photos of notes, .txt, .md, .docx or a whole folder</p>
            </div>
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center pl-4 pr-16">
          <Toolbar />
        </div>
        <div className="min-h-0 flex-1 overflow-auto" id="page-scroll">
          <CanvasStage page={page} />
        </div>
        <StatusBar />
        <button
          className={`btn absolute right-3 top-3 z-30 p-2 ${panelOpen ? 'btn-outline' : 'btn-pen'}`}
          onClick={togglePanel}
          aria-label={panelOpen ? 'Hide AI panel' : 'Show AI panel'}
          title={panelOpen ? 'Hide AI panel' : 'Show AI panel'}
        >
          {panelOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
        </button>
      </main>

      {panelOpen &&
        (wide ? (
          <AIPanel />
        ) : (
          <div className="fixed inset-y-0 right-0 z-40 w-[min(400px,94vw)] bg-card shadow-page">
            <AIPanel onClose={togglePanel} />
          </div>
        ))}
    </div>
  )
}

function StatusBar() {
  const saveStatus = useProjectStore((s) => s.saveStatus)
  const pages = useProjectStore((s) => s.pages)
  const page = useCurrentPage()
  const transcript = useAiStore((s) => s.transcripts.find((t) => t.page_id === page?.id))
  const reading = useAiStore((s) => (page ? s.reading.includes(page.id) : false))
  const zoom = useCanvasStore((s) => s.zoom)
  const setZoom = useCanvasStore((s) => s.setZoom)
  const { goRelative, setBackground } = useProjectStore.getState()
  if (!page) return null

  const saveLabel = { saved: 'Saved', unsaved: 'Unsaved changes', saving: 'Saving…', error: "Couldn't save" }[saveStatus]
  const saveTone = { saved: 'text-grounded', unsaved: 'text-ink-faint', saving: 'text-partial', error: 'text-missing' }[saveStatus]
  const hasInk = needsVision(page.elements)
  const aiLabel = reading
    ? 'AI is reading this page…'
    : !hasInk
      ? 'Typed text: AI reads it directly'
      : transcript && !transcript.stale
        ? 'AI has read your handwriting'
        : 'AI will read your latest ink before answering'

  return (
    <div className="flex items-center justify-between gap-4 border-t border-desk-shade/60 bg-desk/80 px-4 py-1.5 text-xs backdrop-blur">
      <span className={`font-bold ${saveTone}`}>
        {saveStatus === 'saved' ? '✓ ' : saveStatus === 'error' ? '! ' : '• '}
        {saveLabel}
      </span>
      <span className="flex items-center gap-1 text-ink-soft">
        <button className="rounded p-0.5 hover:bg-ink/10 disabled:opacity-30" onClick={() => goRelative(-1)} disabled={page.number === 1} aria-label="Previous page">
          <ChevronLeft size={14} />
        </button>
        Page <strong className="text-ink">{page.number}</strong> of {pages.length}
        <button className="rounded p-0.5 hover:bg-ink/10 disabled:opacity-30" onClick={() => goRelative(1)} disabled={page.number === pages.length} aria-label="Next page">
          <ChevronRight size={14} />
        </button>
        <span className="mx-2 h-3.5 w-px bg-desk-shade" />
        <select
          value={page.background}
          onChange={(e) => void setBackground(page.id, e.target.value as Background)}
          className="rounded bg-transparent font-bold text-ink-soft outline-none hover:text-ink"
          aria-label="Paper style"
        >
          {(['ruled', 'grid', 'dots', 'blank'] as const).map((b) => (
            <option key={b} value={b}>
              {b[0].toUpperCase() + b.slice(1)} paper
            </option>
          ))}
        </select>
        <span className="mx-2 h-3.5 w-px bg-desk-shade" />
        <button className="rounded p-0.5 hover:bg-ink/10" onClick={() => setZoom(zoom - 0.1)} aria-label="Zoom out">
          <Minus size={13} />
        </button>
        <button className="w-10 text-center font-bold tabular-nums hover:text-ink" onClick={() => setZoom(1)} title="Reset zoom">
          {Math.round(zoom * 100)}%
        </button>
        <button className="rounded p-0.5 hover:bg-ink/10" onClick={() => setZoom(zoom + 0.1)} aria-label="Zoom in">
          <Plus size={13} />
        </button>
      </span>
      <span className="flex min-w-0 items-center gap-1.5 truncate text-ink-soft">
        {reading && <Spinner size={10} />}
        {aiLabel}
      </span>
    </div>
  )
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

function useKeyboardShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return
      const projects = useProjectStore.getState()
      const canvas = useCanvasStore.getState()
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) projects.redo()
        else projects.undo()
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        projects.redo()
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && canvas.selection.length) {
        const page = projects.pages.find((p) => p.id === projects.currentPageId)
        if (page) projects.commit(page.id, removeElements(page.elements, new Set(canvas.selection)))
        canvas.clearSelection()
      } else if (e.key === 'Escape') {
        canvas.clearSelection()
      } else if (e.key === 'PageDown') {
        projects.goRelative(1)
      } else if (e.key === 'PageUp') {
        projects.goRelative(-1)
      } else if (!mod && !e.altKey && TOOL_KEYS[e.key.toLowerCase()]) {
        canvas.setTool(TOOL_KEYS[e.key.toLowerCase()])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/** After the student pauses writing, quietly let the AI read the new ink (doc §11.1). */
function useAutoRead() {
  const page = useCurrentPage()
  const previous = useRef<{ id: string; elements: unknown } | null>(null)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  useEffect(() => {
    if (!page) return
    const before = previous.current
    // Saves and thumbnails also produce a new page object; only react to real edits.
    if (before && before.id === page.id && before.elements === page.elements) return
    previous.current = { id: page.id, elements: page.elements }
    window.clearTimeout(timer.current)
    if (!before || before.id !== page.id) return

    const pageId = page.id
    const hasInk = needsVision(page.elements)
    useAiStore.getState().markEdited(pageId, hasInk)
    if (!hasInk) return
    timer.current = window.setTimeout(() => {
      const ai = useAiStore.getState()
      if (!ai.autoRead || !ai.health?.ai_configured) return
      const transcript = ai.transcripts.find((t) => t.page_id === pageId)
      if (transcript && !transcript.stale) return // already read (e.g. by an AI request meanwhile)
      void ai.readPage(pageId)
    }, AUTO_READ_DELAY_MS)
  }, [page])
}
