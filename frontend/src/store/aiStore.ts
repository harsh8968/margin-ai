/**
 * AI panel state and the page-reading pipeline (doc §11.1):
 * before any AI call, make sure every in-scope page with ink has a vision transcript that
 * matches its current content hash. Typed-only pages are handled by the server for free.
 */
import { create } from 'zustand'

import { ApiError, api, errorMessage } from '../api/client'
import type { Health, Scope, SelectionPayload, Transcript } from '../api/types'
import { selectionBounds } from '../canvas/hitTest'
import { ensureImagesLoaded, pageToDataUrl, renderRegion } from '../canvas/renderer'
import { useCanvasStore } from './canvasStore'
import { useProjectStore } from './projectStore'
import { toastError } from './toastStore'

export type AiTab = 'ask' | 'voice' | 'summary' | 'quiz' | 'refine' | 'cards' | 'revise' | 'insights'

/** A request from elsewhere in the UI (selection bar, insights) for a tab to act on. */
export interface PendingAction {
  tab: AiTab
  kind: 'ask' | 'explain' | 'summarize' | 'refine' | 'quiz' | 'cards'
  text?: string
  topics?: string[]
  nonce: number
}

interface AiState {
  tab: AiTab
  scope: Scope
  health: Health | null
  transcripts: Transcript[]
  reading: string[]
  autoRead: boolean
  seesOpen: boolean
  pending: PendingAction | null

  setTab: (tab: AiTab) => void
  setScope: (scope: Scope) => void
  setAutoRead: (on: boolean) => void
  setSeesOpen: (open: boolean) => void
  request: (action: Omit<PendingAction, 'nonce'>) => void
  consume: (nonce: number) => void
  /** Atomically claim the pending action for a tab (safe under React StrictMode double effects). */
  take: (tab: AiTab) => PendingAction | null
  loadHealth: () => Promise<void>
  refreshTranscripts: () => Promise<Transcript[]>
  markEdited: (pageId: string, hasInk: boolean) => void
  readPage: (pageId: string, options?: { force?: boolean }) => Promise<boolean>
  ensureRead: (scope: Scope) => Promise<void>
  correctTranscript: (pageId: string, text: string) => Promise<void>
  reset: () => void
}

const READ_CONCURRENCY = 2

export const DEFAULT_SCOPE: Record<AiTab, Scope> = {
  ask: 'project',
  voice: 'project',
  summary: 'page',
  quiz: 'project',
  refine: 'page',
  cards: 'project',
  revise: 'project',
  insights: 'project',
}

export const useAiStore = create<AiState>((set, get) => ({
  tab: 'ask',
  scope: 'project',
  health: null,
  transcripts: [],
  reading: [],
  autoRead: true,
  seesOpen: false,
  pending: null,

  setTab: (tab) => {
    const hasSelection = useCanvasStore.getState().selection.length > 0
    const keepsSelection = tab !== 'revise' && tab !== 'insights' && tab !== 'voice'
    const scope = get().scope === 'selection' && hasSelection && keepsSelection ? 'selection' : DEFAULT_SCOPE[tab]
    set({ tab, scope })
  },
  setScope: (scope) => set({ scope }),
  setAutoRead: (autoRead) => set({ autoRead }),
  setSeesOpen: (seesOpen) => set({ seesOpen }),
  request: (action) => set({ pending: { ...action, nonce: Date.now() + Math.random() }, tab: action.tab }),
  consume: (nonce) => {
    if (get().pending?.nonce === nonce) set({ pending: null })
  },
  take: (tab) => {
    const pending = get().pending
    if (!pending || pending.tab !== tab) return null
    set({ pending: null })
    return pending
  },

  loadHealth: async () => {
    try {
      set({ health: await api.health() })
    } catch {
      set({ health: null })
    }
  },

  refreshTranscripts: async () => {
    const project = useProjectStore.getState().project
    if (!project) return []
    const transcripts = await api.transcripts(project.id)
    set({ transcripts })
    return transcripts
  },

  markEdited: (pageId, hasInk) => {
    set({
      transcripts: get().transcripts.map((t) => (t.page_id === pageId ? { ...t, stale: true, has_ink: hasInk } : t)),
    })
  },

  readPage: (pageId, options = {}) => {
    // Asking while an auto-read is running must wait for THAT read, not skip the page.
    const running = readsInFlight.get(pageId)
    if (running) return running
    const task = readPageNow(pageId, options.force ?? false).finally(() => readsInFlight.delete(pageId))
    readsInFlight.set(pageId, task)
    return task
  },

  ensureRead: async (scope) => {
    const { currentPageId } = useProjectStore.getState()
    await useProjectStore.getState().flushSaves()
    const transcripts = await get().refreshTranscripts()
    const inScope = (pageId: string) => scope === 'project' || pageId === currentPageId
    const queue = transcripts.filter((t) => t.stale && t.has_ink && inScope(t.page_id))
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) await get().readPage(next.page_id)
    }
    await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, queue.length) }, worker))
    // Reads that were already running (auto-read) must finish before the AI is asked.
    await Promise.all([...readsInFlight.entries()].filter(([id]) => inScope(id)).map(([, task]) => task))
  },

  correctTranscript: async (pageId, text) => {
    await useProjectStore.getState().flushSaves()
    const transcript = await api.correctTranscript(pageId, text)
    set({ transcripts: get().transcripts.map((t) => (t.page_id === pageId ? transcript : t)) })
  },

  reset: () => set({ transcripts: [], reading: [], pending: null, tab: 'ask', scope: 'project' }),
}))

const readsInFlight = new Map<string, Promise<boolean>>()

/** Render the saved page and send it to the vision model. Retries once if it changed mid-read. */
async function readPageNow(pageId: string, force: boolean): Promise<boolean> {
  const store = useAiStore
  store.setState({ reading: [...store.getState().reading, pageId] })
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      await useProjectStore.getState().flushSaves()
      const page = useProjectStore.getState().pages.find((p) => p.id === pageId)
      const hash = useProjectStore.getState().savedHash(pageId)
      if (!page || !hash) continue
      await ensureImagesLoaded(page.elements)
      const image = pageToDataUrl(page.elements, page.background, 1, 0.85)
      try {
        const transcript = await api.transcribe(pageId, image, hash, force)
        store.setState({ transcripts: store.getState().transcripts.map((t) => (t.page_id === pageId ? transcript : t)) })
        return true
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) continue // edited mid-read: save and retry
        throw error
      }
    }
    return false
  } catch (error) {
    toastError(`Couldn't read page: ${errorMessage(error)}`)
    return false
  } finally {
    store.setState({ reading: store.getState().reading.filter((id) => id !== pageId) })
  }
}

/** Snapshot of the current selection for "ask about this part" (doc B4). */
export function currentSelectionPayload(): SelectionPayload | null {
  const ids = new Set(useCanvasStore.getState().selection)
  if (ids.size === 0) return null
  const projects = useProjectStore.getState()
  const page = projects.pages.find((p) => p.id === projects.currentPageId)
  if (!page) return null
  const selected = page.elements.filter((el) => ids.has(el.id))
  const textBlocks = selected.flatMap((el) => (el.type === 'text' && el.text.trim() ? [el.text.trim()] : []))
  const hasInk = selected.some((el) => el.type === 'stroke')
  const box = selectionBounds(page.elements, ids)
  const image = hasInk && box ? renderRegion(page.elements, ids, box) : null
  return { image, text_blocks: textBlocks }
}

/** Scope + selection arguments shared by most AI calls. Reads pages first. */
export async function prepareScope(scope: Scope): Promise<{ project_id: string; page_id: string | null; scope: Scope; selection: SelectionPayload | null } | null> {
  const projects = useProjectStore.getState()
  if (!projects.project) return null
  const selection = scope === 'selection' ? currentSelectionPayload() : null
  if (scope === 'selection' && !selection) {
    toastError('Select something on the page first (Select tool, then draw a loop around it).')
    return null
  }
  await useAiStore.getState().ensureRead(scope === 'project' ? 'project' : 'page')
  return { project_id: projects.project.id, page_id: projects.currentPageId, scope, selection }
}
