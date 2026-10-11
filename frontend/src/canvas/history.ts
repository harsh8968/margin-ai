import type { CanvasElement } from './types'

/**
 * Undo/redo by snapshots. Elements are immutable, so a snapshot is just the old array
 * reference: unchanged elements are shared, which keeps this cheap.
 */
export interface History {
  past: CanvasElement[][]
  future: CanvasElement[][]
}

export const MAX_HISTORY = 100

export const emptyHistory = (): History => ({ past: [], future: [] })

export function record(history: History, previous: CanvasElement[]): History {
  const past = [...history.past, previous]
  return { past: past.length > MAX_HISTORY ? past.slice(past.length - MAX_HISTORY) : past, future: [] }
}

export function undo(history: History, current: CanvasElement[]): { history: History; elements: CanvasElement[] } | null {
  if (history.past.length === 0) return null
  const elements = history.past[history.past.length - 1]
  return { elements, history: { past: history.past.slice(0, -1), future: [current, ...history.future] } }
}

export function redo(history: History, current: CanvasElement[]): { history: History; elements: CanvasElement[] } | null {
  if (history.future.length === 0) return null
  const [elements, ...future] = history.future
  return { elements, history: { past: [...history.past, current], future } }
}
