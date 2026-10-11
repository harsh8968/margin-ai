import { create } from 'zustand'

import { api, errorMessage } from '../api/client'
import { useProjectStore } from '../store/projectStore'
import { toast, toastError } from '../store/toastStore'
import type { ImportEntry, ImportResult } from './importNotes'
import { MAX_IMPORT_PAGES, suggestedNotebookName } from './importNotes'

interface ImportStatus {
  active: boolean
  message: string
}

/** Drives the small "Importing…" card so long PDF imports show progress. */
export const useImportStatus = create<ImportStatus>(() => ({ active: false, message: '' }))

const setMessage = (message: string) => useImportStatus.setState({ active: true, message })

async function runImport(projectId: string, entries: ImportEntry[]): Promise<ImportResult> {
  const { importFiles } = await import('./importNotes') // pdf.js etc. load only when importing
  return importFiles(projectId, entries, setMessage)
}

function report(result: ImportResult): void {
  if (result.pages.length) {
    toast(`Imported ${result.pages.length} page${result.pages.length === 1 ? '' : 's'}. The AI reads them before answering.`, { tone: 'success' })
  }
  if (result.truncated) toast(`Stopped at ${MAX_IMPORT_PAGES} pages. Import the rest into another notebook.`, { ttl: 7000 })
  if (result.skipped.length) {
    const list = result.skipped.slice(0, 3).join(', ')
    toast(`Skipped ${result.skipped.length}: ${list}${result.skipped.length > 3 ? '…' : ''}`, { ttl: 8000 })
  }
}

/** Import into the open notebook, right after the current page. */
export async function importIntoCurrentProject(entries: ImportEntry[]): Promise<void> {
  const store = useProjectStore.getState()
  if (!store.project || entries.length === 0) return
  setMessage('Preparing import…')
  try {
    await store.flushSaves()
    const result = await runImport(store.project.id, entries)
    if (result.pages.length === 0) {
      toastError('Nothing to import. Supported: PDF, PNG/JPG/WebP photos, .txt, .md and .docx.')
    } else {
      setMessage(`Adding ${result.pages.length} pages…`)
      await useProjectStore.getState().insertPages(result.pages, useProjectStore.getState().currentPageId)
    }
    report(result)
  } catch (error) {
    toastError(`Import failed: ${errorMessage(error)}`)
  } finally {
    useImportStatus.setState({ active: false, message: '' })
  }
}

/** Create a notebook from files or a folder (named after the folder). Returns its id. */
export async function importAsNewNotebook(entries: ImportEntry[]): Promise<string | null> {
  if (entries.length === 0) return null
  setMessage('Creating notebook…')
  let projectId: string | null = null
  try {
    const project = await api.createProject(suggestedNotebookName(entries))
    projectId = project.id
    const [blank] = (await api.getProject(project.id)).pages
    const result = await runImport(project.id, entries)
    let after = blank.id
    for (const [i, page] of result.pages.entries()) {
      setMessage(`Adding page ${i + 1} of ${result.pages.length}…`)
      after = (await api.addPage(project.id, { ...page, after_page_id: after })).id
    }
    if (result.pages.length) await api.deletePage(blank.id) // drop the empty starter page
    else toastError('Nothing could be imported, so the notebook is empty.')
    report(result)
    return projectId
  } catch (error) {
    toastError(`Import failed: ${errorMessage(error)}`)
    return projectId
  } finally {
    useImportStatus.setState({ active: false, message: '' })
  }
}
