import type { Speaker } from './protocol'

export interface Caption {
  id: number
  who: Speaker
  text: string
  final: boolean
}

export const MAX_CAPTIONS = 30

const closeAll = (captions: Caption[]) => captions.map((c) => (c.final ? c : { ...c, final: true }))

/** Streamed transcript fragments join the speaker's open caption; a new speaker starts a new one. */
export function appendCaption(captions: Caption[], who: Speaker, fragment: string): Caption[] {
  const last = captions.at(-1)
  if (last && last.who === who && !last.final) {
    return [...captions.slice(0, -1), { ...last, text: last.text + fragment }]
  }
  const next: Caption = { id: (last?.id ?? 0) + 1, who, text: fragment.trimStart(), final: false }
  return [...closeAll(captions), next].slice(-MAX_CAPTIONS)
}

export function finalizeCaptions(captions: Caption[]): Caption[] {
  return captions.some((c) => !c.final) ? closeAll(captions) : captions
}
