import { BookOpenCheck, Copy, FilePlus2, Plus, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { api, errorMessage } from '../../api/client'
import type { Scope, SummaryFormat, SummaryResult } from '../../api/types'
import { addAsNewPages, addBelowOnCurrentPage, copyText } from '../../lib/insertActions'
import { prepareScope, useAiStore } from '../../store/aiStore'
import { useCurrentPage } from '../../store/projectStore'
import { toastError } from '../../store/toastStore'
import { Card, EmptyState, Markdown, PageCite, Segmented, Thinking, UnreadWarning } from './shared'
import { scopeWords, useEffectiveScope } from './useScope'

const FORMATS: { value: SummaryFormat; label: string }[] = [
  { value: 'short', label: 'Short' },
  { value: 'detailed', label: 'Detailed' },
  { value: 'terms', label: 'Key terms' },
]

export function SummaryTab() {
  const scope = useEffectiveScope()
  const page = useCurrentPage()
  const pending = useAiStore((s) => s.pending)
  const [format, setFormat] = useState<SummaryFormat>('short')
  const [result, setResult] = useState<SummaryResult | null>(null)
  const [busy, setBusy] = useState(false)

  const run = useCallback(
    async (runScope: Scope, runFormat: SummaryFormat) => {
      setBusy(true)
      try {
        const args = await prepareScope(runScope)
        if (args) setResult(await api.summarize({ ...args, format: runFormat }))
      } catch (error) {
        toastError(errorMessage(error))
      } finally {
        setBusy(false)
      }
    },
    [],
  )

  useEffect(() => {
    if (!pending) return
    const action = useAiStore.getState().take('summary')
    if (action) void run('selection', format)
  }, [pending, run, format])

  const title = result?.scope === 'project' ? 'Project summary' : `Summary of ${page?.title ?? 'page'}`

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="eyebrow">Format</p>
        <Segmented label="Summary format" value={format} onChange={setFormat} options={FORMATS} />
      </div>
      <button className="btn btn-ink w-full" onClick={() => void run(scope, format)} disabled={busy}>
        {result ? <RefreshCw size={15} /> : <BookOpenCheck size={15} />} Summarise {scopeWords(scope)}
      </button>

      {busy && <Thinking label={`Summarising ${scopeWords(scope)}…`} />}

      {!busy && result && (
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <p className="eyebrow">{scopeWords(result.scope)} · {FORMATS.find((f) => f.value === result.format)?.label}</p>
            <button className="btn btn-ghost p-1.5" onClick={() => void copyText(result.summary_markdown)} aria-label="Copy summary">
              <Copy size={13} />
            </button>
          </div>
          <Markdown text={result.summary_markdown} />
          {result.pages_used.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-dashed border-line pt-3 text-[0.72rem] text-ink-faint">
              Drawn from {result.pages_used.map((p) => <PageCite key={p.page_id} number={p.page} />)}
            </div>
          )}
          <UnreadWarning pages={result.unread_pages} />
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button className="btn btn-outline text-xs" onClick={() => void addBelowOnCurrentPage(result.summary_markdown, title)}>
              <Plus size={14} /> Add below notes
            </button>
            <button className="btn btn-outline text-xs" onClick={() => void addAsNewPages(result.summary_markdown, title)}>
              <FilePlus2 size={14} /> Insert as new page
            </button>
          </div>
        </Card>
      )}

      {!busy && !result && (
        <EmptyState icon={<BookOpenCheck size={20} />} title="One-tap summaries">
          Summarise this page or the whole notebook. Every point links back to the page it came from.
        </EmptyState>
      )}
    </div>
  )
}
