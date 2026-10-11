/** Server timestamps are UTC; SQLite can drop the offset, so treat offset-less ones as UTC. */
export function parseServerDate(iso: string): number {
  const hasZone = /(Z|[+-]\d\d:?\d\d)$/.test(iso)
  return new Date(hasZone ? iso : `${iso}Z`).getTime()
}

export function timeAgo(iso: string, now = Date.now()): string {
  const then = parseServerDate(iso)
  const seconds = Math.max(0, Math.round((now - then) / 1000))
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} d ago`
  return new Date(then).toLocaleDateString()
}

const SPINES = ['#1f2a44', '#8c2f25', '#2f6b4f', '#5b3f86', '#9a6a12', '#2b5f8f']

/** A stable notebook-spine colour per project id. */
export function spineColor(id: string): string {
  let hash = 0
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return SPINES[hash % SPINES.length]
}

export const percent = (value: number): string => `${Math.round(value * 100)}%`
