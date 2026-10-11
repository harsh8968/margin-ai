/**
 * Placing AI-written text into the notebook without ever overwriting the student's work
 * (doc A9): text goes below the existing notes, or onto new pages when it doesn't fit.
 */
import { contentBottom, makeTextBlock } from '../canvas/engine'
import { layoutText } from '../canvas/textLayout'
import type { Measure } from '../canvas/textLayout'
import type { Background, CanvasElement, TextElement } from '../canvas/types'
import { PAGE_HEIGHT, PAGE_MARGIN_TOP, PAGE_MARGIN_X, PAGE_WIDTH } from '../canvas/types'

export const INSERT_FONT_SIZE = 26
const BOTTOM_LIMIT = PAGE_HEIGHT - 110
const GAP = 48

/** Split text into page-sized chunks. The first chunk starts at `firstTop`. */
export function paginate(text: string, firstTop: number, measure: Measure, fontSize = INSERT_FONT_SIZE): string[] {
  const width = PAGE_WIDTH - PAGE_MARGIN_X * 2
  const { lines, lineHeight } = layoutText(text, fontSize, width, measure)
  const chunks: string[][] = [[]]
  let y = firstTop
  for (const line of lines) {
    if (y + lineHeight > BOTTOM_LIMIT && chunks[chunks.length - 1].length > 0) {
      chunks.push([])
      y = PAGE_MARGIN_TOP
    }
    chunks[chunks.length - 1].push(line)
    y += lineHeight
  }
  return chunks.map((c) => c.join('\n').trim()).filter((c) => c.length > 0)
}

export interface Placement {
  /** Elements for the current page (existing + the first chunk), or null if nothing fits there. */
  currentPage: CanvasElement[] | null
  /** Text chunks that need new pages after the current one. */
  overflow: string[]
}

export function placeBelow(elements: CanvasElement[], text: string, measure: Measure): Placement {
  const top = Math.max(PAGE_MARGIN_TOP, contentBottom(elements) + GAP)
  const roomForAFewLines = top + INSERT_FONT_SIZE * 1.4 * 3 < BOTTOM_LIMIT
  if (!roomForAFewLines) return { currentPage: null, overflow: paginate(text, PAGE_MARGIN_TOP, measure) }
  const [first, ...rest] = paginate(text, top, measure)
  if (!first) return { currentPage: null, overflow: [] }
  return { currentPage: [...elements, makeTextBlock(first, top, INSERT_FONT_SIZE)], overflow: rest }
}

export function pagesFor(chunks: string[], title: string): { title: string; elements: TextElement[]; background: Background }[] {
  return chunks.map((chunk, i) => ({
    title: chunks.length > 1 ? `${title} (${i + 1})` : title,
    elements: [makeTextBlock(chunk, PAGE_MARGIN_TOP, INSERT_FONT_SIZE)],
    background: 'ruled' as const,
  }))
}
