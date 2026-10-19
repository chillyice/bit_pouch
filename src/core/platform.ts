import { computed } from 'vue'

export type ShellKind = 'web' | 'desktop' | 'mobile'

/**
 * Tauri 2 会在 WebView 中注入 __TAURI_INTERNALS__。
 * 桌面/移动端只影响外壳能力（全局快捷键、窗口），工具逻辑保持一致。
 */
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export const shellKind = computed<ShellKind>(() => {
  if (!isTauri) return 'web'
  const ua = navigator.userAgent.toLowerCase()
  return /android|iphone|ipad|ipod/.test(ua) ? 'mobile' : 'desktop'
})
