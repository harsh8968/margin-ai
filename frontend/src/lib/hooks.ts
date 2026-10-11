import { useEffect, useState } from 'react'

import { invalidateTextLayouts } from '../canvas/textLayout'
import { TEXT_FONT_FAMILY } from '../canvas/types'

export type Route = { name: 'home' } | { name: 'login' } | { name: 'signup' } | { name: 'project'; projectId: string }

export function parseHash(hash: string): Route {
  const match = /^#\/p\/([\w-]+)/.exec(hash)
  if (match) return { name: 'project', projectId: match[1] }
  if (/^#\/login\b/.test(hash)) return { name: 'login' }
  if (/^#\/signup\b/.test(hash)) return { name: 'signup' }
  return { name: 'home' }
}

/** Tiny hash router: #/ is the library, #/p/<id> opens a notebook, #/login and #/signup sign in. */
export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export const navigate = (route: Route): void => {
  window.location.hash = route.name === 'project' ? `#/p/${route.projectId}` : route.name === 'home' ? '#/' : `#/${route.name}`
}

let fontsPromise: Promise<void> | null = null

/** Canvas text must be measured with the real font, so wait for it before laying out. */
export function useFontsReady(): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    fontsPromise ??= Promise.all([
      document.fonts.load(`28px ${TEXT_FONT_FAMILY}`),
      document.fonts.load(`700 28px ${TEXT_FONT_FAMILY}`),
    ])
      .then(() => invalidateTextLayouts())
      .catch(() => undefined)
    let alive = true
    void fontsPromise.then(() => alive && setReady(true))
    return () => {
      alive = false
    }
  }, [])
  return ready
}

/** Width of an element, kept up to date with a ResizeObserver. */
export function useElementWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(el)
    setWidth(el.getBoundingClientRect().width)
    return () => observer.disconnect()
  }, [ref])
  return width
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const list = window.matchMedia(query)
    const onChange = () => setMatches(list.matches)
    list.addEventListener('change', onChange)
    onChange()
    return () => list.removeEventListener('change', onChange)
  }, [query])
  return matches
}
