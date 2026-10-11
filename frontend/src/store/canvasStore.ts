import { create } from 'zustand'

import type { EraserMode, Tool } from '../canvas/types'

export const INK_COLORS = ['#1f2a44', '#2456a6', '#b4332e', '#2f7a52', '#7a4fb5', '#5c4a3a'] as const
export const HIGHLIGHT_COLORS = ['#f6d32d', '#7fe0a8', '#ff9ec7', '#8fd3ff'] as const

interface CanvasState {
  tool: Tool
  penColor: string
  penSize: number
  highlighterColor: string
  highlighterSize: number
  eraserSize: number
  eraserMode: EraserMode
  textSize: number
  zoom: number
  /** Ids of selected elements on the current page. */
  selection: string[]
  editingTextId: string | null

  setTool: (tool: Tool) => void
  setPenColor: (color: string) => void
  setPenSize: (size: number) => void
  setHighlighterColor: (color: string) => void
  setHighlighterSize: (size: number) => void
  setEraserSize: (size: number) => void
  setEraserMode: (mode: EraserMode) => void
  setTextSize: (size: number) => void
  setZoom: (zoom: number) => void
  setSelection: (ids: string[]) => void
  clearSelection: () => void
  setEditingText: (id: string | null) => void
}

export const useCanvasStore = create<CanvasState>((set) => ({
  tool: 'pen',
  penColor: INK_COLORS[0],
  penSize: 5,
  highlighterColor: HIGHLIGHT_COLORS[0],
  highlighterSize: 26,
  eraserSize: 26,
  eraserMode: 'precise',
  textSize: 28,
  zoom: 1,
  selection: [],
  editingTextId: null,

  setTool: (tool) => set((s) => ({ tool, selection: tool === 'select' ? s.selection : [], editingTextId: null })),
  setPenColor: (penColor) => set({ penColor }),
  setPenSize: (penSize) => set({ penSize }),
  setHighlighterColor: (highlighterColor) => set({ highlighterColor }),
  setHighlighterSize: (highlighterSize) => set({ highlighterSize }),
  setEraserSize: (eraserSize) => set({ eraserSize }),
  setEraserMode: (eraserMode) => set({ eraserMode }),
  setTextSize: (textSize) => set({ textSize }),
  setZoom: (zoom) => set({ zoom: Math.min(1.6, Math.max(0.5, Math.round(zoom * 10) / 10)) }),
  setSelection: (selection) => set({ selection }),
  clearSelection: () => set({ selection: [] }),
  setEditingText: (editingTextId) => set({ editingTextId }),
}))
