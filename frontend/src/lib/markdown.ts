/** Helpers for moving AI markdown onto the canvas, which draws plain text. */

export function markdownToPlain(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  for (const raw of lines) {
    let line = raw
    if (/^\s*```/.test(line)) continue
    if (/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line)) continue // table separator
    if (/^\s*\|.*\|\s*$/.test(line)) {
      line = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()).join('  -  ')
    }
    const heading = /^\s*(#{1,6})\s+(.*)$/.exec(line)
    if (heading) line = heading[1].length <= 2 ? heading[2].toUpperCase() : heading[2]
    line = line
      .replace(/^\s*>\s?/, '')
      .replace(/^(\s*)[-*+]\s+/, '$1• ')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/__(.+?)__/g, '$1')
      .replace(/(^|[\s(])\*(\S.*?\S|\S)\*(?=[\s).,;:!?]|$)/g, '$1$2')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, '$1')
      .replace(/\[p\.\s*(\d+)\]/gi, '(p.$1)')
      .replace(/\$\$?([^$]+)\$\$?/g, '$1')
    out.push(line.replace(/\s+$/, ''))
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** Turn [p.3] markers into links the markdown renderer shows as clickable page chips. */
export function linkifyPageRefs(md: string): string {
  return md.replace(/\[p\.\s*(\d+)\](?!\()/gi, (_m, n: string) => `[p.${n}](#page-${n})`)
}
