import { ref } from 'vue'
import { readString, STORAGE_KEYS, writeString } from './storage'

export type Theme = 'dark' | 'light'

const stored = readString(STORAGE_KEYS.theme)
const prefersLight = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches

export const theme = ref<Theme>(stored === 'light' || stored === 'dark' ? stored : prefersLight ? 'light' : 'dark')

export function applyTheme(): void {
  document.documentElement.dataset.theme = theme.value
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', theme.value === 'dark' ? '#0a0d0b' : '#f4f6ef')
}

export function setTheme(next: Theme): void {
  theme.value = next
  writeString(STORAGE_KEYS.theme, next)
  applyTheme()
}

export function toggleTheme(): void {
  setTheme(theme.value === 'dark' ? 'light' : 'dark')
}
