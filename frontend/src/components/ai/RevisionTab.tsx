import { Copy, FilePlus2, NotebookPen, RefreshCw } from 'lucide-react'
import { useState } from 'react'

import { api, errorMessage } from '../../api/client'
import type { RevisionSheet } from '../../api/types'
import { addAsNewPages, copyText } from '../../lib/insertActions'
import { prepareScope } from '../../store/aiStore'
import { toastError } from '../../store/toastStore'
import { Card, EmptyState, Markdown, Thinking, UnreadWarning } from './shared'

/** Smart revision mode (doc B3): a one-page sheet of the whole project. */
export function RevisionTab() {
  const [sheet, setSheet] = useState<RevisionSheet | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async () => {
    setBusy(true)
    try {
      const args = await prepareScope('project')
      if (args) setSheet(await api.revisionSheet(args.project_id, args.page_id))
    } catch (error) {
      toastError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <button className="btn btn-pen w-full" onClick={run} disabled={busy}>
        {sheet ? <RefreshCw size={15} /> : <NotebookPen size={15} />} {sheet ? 'Regenerate' : 'Make my revision sheet'}
      </button>

      {busy && <Thinking label="Reading every page for the essentials…" />}

      {!busy && sheet && (
        <Card className="relative overflow-hidden">
          <span className="absolute inset-y-0 left-0 w-1.5 bg-highlight" aria-hidden />
          <div className="mb-2 flex items-start justify-between gap-2">
            <h3 className="font-display text-lg font-semibold leading-tight">{sheet.title}</h3>
            <button className="btn btn-ghost p-1.5" onClick={() => void copyText(sheet.sheet_markdown)} aria-label="Copy sheet">
              <Copy size={13} />
            </button>
          </div>
          <Markdown text={sheet.sheet_markdown} />
          <UnreadWarning pages={sheet.unread_pages} />
          <button className="btn btn-outline mt-4 w-full text-xs" onClick={() => void addAsNewPages(sheet.sheet_markdown, sheet.title || 'Revision sheet')}>
            <FilePlus2 size={14} /> Insert as page (then Export PDF to print it)
          </button>
        </Card>
      )}

      {!busy && !sheet && (
        <EmptyState icon={<NotebookPen size={20} />} title="The night-before sheet">
          Key definitions, formulas, must-remember points and likely exam questions from the whole notebook, each with its page.
        </EmptyState>
      )}
    </div>
  )
}
