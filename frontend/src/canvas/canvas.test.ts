import { describe, expect, it } from 'vitest'

import { eraseTouched, finishPath, recolorElements, removeElements, startStroke, translateElements, upsertElement } from './engine'
import { distanceToSegment, pointInPolygon, resample, segmentsIntersect } from './geometry'
import { elementAt, elementBounds, idsInLasso, idsTouchedByPath, selectionBounds } from './hitTest'
import { emptyHistory, MAX_HISTORY, record, redo, undo } from './history'
import { layoutText } from './textLayout'
import type { CanvasElement, Point, StrokeElement, TextElement } from './types'

const measure = (text: string, size: number) => text.length * size * 0.5
const boxOfText = (el: TextElement) => ({ x: el.x, y: el.y, width: el.width, height: layoutText(el.text, el.font_size, el.width, measure).height })

const line = (id: string, x0: number, y0: number, x1: number, y1: number, size = 4): StrokeElement => ({
  id,
  type: 'stroke',
  tool: 'pen',
  points: resample([[x0, y0, 0.5], [x1, y1, 0.5]], 2.5),
  color: '#000',
  size,
  opacity: 1,
})

const text = (id: string, x: number, y: number, value = 'hello'): TextElement => ({
  id, type: 'text', x, y, width: 300, text: value, font_size: 20, color: '#000',
})

describe('geometry', () => {
  it('measures distance to a segment, clamping to its ends', () => {
    expect(distanceToSegment([5, 5], [0, 0], [10, 0])).toBe(5)
    expect(distanceToSegment([-3, 4], [0, 0], [10, 0])).toBe(5)
  })

  it('detects crossing segments', () => {
    expect(segmentsIntersect([0, 0], [10, 10], [0, 10], [10, 0])).toBe(true)
    expect(segmentsIntersect([0, 0], [10, 0], [0, 5], [10, 5])).toBe(false)
  })

  it('tests points against a polygon', () => {
    const square = [[0, 0], [10, 0], [10, 10], [0, 10]] as const
    expect(pointInPolygon([5, 5], square)).toBe(true)
    expect(pointInPolygon([15, 5], square)).toBe(false)
  })

  it('resamples so no gap exceeds the limit and keeps pressure interpolated', () => {
    const out = resample([[0, 0, 0], [10, 0, 1]], 2.5)
    for (let i = 1; i < out.length; i++) expect(out[i][0] - out[i - 1][0]).toBeLessThanOrEqual(2.5)
    expect(out[0]).toEqual([0, 0, 0])
    expect(out.at(-1)).toEqual([10, 0, 1])
    expect(out[2][2]).toBeCloseTo(out[2][0] / 10)
  })
})

describe('hit testing', () => {
  const elements: CanvasElement[] = [line('a', 0, 0, 100, 0), line('b', 0, 50, 100, 50), text('t', 200, 200)]

  it('finds the topmost element under a point', () => {
    expect(elementAt(elements, [50, 1], 3, boxOfText)?.id).toBe('a')
    expect(elementAt(elements, [210, 205], 3, boxOfText)?.id).toBe('t')
    expect(elementAt(elements, [50, 25], 3, boxOfText)).toBeNull()
  })

  it('stroke eraser catches a fast swipe that crosses between sample points', () => {
    const swipe = [[50, -30], [50, 30]] as const
    expect([...idsTouchedByPath(elements, swipe, 2, boxOfText)]).toEqual(['a'])
  })

  it('stroke eraser removes text it touches but leaves other strokes', () => {
    const next = eraseTouched(elements, [[205, 210]], 5)
    expect(next.map((e) => e.id)).toEqual(['a', 'b'])
    expect(eraseTouched(elements, [[500, 500]], 5)).toBe(elements) // nothing hit: same array, no history entry
  })

  it('lasso selects strokes that are mostly inside and text by its centre', () => {
    const lasso = [[-10, -10], [120, -10], [120, 20], [-10, 20]] as const
    expect(idsInLasso(elements, lasso, boxOfText)).toEqual(['a'])
    const all = [[-10, -10], [600, -10], [600, 400], [-10, 400]] as const
    expect(idsInLasso(elements, all, boxOfText)).toEqual(['a', 'b', 't'])
  })

  it('computes selection bounds including stroke width', () => {
    const box = selectionBounds(elements, new Set(['a', 'b']), boxOfText)
    expect(box).toEqual({ x: -2, y: -2, width: 104, height: 54 })
    expect(elementBounds(elements[0]).height).toBe(4)
  })
})

describe('engine', () => {
  it('finishes a single tap as a dot instead of an empty stroke', () => {
    const stroke = finishPath(startStroke('pen', [10, 10, 0.5] as Point, { color: '#000', size: 4, opacity: 1 }))
    expect(stroke.points.length).toBeGreaterThanOrEqual(2)
  })

  it('never mutates the input when translating, recolouring or removing', () => {
    const elements: CanvasElement[] = [line('a', 0, 0, 10, 0), text('t', 5, 5)]
    const frozen = JSON.stringify(elements)
    const moved = translateElements(elements, new Set(['a', 't']), 10, 20)
    expect((moved[1] as TextElement).x).toBe(15)
    expect((moved[0] as StrokeElement).points[0]).toEqual([10, 20, 0.5])
    expect((recolorElements(elements, new Set(['t']), '#f00')[1] as TextElement).color).toBe('#f00')
    expect(removeElements(elements, new Set(['a'])).map((e) => e.id)).toEqual(['t'])
    expect(JSON.stringify(elements)).toBe(frozen)
  })

  it('upserts by id', () => {
    const elements: CanvasElement[] = [text('t', 0, 0, 'old')]
    expect((upsertElement(elements, text('t', 0, 0, 'new'))[0] as TextElement).text).toBe('new')
    expect(upsertElement(elements, text('u', 0, 0)).length).toBe(2)
  })
})

describe('history', () => {
  it('undoes and redoes snapshots', () => {
    const v1: CanvasElement[] = []
    const v2: CanvasElement[] = [text('t', 0, 0)]
    const h = record(emptyHistory(), v1)
    const back = undo(h, v2)!
    expect(back.elements).toBe(v1)
    const forward = redo(back.history, back.elements)!
    expect(forward.elements).toBe(v2)
    expect(undo(emptyHistory(), v1)).toBeNull()
  })

  it('a new edit clears the redo stack and the stack is capped', () => {
    let h = emptyHistory()
    for (let i = 0; i < MAX_HISTORY + 5; i++) h = record(h, [])
    expect(h.past.length).toBe(MAX_HISTORY)
    const back = undo(h, [])!
    expect(record(back.history, []).future).toEqual([])
  })
})

describe('text layout', () => {
  it('wraps words, keeps blank lines, and breaks very long words', () => {
    const layout = layoutText('aaaa bbbb cccc\n\nzzzzzzzzzzzzzzzzzzzz', 10, 40, measure)
    expect(layout.lines).toEqual(['aaaa', 'bbbb', 'cccc', '', 'zzzzzzzz', 'zzzzzzzz', 'zzzz'])
    expect(layout.height).toBeCloseTo(7 * 14)
  })
})
