import { describe, expect, it } from 'vitest'

import { makeTextBlock } from '../canvas/engine'
import { PAGE_HEIGHT, PAGE_MARGIN_TOP } from '../canvas/types'
import { pagesFor, paginate, placeBelow } from './insert'
import { parseHash } from './hooks'
import { linkifyPageRefs, markdownToPlain } from './markdown'

const measure = (text: string, size: number) => text.length * size * 0.5

describe('markdownToPlain', () => {
  it('flattens common markdown into readable plain text', () => {
    const md = '## Key idea\n- **2NF** removes *partial* dependency [p.2]\n- uses `keys`\n> note\n\n\n\nSee [docs](http://x)'
    expect(markdownToPlain(md)).toBe('KEY IDEA\n• 2NF removes partial dependency (p.2)\n• uses keys\nnote\n\nSee docs')
  })

  it('turns tables into lines and drops separators', () => {
    expect(markdownToPlain('| Term | Meaning |\n|---|---|\n| 1NF | atomic |')).toBe('Term  -  Meaning\n1NF  -  atomic')
  })

  it('keeps snake_case and maths content', () => {
    expect(markdownToPlain('roll_no and $a \\to b$')).toBe('roll_no and a \\to b')
  })
})

describe('linkifyPageRefs', () => {
  it('links page markers once', () => {
    expect(linkifyPageRefs('see [p.3] and [P. 12]')).toBe('see [p.3](#page-3) and [p.12](#page-12)')
    expect(linkifyPageRefs('[p.3](#page-3)')).toBe('[p.3](#page-3)')
  })
})

describe('inserting AI text', () => {
  const long = Array.from({ length: 120 }, (_, i) => `line ${i}`).join('\n')

  it('paginates long text across pages', () => {
    const chunks = paginate(long, PAGE_MARGIN_TOP, measure)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join('\n').split('\n').length).toBe(120)
  })

  it('places text below existing notes without touching them', () => {
    const existing = [makeTextBlock('old notes', PAGE_MARGIN_TOP)]
    const result = placeBelow(existing, 'new idea', measure)
    expect(result.currentPage?.[0]).toBe(existing[0])
    expect(result.currentPage?.length).toBe(2)
    expect(result.overflow).toEqual([])
  })

  it('overflows to new pages when the page is full', () => {
    const full = [makeTextBlock('x', PAGE_HEIGHT - 150)]
    const result = placeBelow(full, 'new idea', measure)
    expect(result.currentPage).toBeNull()
    expect(result.overflow).toEqual(['new idea'])
    expect(pagesFor(['a', 'b'], 'Summary').map((p) => p.title)).toEqual(['Summary (1)', 'Summary (2)'])
  })
})

describe('parseServerDate', () => {
  it('handles Z, offsets and offset-less UTC timestamps alike', async () => {
    const { parseServerDate } = await import('./format')
    const expected = Date.UTC(2026, 9, 11, 10, 0, 0)
    expect(parseServerDate('2026-10-11T10:00:00Z')).toBe(expected)
    expect(parseServerDate('2026-10-11T10:00:00+00:00')).toBe(expected)
    expect(parseServerDate('2026-10-11T10:00:00')).toBe(expected)
    expect(parseServerDate('2026-10-11T15:30:00+05:30')).toBe(expected)
  })
})

describe('parseHash', () => {
  it('routes the library, notebooks and the sign-in screens', () => {
    expect(parseHash('')).toEqual({ name: 'home' })
    expect(parseHash('#/')).toEqual({ name: 'home' })
    expect(parseHash('#/p/abc123')).toEqual({ name: 'project', projectId: 'abc123' })
    expect(parseHash('#/login')).toEqual({ name: 'login' })
    expect(parseHash('#/signup')).toEqual({ name: 'signup' })
  })
})
