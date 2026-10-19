import { reactive } from 'vue'

export type ToastTone = 'info' | 'success' | 'warn' | 'error'

export interface ToastItem {
  id: number
  message: string
  tone: ToastTone
}

export const toasts = reactive<ToastItem[]>([])

let seq = 0

export function pushToast(message: string, tone: ToastTone = 'info', duration = 2200): void {
  const id = ++seq
  toasts.push({ id, message, tone })
  window.setTimeout(() => dismissToast(id), duration)
}

export function dismissToast(id: number): void {
  const index = toasts.findIndex((item) => item.id === id)
  if (index >= 0) toasts.splice(index, 1)
}
