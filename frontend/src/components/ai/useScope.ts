import type { Scope } from '../../api/types'
import { useAiStore } from '../../store/aiStore'
import { useCanvasStore } from '../../store/canvasStore'

/** The scope that will actually be used: falls back to the page when nothing is selected. */
export function useEffectiveScope(allowProject = true): Scope {
  const scope = useAiStore((s) => s.scope)
  const hasSelection = useCanvasStore((s) => s.selection.length > 0)
  if (scope === 'selection' && !hasSelection) return 'page'
  if (scope === 'project' && !allowProject) return 'page'
  return scope
}

export const scopeWords = (scope: Scope): string =>
  scope === 'selection' ? 'your selection' : scope === 'page' ? 'this page' : 'the whole project'
