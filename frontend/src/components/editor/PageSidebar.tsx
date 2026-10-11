import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowLeft, Copy, Download, FilePlus2, GripVertical, MoreHorizontal, MoreVertical, Pencil, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { api, errorMessage } from '../../api/client'
import type { Page } from '../../api/types'
import { navigate } from '../../lib/hooks'
import { useAiStore } from '../../store/aiStore'
import { useProjectStore } from '../../store/projectStore'
import { toast, toastError } from '../../store/toastStore'
import { importIntoCurrentProject } from '../../lib/importActions'
import { ImportPicker } from '../ui/ImportPicker'
import { ConfirmDialog } from '../ui/Modal'
import { Spinner } from '../ui/Toasts'

export function PageSidebar() {
  const project = useProjectStore((s) => s.project)
  const pages = useProjectStore((s) => s.pages)
  const currentPageId = useProjectStore((s) => s.currentPageId)
  const { reorderPages, addPage, renameProject, flushSaves } = useProjectStore.getState()
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [exporting, setExporting] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Page | null>(null)
  const [deletingNotebook, setDeletingNotebook] = useState(false)

  const startRename = () => {
    if (!project) return
    setNameDraft(project.name)
    setEditingName(true)
  }

  const deleteNotebook = async () => {
    if (!project) return
    try {
      await flushSaves() // a save landing after the delete would fail with "not found"
      await api.deleteProject(project.id)
      setDeletingNotebook(false)
      toast(`Deleted "${project.name}"`, { tone: 'success' })
      navigate({ name: 'home' })
    } catch (error) {
      toastError(`Couldn't delete the notebook: ${errorMessage(error)}`)
    }
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const ids = pages.map((p) => p.id)
    void reorderPages(arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))))
  }

  const exportPdf = async () => {
    if (!project) return
    setExporting('Preparing…')
    try {
      await flushSaves()
      const { exportProjectPdf } = await import('../../export/pdfExport') // jsPDF is big: load it on demand
      await exportProjectPdf(project.name, useProjectStore.getState().pages, (done, total) => setExporting(`${done}/${total}`))
      toast('PDF downloaded', { tone: 'success' })
    } catch (error) {
      toastError(`Export failed: ${errorMessage(error)}`)
    } finally {
      setExporting(null)
    }
  }

  if (!project) return null

  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-desk-shade/70 bg-desk-deep/40">
      <div className="px-4 pb-3 pt-4">
        <button className="btn btn-ghost -ml-2 px-2 py-1 text-xs" onClick={() => navigate({ name: 'home' })}>
          <ArrowLeft size={14} /> Notebooks
        </button>
        {editingName ? (
          <input
            autoFocus
            className="field mt-2 py-1 font-display text-lg"
            value={nameDraft}
            maxLength={120}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => {
              setEditingName(false)
              void renameProject(nameDraft)
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <div className="mt-2 flex items-start justify-between gap-1">
            <h1
              className="min-w-0 cursor-text break-words font-display text-[1.35rem] font-semibold leading-tight"
              title="Double-click to rename"
              onDoubleClick={startRename}
            >
              {project.name}
            </h1>
            <NotebookMenu onRename={startRename} onDelete={() => setDeletingNotebook(true)} />
          </div>
        )}
        <p className="eyebrow mt-2">
          {pages.length} {pages.length === 1 ? 'page' : 'pages'} · drag to reorder
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={pages.map((p) => p.id)} strategy={verticalListSortingStrategy}>
            <ol className="flex flex-col gap-2.5">
              {pages.map((page) => (
                <PageItem key={page.id} page={page} active={page.id === currentPageId} onDelete={() => setDeleting(page)} />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      </div>

      <div className="flex flex-col gap-2 border-t border-desk-shade/70 p-3">
        <div className="grid grid-cols-2 gap-2">
          <button className="btn btn-outline px-2" onClick={() => void addPage()}>
            <FilePlus2 size={16} /> Page
          </button>
          <ImportPicker label="Import" className="btn btn-outline w-full px-2" menuAbove onPick={(entries) => void importIntoCurrentProject(entries)} />
        </div>
        <button className="btn btn-ink w-full" onClick={exportPdf} disabled={exporting !== null}>
          {exporting ? (
            <>
              <Spinner /> Exporting {exporting}
            </>
          ) : (
            <>
              <Download size={16} /> Export PDF
            </>
          )}
        </button>
      </div>

      {deleting && (
        <ConfirmDialog
          title="Delete page?"
          message={
            <>
              Page {deleting.number}, <strong className="text-ink">{deleting.title}</strong>, will be removed. You can undo this for a few seconds.
            </>
          }
          confirmLabel="Delete page"
          danger
          onConfirm={() => {
            void useProjectStore.getState().deletePage(deleting.id)
            setDeleting(null)
          }}
          onCancel={() => setDeleting(null)}
        />
      )}

      {deletingNotebook && (
        <ConfirmDialog
          title="Delete notebook?"
          message={
            <>
              <strong className="text-ink">{project.name}</strong> and all {pages.length} of its pages, quizzes and flashcards will be
              deleted permanently.
            </>
          }
          confirmLabel="Delete notebook"
          danger
          onConfirm={deleteNotebook}
          onCancel={() => setDeletingNotebook(false)}
        />
      )}
    </aside>
  )
}

function NotebookMenu({ onRename, onDelete }: { onRename: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative shrink-0">
      <button className="btn btn-ghost p-1" onClick={() => setOpen((o) => !o)} aria-label="Notebook options" aria-haspopup="menu" aria-expanded={open}>
        <MoreHorizontal size={18} />
      </button>
      {open && (
        <div role="menu" className="rise absolute right-0 top-8 z-30 w-44 overflow-hidden rounded-xl border border-line bg-paper py-1 shadow-lift" onMouseLeave={() => setOpen(false)}>
          <button role="menuitem" className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-desk/60" onClick={() => { setOpen(false); onRename() }}>
            <Pencil size={14} /> Rename
          </button>
          <button role="menuitem" className="flex w-full items-center gap-2 px-3 py-2 text-sm text-pen hover:bg-pen-soft" onClick={() => { setOpen(false); onDelete() }}>
            <Trash2 size={14} /> Delete notebook
          </button>
        </div>
      )}
    </div>
  )
}

function PageItem({ page, active, onDelete }: { page: Page; active: boolean; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page.id })
  const transcript = useAiStore((s) => s.transcripts.find((t) => t.page_id === page.id))
  const reading = useAiStore((s) => s.reading.includes(page.id))
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(page.title)
  const [menu, setMenu] = useState(false)
  const itemRef = useRef<HTMLLIElement | null>(null)
  const { setCurrentPage, renamePage, duplicatePage } = useProjectStore.getState()

  // Keep the open page visible in the list (e.g. right after "Add page").
  useEffect(() => {
    if (active) itemRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [active])

  const finishRename = () => {
    setRenaming(false)
    if (draft.trim() && draft !== page.title) void renamePage(page.id, draft)
  }

  const aiState = reading ? 'reading' : !transcript ? null : transcript.stale && transcript.has_ink ? 'unread' : transcript.transcript_md ? 'read' : null

  return (
    <li
      ref={(node) => {
        setNodeRef(node)
        itemRef.current = node
      }}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group relative flex gap-2.5 rounded-xl p-1.5 transition ${
        active ? 'bg-paper shadow-lift ring-2 ring-pen/70' : 'hover:bg-paper/60'
      } ${isDragging ? 'z-10 opacity-80 shadow-page' : ''}`}
    >
      <button
        className="relative w-[52px] shrink-0 overflow-hidden rounded-[3px] bg-paper shadow-[0_1px_4px_rgba(31,42,68,0.25)]"
        style={{ aspectRatio: '1240 / 1754' }}
        onClick={() => setCurrentPage(page.id)}
        aria-label={`Open page ${page.number}`}
        aria-current={active ? 'page' : undefined}
      >
        {page.thumbnail ? (
          <img src={page.thumbnail} alt="" className="h-full w-full object-cover" draggable={false} />
        ) : (
          <span className="block h-full w-full bg-[repeating-linear-gradient(180deg,transparent_0,transparent_6px,rgba(70,110,170,0.18)_6px,rgba(70,110,170,0.18)_7px)]" />
        )}
      </button>

      <div className="min-w-0 flex-1 py-0.5">
        <div className="flex items-baseline gap-1.5 pr-5">
          <span className="font-display text-sm font-semibold text-pen">{page.number}</span>
          {renaming ? (
            <input
              autoFocus
              value={draft}
              maxLength={120}
              className="field px-1.5 py-0.5 text-sm"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={finishRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') finishRename()
                if (e.key === 'Escape') {
                  setDraft(page.title)
                  setRenaming(false)
                }
              }}
            />
          ) : (
            <button
              className="truncate text-left text-sm font-bold leading-snug"
              onClick={() => setCurrentPage(page.id)}
              onDoubleClick={() => {
                setDraft(page.title)
                setRenaming(true)
              }}
              title="Double-click to rename"
            >
              {page.title}
            </button>
          )}
        </div>
        {aiState && (
          <p className={`mt-1 text-[0.68rem] font-bold ${aiState === 'read' ? 'text-grounded' : aiState === 'reading' ? 'text-partial' : 'text-ink-faint'}`}>
            {aiState === 'read' ? '✓ AI has read it' : aiState === 'reading' ? 'AI is reading…' : '○ New ink, not read yet'}
          </p>
        )}
      </div>

      <div className="absolute right-1 top-1.5 flex flex-col items-center rounded-lg bg-paper/90 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
        <button className="cursor-grab rounded p-1 text-ink-faint hover:text-ink active:cursor-grabbing" {...attributes} {...listeners} aria-label={`Drag page ${page.number}`}>
          <GripVertical size={14} />
        </button>
        <button className="rounded p-1 text-ink-faint hover:text-ink" onClick={() => setMenu((m) => !m)} aria-label="Page options">
          <MoreVertical size={14} />
        </button>
      </div>

      {menu && (
        <div className="rise absolute right-2 top-14 z-20 w-40 overflow-hidden rounded-xl border border-line bg-paper py-1 shadow-lift" onMouseLeave={() => setMenu(false)}>
          <button className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-desk/60" onClick={() => { setMenu(false); setDraft(page.title); setRenaming(true) }}>
            <Pencil size={14} /> Rename
          </button>
          <button className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-desk/60" onClick={() => { setMenu(false); void duplicatePage(page.id) }}>
            <Copy size={14} /> Duplicate
          </button>
          <button className="flex w-full items-center gap-2 px-3 py-2 text-sm text-pen hover:bg-pen-soft" onClick={() => { setMenu(false); onDelete() }}>
            <Trash2 size={14} /> Delete
          </button>
        </div>
      )}
    </li>
  )
}
