import type { Box, Point } from './types'

/** Any point-like tuple: [x, y] or [x, y, pressure]. */
export type XY = readonly [number, number, ...number[]]

export function distance(a: XY, b: XY): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

/** Shortest distance from point p to the segment a-b. */
export function distanceToSegment(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) return distance(p, a)
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

/** Shortest distance between two segments (0 if they cross). */
export function segmentDistance(a1: XY, a2: XY, b1: XY, b2: XY): number {
  if (segmentsIntersect(a1, a2, b1, b2)) return 0
  return Math.min(
    distanceToSegment(a1, b1, b2),
    distanceToSegment(a2, b1, b2),
    distanceToSegment(b1, a1, a2),
    distanceToSegment(b2, a1, a2),
  )
}

function orientation(a: XY, b: XY, c: XY): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

export function segmentsIntersect(a1: XY, a2: XY, b1: XY, b2: XY): boolean {
  const d1 = orientation(b1, b2, a1)
  const d2 = orientation(b1, b2, a2)
  const d3 = orientation(a1, a2, b1)
  const d4 = orientation(a1, a2, b2)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

/** Even-odd ray casting: is p inside the polygon? */
export function pointInPolygon(p: XY, polygon: readonly XY[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    const crosses = yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi
    if (crosses) inside = !inside
  }
  return inside
}

export function boundsOfPoints(points: readonly XY[], pad = 0): Box {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of points) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 }
  return { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 }
}

export function unionBoxes(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null
  const minX = Math.min(...boxes.map((b) => b.x))
  const minY = Math.min(...boxes.map((b) => b.y))
  const maxX = Math.max(...boxes.map((b) => b.x + b.width))
  const maxY = Math.max(...boxes.map((b) => b.y + b.height))
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export function boxContains(box: Box, p: XY): boolean {
  return p[0] >= box.x && p[0] <= box.x + box.width && p[1] >= box.y && p[1] <= box.y + box.height
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y
}

/** Distance from a point to the nearest edge of a box (0 if inside). */
export function distanceToBox(p: XY, box: Box): number {
  const dx = Math.max(box.x - p[0], 0, p[0] - (box.x + box.width))
  const dy = Math.max(box.y - p[1], 0, p[1] - (box.y + box.height))
  return Math.hypot(dx, dy)
}

/**
 * Insert points so no gap exceeds `maxGap`. Fast pen movements produce sparse samples;
 * evening them out keeps hit-testing and the precise eraser reliable.
 */
export function resample(points: Point[], maxGap: number): Point[] {
  if (points.length < 2) return points.slice()
  const out: Point[] = [points[0]]
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]
    const curr = points[i]
    const gap = distance(prev, curr)
    const steps = Math.floor(gap / maxGap)
    for (let s = 1; s <= steps; s++) {
      const t = s / (steps + 1)
      out.push([prev[0] + (curr[0] - prev[0]) * t, prev[1] + (curr[1] - prev[1]) * t, prev[2] + (curr[2] - prev[2]) * t])
    }
    out.push(curr)
  }
  return out
}

/** Round coordinates to 0.1 units: halves the saved JSON with no visible difference. */
export function roundPoints(points: Point[]): Point[] {
  return points.map(([x, y, p]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(p * 100) / 100])
}
