/**
 * Whole-project PDF (doc §10.3, P4). Pages are sorted by `order` HERE, not trusted from the
 * caller, because "PDF pages in the wrong order" is the classic failure for this feature.
 */
import { jsPDF } from 'jspdf'

import type { Page } from '../api/types'
import { ensureImagesLoaded, pageToDataUrl } from '../canvas/renderer'

const A4_WIDTH_MM = 210
const A4_HEIGHT_MM = 297
const RENDER_SCALE = 2 // 300 DPI-equivalent

export async function exportProjectPdf(projectName: string, pages: Page[], onProgress?: (done: number, total: number) => void): Promise<void> {
  const pdf = await buildProjectPdf(projectName, pages, onProgress)
  pdf.save(`${safeFileName(projectName)}.pdf`)
}

/** Builds the PDF without saving it (separate so it can be inspected and tested). */
export async function buildProjectPdf(projectName: string, pages: Page[], onProgress?: (done: number, total: number) => void): Promise<jsPDF> {
  const ordered = [...pages].sort((a, b) => a.order - b.order)
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true })
  pdf.setProperties({ title: projectName, creator: 'Margin AI study canvas' })

  for (const [index, page] of ordered.entries()) {
    if (index > 0) pdf.addPage('a4', 'portrait')
    await ensureImagesLoaded(page.elements)
    const image = pageToDataUrl(page.elements, page.background, RENDER_SCALE, 0.9)
    pdf.addImage(image, 'JPEG', 0, 0, A4_WIDTH_MM, A4_HEIGHT_MM, undefined, 'FAST')
    // Footer: makes the page order obvious when flipping through the PDF.
    pdf.setFontSize(8)
    pdf.setTextColor(120, 125, 140)
    pdf.text(`${projectName}  ·  ${page.title}`, 12, A4_HEIGHT_MM - 7)
    pdf.text(`${index + 1} / ${ordered.length}`, A4_WIDTH_MM - 12, A4_HEIGHT_MM - 7, { align: 'right' })
    onProgress?.(index + 1, ordered.length)
    await new Promise((resolve) => setTimeout(resolve, 0)) // let the UI breathe between pages
  }
  return pdf
}

export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'notebook'
}
