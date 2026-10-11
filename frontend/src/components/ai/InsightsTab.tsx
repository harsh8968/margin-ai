import { BarChart3, Compass, Layers, ListChecks, MessageSquareText } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api, errorMessage } from '../../api/client'
import type { Insights, Recommendations } from '../../api/types'
import { percent } from '../../lib/format'
import { prepareScope, useAiStore } from '../../store/aiStore'
import { useProjectStore } from '../../store/projectStore'
import { toastError } from '../../store/toastStore'
import { Spinner } from '../ui/Toasts'
import { MasteryBar } from './QuizTab'
import { Card, EmptyState, PageCite } from './shared'

/** Personalised learning (doc B5): weak spots from quiz history, plus an AI study plan. */
export function InsightsTab() {
  const project = useProjectStore((s) => s.project)
  const [insights, setInsights] = useState<Insights | null>(null)
  const [plan, setPlan] = useState<Recommendations | null>(null)
  const [planning, setPlanning] = useState(false)
  const request = useAiStore((s) => s.request)

  useEffect(() => {
    if (!project) return
    api.insights(project.id).then(setInsights).catch((error: unknown) => toastError(errorMessage(error)))
  }, [project])

  const makePlan = async () => {
    setPlanning(true)
    try {
      const args = await prepareScope('project')
      if (args) setPlan(await api.recommend(args.project_id, args.page_id))
    } catch (error) {
      toastError(errorMessage(error))
    } finally {
      setPlanning(false)
    }
  }

  if (!insights) return <div className="skeleton h-40" />

  const weakNames = insights.weak_topics.map((t) => t.topic).slice(0, 10)

  return (
    <div className="space-y-4">
      {insights.total_answers === 0 ? (
        <EmptyState icon={<BarChart3 size={20} />} title="No quiz history yet">
          Take a quiz and this tab will track your accuracy per topic, find weak spots, and adapt future quizzes.
        </EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Accuracy" value={insights.overall_accuracy === null ? '-' : percent(insights.overall_accuracy)} />
            <Stat label="Answers" value={String(insights.total_answers)} />
            <Stat label="Cards due" value={String(insights.flashcards.due)} />
          </div>

          {insights.recent_quizzes.length > 1 && (
            <Card>
              <p className="eyebrow mb-2">Recent quizzes</p>
              <Sparkline values={insights.recent_quizzes.map((q) => q.score)} />
            </Card>
          )}

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <p className="eyebrow">Topics, weakest first</p>
            </div>
            <div className="space-y-3">
              {insights.topics.map((t) => (
                <div key={t.topic}>
                  <MasteryBar label={t.topic} value={t.accuracy} detail={`${t.attempts} answered`} />
                  <div className="mt-1 flex items-center gap-1 text-[0.68rem] text-ink-faint">
                    {t.source_pages.map((n) => (
                      <PageCite key={n} number={n} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {weakNames.length > 0 && (
            <Card className="border-missing/30 bg-missing-soft/40">
              <p className="text-sm font-bold text-missing">Your weak spots: {weakNames.join(', ')}</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button className="btn btn-pen text-xs" onClick={() => request({ tab: 'quiz', kind: 'quiz', topics: weakNames })}>
                  <ListChecks size={14} /> Quiz me on these
                </button>
                <button className="btn btn-outline text-xs" onClick={() => request({ tab: 'cards', kind: 'cards', topics: weakNames })}>
                  <Layers size={14} /> Make flashcards
                </button>
              </div>
            </Card>
          )}
        </>
      )}

      <button className="btn btn-ink w-full" onClick={makePlan} disabled={planning}>
        {planning ? <Spinner /> : <Compass size={15} />} {plan ? 'Refresh my study plan' : 'What should I revise next?'}
      </button>

      {plan && (
        <div className="space-y-3">
          {plan.recommendations.map((rec, i) => (
            <Card key={rec.topic}>
              <div className="flex items-start gap-3">
                <span className="font-display text-2xl font-semibold leading-none text-pen">{i + 1}</span>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-bold">{rec.topic}</p>
                  <p className="mt-0.5 text-ink-soft">{rec.why}</p>
                  <p className="mt-1.5 text-ink">→ {rec.action}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {rec.pages.map((p) => (
                      <PageCite key={p.page_id} number={p.page} />
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          ))}
          {plan.practice_questions.length > 0 && (
            <Card>
              <p className="eyebrow mb-2">Practice questions</p>
              <ul className="space-y-1.5">
                {plan.practice_questions.map((q) => (
                  <li key={q}>
                    <button className="group flex w-full items-start gap-2 text-left text-sm hover:text-pen" onClick={() => request({ tab: 'ask', kind: 'ask', text: q })}>
                      <MessageSquareText size={14} className="mt-0.5 shrink-0 text-ink-faint group-hover:text-pen" />
                      {q}
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-paper px-3 py-3 text-center shadow-[0_1px_2px_rgba(31,42,68,0.08)]">
      <div className="font-display text-2xl font-semibold leading-none">{value}</div>
      <div className="mt-1.5 text-[0.62rem] font-bold uppercase tracking-wider text-ink-faint">{label}</div>
    </div>
  )
}

function Sparkline({ values }: { values: number[] }) {
  const w = 300
  const h = 56
  const step = w / Math.max(1, values.length - 1)
  const points = values.map((v, i) => [i * step, h - 6 - v * (h - 12)] as const)
  const path = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`-4 0 ${w + 8} ${h}`} className="h-14 w-full" role="img" aria-label={`Scores: ${values.map(percent).join(', ')}`}>
      <line x1="0" x2={w} y1={h - 6 - 0.8 * (h - 12)} y2={h - 6 - 0.8 * (h - 12)} stroke="currentColor" className="text-grounded/30" strokeDasharray="4 4" />
      <path d={path} fill="none" stroke="currentColor" className="text-ink" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {points.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i === points.length - 1 ? 4.5 : 3} className={i === points.length - 1 ? 'fill-pen' : 'fill-ink'} />
      ))}
    </svg>
  )
}
