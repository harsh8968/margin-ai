/**
 * Import existing study material into a notebook: PDFs, photos of handwritten pages,
 * plain-text / Markdown / Word notes, or a whole folder of them.
 *
 * Every PDF page and photo becomes the *paper* of a new canvas page (the student can write
 * over it). A typed PDF's text layer is kept with the page so the AI reads it exactly. Scans,
 * photos and handwritten PDFs are read by the vision model instead, and so are pages whose
 * pictures carry content the text layer misses (see pdfPageKind).
 */
import { api } from '../api/client'
import { newId } from '../canvas/engine'
import { measureWithCanvas } from '../canvas/textLayout'
import type { Background, CanvasElement, ImageElement } from '../canvas/types'
import { PAGE_HEIGHT, PAGE_MARGIN_TOP, PAGE_WIDTH } from '../canvas/types'
import { pagesFor, paginate } from './insert'
import { markdownToPlain } from './markdown'
import { pageSignals, planTextLayer } from './pdfPageKind'

export const IMPORT_ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.txt,.md,.markdown,.docx'
export const MAX_IMPORT_PAGES = 120

const OVERSAMPLE = 1.4 // render imports a little sharper than the page so zooming stays crisp
const PHOTO_MARGIN = 40
const JUNK_FILES = /^(\.|desktop\.ini$|thumbs\.db$)/i

export interface ImportEntry {
  file: File
  /** Folder-relative path, used for ordering ("Unit 1/01 intro.pdf"). */
  path: string
}

export interface ImportedPage {
  title: string
  background: Background
  elements: CanvasElement[]
}

export interface ImportResult {
  pages: ImportedPage[]
  skipped: string[]
  truncated: boolean
}

type Kind = 'pdf' | 'image' | 'text' | 'markdown' | 'docx' | null

function kindOf(file: File): Kind {
  const name = file.name.toLowerCase()
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return 'pdf'
  if (/\.(png|jpe?g|webp)$/.test(name) || /^image\/(png|jpeg|webp)$/.test(file.type)) return 'image'
  if (/\.(md|markdown)$/.test(name)) return 'markdown'
  if (name.endsWith('.txt') || file.type === 'text/plain') return 'text'
  if (name.endsWith('.docx')) return 'docx'
  return null
}

const baseName = (name: string) => name.replace(/\.[^.]+$/, '')

/** "Lecture 2.pdf" before "Lecture 10.pdf", folders grouped together. */
export function sortEntries(entries: ImportEntry[]): ImportEntry[] {
  return [...entries].sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }))
}

export function entriesFromFileList(files: FileList | File[]): ImportEntry[] {
  return Array.from(files).map((file) => ({ file, path: file.webkitRelativePath || file.name }))
}

/** Folder name when a whole folder was picked, else the first file's name. */
export function suggestedNotebookName(entries: ImportEntry[]): string {
  const first = sortEntries(entries)[0]
  if (!first) return 'Imported notes'
  const folder = first.path.includes('/') ? first.path.split('/')[0] : ''
  return (folder || baseName(first.file.name)).slice(0, 120)
}

export async function importFiles(projectId: string, entries: ImportEntry[], onProgress: (message: string) => void): Promise<ImportResult> {
  const pages: ImportedPage[] = []
  const skipped: string[] = []
  let truncated = false

  for (const { file, path } of sortEntries(entries)) {
    if (JUNK_FILES.test(file.name)) continue
    const room = MAX_IMPORT_PAGES - pages.length
    if (room <= 0) {
      truncated = true
      break
    }
    const kind = kindOf(file)
    onProgress(`Reading ${path}`)
    try {
      if (kind === 'pdf') {
        const result = await pdfPages(projectId, file, room, onProgress)
        pages.push(...result.pages)
        truncated ||= result.truncated
      } else if (kind === 'image') {
        pages.push(await photoPage(projectId, file))
      } else if (kind === 'text' || kind === 'markdown') {
        const raw = await file.text()
        pages.push(...textPages(baseName(file.name), kind === 'markdown' ? markdownToPlain(raw) : raw).slice(0, room))
      } else if (kind === 'docx') {
        const mammoth = await import('mammoth')
        const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
        pages.push(...textPages(baseName(file.name), value).slice(0, room))
      } else {
        skipped.push(`${file.name} (unsupported type)`)
      }
    } catch (error) {
      skipped.push(`${file.name} (${error instanceof Error ? error.message : 'could not be read'})`)
    }
  }
  return { pages, skipped, truncated }
}

// --------------------------------------------------------------------------- PDFs

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null

async function loadPdfJs() {
  pdfjsPromise ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default
    return pdfjs
  })
  return pdfjsPromise
}

async function pdfPages(projectId: string, file: File, limit: number, onProgress: (m: string) => void) {
  const pdfjs = await loadPdfJs()
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  const doc = await task.promise
  const pages: ImportedPage[] = []
  const count = Math.min(doc.numPages, limit)
  try {
    for (let n = 1; n <= count; n++) {
      onProgress(`${file.name}: page ${n} of ${doc.numPages}`)
      const page = await doc.getPage(n)
      const natural = page.getViewport({ scale: 1 })
      const fit = Math.min(PAGE_WIDTH / natural.width, PAGE_HEIGHT / natural.height)
      const viewport = page.getViewport({ scale: fit * OVERSAMPLE })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas is not available')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvas, viewport }).promise
      const content = await page.getTextContent()
      const text = content.items
        .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''))
        .join('')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
      const plan = planTextLayer(pageSignals(await page.getOperatorList(), page.view, pdfjs.OPS), text)
      const asset = await api.uploadAsset(projectId, canvas.toDataURL('image/jpeg', 0.82))
      const width = natural.width * fit
      const height = natural.height * fit
      const image = imageElement(asset.url, (PAGE_WIDTH - width) / 2, (PAGE_HEIGHT - height) / 2, width, height, plan.keepText ? text : '', file.name)
      pages.push({
        title: doc.numPages > 1 ? `${baseName(file.name)} · p${n}` : baseName(file.name),
        background: 'blank',
        elements: [plan.needsVision ? { ...image, needs_vision: true } : image],
      })
      page.cleanup()
    }
  } finally {
    await task.destroy() // frees the worker and the PDF's memory
  }
  return { pages, truncated: doc.numPages > count }
}

// --------------------------------------------------------------------------- photos & scans

async function photoPage(projectId: string, file: File): Promise<ImportedPage> {
  const bitmap = await createImageBitmap(file) // honours EXIF rotation from phone cameras
  try {
    const fit = Math.min((PAGE_WIDTH - PHOTO_MARGIN * 2) / bitmap.width, (PAGE_HEIGHT - PHOTO_MARGIN * 2) / bitmap.height)
    const width = bitmap.width * fit
    const height = bitmap.height * fit
    const pixelScale = Math.min(OVERSAMPLE, 1 / fit) // never upscale beyond the original photo
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width * pixelScale)
    canvas.height = Math.round(height * pixelScale)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas is not available')
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const asset = await api.uploadAsset(projectId, canvas.toDataURL('image/jpeg', 0.85))
    return {
      title: baseName(file.name),
      background: 'blank',
      elements: [imageElement(asset.url, (PAGE_WIDTH - width) / 2, (PAGE_HEIGHT - height) / 2, width, height, '', file.name)],
    }
  } finally {
    bitmap.close()
  }
}

// --------------------------------------------------------------------------- text notes

function textPages(title: string, text: string): ImportedPage[] {
  const clean = text.replace(/\r\n/g, '\n').trim()
  if (!clean) return []
  return pagesFor(paginate(clean, PAGE_MARGIN_TOP, measureWithCanvas), title)
}

function imageElement(src: string, x: number, y: number, width: number, height: number, text: string, name: string): ImageElement {
  return { id: newId(), type: 'image', x, y, width, height, src, text: text.slice(0, 60_000), name }
}

// --------------------------------------------------------------------------- drag & drop (files and folders)

type FsEntry = { isFile: boolean; isDirectory: boolean; name: string; fullPath: string }
type FsFileEntry = FsEntry & { file: (ok: (f: File) => void, fail: (e: unknown) => void) => void }
type FsDirEntry = FsEntry & { createReader: () => { readEntries: (ok: (e: FsEntry[]) => void, fail: (e: unknown) => void) => void } }

async function walk(entry: FsEntry, out: ImportEntry[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((ok, fail) => (entry as FsFileEntry).file(ok, fail))
    out.push({ file, path: entry.fullPath.replace(/^\//, '') })
  } else if (entry.isDirectory) {
    const reader = (entry as FsDirEntry).createReader()
    // readEntries returns results in batches; keep reading until it returns none.
    for (;;) {
      const batch = await new Promise<FsEntry[]>((ok, fail) => reader.readEntries(ok, fail))
      if (batch.length === 0) break
      for (const child of batch) await walk(child, out)
    }
  }
}

/** Files and whole folders dropped onto the page. */
export async function entriesFromDrop(data: DataTransfer): Promise<ImportEntry[]> {
  const roots = Array.from(data.items)
    .map((item) => (item.kind === 'file' ? (item.webkitGetAsEntry?.() as FsEntry | null) : null))
    .filter((e): e is FsEntry => e !== null)
  if (roots.length === 0) return entriesFromFileList(data.files)
  const out: ImportEntry[] = []
  for (const root of roots) await walk(root, out)
  return out
}
