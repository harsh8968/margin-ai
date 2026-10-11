/**
 * Canvas 2D rendering. One replay routine feeds the editor, thumbnails, PDF export and the
 * images we send to the vision model, so they can never disagree about what a page looks like.
 */
import { getStroke } from 'perfect-freehand'

import { textLayoutOf, fontFor } from './textLayout'
import type { Background, Box, CanvasElement, EraseElement, ImageElement, StrokeElement, TextElement } from './types'
import { PAGE_HEIGHT, PAGE_MARGIN_TOP, PAGE_WIDTH } from './types'

export const PAPER = '#fffdf8'
const RULE = 'rgba(70, 110, 170, 0.22)'
const MARGIN_RULE = 'rgba(200, 70, 60, 0.35)'
const GRID = 'rgba(70, 110, 170, 0.14)'

// --------------------------------------------------------------------------- paths

const average = (a: number, b: number) => (a + b) / 2

/** perfect-freehand returns an outline polygon; turn it into a smooth SVG path. */
function svgPathFromOutline(points: number[][]): string {
  const len = points.length
  if (len < 4) return ''
  let a = points[0]
  let b = points[1]
  const c = points[2]
  let d = `M${a[0].toFixed(2)},${a[1].toFixed(2)} Q${b[0].toFixed(2)},${b[1].toFixed(2)} ${average(b[0], c[0]).toFixed(2)},${average(b[1], c[1]).toFixed(2)} T`
  for (let i = 2; i < len - 1; i++) {
    a = points[i]
    b = points[i + 1]
    d += `${average(a[0], b[0]).toFixed(2)},${average(a[1], b[1]).toFixed(2)} `
  }
  return d + 'Z'
}

function hasRealPressure(el: StrokeElement | EraseElement): boolean {
  return el.points.some((p) => Math.abs(p[2] - 0.5) > 0.001)
}

export function outlineOptions(el: StrokeElement | EraseElement, last: boolean) {
  if (el.type === 'erase' || el.tool === 'highlighter') {
    return { size: el.size, thinning: 0, smoothing: 0.6, streamline: 0.5, simulatePressure: false, last }
  }
  return { size: el.size, thinning: 0.6, smoothing: 0.55, streamline: 0.45, simulatePressure: !hasRealPressure(el), last }
}

const pathCache = new WeakMap<StrokeElement | EraseElement, Path2D>()

export function pathFor(el: StrokeElement | EraseElement, live = false): Path2D {
  if (!live) {
    const cached = pathCache.get(el)
    if (cached) return cached
  }
  const outline = getStroke(el.points, outlineOptions(el, !live))
  const path = new Path2D(svgPathFromOutline(outline))
  if (!live) pathCache.set(el, path)
  return path
}

// --------------------------------------------------------------------------- drawing

export function drawBackground(ctx: CanvasRenderingContext2D, background: Background): void {
  ctx.save()
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT)
  ctx.lineWidth = 1.5
  if (background === 'ruled') {
    ctx.strokeStyle = RULE
    for (let y = PAGE_MARGIN_TOP + 52; y < PAGE_HEIGHT - 60; y += 52) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(PAGE_WIDTH, y)
      ctx.stroke()
    }
    ctx.strokeStyle = MARGIN_RULE
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(100, 0)
    ctx.lineTo(100, PAGE_HEIGHT)
    ctx.stroke()
  } else if (background === 'grid') {
    ctx.strokeStyle = GRID
    for (let x = 40; x < PAGE_WIDTH; x += 40) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, PAGE_HEIGHT)
      ctx.stroke()
    }
    for (let y = 40; y < PAGE_HEIGHT; y += 40) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(PAGE_WIDTH, y)
      ctx.stroke()
    }
  } else if (background === 'dots') {
    ctx.fillStyle = 'rgba(70, 90, 130, 0.35)'
    for (let x = 40; x < PAGE_WIDTH; x += 40) {
      for (let y = 40; y < PAGE_HEIGHT; y += 40) {
        ctx.beginPath()
        ctx.arc(x, y, 1.8, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
  ctx.restore()
}

export function drawText(ctx: CanvasRenderingContext2D, el: TextElement): void {
  const layout = textLayoutOf(el)
  ctx.save()
  ctx.font = fontFor(el.font_size)
  ctx.fillStyle = el.color
  ctx.textBaseline = 'top'
  const inset = (layout.lineHeight - el.font_size) / 2
  layout.lines.forEach((line, i) => ctx.fillText(line, el.x, el.y + i * layout.lineHeight + inset))
  ctx.restore()
}

// --------------------------------------------------------------------------- imported images

const imageCache = new Map<string, HTMLImageElement>()
const imageListeners = new Set<() => void>()

function imageFor(src: string): HTMLImageElement {
  let img = imageCache.get(src)
  if (!img) {
    img = new Image()
    img.decoding = 'async'
    img.onload = () => imageListeners.forEach((notify) => notify())
    img.src = src
    imageCache.set(src, img)
  }
  return img
}

const isReady = (img: HTMLImageElement) => img.complete && img.naturalWidth > 0

/** Subscribe to "an image finished loading" so on-screen layers can redraw. */
export function onImageLoaded(listener: () => void): () => void {
  imageListeners.add(listener)
  return () => imageListeners.delete(listener)
}

/** Offscreen renders (PDF, thumbnails, vision) must wait for imported images first. */
export async function ensureImagesLoaded(elements: CanvasElement[]): Promise<void> {
  const images = elements.filter((el): el is ImageElement => el.type === 'image')
  await Promise.all(
    images.map((el) => {
      const img = imageFor(el.src)
      return isReady(img) ? undefined : img.decode().catch(() => undefined)
    }),
  )
}

/** Imported pages are paper: drawn on the background layer, under all ink. */
export function drawImages(ctx: CanvasRenderingContext2D, elements: CanvasElement[]): void {
  for (const el of elements) {
    if (el.type !== 'image') continue
    const img = imageFor(el.src)
    if (isReady(img)) {
      ctx.drawImage(img, el.x, el.y, el.width, el.height)
    } else {
      ctx.save()
      ctx.fillStyle = 'rgba(31,42,68,0.05)'
      ctx.fillRect(el.x, el.y, el.width, el.height)
      ctx.restore()
    }
  }
}

export function drawElement(ctx: CanvasRenderingContext2D, el: CanvasElement, live = false): void {
  if (el.type === 'image') return // drawn with the paper, see drawImages
  if (el.type === 'text') {
    drawText(ctx, el)
    return
  }
  ctx.save()
  if (el.type === 'erase') {
    ctx.globalCompositeOperation = 'destination-out'
    ctx.fillStyle = '#000'
  } else {
    ctx.globalAlpha = el.opacity
    ctx.globalCompositeOperation = el.tool === 'highlighter' ? 'multiply' : 'source-over'
    ctx.fillStyle = el.color
  }
  ctx.fill(pathFor(el, live))
  ctx.restore()
}

export interface DrawOptions {
  hiddenIds?: ReadonlySet<string>
  /** Live preview offset while dragging a selection. */
  moving?: { ids: ReadonlySet<string>; dx: number; dy: number }
}

/** Replay the element list. Draw onto a transparent layer so erasers never cut the paper. */
export function drawElements(ctx: CanvasRenderingContext2D, elements: CanvasElement[], options: DrawOptions = {}): void {
  for (const el of elements) {
    if (options.hiddenIds?.has(el.id)) continue
    const moving = options.moving && options.moving.ids.has(el.id)
    if (moving) {
      ctx.save()
      ctx.translate(options.moving!.dx, options.moving!.dy)
      drawElement(ctx, el)
      ctx.restore()
    } else {
      drawElement(ctx, el)
    }
  }
}

// --------------------------------------------------------------------------- offscreen renders

function makeCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D is not available in this browser')
  return [canvas, ctx]
}

/** Paper + ink composited at `scale`. Used by PDF export, thumbnails and vision transcription. */
export function renderPage(elements: CanvasElement[], background: Background, scale: number): HTMLCanvasElement {
  const [base, baseCtx] = makeCanvas(PAGE_WIDTH * scale, PAGE_HEIGHT * scale)
  baseCtx.scale(scale, scale)
  drawBackground(baseCtx, background)
  drawImages(baseCtx, elements)
  const [ink, inkCtx] = makeCanvas(PAGE_WIDTH * scale, PAGE_HEIGHT * scale)
  inkCtx.scale(scale, scale)
  drawElements(inkCtx, elements)
  baseCtx.setTransform(1, 0, 0, 1, 0, 0)
  baseCtx.drawImage(ink, 0, 0)
  return base
}

export function pageToDataUrl(elements: CanvasElement[], background: Background, scale: number, quality = 0.85): string {
  return renderPage(elements, background, scale).toDataURL('image/jpeg', quality)
}

export function thumbnailOf(elements: CanvasElement[], background: Background): string {
  return pageToDataUrl(elements, background, 0.16, 0.72)
}

/** Crop of just the selected elements on plain paper: what "ask about selection" sends. */
export function renderRegion(elements: CanvasElement[], ids: ReadonlySet<string>, box: Box): string {
  const pad = 24
  const scale = Math.min(1.5, 1600 / Math.max(box.width + pad * 2, box.height + pad * 2))
  const [base, ctx] = makeCanvas((box.width + pad * 2) * scale, (box.height + pad * 2) * scale)
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, base.width, base.height)
  const [ink, inkCtx] = makeCanvas(base.width, base.height)
  inkCtx.scale(scale, scale)
  inkCtx.translate(pad - box.x, pad - box.y)
  drawElements(inkCtx, elements.filter((el) => ids.has(el.id) || el.type === 'erase'))
  ctx.drawImage(ink, 0, 0)
  return base.toDataURL('image/jpeg', 0.9)
}
