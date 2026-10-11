import { useEffect, useRef } from 'react'
import type { PointerEvent } from 'react'

import type { BlobFrame, BlobState } from './blobShape'
import { STATE_TOKENS, mix, outline, withAlpha } from './blobShape'

interface Props {
  /** Read every animation frame; must be a stable function. */
  frame: () => { visual: BlobState; level: number }
  onActivate: () => void
  label: string
}

const SIZE = 240
const LEVEL_EASE = 0.22
const LEAN_EASE = 0.08

/** Quadratic curves through the midpoints of a closed ring of points: a smooth organic edge. */
function traceSmooth(ctx: CanvasRenderingContext2D, points: [number, number][]) {
  const n = points.length
  const mid = (i: number): [number, number] => [(points[i][0] + points[(i + 1) % n][0]) / 2, (points[i][1] + points[(i + 1) % n][1]) / 2]
  const [sx, sy] = mid(n - 1)
  ctx.moveTo(sx, sy)
  for (let i = 0; i < n; i++) {
    const [mx, my] = mid(i)
    ctx.quadraticCurveTo(points[i][0], points[i][1], mx, my)
  }
  ctx.closePath()
}

export function VoiceBlob({ frame, onActivate, label }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const leanTarget = useRef({ x: 0, y: 0 })

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = SIZE * dpr
    canvas.height = SIZE * dpr
    ctx.scale(dpr, dpr)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const styles = getComputedStyle(document.documentElement)
    const colors = new Map<string, string>()
    const color = (token: string) => {
      const cached = colors.get(token)
      if (cached) return cached
      const value = styles.getPropertyValue(token).trim() || '#1f2a44'
      colors.set(token, value)
      return value
    }

    const startedAt = performance.now()
    const lean = { x: 0, y: 0 }
    let level = 0
    let raf = 0
    const draw = (now: number) => {
      const current = frame()
      level += (current.level - level) * LEVEL_EASE
      lean.x += (leanTarget.current.x - lean.x) * LEAN_EASE
      lean.y += (leanTarget.current.y - lean.y) * LEAN_EASE
      const f: BlobFrame = { time: (now - startedAt) / 1000, level, state: current.visual, lean, reducedMotion: reduced.matches }
      const { body, glow } = STATE_TOKENS[current.visual]
      const c = SIZE / 2
      const base = SIZE * 0.3

      ctx.clearRect(0, 0, SIZE, SIZE)
      const halo = ctx.createRadialGradient(c, c, base * 0.6, c, c, base * 1.65)
      halo.addColorStop(0, withAlpha(color(glow), 0.22 + level * 0.3))
      halo.addColorStop(1, withAlpha(color(glow), 0))
      ctx.fillStyle = halo
      ctx.fillRect(0, 0, SIZE, SIZE)

      ctx.beginPath()
      traceSmooth(ctx, outline(f, c, c, base))
      const fill = ctx.createRadialGradient(c - base * 0.35, c - base * 0.4, base * 0.1, c, c, base * 1.3)
      fill.addColorStop(0, mix(color(body), '#ffffff', 0.35))
      fill.addColorStop(0.55, color(body))
      fill.addColorStop(1, mix(color(body), '#000000', 0.35))
      ctx.fillStyle = fill
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = withAlpha(color(glow), 0.55)
      ctx.stroke()

      ctx.beginPath()
      ctx.ellipse(c - base * 0.32, c - base * 0.38, base * 0.22, base * 0.13, -0.6, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.32)'
      ctx.fill()
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [frame])

  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    leanTarget.current = { x: ((e.clientX - box.left) / box.width - 0.5) * 2, y: ((e.clientY - box.top) / box.height - 0.5) * 2 }
  }

  return (
    <button
      type="button"
      onClick={onActivate}
      onPointerMove={onPointerMove}
      onPointerLeave={() => (leanTarget.current = { x: 0, y: 0 })}
      aria-label={label}
      title={label}
      className="group relative mx-auto block rounded-full outline-none focus-visible:ring-4 focus-visible:ring-pen/30"
      style={{ width: SIZE, height: SIZE }}
    >
      <canvas ref={canvasRef} style={{ width: SIZE, height: SIZE }} className="transition-transform duration-300 ease-[var(--ease-out-expo)] group-active:scale-95" />
    </button>
  )
}
