/**
 * The page is a list of vector elements, never a bitmap (PS6 doc §9.1).
 * Every save, undo, export and AI selection works by replaying this list.
 * Field names match the backend's pydantic models exactly.
 */

/** A4 at 150 DPI. All element coordinates live in this fixed logical space. */
export const PAGE_WIDTH = 1240
export const PAGE_HEIGHT = 1754
export const PAGE_MARGIN_X = 130
export const PAGE_MARGIN_TOP = 140

/** [x, y, pressure] in page units. Pressure is 0..1 (0.5 for mouse). */
export type Point = [number, number, number]

export interface StrokeElement {
  id: string
  type: 'stroke'
  tool: 'pen' | 'highlighter'
  points: Point[]
  color: string
  size: number
  opacity: number
}

/** Precise eraser: replayed with `destination-out`, so it only removes ink, never the paper. */
export interface EraseElement {
  id: string
  type: 'erase'
  points: Point[]
  size: number
}

export interface TextElement {
  id: string
  type: 'text'
  x: number
  y: number
  width: number
  text: string
  font_size: number
  color: string
}

/**
 * An imported PDF page or photo. It is part of the *paper*: drawn under the ink, never
 * erased or moved by accident. `text` is the PDF's text layer (empty for photos/scans).
 */
export interface ImageElement {
  id: string
  type: 'image'
  x: number
  y: number
  width: number
  height: number
  src: string
  text: string
  name: string
  /** Pictures, scans or drawings on this page carry content its text layer lacks. */
  needs_vision?: boolean
}

export type CanvasElement = StrokeElement | EraseElement | TextElement | ImageElement

/** Does reading this page need the vision model? (ink, or an image whose text layer is missing or incomplete) */
export function needsVision(elements: CanvasElement[]): boolean {
  return elements.some((el) => el.type === 'stroke' || (el.type === 'image' && (el.needs_vision || !el.text.trim())))
}

export type Background = 'ruled' | 'grid' | 'dots' | 'blank'

export type Tool = 'pen' | 'highlighter' | 'eraser' | 'text' | 'select'

export type EraserMode = 'precise' | 'stroke'

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export const TEXT_FONT_FAMILY = '"Atkinson Hyperlegible Next", "Segoe UI", system-ui, sans-serif'
export const TEXT_LINE_HEIGHT = 1.4
