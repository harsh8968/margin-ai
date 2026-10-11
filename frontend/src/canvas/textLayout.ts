import type { Box, TextElement } from './types'
import { TEXT_FONT_FAMILY, TEXT_LINE_HEIGHT } from './types'

/** Returns the rendered width of `text` at `fontSize`. Injectable so layout is unit-testable. */
export type Measure = (text: string, fontSize: number) => number

export interface TextLayout {
  lines: string[]
  lineHeight: number
  height: number
}

export function fontFor(fontSize: number): string {
  return `${fontSize}px ${TEXT_FONT_FAMILY}`
}

/** Word-wrap text into lines no wider than maxWidth. Respects explicit newlines. */
export function layoutText(text: string, fontSize: number, maxWidth: number, measure: Measure): TextLayout {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    if (paragraph.trim() === '') {
      lines.push('')
      continue
    }
    let line = ''
    for (const word of paragraph.split(/(\s+)/).filter((w) => w.length > 0)) {
      const candidate = line + word
      if (line && measure(candidate.trimEnd(), fontSize) > maxWidth) {
        lines.push(line.trimEnd())
        line = word.trimStart()
      } else {
        line = candidate
      }
      // A single word wider than the box gets broken by characters.
      while (measure(line, fontSize) > maxWidth && line.length > 1) {
        let cut = line.length - 1
        while (cut > 1 && measure(line.slice(0, cut), fontSize) > maxWidth) cut--
        lines.push(line.slice(0, cut))
        line = line.slice(cut)
      }
    }
    lines.push(line.trimEnd())
  }
  const lineHeight = fontSize * TEXT_LINE_HEIGHT
  return { lines, lineHeight, height: Math.max(1, lines.length) * lineHeight }
}

// --------------------------------------------------------------------------- canvas-backed measuring

let measureCtx: CanvasRenderingContext2D | null = null
const widthCache = new Map<string, number>()
let layoutVersion = 0
const layoutCache = new WeakMap<TextElement, { version: number; layout: TextLayout }>()

export const measureWithCanvas: Measure = (text, fontSize) => {
  const key = `${fontSize}|${text}`
  const cached = widthCache.get(key)
  if (cached !== undefined) return cached
  if (!measureCtx && typeof document !== 'undefined') measureCtx = document.createElement('canvas').getContext('2d')
  if (!measureCtx) return text.length * fontSize * 0.55 // no canvas (tests): a decent average glyph width
  measureCtx.font = fontFor(fontSize)
  const width = measureCtx.measureText(text).width
  if (widthCache.size > 5000) widthCache.clear()
  widthCache.set(key, width)
  return width
}

/** Call after web fonts finish loading: widths measured with the fallback font are wrong. */
export function invalidateTextLayouts(): void {
  widthCache.clear()
  layoutVersion++
}

export function textLayoutOf(el: TextElement): TextLayout {
  const cached = layoutCache.get(el)
  if (cached && cached.version === layoutVersion) return cached.layout
  const layout = layoutText(el.text, el.font_size, el.width, measureWithCanvas)
  layoutCache.set(el, { version: layoutVersion, layout })
  return layout
}

export function textBox(el: TextElement): Box {
  return { x: el.x, y: el.y, width: el.width, height: textLayoutOf(el).height }
}
