/**
 * How should the AI read an imported PDF page: from its text layer, with the vision model, or both?
 *
 * A text layer is exact for typed pages, but it can't be trusted blindly:
 * - Phone scanner apps (Adobe Scan, CamScanner, Lens…) lay an invisible OCR layer over the photo.
 *   On handwriting that OCR is gibberish, and it would stand in for what the student wrote.
 * - Typed handouts often carry tables, diagrams or screenshots as pictures the text layer lacks.
 * - Some exam papers use fonts with no Unicode map, so their "text" extracts as symbols.
 * So we look at what the page actually draws (pdf.js operator list) and what its text reads like.
 */

/** The pdf.js `OPS` codes we inspect (passed in so this stays free of pdf.js and testable). */
export type PdfOps = Record<
  | 'save' | 'restore' | 'transform' | 'paintFormXObjectBegin' | 'paintFormXObjectEnd'
  | 'setTextRenderingMode' | 'showText' | 'showSpacedText' | 'nextLineShowText' | 'nextLineSetSpacingShowText'
  | 'constructPath' | 'paintImageXObject' | 'paintInlineImageXObject' | 'paintImageMaskXObject',
  number
>

export interface OperatorList {
  fnArray: number[]
  argsArray: unknown[][]
}

export interface PdfPageSignals {
  /** Share of the page (0–1) covered by raster images. */
  imageCoverage: number
  /** Text-drawing operations in an invisible render mode (an OCR layer) and in a visible one. */
  invisibleText: number
  visibleText: number
  /** Vector paths drawn; ink exported from a tablet note app shows up as hundreds of these. */
  paths: number
}

export interface TextLayerPlan {
  /** Give the AI the text layer as exact text. */
  keepText: boolean
  /** Also send the rendered page to the vision model. */
  needsVision: boolean
}

const PICTURE_COVERAGE = 0.15 // diagrams/tables pasted as images; a header logo stays well below
const DRAWING_PATHS = 400 // typed handouts with tables draw ~150 paths a page; handwriting far more
const INVISIBLE_MODES = new Set([3, 7]) // PDF text render modes that paint nothing

const FILLER = /[\s._\-–—…·]+/g // spaces and answer lines like ". . . ." or "____"
const WORD = /[\p{L}\p{M}]{2,}/gu // letters with their combining marks (Devanagari matras etc.)
const MIN_JUDGED_CHARS = 20
const MIN_WORD_SHARE = 0.1 // measured: real pages ≥ 0.24 (maths-heavy), unmapped fonts ≤ 0.03

type Matrix = [number, number, number, number, number, number]
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

/** m ∘ n: apply n, then m (PDF affine matrices [a b c d e f]). */
function compose(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ]
}

const isMatrix = (value: unknown): value is Matrix => Array.isArray(value) && value.length === 6 && value.every((v) => typeof v === 'number')

/** Area of the unit square (where PDF images are painted) under `m`, clipped to the page. */
function paintedArea(m: Matrix, [x0, y0, x1, y1]: number[]): number {
  const xs = [m[4], m[0] + m[4], m[2] + m[4], m[0] + m[2] + m[4]]
  const ys = [m[5], m[1] + m[5], m[3] + m[5], m[1] + m[3] + m[5]]
  const width = Math.min(Math.max(...xs), x1) - Math.max(Math.min(...xs), x0)
  const height = Math.min(Math.max(...ys), y1) - Math.max(Math.min(...ys), y0)
  return width > 0 && height > 0 ? width * height : 0
}

export function pageSignals(list: OperatorList, view: number[], OPS: PdfOps): PdfPageSignals {
  const imageOps = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject])
  const textOps = new Set([OPS.showText, OPS.showSpacedText, OPS.nextLineShowText, OPS.nextLineSetSpacingShowText])
  const pageArea = Math.max(1, (view[2] - view[0]) * (view[3] - view[1]))
  const stack: { ctm: Matrix; mode: number }[] = []
  let state = { ctm: IDENTITY, mode: 0 }
  let imageArea = 0
  const signals = { imageCoverage: 0, invisibleText: 0, visibleText: 0, paths: 0 }

  list.fnArray.forEach((fn, i) => {
    const args = list.argsArray[i] ?? []
    if (fn === OPS.save) stack.push(state)
    else if (fn === OPS.restore || fn === OPS.paintFormXObjectEnd) state = stack.pop() ?? state
    else if (fn === OPS.transform && isMatrix(args)) state = { ...state, ctm: compose(state.ctm, args) }
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(state)
      if (isMatrix(args[0])) state = { ...state, ctm: compose(state.ctm, args[0]) }
    } else if (fn === OPS.setTextRenderingMode && typeof args[0] === 'number') state = { ...state, mode: args[0] }
    else if (textOps.has(fn)) {
      if (INVISIBLE_MODES.has(state.mode)) signals.invisibleText++
      else signals.visibleText++
    } else if (imageOps.has(fn)) imageArea += paintedArea(state.ctm, view)
    else if (fn === OPS.constructPath) signals.paths++
  })
  return { ...signals, imageCoverage: Math.min(1, imageArea / pageArea) }
}

/**
 * Fonts without a Unicode map extract as symbol soup (`! " # $ % & '`), and the AI would be
 * told it's exact. Real text, even maths-heavy, is mostly words; the soup has almost none.
 */
export function isReadable(text: string): boolean {
  const judged = text.replace(FILLER, '').length
  if (judged < MIN_JUDGED_CHARS) return true
  const inWords = (text.match(WORD) ?? []).reduce((sum, word) => sum + word.length, 0)
  return inWords / judged >= MIN_WORD_SHARE
}

export function planTextLayer(s: PdfPageSignals, text: string): TextLayerPlan {
  // Mostly invisible text = OCR over a scan or photo. Its guesses would be passed off as exact.
  const ocrLayer = s.invisibleText > s.visibleText
  if (ocrLayer || !text.trim() || !isReadable(text)) return { keepText: false, needsVision: true }
  return { keepText: true, needsVision: s.imageCoverage >= PICTURE_COVERAGE || s.paths >= DRAWING_PATHS }
}
