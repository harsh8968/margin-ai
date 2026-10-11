import { create } from 'zustand'

export interface Toast {
  id: number
  message: string
  tone: 'info' | 'error' | 'success'
  action?: { label: string; run: () => void }
}

interface ToastState {
  toasts: Toast[]
  push: (message: string, options?: { tone?: Toast['tone']; action?: Toast['action']; ttl?: number }) => void
  dismiss: (id: number) => void
}

let nextId = 1

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (message, options = {}) => {
    const id = nextId++
    const toast: Toast = { id, message, tone: options.tone ?? 'info', action: options.action }
    set({ toasts: [...get().toasts.slice(-3), toast] })
    window.setTimeout(() => get().dismiss(id), options.ttl ?? (options.action ? 6000 : 4000))
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}))

export const toast = (message: string, options?: Parameters<ToastState['push']>[1]) => useToasts.getState().push(message, options)
export const toastError = (message: string) => useToasts.getState().push(message, { tone: 'error', ttl: 6000 })
