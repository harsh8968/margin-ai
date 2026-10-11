import { Eye, RefreshCw, Save } from 'lucide-react'
import { useEffect, useState } from 'react'

import { errorMessage } from '../../api/client'
import type { Transcript } from '../../api/types'
import { useAiStore } from '../../store/aiStore'
import { useProjectStore } from '../../store/projectStore'
import { toast, toastError } from '../../store/toastStore'
import { Modal } from '../ui/Modal'
import { Spinner } from '../ui/Toasts'
import { goToPage } from './shared'

const SOURCE_LABEL: Record<NonNullable<Transcript['source']>, string> = {
  vision: 'Read from handwriting',
  typed: 'Typed text (exact)',
  seed: 'Pre-read (demo)',
  user: 'Corrected by you',
}

/**
 * "What the AI sees" (doc §11.2): the exact text every answer is grounded in, per page.
 * Students can fix misread words here, which fixes them for every future answer.
 */
export function WhatAISees({ onClose }: { onClose: () => void }) {
  const transcripts = useAiStore((s) => s.transcripts)
  const reading = useAiStore((s) => s.reading)
  const autoRead = useAiStore((s) => s.autoRead)
  const currentPageId = useProjectStore((s) => s.currentPageId)
  const [selectedId, setSelectedId] = useState<string | null>(currentPageId)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const { refreshTranscripts, readPage, correctTranscript, setAutoRead } = useAiStore.getState()

  useEffect(() => {
    void useProjectStore
      .getState()
      .flushSaves()
      .then(() => refreshTranscripts())
      .catch(() => undefined)
  }, [refreshTranscripts])

  const selected = transcripts.find((t) => t.page_id === selectedId) ?? transcripts[0]
  useEffect(() => {
    setDraft(selected?.transcript_md ?? '')
  }, [selected?.page_id, selected?.transcript_md])

  const save = async () => {
    if (!selected) return
    setSaving(true)
    try {
      await correctTranscript(selected.page_id, draft)
      toast('Saved. Answers will use your correction.', { tone: 'success' })
    } catch (error) {
      toastError(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const readAll = async () => {
    await useAiStore.getState().ensureRead('project')
  }

  const staleCount = transcripts.filter((t) => t.stale && t.has_ink).length

  return (
    <Modal wide title="What the AI sees" onClose={onClose}>
      <p className="mb-4 max-w-3xl text-sm leading-relaxed text-ink-soft">
        The AI can't see ink, only text. Each page with handwriting is read once by a vision model, and that reading is reused until you change the
        page. This is <strong className="text-ink">exactly</strong> what every answer is based on. If a word was misread, fix it here.
      </p>
      <div className="grid gap-5 md:grid-cols-[230px_1fr]">
        <div>
          <ol className="space-y-1.5">
            {transcripts.map((t) => {
              const isReading = reading.includes(t.page_id)
              const status = isReading ? 'Reading…' : t.stale && t.has_ink ? 'Not read yet' : t.source ? SOURCE_LABEL[t.source] : 'Empty'
              return (
                <li key={t.page_id}>
                  <button
                    onClick={() => setSelectedId(t.page_id)}
                    className={`w-full rounded-xl px-3 py-2 text-left transition ${selected?.page_id === t.page_id ? 'bg-ink text-paper' : 'hover:bg-desk/70'}`}
                  >
                    <span className="block truncate text-sm font-bold">
                      {t.number}. {t.title}
                    </span>
                    <span className={`text-[0.7rem] ${selected?.page_id === t.page_id ? 'text-paper/70' : t.stale && t.has_ink ? 'text-partial' : 'text-ink-faint'}`}>
                      {isReading && <Spinner size={9} />} {status}
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
          <button className="btn btn-outline mt-3 w-full text-xs" onClick={readAll} disabled={staleCount === 0 || reading.length > 0}>
            <Eye size={14} /> Read {staleCount ? `${staleCount} unread page${staleCount === 1 ? '' : 's'}` : 'all (up to date)'}
          </button>
          <label className="mt-3 flex items-center gap-2 text-xs text-ink-soft">
            <input type="checkbox" checked={autoRead} onChange={(e) => setAutoRead(e.target.checked)} className="accent-pen" />
            Read pages automatically when I pause writing
          </label>
        </div>

        {selected ? (
          <div className="flex min-h-[340px] flex-col">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <button className="text-left font-display text-lg font-semibold hover:text-pen" onClick={() => { goToPage(selected.number); onClose() }}>
                p.{selected.number} · {selected.title} →
              </button>
              {selected.has_ink && (
                <button className="btn btn-outline px-2.5 py-1.5 text-xs" onClick={() => void readPage(selected.page_id, { force: true })} disabled={reading.includes(selected.page_id)}>
                  {reading.includes(selected.page_id) ? <Spinner size={12} /> : <RefreshCw size={13} />} Re-read handwriting
                </button>
              )}
            </div>
            <textarea
              className="field min-h-[280px] flex-1 font-mono text-[0.82rem] leading-relaxed"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={selected.has_ink ? 'Not read yet. Press "Re-read handwriting".' : 'This page is empty.'}
              spellCheck
            />
            <div className="mt-3 flex items-center justify-between gap-2">
              <p className="text-xs text-ink-faint">
                {selected.user_corrected ? 'You corrected this reading. Later re-reads use it as a spelling guide.' : 'Edits here change what the AI uses, not your page.'}
              </p>
              <button
                className="btn btn-ink"
                onClick={save}
                disabled={saving || draft === (selected.transcript_md ?? '') || (selected.stale && selected.has_ink)}
                title={selected.stale && selected.has_ink ? 'This page changed since it was read. Re-read it first, then correct.' : undefined}
              >
                {saving ? <Spinner /> : <Save size={15} />} Save correction
              </button>
            </div>
          </div>
        ) : (
          <div className="skeleton h-72" />
        )}
      </div>
    </Modal>
  )
}
