import { boundsOfPoints, boxesOverlap, distanceToBox, distanceToSegment, pointInPolygon, segmentDistance, unionBoxes } from './geometry'
import type { XY } from './geometry'
import { textBox } from './textLayout'
import type { Box, CanvasElement, StrokeElement, TextElement } from './types'

type BoxOf = (el: TextElement) => Box

const boundsCache = new WeakMap<CanvasElement, Box>()

/** Bounding box of any element, in page units. Text needs a measurer (defaults to canvas). */
export function elementBounds(el: CanvasElement, boxOfText: BoxOf = textBox): Box {
  if (el.type === 'text') return boxOfText(el)
  if (el.type === 'image') return { x: el.x, y: el.y, width: el.width, height: el.height }
  const cached = boundsCache.get(el)
  if (cached) return cached
  const box = boundsOfPoints(el.points, el.size / 2)
  boundsCache.set(el, box)
  return box
}

export function selectionBounds(elements: CanvasElement[], ids: ReadonlySet<string>, boxOfText: BoxOf = textBox): Box | null {
  return unionBoxes(
    elements.filter((el) => ids.has(el.id) && el.type !== 'erase' && el.type !== 'image').map((el) => elementBounds(el, boxOfText)),
  )
}

function strokeNear(stroke: StrokeElement, p: XY, radius: number): boolean {
  const reach = radius + stroke.size / 2
  const pts = stroke.points
  if (pts.length === 1) return Math.hypot(pts[0][0] - p[0], pts[0][1] - p[1]) <= reach
  for (let i = 1; i < pts.length; i++) {
    if (distanceToSegment(p, pts[i - 1], pts[i]) <= reach) return true
  }
  return false
}

/** Topmost visible element under the point (strokes and text; erasers are invisible). */
export function elementAt(elements: CanvasElement[], p: XY, tolerance: number, boxOfText: BoxOf = textBox): CanvasElement | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i]
    if (el.type === 'text') {
      if (distanceToBox(p, boxOfText(el)) <= tolerance) return el
    } else if (el.type === 'stroke') {
      const box = elementBounds(el)
      if (distanceToBox(p, box) <= tolerance && strokeNear(el, p, tolerance)) return el
    }
  }
  return null
}

/**
 * Stroke eraser: ids of strokes/text touched by the eraser's path.
 * Checking segment-to-segment distance means even a fast swipe can't skip over a thin line.
 */
export function idsTouchedByPath(elements: CanvasElement[], path: readonly XY[], radius: number, boxOfText: BoxOf = textBox): Set<string> {
  const hit = new Set<string>()
  if (path.length === 0) return hit
  const pathBox = boundsOfPoints(path, radius)
  const segments: [XY, XY][] = path.length === 1 ? [[path[0], path[0]]] : path.slice(1).map((p, i) => [path[i], p])
  for (const el of elements) {
    if (el.type === 'erase' || el.type === 'image') continue // imported pages are paper, not ink
    const box = elementBounds(el, boxOfText)
    if (!boxesOverlap(box, pathBox)) continue
    if (el.type === 'text') {
      if (path.some((p) => distanceToBox(p, box) <= radius)) hit.add(el.id)
      continue
    }
    const reach = radius + el.size / 2
    const pts = el.points
    const strokeSegments: [XY, XY][] = pts.length === 1 ? [[pts[0], pts[0]]] : pts.slice(1).map((p, i) => [pts[i], p])
    outer: for (const [a1, a2] of segments) {
      for (const [b1, b2] of strokeSegments) {
        if (segmentDistance(a1, a2, b1, b2) <= reach) {
          hit.add(el.id)
          break outer
        }
      }
    }
  }
  return hit
}

/** Lasso: a stroke is selected when most of it is inside; text when its centre is inside. */
export function idsInLasso(elements: CanvasElement[], polygon: readonly XY[], boxOfText: BoxOf = textBox): string[] {
  if (polygon.length < 3) return []
  const lassoBox = boundsOfPoints(polygon)
  const ids: string[] = []
  for (const el of elements) {
    if (el.type === 'erase' || el.type === 'image') continue // invisible eraser / locked paper
    const box = elementBounds(el, boxOfText)
    if (!boxesOverlap(box, lassoBox)) continue
    if (el.type === 'text') {
      if (pointInPolygon([box.x + box.width / 2, box.y + box.height / 2], polygon)) ids.push(el.id)
      continue
    }
    const sample = el.points.length > 60 ? el.points.filter((_, i) => i % Math.ceil(el.points.length / 60) === 0) : el.points
    const inside = sample.filter((p) => pointInPolygon(p, polygon)).length
    if (inside / sample.length >= 0.6) ids.push(el.id)
  }
  return ids
}

/** Eraser passes lying wholly inside `box`: they travel with the ink they erased when it moves. */
export function erasersWithin(elements: CanvasElement[], box: Box): string[] {
  return elements
    .filter((el) => el.type === 'erase')
    .filter((el) => {
      const b = elementBounds(el)
      return b.x >= box.x && b.y >= box.y && b.x + b.width <= box.x + box.width && b.y + b.height <= box.y + box.height
    })
    .map((el) => el.id)
}
