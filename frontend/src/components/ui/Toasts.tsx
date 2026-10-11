import { AlertTriangle, Check, Info } from 'lucide-react'

import { useToasts } from '../../store/toastStore'

const ICONS = { info: Info, error: AlertTriangle, success: Check }

export function Toasts() {
  const { toasts, dismiss } = useToasts()
  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2" aria-live="polite">
      {toasts.map((t) => {
        const Icon = ICONS[t.tone]
        return (
          <div
            key={t.id}
            className={`rise pointer-events-auto flex max-w-[520px] items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium shadow-tool ${
              t.tone === 'error' ? 'bg-pen text-white' : 'bg-ink text-paper'
            }`}
          >
            <Icon size={16} className="shrink-0" />
            <span>{t.message}</span>
            {t.action && (
              <button
                className="ml-1 rounded-md px-2 py-0.5 font-bold text-highlight underline-offset-2 hover:underline"
                onClick={() => {
                  t.action?.run()
                  dismiss(t.id)
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      className="inline-block animate-spin rounded-full border-2 border-current border-r-transparent"
      style={{ width: size, height: size }}
      aria-hidden
    />
  )
}
