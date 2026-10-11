import { AlertTriangle, BookMarked, CheckCircle2, Globe2, HelpCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'

import type { Grounding } from '../../api/types'
import { linkifyPageRefs } from '../../lib/markdown'
import { useProjectStore } from '../../store/projectStore'

/** Jump to page N (1-based) and scroll the page into view. */
export function goToPage(number: number): void {
  const store = useProjectStore.getState()
  const page = store.pages[number - 1]
  if (!page) return
  store.setCurrentPage(page.id)
  document.getElementById('page-scroll')?.scrollTo({ top: 0, behavior: 'smooth' })
}

export function PageCite({ number }: { number: number }) {
  const title = useProjectStore((s) => s.pages[number - 1]?.title)
  return (
    <button className="cite" onClick={() => goToPage(number)} title={title ? `Go to page ${number}: ${title}` : `Page ${number}`}>
      p.{number}
    </button>
  )
}

/** AI markdown. react-markdown never renders raw HTML, so model output can't inject markup. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="prose-note">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          // Never load remote images from AI output: a crafted note could leak data via the URL.
          img: () => null,
          a: ({ href, children }) => {
            const match = /^#page-(\d+)$/.exec(href ?? '')
            if (match) return <PageCite number={Number(match[1])} />
            return (
              <a href={href} target="_blank" rel="noreferrer noopener" className="text-pen underline underline-offset-2">
                {children}
              </a>
            )
          },
        }}
      >
        {linkifyPageRefs(text)}
      </ReactMarkdown>
    </div>
  )
}

const BADGES: Record<Grounding, { label: string; icon: typeof CheckCircle2; className: string }> = {
  grounded: { label: 'From your notes', icon: CheckCircle2, className: 'bg-grounded-soft text-grounded' },
  partial: { label: 'Partly covered', icon: AlertTriangle, className: 'bg-partial-soft text-partial' },
  not_in_notes: { label: 'Not covered in your notes', icon: HelpCircle, className: 'bg-missing-soft text-missing' },
  general: { label: 'Outside your notes · general knowledge', icon: Globe2, className: 'bg-general-soft text-general' },
}

export function GroundingBadge({ grounding }: { grounding: Grounding }) {
  const { label, icon: Icon, className } = BADGES[grounding]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.72rem] font-bold ${className}`}>
      <Icon size={13} /> {label}
    </span>
  )
}

export function UnreadWarning({ pages }: { pages: number[] }) {
  if (!pages.length) return null
  return (
    <p className="mt-2 flex items-start gap-1.5 text-[0.72rem] text-partial">
      <BookMarked size={13} className="mt-0.5 shrink-0" />
      The AI couldn't read the latest handwriting on {pages.map((n) => `p.${n}`).join(', ')}; it used the typed text there.
    </p>
  )
}

interface SegmentedProps<T extends string> {
  value: T
  options: { value: T; label: ReactNode; disabled?: boolean; title?: string }[]
  onChange: (value: T) => void
  label: string
}

export function Segmented<T extends string>({ value, options, onChange, label }: SegmentedProps<T>) {
  return (
    <div className="flex rounded-xl bg-desk-deep/70 p-1" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-bold transition disabled:opacity-40 ${
            value === o.value ? 'bg-paper text-ink shadow-[0_1px_3px_rgba(31,42,68,0.18)]' : 'text-ink-soft hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rise rounded-2xl border border-line bg-paper p-4 shadow-[0_1px_2px_rgba(31,42,68,0.06)] ${className}`}>{children}</div>
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="px-4 py-8 text-center">
      <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-2xl bg-paper text-pen shadow-lift">{icon}</div>
      <p className="font-display text-lg font-semibold">{title}</p>
      <div className="mx-auto mt-1 max-w-[280px] text-sm leading-relaxed text-ink-soft">{children}</div>
    </div>
  )
}

export function Thinking({ label }: { label: string }) {
  return (
    <Card>
      <p className="mb-3 text-xs font-bold text-ink-soft">{label}</p>
      <div className="skeleton mb-2 h-3 w-11/12" />
      <div className="skeleton mb-2 h-3 w-4/5" />
      <div className="skeleton h-3 w-3/5" />
    </Card>
  )
}
