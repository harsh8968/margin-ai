/**
 * Tool logic as pure functions over the element list. The React canvas component feeds
 * pointer events in; these return a NEW element array (never mutate), which is what
 * makes undo/redo a matter of keeping old arrays around.
 */
import { nanoid } from 'nanoid'

import { resample, roundPoints } from './geometry'
import type { XY } from './geometry'
import { elementBounds, idsTouchedByPath } from './hitTest'
import type { CanvasElement, EraseElement, Point, StrokeElement, TextElement } from './types'
import { PAGE_MARGIN_X, PAGE_WIDTH } from './types'

export const newId = (): string => nanoid(12)

export interface InkSettings {
  color: string
  size: number
  opacity: number
}

export function startStroke(tool: 'pen' | 'highlighter', point: Point, ink: InkSettings): StrokeElement {
  return { id: newId(), type: 'stroke', tool, points: [point], color: ink.color, size: ink.size, opacity: ink.opacity }
}

export function startErase(point: Point, size: number): EraseElement {
  return { id: newId(), type: 'erase', points: [point], size }
}

/** Even out spacing and trim precision before the stroke is committed and saved. */
export const MAX_POINTS = 8000 // the server accepts 20k; stay well under it

export function finishPath<T extends StrokeElement | EraseElement>(el: T): T {
  const pts = el.points.length === 1 ? [el.points[0], [el.points[0][0] + 0.5, el.points[0][1] + 0.5, el.points[0][2]] as Point] : el.points
  let points = resample(pts, 2.5)
  if (points.length > MAX_POINTS) {
    // A very long scribble: keep every k-th point (plus the last) so it still saves.
    const step = Math.ceil(points.length / MAX_POINTS)
    points = [...points.filter((_, i) => i % step === 0), points[points.length - 1]]
  }
  return { ...el, points: roundPoints(points) }
}

export function eraseTouched(elements: CanvasElement[], path: readonly XY[], radius: number): CanvasElement[] {
  const hit = idsTouchedByPath(elements, path, radius)
  return hit.size === 0 ? elements : elements.filter((el) => !hit.has(el.id))
}

export function translateElements(elements: CanvasElement[], ids: ReadonlySet<string>, dx: number, dy: number): CanvasElement[] {
  if (dx === 0 && dy === 0) return elements
  return elements.map((el) => {
    if (!ids.has(el.id)) return el
    if (el.type === 'text' || el.type === 'image') return { ...el, x: el.x + dx, y: el.y + dy }
    return { ...el, points: el.points.map(([x, y, p]) => [x + dx, y + dy, p] as Point) }
  })
}

export function recolorElements(elements: CanvasElement[], ids: ReadonlySet<string>, color: string): CanvasElement[] {
  return elements.map((el) => (ids.has(el.id) && (el.type === 'stroke' || el.type === 'text') ? { ...el, color } : el))
}

export function removeElements(elements: CanvasElement[], ids: ReadonlySet<string>): CanvasElement[] {
  return elements.filter((el) => !ids.has(el.id))
}

export function upsertElement(elements: CanvasElement[], next: CanvasElement): CanvasElement[] {
  const index = elements.findIndex((el) => el.id === next.id)
  if (index === -1) return [...elements, next]
  return elements.map((el, i) => (i === index ? next : el))
}

export function newTextElement(x: number, y: number, fontSize: number, color: string): TextElement {
  const width = Math.max(240, Math.min(820, PAGE_WIDTH - x - 70))
  return { id: newId(), type: 'text', x, y, width, text: '', font_size: fontSize, color }
}

/** Lowest point used on the page, so AI text can be inserted below existing notes. */
export function contentBottom(elements: CanvasElement[]): number {
  let bottom = 0
  for (const el of elements) {
    if (el.type === 'erase') continue
    const box = elementBounds(el)
    bottom = Math.max(bottom, box.y + box.height)
  }
  return bottom
}

export function makeTextBlock(text: string, y: number, fontSize = 26, color = '#1f2a44'): TextElement {
  return { id: newId(), type: 'text', x: PAGE_MARGIN_X, y, width: PAGE_WIDTH - PAGE_MARGIN_X * 2, text, font_size: fontSize, color }
}
