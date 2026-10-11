import { useAiStore } from '../../store/aiStore'

/** Honest indicator of which AI is answering: the real model, the mock, or nothing. */
export function AiStatus({ compact = false }: { compact?: boolean }) {
  const health = useAiStore((s) => s.health)
  let tone = 'bg-missing'
  let label = 'Backend offline'
  let detail = 'Start the API on port 8000.'
  if (health) {
    if (health.llm === 'mock') {
      tone = 'bg-partial'
      label = 'Mock AI'
      detail = 'Keyword-matching stand-in. Set LLM_PROVIDER=gemini for real answers.'
    } else if (health.ai_configured) {
      tone = 'bg-grounded'
      label = health.model ?? health.llm
      detail = 'Vision + grounded answers ready.'
    } else {
      tone = 'bg-missing'
      label = 'AI not configured'
      detail = 'Add GEMINI_API_KEY to backend/.env and restart.'
    }
  }
  if (compact) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[0.7rem] font-bold text-ink-faint" title={detail}>
        <span className={`h-2 w-2 rounded-full ${tone}`} />
        {label}
      </span>
    )
  }
  return (
    <div className="flex items-start gap-2.5 text-xs text-ink-soft">
      <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${tone}`} />
      <span>
        <strong className="text-ink">{label}</strong> · {detail}
      </span>
    </div>
  )
}
