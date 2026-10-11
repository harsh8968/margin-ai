import { Eraser, Highlighter, Lasso, PenLine, Redo2, Type, Undo2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { recolorElements } from '../../canvas/engine'
import type { Tool } from '../../canvas/types'
import { HIGHLIGHT_COLORS, INK_COLORS, useCanvasStore } from '../../store/canvasStore'
import { useCurrentPage, useProjectStore } from '../../store/projectStore'

const TOOLS: { id: Tool; label: string; key: string; icon: LucideIcon }[] = [
  { id: 'pen', label: 'Pen', key: 'P', icon: PenLine },
  { id: 'highlighter', label: 'Highlighter', key: 'H', icon: Highlighter },
  { id: 'eraser', label: 'Eraser', key: 'E', icon: Eraser },
  { id: 'text', label: 'Text', key: 'T', icon: Type },
  { id: 'select', label: 'Select & ask AI', key: 'V', icon: Lasso },
]

function Divider() {
  return <span className="mx-1.5 h-6 w-px bg-white/15" aria-hidden />
}

/** The floating "pen case" toolbar (C1-C3). */
export function Toolbar() {
  const s = useCanvasStore()
  const page = useCurrentPage()
  const history = useProjectStore((st) => (page ? st.histories[page.id] : undefined))
  const { undo, redo, commit } = useProjectStore.getState()

  const isHighlighter = s.tool === 'highlighter'
  const swatches = isHighlighter ? HIGHLIGHT_COLORS : INK_COLORS
  const activeColor = isHighlighter ? s.highlighterColor : s.penColor

  const pickColor = (color: string) => {
    if (isHighlighter) s.setHighlighterColor(color)
    else s.setPenColor(color)
    // C3: with something selected, a colour change restyles the selection.
    if (s.tool === 'select' && s.selection.length && page) {
      commit(page.id, recolorElements(page.elements, new Set(s.selection), color))
    }
  }

  const size = (() => {
    switch (s.tool) {
      case 'highlighter':
        return { value: s.highlighterSize, min: 10, max: 60, set: s.setHighlighterSize, label: 'Highlighter width' }
      case 'eraser':
        return { value: s.eraserSize, min: 8, max: 120, set: s.setEraserSize, label: 'Eraser size' }
      case 'text':
        return { value: s.textSize, min: 16, max: 72, set: s.setTextSize, label: 'Text size' }
      default:
        return { value: s.penSize, min: 1, max: 24, set: s.setPenSize, label: 'Pen width' }
    }
  })()

  return (
    <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-y-1 rounded-2xl bg-ink px-2 py-1.5 text-paper shadow-tool" role="toolbar" aria-label="Drawing tools">
      {TOOLS.map(({ id, label, key, icon: Icon }) => (
        <button
          key={id}
          onClick={() => s.setTool(id)}
          title={`${label} (${key})`}
          aria-label={label}
          aria-pressed={s.tool === id}
          className={`relative grid h-9 w-9 place-items-center rounded-xl transition ${
            s.tool === id ? 'bg-paper text-ink' : 'text-paper/75 hover:bg-white/10 hover:text-paper'
          }`}
        >
          <Icon size={18} />
          {s.tool === id && <span className="absolute -bottom-1 h-1 w-1 rounded-full bg-pen" />}
        </button>
      ))}

      {s.tool === 'eraser' && (
        <div className="ml-1.5 flex rounded-lg bg-white/10 p-0.5 text-[0.7rem] font-bold">
          {(['precise', 'stroke'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => s.setEraserMode(mode)}
              className={`rounded-md px-2 py-1 ${s.eraserMode === mode ? 'bg-paper text-ink' : 'text-paper/70'}`}
              title={mode === 'precise' ? 'Erase only where you rub' : 'Erase whole strokes you touch'}
            >
              {mode === 'precise' ? 'Precise' : 'Whole stroke'}
            </button>
          ))}
        </div>
      )}

      <Divider />

      {s.tool !== 'eraser' && (
        <div className="flex items-center gap-1" role="radiogroup" aria-label="Colour">
          {swatches.map((color) => (
            <button
              key={color}
              role="radio"
              aria-checked={activeColor === color}
              aria-label={`Colour ${color}`}
              onClick={() => pickColor(color)}
              className={`h-5 w-5 rounded-full border-2 transition ${activeColor === color ? 'scale-110 border-paper' : 'border-transparent hover:scale-110'}`}
              style={{ background: color }}
            />
          ))}
          <label className="relative ml-0.5 h-5 w-5 cursor-pointer overflow-hidden rounded-full border-2 border-white/30 bg-[conic-gradient(red,yellow,lime,cyan,blue,magenta,red)]" title="Custom colour">
            <input type="color" className="absolute inset-0 cursor-pointer opacity-0" value={activeColor} onChange={(e) => pickColor(e.target.value)} />
          </label>
        </div>
      )}

      <div className="ml-2 flex items-center gap-2" title={size.label}>
        <input
          type="range"
          min={size.min}
          max={size.max}
          value={size.value}
          onChange={(e) => size.set(Number(e.target.value))}
          aria-label={size.label}
          className="w-16 accent-pen"
        />
        <span className="w-6 text-right text-[0.7rem] tabular-nums text-paper/60">{size.value}</span>
      </div>

      <Divider />

      <button className="grid h-9 w-9 place-items-center rounded-xl text-paper/75 hover:bg-white/10 hover:text-paper disabled:opacity-30" onClick={undo} disabled={!history?.past.length} title="Undo (Ctrl+Z)" aria-label="Undo">
        <Undo2 size={18} />
      </button>
      <button className="grid h-9 w-9 place-items-center rounded-xl text-paper/75 hover:bg-white/10 hover:text-paper disabled:opacity-30" onClick={redo} disabled={!history?.future.length} title="Redo (Ctrl+Y)" aria-label="Redo">
        <Redo2 size={18} />
      </button>

    </div>
  )
}
