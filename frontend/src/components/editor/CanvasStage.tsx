/**
 * The notebook page: three stacked <canvas> layers (doc §9.2).
 *   1. background - paper + ruling, never erased
 *   2. ink        - every committed element, replayed from the element list
 *   3. live       - only what's being drawn right now (stroke, lasso, eraser cursor)
 * Pointer input is handled here; the tool logic itself lives in canvas/engine.ts.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

import type { Page } from '../../api/types'
import {
  eraseTouched,
  finishPath,
  newTextElement,
  removeElements,
  startErase,
  startStroke,
  translateElements,
  upsertElement,
} from '../../canvas/engine'
import type { XY } from '../../canvas/geometry'
import { boxContains } from '../../canvas/geometry'
import { elementAt, erasersWithin, idsInLasso, selectionBounds } from '../../canvas/hitTest'
import { drawBackground, drawElement, drawElements, drawImages, onImageLoaded } from '../../canvas/renderer'
import type { DrawOptions } from '../../canvas/renderer'
import type { CanvasElement, EraseElement, Point, StrokeElement, TextElement } from '../../canvas/types'
import { PAGE_HEIGHT, PAGE_WIDTH, TEXT_FONT_FAMILY, TEXT_LINE_HEIGHT } from '../../canvas/types'
import { useElementWidth, useFontsReady } from '../../lib/hooks'
import { useAiStore } from '../../store/aiStore'
import { useCanvasStore } from '../../store/canvasStore'
import { useProjectStore } from '../../store/projectStore'
import { SelectionBar } from './SelectionBar'

type Gesture =
  | { kind: 'draw'; el: StrokeElement }
  | { kind: 'erase'; el: EraseElement }
  | { kind: 'strokeErase'; path: XY[]; elements: CanvasElement[] }
  | { kind: 'move'; start: XY; ids: Set<string>; dx: number; dy: number }
  | { kind: 'lasso'; points: XY[] }

interface Draft {
  el: TextElement
  isNew: boolean
}

const MAX_PAGE_CSS_WIDTH = 880

export function CanvasStage({ page }: { page: Page }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const bgRef = useRef<HTMLCanvasElement>(null)
  const inkRef = useRef<HTMLCanvasElement>(null)
  const liveRef = useRef<HTMLCanvasElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const elementsRef = useRef(page.elements)
  elementsRef.current = page.elements

  const fontsReady = useFontsReady()
  const containerWidth = useElementWidth(wrapRef)
  const commit = useProjectStore((s) => s.commit)
  const reading = useAiStore((s) => s.reading.includes(page.id))
  const tool = useCanvasStore((s) => s.tool)
  const zoom = useCanvasStore((s) => s.zoom)
  const selection = useCanvasStore((s) => s.selection)
  const setSelection = useCanvasStore((s) => s.setSelection)
  const eraserMode = useCanvasStore((s) => s.eraserMode)
  const eraserSize = useCanvasStore((s) => s.eraserSize)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [moveOffset, setMoveOffset] = useState<[number, number]>([0, 0])

  const cssWidth = Math.max(320, Math.min(containerWidth - 64, MAX_PAGE_CSS_WIDTH) * zoom)
  const scale = cssWidth / PAGE_WIDTH
  const cssHeight = PAGE_HEIGHT * scale
  const dpr = Math.min(window.devicePixelRatio || 1, 2)

  const selectedIds = useMemo(() => new Set(selection), [selection])
  const selectionBox = useMemo(
    () => (selection.length && tool === 'select' ? selectionBounds(page.elements, selectedIds) : null),
    [page.elements, selectedIds, selection.length, tool, fontsReady], // eslint-disable-line react-hooks/exhaustive-deps
  )

  // ------------------------------------------------------------------ canvas setup & drawing

  const prepare = useCallback(
    (canvas: HTMLCanvasElement | null): CanvasRenderingContext2D | null => {
      if (!canvas) return null
      const w = Math.round(cssWidth * dpr)
      const h = Math.round(cssHeight * dpr)
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, w, h)
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0)
      return ctx
    },
    [cssWidth, cssHeight, dpr, scale],
  )

  const drawInk = useCallback(
    (elements: CanvasElement[], options: DrawOptions = {}) => {
      const ctx = prepare(inkRef.current)
      if (!ctx) return
      const hidden = new Set(options.hiddenIds ?? [])
      if (draft) hidden.add(draft.el.id)
      drawElements(ctx, elements, { ...options, hiddenIds: hidden })
    },
    [prepare, draft],
  )

  const clearLive = useCallback(() => prepare(liveRef.current), [prepare])

  // Imported page images live on the paper layer; redraw it when they change or finish loading.
  const [imagesLoaded, setImagesLoaded] = useState(0)
  useEffect(() => onImageLoaded(() => setImagesLoaded((n) => n + 1)), [])
  const paperImages = useMemo(() => page.elements.filter((el) => el.type === 'image'), [page.elements])
  const paperKey = paperImages.map((el) => (el.type === 'image' ? `${el.src}@${el.x},${el.y}` : '')).join('|')

  useLayoutEffect(() => {
    const ctx = prepare(bgRef.current)
    if (!ctx) return
    drawBackground(ctx, page.background)
    drawImages(ctx, paperImages)
  }, [prepare, page.background, paperKey, imagesLoaded]) // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (!gesture.current) drawInk(page.elements)
  }, [drawInk, page.elements, fontsReady])

  // Leaving the page or switching tools ends any text edit / selection cleanly.
  useEffect(() => {
    setDraft(null)
    useCanvasStore.getState().clearSelection()
  }, [page.id])

  // Unmounting (Back to notebooks, route change) fires no blur: save the open text box anyway.
  const commitDraftRef = useRef<() => void>(() => undefined)
  useEffect(() => () => commitDraftRef.current(), [])

  // ------------------------------------------------------------------ pointer input

  const toPage = (e: { clientX: number; clientY: number; pressure: number; pointerType: string }): Point => {
    const rect = liveRef.current!.getBoundingClientRect()
    const pressure = e.pointerType === 'pen' ? Math.max(0.05, e.pressure) : 0.5
    return [(e.clientX - rect.left) / scale, (e.clientY - rect.top) / scale, pressure]
  }

  const drawEraserCursor = (p: XY) => {
    const ctx = clearLive()
    if (!ctx) return
    ctx.beginPath()
    ctx.arc(p[0], p[1], eraserSize / 2, 0, Math.PI * 2)
    ctx.lineWidth = 1.5 / scale
    ctx.strokeStyle = 'rgba(31,42,68,0.55)'
    ctx.fillStyle = 'rgba(255,255,255,0.35)'
    ctx.fill()
    ctx.stroke()
  }

  const drawLasso = (points: XY[]) => {
    const ctx = clearLive()
    if (!ctx || points.length < 2) return
    ctx.beginPath()
    ctx.moveTo(points[0][0], points[0][1])
    points.slice(1).forEach(([x, y]) => ctx.lineTo(x, y))
    ctx.closePath()
    ctx.setLineDash([10 / scale, 8 / scale])
    ctx.lineWidth = 2 / scale
    ctx.strokeStyle = '#c43d2f'
    ctx.fillStyle = 'rgba(246,211,45,0.12)'
    ctx.fill()
    ctx.stroke()
  }

  const commitDraft = useCallback(() => {
    if (!draft) return
    const text = draft.el.text.replace(/\s+$/, '')
    const current = elementsRef.current
    if (!text.trim()) {
      if (!draft.isNew) commit(page.id, removeElements(current, new Set([draft.el.id])))
    } else {
      const original = current.find((el) => el.id === draft.el.id)
      if (draft.isNew || (original?.type === 'text' && original.text !== text)) {
        commit(page.id, upsertElement(current, { ...draft.el, text }))
      }
    }
    setDraft(null)
  }, [draft, commit, page.id])
  commitDraftRef.current = commitDraft

  /** The selection plus any eraser passes inside it, so erased gaps move with their ink. */
  const movingIds = (ids: string[]): Set<string> => {
    const box = selectionBounds(elementsRef.current, new Set(ids))
    return new Set(box ? [...ids, ...erasersWithin(elementsRef.current, box)] : ids)
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (!e.isPrimary) return // ignore a resting palm or second finger
    // Stop the follow-up mousedown from stealing focus (it would blur a new text box
    // the instant it appears) and from starting a text selection while drawing.
    e.preventDefault()
    if (draft) {
      commitDraft()
      if (tool === 'text') return
    }
    const p = toPage(e)
    const xy: XY = [p[0], p[1]]
    e.currentTarget.setPointerCapture(e.pointerId)
    const canvasState = useCanvasStore.getState()

    if (tool === 'pen' || tool === 'highlighter') {
      const ink =
        tool === 'pen'
          ? { color: canvasState.penColor, size: canvasState.penSize, opacity: 1 }
          : { color: canvasState.highlighterColor, size: canvasState.highlighterSize, opacity: 0.35 }
      gesture.current = { kind: 'draw', el: startStroke(tool, p, ink) }
    } else if (tool === 'eraser') {
      if (eraserMode === 'precise') {
        const el = startErase(p, eraserSize)
        gesture.current = { kind: 'erase', el }
        drawInk([...elementsRef.current, el])
      } else {
        const elements = eraseTouched(elementsRef.current, [xy], eraserSize / 2)
        gesture.current = { kind: 'strokeErase', path: [xy], elements }
        drawInk(elements)
      }
      drawEraserCursor(xy)
    } else if (tool === 'text') {
      const hit = elementAt(elementsRef.current, xy, 6)
      if (hit?.type === 'text') {
        setDraft({ el: hit, isNew: false })
      } else {
        const el = newTextElement(xy[0], Math.max(20, xy[1] - canvasState.textSize * 0.7), canvasState.textSize, canvasState.penColor)
        setDraft({ el, isNew: true })
      }
    } else if (tool === 'select') {
      const box = selectionBounds(elementsRef.current, new Set(canvasState.selection))
      if (box && boxContains({ x: box.x - 8, y: box.y - 8, width: box.width + 16, height: box.height + 16 }, xy)) {
        gesture.current = { kind: 'move', start: xy, ids: movingIds(canvasState.selection), dx: 0, dy: 0 }
        return
      }
      const hit = elementAt(elementsRef.current, xy, 6)
      if (hit) {
        setSelection([hit.id])
        gesture.current = { kind: 'move', start: xy, ids: movingIds([hit.id]), dx: 0, dy: 0 }
      } else {
        setSelection([])
        gesture.current = { kind: 'lasso', points: [xy] }
      }
    }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const g = gesture.current
    const native = e.nativeEvent
    const events = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : []
    const samples = (events.length ? events : [native]).map((ev) => toPage(ev))
    const last = samples[samples.length - 1]
    const lastXY: XY = [last[0], last[1]]

    if (!g) {
      if (tool === 'eraser') drawEraserCursor(lastXY)
      return
    }
    if (g.kind === 'draw') {
      g.el = { ...g.el, points: [...g.el.points, ...samples] }
      const ctx = clearLive()
      if (ctx) drawElement(ctx, g.el, true)
    } else if (g.kind === 'erase') {
      g.el = { ...g.el, points: [...g.el.points, ...samples] }
      drawInk([...elementsRef.current, g.el])
      drawEraserCursor(lastXY)
    } else if (g.kind === 'strokeErase') {
      const prev = g.path[g.path.length - 1]
      g.path.push(lastXY)
      g.elements = eraseTouched(g.elements, [prev, lastXY], eraserSize / 2)
      drawInk(g.elements)
      drawEraserCursor(lastXY)
    } else if (g.kind === 'move') {
      g.dx = lastXY[0] - g.start[0]
      g.dy = lastXY[1] - g.start[1]
      drawInk(elementsRef.current, { moving: { ids: g.ids, dx: g.dx, dy: g.dy } })
      setMoveOffset([g.dx, g.dy])
    } else if (g.kind === 'lasso') {
      g.points.push(lastXY)
      drawLasso(g.points)
    }
  }

  const onPointerUp = () => {
    const g = gesture.current
    gesture.current = null
    if (!g) return
    const current = elementsRef.current
    if (g.kind === 'draw') {
      commit(page.id, [...current, finishPath(g.el)])
      clearLive()
    } else if (g.kind === 'erase') {
      commit(page.id, [...current, finishPath(g.el)])
    } else if (g.kind === 'strokeErase') {
      if (g.elements !== current) commit(page.id, g.elements)
      else drawInk(current)
    } else if (g.kind === 'move') {
      setMoveOffset([0, 0])
      if (Math.hypot(g.dx, g.dy) > 1) commit(page.id, translateElements(current, g.ids, g.dx, g.dy))
      else drawInk(current)
    } else if (g.kind === 'lasso') {
      clearLive()
      setSelection(idsInLasso(current, g.points))
    }
  }

  const onPointerLeave = () => {
    if (!gesture.current && tool === 'eraser') clearLive()
  }

  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (tool !== 'select') return
    const rect = liveRef.current!.getBoundingClientRect()
    const hit = elementAt(elementsRef.current, [(e.clientX - rect.left) / scale, (e.clientY - rect.top) / scale], 6)
    if (hit?.type === 'text') {
      setSelection([])
      setDraft({ el: hit, isNew: false })
    }
  }

  const cursor = tool === 'text' ? 'text' : tool === 'select' ? 'default' : tool === 'eraser' ? 'none' : 'crosshair'

  return (
    <div ref={wrapRef} className="flex min-h-full w-full justify-center px-8 pb-24 pt-20">
      <div className="relative shrink-0 rounded-[3px] shadow-page" style={{ width: cssWidth, height: cssHeight }}>
        <canvas ref={bgRef} className="absolute inset-0 rounded-[3px]" style={{ width: cssWidth, height: cssHeight }} />
        <canvas ref={inkRef} className="absolute inset-0" style={{ width: cssWidth, height: cssHeight }} />
        <canvas
          ref={liveRef}
          className="absolute inset-0 touch-none"
          style={{ width: cssWidth, height: cssHeight, cursor }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={onPointerLeave}
          onDoubleClick={onDoubleClick}
          aria-label={`Page ${page.number}: ${page.title}. Drawing surface.`}
          role="img"
        />

        {draft && <TextDraft draft={draft} scale={scale} onChange={setDraft} onDone={commitDraft} onCancel={() => setDraft(null)} />}

        {selectionBox && (
          <>
            <div
              className="pointer-events-none absolute rounded-md border-2 border-dashed border-pen/80 bg-highlight/10"
              style={{
                left: (selectionBox.x + moveOffset[0]) * scale - 6,
                top: (selectionBox.y + moveOffset[1]) * scale - 6,
                width: selectionBox.width * scale + 12,
                height: selectionBox.height * scale + 12,
              }}
            />
            {moveOffset[0] === 0 && moveOffset[1] === 0 && (
              <SelectionBar
                pageId={page.id}
                left={selectionBox.x * scale + (selectionBox.width * scale) / 2}
                top={selectionBox.y * scale - 12}
                pageWidth={cssWidth}
              />
            )}
          </>
        )}

        {reading && (
          <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[3px]" aria-live="polite">
            <div className="scanline" />
            <div className="absolute right-4 top-4 rounded-full bg-ink px-3 py-1.5 text-xs font-bold text-highlight shadow-tool">
              Reading your handwriting…
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

interface TextDraftProps {
  draft: Draft
  scale: number
  onChange: (draft: Draft) => void
  onDone: () => void
  onCancel: () => void
}

/** The textarea that floats over the canvas while typing (doc §9.3, C4/C5). */
function TextDraft({ draft, scale, onChange, onDone, onCancel }: TextDraftProps) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const { el } = draft
  useEffect(() => {
    const area = ref.current
    if (!area) return
    area.focus()
    area.setSelectionRange(area.value.length, area.value.length)
  }, [el.id])
  useLayoutEffect(() => {
    const area = ref.current
    if (!area) return
    area.style.height = 'auto'
    area.style.height = `${area.scrollHeight}px`
  }, [el.text, scale])

  return (
    <textarea
      ref={ref}
      data-text-draft
      value={el.text}
      spellCheck
      placeholder="Type your note…"
      onChange={(e) => onChange({ ...draft, el: { ...el, text: e.target.value } })}
      onBlur={onDone}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          if (draft.isNew && !el.text.trim()) onCancel()
          else onDone()
        }
        e.stopPropagation()
      }}
      className="absolute resize-none overflow-hidden rounded-sm bg-highlight/10 p-0 outline-2 outline-offset-4 outline-pen/60 outline-dashed placeholder:text-ink-faint/70"
      style={{
        left: el.x * scale,
        top: el.y * scale,
        width: el.width * scale,
        fontSize: el.font_size * scale,
        lineHeight: TEXT_LINE_HEIGHT,
        fontFamily: TEXT_FONT_FAMILY,
        color: el.color,
      }}
    />
  )
}
