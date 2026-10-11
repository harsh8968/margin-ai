import { FileUp, FolderUp, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useImportStatus } from '../../lib/importActions'
import type { ImportEntry } from '../../lib/importNotes'
import { IMPORT_ACCEPT, entriesFromFileList } from '../../lib/importNotes'
import { Spinner } from './Toasts'

interface Props {
  label: string
  className?: string
  onPick: (entries: ImportEntry[]) => void
  menuAbove?: boolean
}

/** "Import" button: choose files (PDF, photos, notes) or a whole study folder. */
export function ImportPicker({ label, className = 'btn btn-outline w-full', onPick, menuAbove = false }: Props) {
  const [open, setOpen] = useState(false)
  const filesRef = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)
  const busy = useImportStatus((s) => s.active)

  useEffect(() => {
    // React has no prop for folder picking; the attribute is widely supported.
    folderRef.current?.setAttribute('webkitdirectory', '')
    folderRef.current?.setAttribute('directory', '')
  }, [])

  const handle = (input: HTMLInputElement | null) => {
    if (!input?.files?.length) return
    const entries = entriesFromFileList(input.files)
    input.value = '' // allow picking the same files again later
    setOpen(false)
    onPick(entries)
  }

  return (
    <div className="relative">
      <button className={className} onClick={() => setOpen((o) => !o)} disabled={busy} aria-haspopup="menu" aria-expanded={open}>
        {busy ? <Spinner /> : <Upload size={16} />} {label}
      </button>
      {open && (
        <div
          role="menu"
          className={`rise absolute right-0 z-30 w-[13.5rem] min-w-full overflow-hidden rounded-xl border border-line bg-paper py-1 shadow-lift ${menuAbove ? 'bottom-full mb-2' : 'top-full mt-2'}`}
          onMouseLeave={() => setOpen(false)}
        >
          <button role="menuitem" className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left hover:bg-desk/60" onClick={() => filesRef.current?.click()}>
            <FileUp size={16} className="mt-0.5 shrink-0 text-pen" />
            <span>
              <span className="block text-sm font-bold">Files</span>
              <span className="block text-xs text-ink-faint">PDFs, photos of notes, .txt, .md, .docx</span>
            </span>
          </button>
          <button role="menuitem" className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left hover:bg-desk/60" onClick={() => folderRef.current?.click()}>
            <FolderUp size={16} className="mt-0.5 shrink-0 text-pen" />
            <span>
              <span className="block text-sm font-bold">A whole folder</span>
              <span className="block text-xs text-ink-faint">Every supported file, in name order</span>
            </span>
          </button>
        </div>
      )}
      <input ref={filesRef} type="file" multiple accept={IMPORT_ACCEPT} className="hidden" onChange={(e) => handle(e.currentTarget)} />
      <input ref={folderRef} type="file" multiple className="hidden" onChange={(e) => handle(e.currentTarget)} />
    </div>
  )
}

export function ImportProgress() {
  const { active, message } = useImportStatus()
  if (!active) return null
  return (
    <div className="rise fixed bottom-5 left-5 z-[60] flex max-w-sm items-center gap-3 rounded-xl bg-ink px-4 py-3 text-sm text-paper shadow-tool" role="status">
      <Spinner />
      <span className="truncate">{message || 'Importing…'}</span>
    </div>
  )
}
