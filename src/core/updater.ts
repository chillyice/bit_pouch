import { computed, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { t } from './i18n'
import type { MessageKey } from './i18n'
import { isTauri } from './platform'
import { pushToast } from './toast'

export type UpdateSource = 'ihomy' | 'github'
export type UpdateKind = 'installed' | 'portable'

export type UpdatePhase =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'up-to-date' }
  | { phase: 'available'; version: string; notes?: string | null }
  | { phase: 'downloading'; version: string; percent?: number | null }
  | { phase: 'ready'; version: string }
  | { phase: 'installing'; version: string }
  | { phase: 'error'; code: string; detail: string }

export type UpdateStatus = { current: string; kind: UpdateKind } & UpdatePhase

export interface UpdateSettings {
  source: UpdateSource
  auto_update: boolean
}

/** Tauri 更新只在桌面端可用；Web / PWA 由站点本身更新，移动端走应用商店。 */
export const updaterAvailable =
  isTauri && !/android|iphone|ipad|ipod/i.test(navigator.userAgent)

export const updateStatus = ref<UpdateStatus | null>(null)
export const updateSettings = ref<UpdateSettings>({ source: 'ihomy', auto_update: false })
export const updateReady = ref(false)

export const updateBusy = computed(() => {
  const phase = updateStatus.value?.phase
  return phase === 'checking' || phase === 'downloading' || phase === 'installing'
})

const ERROR_KEYS: Record<string, MessageKey> = {
  timeout: 'settings.update.error.timeout',
  connect: 'settings.update.error.connect',
  network: 'settings.update.error.network',
  'release-not-found': 'settings.update.error.releaseNotFound',
  'target-not-found': 'settings.update.error.targetNotFound',
  'targets-not-found': 'settings.update.error.targetNotFound',
  'bad-manifest': 'settings.update.error.badManifest',
  'bad-version': 'settings.update.error.badVersion',
  'no-endpoint': 'settings.update.error.noEndpoint',
  'insecure-transport': 'settings.update.error.insecureTransport',
  'check-failed': 'settings.update.error.checkFailed',
  init: 'settings.update.error.init',
  signature: 'settings.update.error.signature',
  'signature-format': 'settings.update.error.signatureFormat',
  'missing-signed-version': 'settings.update.error.missingSignedVersion',
  'version-mismatch': 'settings.update.error.versionMismatch',
  'download-timeout': 'settings.update.error.downloadTimeout',
  'download-network': 'settings.update.error.downloadNetwork',
  'download-failed': 'settings.update.error.downloadFailed',
  persist: 'settings.update.error.persist',
  install: 'settings.update.error.install',
  'kind-mismatch': 'settings.update.error.kindMismatch',
  'no-package': 'settings.update.error.noPackage',
}

/** 把后端错误码翻成当前语言；`detail` 是底层原文，附在后面方便排查。 */
export function updateErrorText(code: string, detail: string): string {
  const key = ERROR_KEYS[code]
  const base = key ? t(key) : t('settings.update.error.checkFailed')
  return detail ? `${base} · ${detail}` : base
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(command, args)
}

export async function checkForUpdates(): Promise<void> {
  if (!updaterAvailable) return
  await call('check_update')
}

export async function downloadUpdate(): Promise<void> {
  if (!updaterAvailable) return
  await call('download_update')
}

export async function installUpdate(): Promise<void> {
  if (!updaterAvailable) return
  await call('install_update')
}

export async function saveUpdateSettings(next: UpdateSettings): Promise<boolean> {
  if (!updaterAvailable) return false
  try {
    updateSettings.value = await call<UpdateSettings>('set_update_settings', { settings: next })
    return true
  } catch {
    return false
  }
}

export async function setUpdateSource(source: UpdateSource): Promise<void> {
  const previous = updateSettings.value
  if (!(await saveUpdateSettings({ ...previous, source }))) {
    updateSettings.value = previous
    pushToast(t('settings.update.saveFailed'), 'error')
  }
}

export async function setAutoUpdate(enabled: boolean): Promise<void> {
  const previous = updateSettings.value
  if (!(await saveUpdateSettings({ ...previous, auto_update: enabled }))) {
    updateSettings.value = previous
    pushToast(t('settings.update.saveFailed'), 'error')
    return
  }
  // 已经发现新版本时勾上就立刻下载：否则要等下一次检查（可能一天后）才动。
  if (enabled && updateStatus.value?.phase === 'available') {
    await downloadUpdate()
  }
}

let unlisten: UnlistenFn | null = null
let initialized = false

/** 启动时读取一次状态，并订阅后端推送。重复调用无副作用。 */
export async function initUpdateBridge(): Promise<void> {
  if (!updaterAvailable || initialized) return
  initialized = true

  try {
    unlisten = await listen<UpdateStatus>('update-status', (event) => {
      const previous = updateStatus.value
      const next = event.payload
      updateStatus.value = next

      const same = (phase: UpdatePhase['phase'], version: string): boolean =>
        previous?.phase === phase && 'version' in previous && previous.version === version

      if (next.phase === 'available' && !same('available', next.version)) {
        pushToast(t('settings.update.toastAvailable', { version: next.version }), 'info', 4000)
      } else if (next.phase === 'ready' && !same('ready', next.version)) {
        pushToast(t('settings.update.toastReady', { version: next.version }), 'success', 4000)
      }
    })
  } catch {
    // 事件桥不可用不阻塞设置页：状态仍可通过 get_update_status 拉取。
  }

  try {
    const [status, settings] = await Promise.all([
      call<UpdateStatus>('get_update_status'),
      call<UpdateSettings>('get_update_settings'),
    ])
    updateStatus.value = status
    updateSettings.value = settings
    updateReady.value = true
    if (status.phase === 'ready') {
      pushToast(t('settings.update.toastReady', { version: status.version }), 'success', 4000)
    }
  } catch {
    updateReady.value = true
  }
}

export function disposeUpdateBridge(): void {
  unlisten?.()
  unlisten = null
  initialized = false
}
