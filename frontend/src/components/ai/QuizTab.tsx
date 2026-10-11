import { ArrowRight, Check, Gauge, ListChecks, RotateCcw, Sparkles, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { api, errorMessage } from '../../api/client'
import type { AnswerResult, Difficulty, QuestionType, Quiz, Scope } from '../../api/types'
import { percent } from '../../lib/format'
import { prepareScope, useAiStore } from '../../store/aiStore'
import { toastError } from '../../store/toastStore'
import { Spinner } from '../ui/Toasts'
import { Card, EmptyState, PageCite, Segmented, Thinking, UnreadWarning } from './shared'
import { scopeWords, useEffectiveScope } from './useScope'

const TYPE_LABELS: Record<QuestionType, string> = { mcq: 'Multiple choice', tf: 'True / false', short: 'Short answer' }
const DIFFICULTY_STARS = ['', '●○○', '●●○', '●●●']

export function QuizTab() {
  const scope = useEffectiveScope()
  const pending = useAiStore((s) => s.pending)
  const [count, setCount] = useState('5')
  const [types, setTypes] = useState<QuestionType[]>(['mcq', 'tf', 'short'])
  const [difficulty, setDifficulty] = useState<Difficulty>('medium')
  const [focus, setFocus] = useState<string[]>([])
  const [quiz, setQuiz] = useState<Quiz | null>(null)
  const [busy, setBusy] = useState(false)

  const generate = useCallback(
    async (genScope: Scope, genDifficulty: Difficulty, focusTopics: string[]) => {
      setBusy(true)
      setQuiz(null)
      try {
        const args = await prepareScope(genScope)
        if (!args) return
        setQuiz(await api.quiz({ ...args, count: Number(count), types, difficulty: genDifficulty, focus_topics: focusTopics }))
      } catch (error) {
        toastError(errorMessage(error))
      } finally {
        setBusy(false)
      }
    },
    [count, types],
  )

  useEffect(() => {
    if (!pending) return
    const action = useAiStore.getState().take('quiz')
    if (!action) return
    if (action.topics?.length) {
      // From Insights: "quiz me on my weak topics", adaptive over the whole project.
      setFocus(action.topics)
      setDifficulty('adaptive')
      void generate('project', 'adaptive', action.topics)
    } else {
      void generate('selection', difficulty, [])
    }
  }, [pending, generate, difficulty])

  const toggleType = (t: QuestionType) =>
    setTypes((current) => (current.includes(t) ? (current.length > 1 ? current.filter((x) => x !== t) : current) : [...current, t]))

  if (busy) return <Thinking label={`Writing questions from ${scopeWords(scope)}…`} />
  if (quiz) return <QuizRunner quiz={quiz} onDone={() => setQuiz(null)} onAgain={() => void generate(scope, 'adaptive', [])} />

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="eyebrow">Questions</p>
        <Segmented label="Number of questions" value={count} onChange={setCount} options={['5', '10', '15'].map((v) => ({ value: v, label: v }))} />
      </div>
      <div className="space-y-2">
        <p className="eyebrow">Types</p>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(TYPE_LABELS) as QuestionType[]).map((t) => (
            <button key={t} className="chip" data-on={types.includes(t)} onClick={() => toggleType(t)} aria-pressed={types.includes(t)}>
              {types.includes(t) && <Check size={12} />} {TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <p className="eyebrow">Difficulty</p>
        <Segmented
          label="Difficulty"
          value={difficulty}
          onChange={setDifficulty}
          options={[
            { value: 'easy', label: 'Easy' },
            { value: 'medium', label: 'Medium' },
            { value: 'hard', label: 'Hard' },
            { value: 'adaptive', label: (<><Gauge size={12} /> Adaptive</>), title: 'Adjusts to your past answers and targets weak topics' },
          ]}
        />
        {difficulty === 'adaptive' && (
          <p className="text-[0.72rem] leading-snug text-ink-faint">
            Steps up after strong answers, eases off after weak ones, and puts most questions on your weakest topics.
          </p>
        )}
      </div>
      {focus.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-ink-faint">Focus:</span>
          {focus.map((t) => (
            <span key={t} className="chip">
              {t}
            </span>
          ))}
          <button className="text-ink-faint underline" onClick={() => setFocus([])}>
            clear
          </button>
        </div>
      )}
      <button className="btn btn-pen w-full" onClick={() => void generate(scope, difficulty, focus)}>
        <ListChecks size={15} /> Quiz me on {scopeWords(scope)}
      </button>
      <EmptyState icon={<ListChecks size={20} />} title="Practice that sticks">
        Every question comes from your own notes and points to the page that answers it.
      </EmptyState>
    </div>
  )
}

function QuizRunner({ quiz, onDone, onAgain }: { quiz: Quiz; onDone: () => void; onAgain: () => void }) {
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<number, AnswerResult>>({})
  const [choice, setChoice] = useState('')
  const [checking, setChecking] = useState(false)
  const question = quiz.questions[index]
  const result = question ? answers[question.index] : undefined
  const finished = index >= quiz.questions.length

  const submit = async () => {
    if (!question || !choice.trim()) return
    setChecking(true)
    try {
      const res = await api.answer(quiz.quiz_id, question.index, choice)
      setAnswers((a) => ({ ...a, [question.index]: res }))
    } catch (error) {
      toastError(errorMessage(error))
    } finally {
      setChecking(false)
    }
  }

  const next = () => {
    setChoice('')
    setIndex((i) => i + 1)
  }

  if (finished) {
    const results = Object.values(answers)
    const score = results.reduce((sum, r) => sum + r.score, 0) / Math.max(1, results.length)
    const byTopic = new Map<string, { total: number; score: number }>()
    quiz.questions.forEach((q) => {
      const r = answers[q.index]
      if (!r) return
      const entry = byTopic.get(q.topic) ?? { total: 0, score: 0 }
      byTopic.set(q.topic, { total: entry.total + 1, score: entry.score + r.score })
    })
    return (
      <div className="space-y-4">
        <Card className="text-center">
          <p className="eyebrow">Quiz complete</p>
          <p className="mt-2 font-display text-5xl font-semibold">{percent(score)}</p>
          <p className="mt-1 text-sm text-ink-soft">
            {results.filter((r) => r.correct).length} of {results.length} correct · {quiz.difficulty}
          </p>
        </Card>
        <Card>
          <p className="eyebrow mb-3">By topic</p>
          <div className="space-y-2.5">
            {[...byTopic.entries()].map(([topic, { total, score: s }]) => (
              <MasteryBar key={topic} label={topic} value={s / total} detail={`${total} q`} />
            ))}
          </div>
        </Card>
        <div className="grid grid-cols-2 gap-2">
          <button className="btn btn-outline" onClick={onDone}>
            <RotateCcw size={15} /> New quiz
          </button>
          <button className="btn btn-pen" onClick={onAgain}>
            <Sparkles size={15} /> Adaptive round
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {quiz.adaptive_reason && <p className="rounded-xl bg-general-soft px-3 py-2 text-xs text-general">{quiz.adaptive_reason}</p>}
      <div className="flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-desk-deep">
          <div className="h-full rounded-full bg-pen transition-all duration-500" style={{ width: `${(index / quiz.questions.length) * 100}%` }} />
        </div>
        <span className="text-xs font-bold tabular-nums text-ink-soft">
          {index + 1}/{quiz.questions.length}
        </span>
      </div>

      <Card key={question.index}>
        <div className="mb-2 flex items-center justify-between text-[0.7rem] font-bold text-ink-faint">
          <span>
            {TYPE_LABELS[question.type]} · {question.topic}
          </span>
          <span title={`Difficulty ${question.difficulty}/3`} className="tracking-widest text-pen">
            {DIFFICULTY_STARS[question.difficulty]}
          </span>
        </div>
        <p className="font-display text-[1.08rem] font-medium leading-snug">{question.question}</p>

        <div className="mt-4">
          {question.type === 'short' ? (
            <textarea
              className="field min-h-24 text-sm"
              placeholder="Write your answer in a sentence or two…"
              value={choice}
              disabled={!!result}
              onChange={(e) => setChoice(e.target.value)}
            />
          ) : (
            <div className="grid gap-2">
              {question.options.map((option, i) => {
                const picked = choice === option
                const isAnswer = result && result.correct_answer === option
                const wrongPick = result && picked && !result.correct
                return (
                  <button
                    key={option}
                    disabled={!!result}
                    onClick={() => setChoice(option)}
                    className={`flex items-center gap-3 rounded-xl border-[1.5px] px-3 py-2.5 text-left text-sm transition ${
                      isAnswer
                        ? 'border-grounded bg-grounded-soft'
                        : wrongPick
                          ? 'border-missing bg-missing-soft'
                          : picked
                            ? 'border-ink bg-paper'
                            : 'border-line bg-paper hover:border-ink-soft'
                    }`}
                  >
                    <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[0.7rem] font-bold ${picked ? 'bg-ink text-paper' : 'bg-desk-deep text-ink-soft'}`}>
                      {question.type === 'tf' ? option[0] : String.fromCharCode(65 + i)}
                    </span>
                    {option}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {result && (
          <div className={`rise mt-4 rounded-xl p-3 text-sm ${result.correct ? 'bg-grounded-soft' : result.verdict === 'partial' ? 'bg-partial-soft' : 'bg-missing-soft'}`}>
            <p className={`flex items-center gap-1.5 font-bold ${result.correct ? 'text-grounded' : result.verdict === 'partial' ? 'text-partial' : 'text-missing'}`}>
              {result.correct ? <Check size={15} /> : <X size={15} />}
              {result.correct ? 'Correct' : result.verdict === 'partial' ? `Partly right (${percent(result.score)})` : 'Not quite'}
            </p>
            <p className="mt-1 text-ink-soft">{result.feedback}</p>
            {question.type === 'short' && (
              <p className="mt-2 text-ink-soft">
                <strong className="text-ink">Model answer:</strong> {result.correct_answer}
              </p>
            )}
            {result.missing_points.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-ink-soft">
                {result.missing_points.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            )}
            <p className="mt-2 flex items-center gap-1 text-xs text-ink-soft">
              {result.explanation} <PageCite number={result.source_page} />
            </p>
          </div>
        )}
      </Card>

      {result ? (
        <button className="btn btn-ink w-full" onClick={next}>
          {index + 1 === quiz.questions.length ? 'See results' : 'Next question'} <ArrowRight size={15} />
        </button>
      ) : (
        <button className="btn btn-pen w-full" onClick={submit} disabled={!choice.trim() || checking}>
          {checking ? <Spinner /> : <Check size={15} />} {question.type === 'short' ? 'Check my answer' : 'Submit'}
        </button>
      )}
      <UnreadWarning pages={quiz.unread_pages} />
    </div>
  )
}

export function MasteryBar({ label, value, detail }: { label: string; value: number; detail?: string }) {
  const tone = value >= 0.8 ? 'bg-grounded' : value >= 0.5 ? 'bg-partial' : 'bg-missing'
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
        <span className="truncate font-bold">{label}</span>
        <span className="shrink-0 tabular-nums text-ink-faint">
          {percent(value)}
          {detail ? ` · ${detail}` : ''}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-desk-deep">
        <div className={`h-full rounded-full ${tone} transition-all duration-700`} style={{ width: `${Math.max(4, value * 100)}%` }} />
      </div>
    </div>
  )
}
