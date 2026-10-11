/**
 * The open project: its pages (always kept sorted by `order`), the current page, undo
 * history per page, and debounced autosave (doc §9.4, §10).
 */
import { create } from 'zustand'

import { api, errorMessage } from '../api/client'
import type { Page, Project } from '../api/types'
import { emptyHistory, record, redo as redoStep, undo as undoStep } from '../canvas/history'
import type { History } from '../canvas/history'
import { ensureImagesLoaded, thumbnailOf } from '../canvas/renderer'
import type { Background, CanvasElement } from '../canvas/types'
import { toast, toastError } from './toastStore'

export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error'

const SAVE_DELAY_MS = 900
const RETRY_DELAY_MS = 4000
const THUMB_DELAY_MS = 2500

interface ProjectState {
  project: Project | null
  pages: Page[]
  currentPageId: string | null
  histories: Record<string, History>
  saveStatus: SaveStatus
  loading: boolean
  loadError: string | null

  loadProject: (projectId: string) => Promise<void>
  closeProject: () => void
  setCurrentPage: (pageId: string) => void
  goRelative: (delta: number) => void
  commit: (pageId: string, elements: CanvasElement[], options?: { record?: boolean }) => void
  undo: () => void
  redo: () => void
  addPage: (afterPageId?: string | null) => Promise<Page | null>
  insertPages: (pages: { title: string; elements: CanvasElement[]; background?: Background }[], afterPageId: string | null) => Promise<Page[]>
  duplicatePage: (pageId: string) => Promise<void>
  renamePage: (pageId: string, title: string) => Promise<void>
  setBackground: (pageId: string, background: Background) => Promise<void>
  deletePage: (pageId: string) => Promise<void>
  reorderPages: (orderedIds: string[]) => Promise<void>
  renameProject: (name: string) => Promise<void>
  flushSaves: () => Promise<void>
  savedHash: (pageId: string) => string | null
}

// Autosave bookkeeping lives outside React state: it never needs to trigger a render.
const saveTimers = new Map<string, number>()
const thumbTimers = new Map<string, number>()
const inflight = new Map<string, Promise<void>>()
const savedRefs = new Map<string, CanvasElement[]>()
const failedPages = new Set<string>()

const numbered = (pages: Page[]): Page[] =>
  [...pages].sort((a, b) => a.order - b.order).map((p, i) => ({ ...p, order: i, number: i + 1 }))

export const useProjectStore = create<ProjectState>((set, get) => {
  const updatePage = (pageId: string, change: Partial<Page>) =>
    set({ pages: get().pages.map((p) => (p.id === pageId ? { ...p, ...change } : p)) })

  const refreshStatus = () => {
    if (failedPages.size > 0) {
      set({ saveStatus: 'error' })
      return
    }
    set({ saveStatus: inflight.size > 0 ? 'saving' : saveTimers.size > 0 ? 'unsaved' : 'saved' })
  }

  const scheduleThumbnail = (pageId: string) => {
    window.clearTimeout(thumbTimers.get(pageId))
    thumbTimers.set(
      pageId,
      window.setTimeout(async () => {
        thumbTimers.delete(pageId)
        const page = get().pages.find((p) => p.id === pageId)
        if (!page) return
        await ensureImagesLoaded(page.elements)
        const thumbnail = thumbnailOf(page.elements, page.background)
        updatePage(pageId, { thumbnail })
        api.updatePage(pageId, { thumbnail }).catch(() => undefined) // thumbnails are cosmetic
      }, THUMB_DELAY_MS),
    )
  }

  const savePage = async (pageId: string): Promise<void> => {
    window.clearTimeout(saveTimers.get(pageId))
    saveTimers.delete(pageId)
    const running = inflight.get(pageId)
    if (running) await running
    const page = get().pages.find((p) => p.id === pageId)
    if (!page || savedRefs.get(pageId) === page.elements) {
      refreshStatus()
      return
    }
    const snapshot = page.elements
    const task = api
      .updatePage(pageId, { elements: snapshot })
      .then((result) => {
        failedPages.delete(pageId)
        savedRefs.set(pageId, snapshot)
        updatePage(pageId, { content_hash: result.content_hash })
        scheduleThumbnail(pageId)
      })
      .catch((error: unknown) => {
        set({ saveStatus: 'error' })
        failedPages.add(pageId)
        toastError(`Couldn't save: ${errorMessage(error)}. Retrying…`)
        // Keep the page dirty and retry, so a brief server hiccup never loses work.
        window.setTimeout(() => scheduleSave(pageId), RETRY_DELAY_MS)
        throw error
      })
      .finally(() => {
        if (inflight.get(pageId) === entry) inflight.delete(pageId)
      })
    const entry = task.catch(() => undefined)
    inflight.set(pageId, entry)
    set({ saveStatus: 'saving' })
    await task
    if (get().saveStatus === 'error') set({ saveStatus: 'saving' })
    refreshStatus()
    const latest = get().pages.find((p) => p.id === pageId)
    if (latest && latest.elements !== snapshot) await savePage(pageId)
  }

  const scheduleSave = (pageId: string) => {
    window.clearTimeout(saveTimers.get(pageId))
    saveTimers.set(pageId, window.setTimeout(() => void savePage(pageId).catch(() => undefined), SAVE_DELAY_MS))
    if (get().saveStatus !== 'saving') set({ saveStatus: 'unsaved' })
  }

  /** Re-fetch page order/metadata from the server WITHOUT discarding edits not yet saved. */
  const reloadPages = async () => {
    const project = get().project
    if (!project) return
    const { pages } = await api.getProject(project.id)
    const local = new Map(get().pages.map((p) => [p.id, p]))
    const merged = pages.map((server) => {
      const mine = local.get(server.id)
      // Local elements are always at least as new as the server's (autosave only lags).
      // savedRefs still says whether they're saved, so savedHash() stays correct.
      if (mine) return { ...server, elements: mine.elements, content_hash: mine.content_hash, thumbnail: mine.thumbnail ?? server.thumbnail }
      savedRefs.set(server.id, server.elements)
      return server
    })
    set({ pages: numbered(merged) })
  }

  return {
    project: null,
    pages: [],
    currentPageId: null,
    histories: {},
    saveStatus: 'saved',
    loading: false,
    loadError: null,

    loadProject: async (projectId) => {
      set({ loading: true, loadError: null })
      try {
        const { project, pages } = await api.getProject(projectId)
        savedRefs.clear()
        pages.forEach((p) => savedRefs.set(p.id, p.elements))
        set({ project, pages: numbered(pages), currentPageId: pages[0]?.id ?? null, histories: {}, saveStatus: 'saved', loading: false })
        // Pages created by the server (e.g. the demo) have no thumbnail yet.
        pages.filter((p) => !p.thumbnail).forEach((p) => scheduleThumbnail(p.id))
      } catch (error) {
        set({ loading: false, loadError: errorMessage(error) })
      }
    },

    closeProject: () => {
      // Clear only after pending saves finish, or an in-flight save could lose the last edit.
      const closingId = get().project?.id
      void get()
        .flushSaves()
        .finally(() => {
          if (get().project?.id === closingId) set({ project: null, pages: [], currentPageId: null, histories: {} })
        })
    },

    setCurrentPage: (pageId) => {
      const previous = get().currentPageId
      if (previous && previous !== pageId) void savePage(previous).catch(() => undefined)
      set({ currentPageId: pageId })
    },

    goRelative: (delta) => {
      const { pages, currentPageId } = get()
      const index = pages.findIndex((p) => p.id === currentPageId)
      const target = pages[index + delta]
      if (target) get().setCurrentPage(target.id)
    },

    commit: (pageId, elements, options = {}) => {
      const page = get().pages.find((p) => p.id === pageId)
      if (!page || page.elements === elements) return
      if (options.record !== false) {
        const history = get().histories[pageId] ?? emptyHistory()
        set({ histories: { ...get().histories, [pageId]: record(history, page.elements) } })
      }
      updatePage(pageId, { elements })
      scheduleSave(pageId)
    },

    undo: () => {
      const { currentPageId, pages, histories } = get()
      const page = pages.find((p) => p.id === currentPageId)
      if (!page) return
      const step = undoStep(histories[page.id] ?? emptyHistory(), page.elements)
      if (!step) return
      set({ histories: { ...histories, [page.id]: step.history } })
      updatePage(page.id, { elements: step.elements })
      scheduleSave(page.id)
    },

    redo: () => {
      const { currentPageId, pages, histories } = get()
      const page = pages.find((p) => p.id === currentPageId)
      if (!page) return
      const step = redoStep(histories[page.id] ?? emptyHistory(), page.elements)
      if (!step) return
      set({ histories: { ...histories, [page.id]: step.history } })
      updatePage(page.id, { elements: step.elements })
      scheduleSave(page.id)
    },

    addPage: async (afterPageId) => {
      const project = get().project
      if (!project) return null
      try {
        const current = get().pages.find((p) => p.id === (afterPageId ?? get().currentPageId))
        const page = await api.addPage(project.id, { after_page_id: afterPageId ?? get().currentPageId, background: current?.background })
        savedRefs.set(page.id, page.elements)
        await reloadPages()
        set({ currentPageId: page.id })
        return page
      } catch (error) {
        toastError(errorMessage(error))
        return null
      }
    },

    insertPages: async (newPages, afterPageId) => {
      const project = get().project
      if (!project) return []
      const created: Page[] = []
      let anchor = afterPageId
      for (const spec of newPages) {
        const page = await api.addPage(project.id, { title: spec.title, after_page_id: anchor, elements: spec.elements, background: spec.background })
        savedRefs.set(page.id, page.elements)
        created.push(page)
        anchor = page.id
      }
      await reloadPages()
      created.forEach((p) => scheduleThumbnail(p.id))
      if (created[0]) set({ currentPageId: created[0].id })
      return created
    },

    duplicatePage: async (pageId) => {
      await get().flushSaves()
      try {
        const page = await api.duplicatePage(pageId)
        await reloadPages()
        set({ currentPageId: page.id })
      } catch (error) {
        toastError(errorMessage(error))
      }
    },

    renamePage: async (pageId, title) => {
      const clean = title.trim().slice(0, 120)
      if (!clean) return
      updatePage(pageId, { title: clean })
      try {
        await api.updatePage(pageId, { title: clean })
      } catch (error) {
        toastError(errorMessage(error))
      }
    },

    setBackground: async (pageId, background) => {
      updatePage(pageId, { background })
      scheduleThumbnail(pageId)
      try {
        await api.updatePage(pageId, { background })
      } catch (error) {
        toastError(errorMessage(error))
      }
    },

    deletePage: async (pageId) => {
      const { pages } = get()
      if (pages.length <= 1) {
        toastError('A project needs at least one page.')
        return
      }
      await get().flushSaves()
      const index = pages.findIndex((p) => p.id === pageId)
      const deleted = pages[index]
      try {
        await api.deletePage(pageId)
      } catch (error) {
        toastError(errorMessage(error))
        return
      }
      // Re-read state after the awaits: saves above may have updated other pages meanwhile.
      const remaining = numbered(get().pages.filter((p) => p.id !== pageId))
      const nextCurrent = get().currentPageId === pageId ? (remaining[Math.min(index, remaining.length - 1)]?.id ?? null) : get().currentPageId
      set({ pages: remaining, currentPageId: nextCurrent })
      toast(`Deleted "${deleted.title}"`, {
        action: {
          label: 'Undo',
          run: () => {
            api
              .restorePage(pageId)
              .then(async () => {
                await reloadPages()
                set({ currentPageId: pageId })
              })
              .catch((error: unknown) => toastError(errorMessage(error)))
          },
        },
      })
    },

    reorderPages: async (orderedIds) => {
      const project = get().project
      if (!project) return
      const byId = new Map(get().pages.map((p) => [p.id, p]))
      set({ pages: orderedIds.map((id, i) => ({ ...byId.get(id)!, order: i, number: i + 1 })) })
      try {
        await api.reorderPages(project.id, orderedIds)
      } catch (error) {
        toastError(`Couldn't reorder: ${errorMessage(error)}`)
        await reloadPages()
      }
    },

    renameProject: async (name) => {
      const project = get().project
      const clean = name.trim()
      if (!project || !clean) return
      set({ project: { ...project, name: clean } })
      try {
        await api.renameProject(project.id, clean)
      } catch (error) {
        toastError(errorMessage(error))
      }
    },

    flushSaves: async () => {
      const pending = [...saveTimers.keys()]
      await Promise.all(pending.map((id) => savePage(id).catch(() => undefined)))
      await Promise.all([...inflight.values()])
      // Pages edited but never scheduled (e.g. a save still racing) get one more pass.
      const dirty = get().pages.filter((p) => savedRefs.get(p.id) !== p.elements)
      await Promise.all(dirty.map((p) => savePage(p.id).catch(() => undefined)))
    },

    savedHash: (pageId) => {
      const page = get().pages.find((p) => p.id === pageId)
      return page && savedRefs.get(pageId) === page.elements ? page.content_hash : null
    },
  }
})

export const useCurrentPage = (): Page | null =>
  useProjectStore((s) => s.pages.find((p) => p.id === s.currentPageId) ?? null)

export function hasUnsavedWork(): boolean {
  return saveTimers.size > 0 || inflight.size > 0 || failedPages.size > 0 || document.activeElement?.closest('[data-text-draft]') != null
}
