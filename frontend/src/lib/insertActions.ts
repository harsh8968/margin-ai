/**
 * Putting AI output into the notebook. Every path ADDS content; the only replacing path
 * (`replaceWithText`) is called after the student explicitly confirms, and is one undo step.
 */
import { errorMessage } from '../api/client'
import { makeTextBlock, removeElements, upsertElement } from '../canvas/engine'
import { selectionBounds } from '../canvas/hitTest'
import { measureWithCanvas } from '../canvas/textLayout'
import type { CanvasElement, TextElement } from '../canvas/types'
import { PAGE_MARGIN_TOP, PAGE_WIDTH } from '../canvas/types'
import { useCanvasStore } from '../store/canvasStore'
import { useProjectStore } from '../store/projectStore'
import { toast, toastError } from '../store/toastStore'
import { INSERT_FONT_SIZE, pagesFor, paginate, placeBelow } from './insert'
import { markdownToPlain } from './markdown'

function currentPage() {
  const store = useProjectStore.getState()
  return store.pages.find((p) => p.id === store.currentPageId) ?? null
}

function pageById(pageId: string) {
  return useProjectStore.getState().pages.find((p) => p.id === pageId) ?? null
}

/** What a refine proposal was made from, captured when the request was sent. */
export interface ReplaceTarget {
  pageId: string
  selectionIds: string[]
}

export async function addBelowOnCurrentPage(markdown: string, title: string, pageId?: string): Promise<void> {
  const page = pageId ? pageById(pageId) : currentPage()
  if (!page) return
  const text = markdownToPlain(markdown)
  const { currentPage: next, overflow } = placeBelow(page.elements, text, measureWithCanvas)
  try {
    if (next) useProjectStore.getState().commit(page.id, next)
    if (overflow.length) await useProjectStore.getState().insertPages(pagesFor(overflow, title), page.id)
    toast(next ? `Added below your notes on p.${page.number}` : `Page was full, so it went on a new page`, { tone: 'success' })
  } catch (error) {
    toastError(errorMessage(error))
  }
}

export async function addAsNewPages(markdown: string, title: string, afterPageId?: string): Promise<void> {
  const page = afterPageId ? pageById(afterPageId) : currentPage()
  const chunks = paginate(markdownToPlain(markdown), PAGE_MARGIN_TOP, measureWithCanvas)
  try {
    const created = await useProjectStore.getState().insertPages(pagesFor(chunks, title), page?.id ?? null)
    toast(`Inserted ${created.length === 1 ? 'a new page' : `${created.length} new pages`}`, { tone: 'success' })
  } catch (error) {
    toastError(errorMessage(error))
  }
}

/**
 * Accept & replace (doc §12.3). Selection: the selected elements are swapped for one text
 * block in the same place (a single selected text box keeps its position and style).
 * Page: the page's content is replaced; anything that doesn't fit spills onto new pages.
 */
export async function replaceWithText(markdown: string, scope: 'selection' | 'page', target: ReplaceTarget): Promise<void> {
  const page = pageById(target.pageId)
  const text = markdownToPlain(markdown)
  if (!page) {
    toastError('That page no longer exists.')
    return
  }
  if (!text.trim()) {
    toastError('The proposal is empty, so nothing was replaced.')
    return
  }
  const store = useProjectStore.getState()

  if (scope === 'selection') {
    const ids = new Set(target.selectionIds)
    const selected = page.elements.filter((el) => ids.has(el.id))
    const box = selectionBounds(page.elements, ids)
    if (selected.length !== ids.size || !box) {
      toastError('The selected content changed since the proposal was made. Select it again and refine.')
      return
    }
    let next: CanvasElement[]
    if (selected.length === 1 && selected[0].type === 'text') {
      next = upsertElement(page.elements, { ...(selected[0] as TextElement), text })
    } else {
      const width = Math.min(Math.max(box.width, 520), PAGE_WIDTH - box.x - 60)
      const block: TextElement = { ...makeTextBlock(text, box.y, INSERT_FONT_SIZE), x: box.x, width }
      next = [...removeElements(page.elements, ids), block]
    }
    store.commit(page.id, next)
    useCanvasStore.getState().clearSelection()
    toast('Replaced. Press Ctrl+Z to undo.', { tone: 'success', action: { label: 'Undo', run: () => useProjectStore.getState().undo() } })
    return
  }

  const [first, ...rest] = paginate(text, PAGE_MARGIN_TOP, measureWithCanvas)
  store.commit(page.id, first ? [makeTextBlock(first, PAGE_MARGIN_TOP, INSERT_FONT_SIZE)] : [])
  if (rest.length) await store.insertPages(pagesFor(rest, `${page.title} (cont.)`), page.id)
  store.setCurrentPage(page.id)
  toast('Page replaced. Press Ctrl+Z to undo.', { tone: 'success', action: { label: 'Undo', run: () => useProjectStore.getState().undo() } })
}

export async function copyText(markdown: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(markdownToPlain(markdown))
    toast('Copied', { tone: 'success' })
  } catch {
    toastError('Clipboard is not available here')
  }
}
