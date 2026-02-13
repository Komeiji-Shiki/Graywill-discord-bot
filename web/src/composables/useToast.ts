import { reactive, readonly } from 'vue'

export type ToastLevel = 'success' | 'error' | 'warning' | 'info'

export interface ToastItem {
  id: number
  message: string
  level: ToastLevel
  duration: number
}

const state = reactive<{ items: ToastItem[] }>({ items: [] })

let nextId = 1

function addToast(message: string, level: ToastLevel = 'info', duration = 3000) {
  const id = nextId++
  state.items.push({ id, message, level, duration })
  if (duration > 0) {
    setTimeout(() => removeToast(id), duration)
  }
}

function removeToast(id: number) {
  const idx = state.items.findIndex((t) => t.id === id)
  if (idx >= 0) state.items.splice(idx, 1)
}

export function useToast() {
  return {
    items: readonly(state).items,
    remove: removeToast,
    success: (msg: string, duration?: number) => addToast(msg, 'success', duration),
    error: (msg: string, duration?: number) => addToast(msg, 'error', duration ?? 5000),
    warning: (msg: string, duration?: number) => addToast(msg, 'warning', duration),
    info: (msg: string, duration?: number) => addToast(msg, 'info', duration),
  }
}