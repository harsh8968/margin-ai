import { BookOpen, MoreHorizontal, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'

import { api, errorMessage } from '../../api/client'
import type { Project } from '../../api/types'
import { spineColor, timeAgo } from '../../lib/format'
import { navigate } from '../../lib/hooks'
import { toastError } from '../../store/toastStore'
import { AiStatus } from '../ai/AiStatus'
import { importAsNewNotebook } from '../../lib/importActions'
import type { ImportEntry } from '../../lib/importNotes'
import { ImportPicker } from '../ui/ImportPicker'
import { ConfirmDialog } from '../ui/Modal'
import { Spinner } from '../ui/Toasts'

export function HomeView() {
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Project | null>(null)

  const load = useCallback(async () => {
    try {
      setProjects(await api.listProjects())
      setLoadError(null)
    } catch (error) {
      setLoadError(errorMessage(error))
      setProjects([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const create = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    try {
      const project = await api.createProject(name.trim())
      navigate({ name: 'project', projectId: project.id })
    } catch (error) {
      toastError(errorMessage(error))
      setBusy(false)
    }
  }

  const openDemo = async () => {
    setBusy(true)
    try {
      const project = await api.seedDemo()
      navigate({ name: 'project', projectId: project.id })
    } catch (error) {
      toastError(errorMessage(error))
      setBusy(false)
    }
  }

  const importNotebook = async (entries: ImportEntry[]) => {
    const projectId = await importAsNewNotebook(entries)
    if (projectId) navigate({ name: 'project', projectId })
  }

  const rename = async (project: Project, next: string) => {
    try {
      await api.renameProject(project.id, next)
      await load()
    } catch (error) {
      toastError(errorMessage(error))
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    try {
      await api.deleteProject(deleting.id)
      setDeleting(null)
      await load()
    } catch (error) {
      toastError(errorMessage(error))
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-8 pb-24 pt-14">
        <header className="grid items-end gap-10 lg:grid-cols-[1.25fr_1fr]">
          <div className="rise">
            <div className="eyebrow mb-4 flex items-center gap-3">
              <span className="h-px w-8 bg-pen" /> AI study canvas
            </div>
            <h1 className="font-display text-[clamp(3.6rem,8vw,6.6rem)] font-semibold italic leading-[0.9] tracking-tight">
              Margin
              <svg viewBox="0 0 300 24" className="-mt-2 block h-5 w-[min(320px,60%)] text-pen" aria-hidden>
                <path d="M4 16 C 70 4, 160 22, 296 8" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
              </svg>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-soft">
              A notebook that has <em className="font-display not-italic text-ink">read your notes</em>, handwriting included.
              Ask it questions, get quizzed, tidy pages up, and it tells you honestly when your notes don't cover something.
            </p>
          </div>

          <div className="rise rounded-2xl border border-line bg-paper/80 p-6 shadow-lift backdrop-blur" style={{ animationDelay: '120ms' }}>
            <form onSubmit={create} className="flex flex-col gap-3">
              <label htmlFor="new-notebook" className="eyebrow">
                Start a notebook
              </label>
              <div className="flex gap-2">
                <input
                  id="new-notebook"
                  className="field"
                  placeholder="e.g. DBMS Unit 3"
                  value={name}
                  maxLength={120}
                  onChange={(e) => setName(e.target.value)}
                />
                <button className="btn btn-ink shrink-0" disabled={busy || !name.trim()}>
                  <Plus size={16} /> Create
                </button>
              </div>
            </form>
            <div className="my-4 flex items-center gap-3 text-xs text-ink-faint">
              <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
            </div>
            <button
              className="btn btn-outline w-full"
              onClick={openDemo}
              disabled={busy}
              title="A 6-page DBMS normalisation notebook with typed and handwritten pages"
            >
              {busy ? <Spinner /> : <Sparkles size={16} className="text-pen" />} Open the demo notebook
            </button>
            <div className="mt-2">
              <ImportPicker label="Import PDFs, photos or a notes folder" onPick={(entries) => void importNotebook(entries)} />
            </div>
            <div className="mt-4">
              <AiStatus />
            </div>
          </div>
        </header>

        <section className="mt-16">
          <div className="mb-6 flex items-baseline justify-between border-b border-desk-shade pb-3">
            <h2 className="font-display text-2xl font-semibold">Your notebooks</h2>
            {projects && <span className="text-sm text-ink-faint">{projects.length} total</span>}
          </div>

          {loadError && <p className="rounded-xl bg-missing-soft px-4 py-3 text-sm text-missing">{loadError}</p>}

          {projects === null ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-7">
              {[0, 1, 2].map((i) => (
                <div key={i} className="skeleton h-72" />
              ))}
            </div>
          ) : projects.length === 0 && !loadError ? (
            <div className="rounded-2xl border-2 border-dashed border-desk-shade px-8 py-14 text-center text-ink-soft">
              <BookOpen className="mx-auto mb-3 text-ink-faint" />
              No notebooks yet. Create one above, or open the demo to see the AI in action.
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-7 gap-y-10">
              {projects.map((project, i) => (
                <NotebookCard key={project.id} project={project} index={i} onRename={rename} onDelete={setDeleting} />
              ))}
            </div>
          )}
        </section>
      </div>

      {deleting && (
        <ConfirmDialog
          title="Delete notebook?"
          message={
            <>
              <strong className="text-ink">{deleting.name}</strong> and all {deleting.page_count} of its pages, quizzes and flashcards
              will be deleted permanently.
            </>
          }
          confirmLabel="Delete notebook"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  )
}

interface CardProps {
  project: Project
  index: number
  onRename: (project: Project, name: string) => void
  onDelete: (project: Project) => void
}

function NotebookCard({ project, index, onRename, onDelete }: CardProps) {
  const [menu, setMenu] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(project.name)
  const spine = spineColor(project.id)
  const open = () => navigate({ name: 'project', projectId: project.id })

  const finishRename = () => {
    setEditing(false)
    if (draft.trim() && draft.trim() !== project.name) onRename(project, draft.trim())
  }

  return (
    <article className="rise group relative" style={{ animationDelay: `${80 + index * 50}ms` }}>
      <button
        onClick={open}
        className="relative block aspect-[1/1.12] w-full overflow-hidden rounded-r-xl rounded-l-[4px] text-left shadow-lift transition duration-300 ease-[var(--ease-out-expo)] group-hover:-translate-y-1.5 group-hover:-rotate-[0.6deg] group-hover:shadow-page"
        style={{ background: spine }}
        aria-label={`Open ${project.name}`}
      >
        {/* notebook spine with stitching */}
        <span className="absolute inset-y-0 left-0 w-5 border-r border-black/20 bg-black/15">
          <span className="absolute inset-y-3 left-2 border-l border-dashed border-white/30" />
        </span>
        <span className="absolute inset-y-4 left-9 right-4 overflow-hidden rounded-sm bg-paper shadow-[0_2px_8px_rgba(0,0,0,0.25)]">
          {project.cover_thumbnail ? (
            <img src={project.cover_thumbnail} alt="" className="h-full w-full object-cover object-top" />
          ) : (
            <span className="block h-full w-full bg-[repeating-linear-gradient(180deg,transparent_0,transparent_17px,rgba(70,110,170,0.18)_17px,rgba(70,110,170,0.18)_18px)]" />
          )}
        </span>
      </button>

      <div className="mt-3 flex items-start justify-between gap-2 pl-1">
        <div className="min-w-0">
          {editing ? (
            <input
              autoFocus
              className="field py-1 font-display text-lg"
              value={draft}
              maxLength={120}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={finishRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') finishRename()
                if (e.key === 'Escape') {
                  setDraft(project.name)
                  setEditing(false)
                }
              }}
            />
          ) : (
            <h3 className="truncate font-display text-lg font-semibold leading-tight">{project.name}</h3>
          )}
          <p className="mt-0.5 text-xs text-ink-faint">
            {project.page_count} {project.page_count === 1 ? 'page' : 'pages'} · edited {timeAgo(project.updated_at)}
          </p>
        </div>
        <div className="relative">
          <button className="btn btn-ghost p-1.5" onClick={() => setMenu((m) => !m)} aria-label="Notebook options">
            <MoreHorizontal size={18} />
          </button>
          {menu && (
            <div className="rise absolute right-0 top-9 z-20 w-40 overflow-hidden rounded-xl border border-line bg-paper py-1 shadow-lift" onMouseLeave={() => setMenu(false)}>
              <button className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-desk/60" onClick={() => { setMenu(false); setEditing(true) }}>
                <Pencil size={14} /> Rename
              </button>
              <button className="flex w-full items-center gap-2 px-3 py-2 text-sm text-pen hover:bg-pen-soft" onClick={() => { setMenu(false); onDelete(project) }}>
                <Trash2 size={14} /> Delete
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  )
}
