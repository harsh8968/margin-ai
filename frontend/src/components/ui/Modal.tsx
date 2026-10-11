import { X } from 'lucide-react'
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}

export function Modal({ title, onClose, children, footer, wide = false }: ModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Portal to <body>: an ancestor with backdrop-filter would otherwise trap `position: fixed`.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/35 p-6 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`rise flex max-h-[88vh] w-full flex-col overflow-hidden rounded-2xl bg-paper shadow-page ${wide ? 'max-w-5xl' : 'max-w-md'}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 className="font-display text-xl font-semibold">{title}</h2>
          <button className="btn btn-ghost -mr-2 p-2" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-card px-6 py-4">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}

interface ConfirmProps {
  title: string
  message: ReactNode
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ title, message, confirmLabel, danger = false, onConfirm, onCancel }: ConfirmProps) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className={`btn ${danger ? 'btn-pen' : 'btn-ink'}`} onClick={onConfirm} autoFocus>
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-[0.95rem] leading-relaxed text-ink-soft">{message}</div>
    </Modal>
  )
}
