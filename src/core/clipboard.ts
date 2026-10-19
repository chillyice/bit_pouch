import { t } from './i18n'
import { pushToast } from './toast'

/**
 * WebView / 非安全上下文下 navigator.clipboard 可能不可用，
 * 这里保留一个 textarea + execCommand 的兜底路径。
 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      pushToast(t('action.copied'), 'success')
      return true
    }
  } catch {
    // fall through
  }

  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    pushToast(ok ? t('action.copied') : t('action.copyFailed'), ok ? 'success' : 'error')
    return ok
  } catch {
    pushToast(t('action.copyFailed'), 'error')
    return false
  }
}
