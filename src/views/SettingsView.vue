<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Download,
  Languages,
  Monitor,
  Moon,
  RefreshCw,
  ShieldAlert,
  Smartphone,
  Sun,
  Trash2,
  Upload,
} from 'lucide-vue-next'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { locale, localized, setLocale, t } from '@/core/i18n'
import type { MessageKey } from '@/core/i18n'
import { shellKind } from '@/core/platform'
import {
  getUserPluginProblems,
  installUserPlugin,
  listUserPlugins,
  removeUserPlugin,
} from '@/core/registry'
import type { UserPluginProblem, UserPluginSummary } from '@/core/registry'
import { clearAppStorage } from '@/core/storage'
import { setTheme, theme } from '@/core/theme'
import { pushToast } from '@/core/toast'
import {
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  setAutoUpdate,
  setUpdateSource,
  updateBusy,
  updateErrorText,
  updateReady,
  updateSettings,
  updateStatus,
  updaterAvailable,
} from '@/core/updater'
import { USER_PLUGIN_EXAMPLE, USER_PLUGIN_MAX_CODE } from '@/core/userPlugins'
import { useAppStore } from '@/stores/app'

const app = useAppStore()
const appVersion = __APP_VERSION__

const themeOptions = computed(() => [
  { value: 'dark', label: t('settings.theme.dark') },
  { value: 'light', label: t('settings.theme.light') },
])
const localeOptions = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
]

const canDownloadUpdate = computed(() => updateStatus.value?.phase === 'available')
const canInstallUpdate = computed(() => updateStatus.value?.phase === 'ready')

const updateStatusText = computed(() => {
  const status = updateStatus.value
  if (!status) {
    return updateReady.value ? t('settings.update.error.init') : t('common.loading')
  }
  const current = status.current
  switch (status.phase) {
    case 'idle':
      return t('settings.update.status.idle', { version: current })
    case 'checking':
      return t('settings.update.status.checking', { version: current })
    case 'up-to-date':
      return t('settings.update.status.upToDate', { version: current })
    case 'available':
      return t('settings.update.status.available', { version: status.version, current })
    case 'downloading': {
      const percent =
        status.percent === null || status.percent === undefined ? '' : ` ${Math.round(status.percent)}%`
      return t('settings.update.status.downloading', { version: status.version, percent })
    }
    case 'ready':
      return t(
        updateSettings.value.auto_update
          ? 'settings.update.status.readyAuto'
          : 'settings.update.status.ready',
        { version: status.version },
      )
    case 'installing':
      return t('settings.update.status.installing', { version: status.version })
    case 'error':
      return t('settings.update.status.error', {
        message: updateErrorText(status.code, status.detail),
      })
    default:
      return t('settings.update.status.idle', { version: current })
  }
})

function onUpdateSourceChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  void setUpdateSource(value === 'github' ? 'github' : 'ihomy')
}

function toggleAutoUpdate(): void {
  void setAutoUpdate(!updateSettings.value.auto_update)
}

const plugins = ref<UserPluginSummary[]>(listUserPlugins())
const problems = ref<UserPluginProblem[]>(getUserPluginProblems())
const pluginError = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

const PLUGIN_ERROR_KEYS: Record<string, MessageKey> = {
  PLUGIN_SYNTAX: 'userPlugin.error.PLUGIN_SYNTAX',
  PLUGIN_EVAL: 'userPlugin.error.PLUGIN_EVAL',
  PLUGIN_EXPORT: 'userPlugin.error.PLUGIN_EXPORT',
  PLUGIN_MANIFEST: 'userPlugin.error.PLUGIN_MANIFEST',
  PLUGIN_RUN: 'userPlugin.error.PLUGIN_RUN',
  PLUGIN_ID_CONFLICT: 'userPlugin.error.PLUGIN_ID_CONFLICT',
  PLUGIN_TOO_LARGE: 'userPlugin.error.PLUGIN_TOO_LARGE',
  PLUGIN_LIMIT: 'userPlugin.error.PLUGIN_LIMIT',
  PLUGIN_RESULT: 'userPlugin.error.PLUGIN_RESULT',
  PLUGIN_LOAD: 'userPlugin.error.PLUGIN_LOAD',
  PLUGIN_STORAGE: 'userPlugin.error.PLUGIN_STORAGE',
}

function setThemeValue(value: string): void {
  setTheme(value === 'light' ? 'light' : 'dark')
}

function setLocaleValue(value: string): void {
  setLocale(value === 'en' ? 'en' : 'zh')
}

function clearRecent(): void {
  app.clearRecentTools()
  pushToast(t('settings.cleared'), 'success')
}

function clearAll(): void {
  clearAppStorage()
  window.location.reload()
}

function refreshPlugins(): void {
  plugins.value = listUserPlugins()
  problems.value = getUserPluginProblems()
}

function describePluginError(error: { code: string; message: string }): string {
  const key = PLUGIN_ERROR_KEYS[error.code]
  return key ? `${t(key)} · ${error.message}` : `${error.code} · ${error.message}`
}

function installPlugin(code: string): void {
  const result = installUserPlugin(code)
  if (!result.ok) {
    pluginError.value = result.error ? describePluginError(result.error) : t('settings.pluginError')
    return
  }

  pluginError.value = ''
  refreshPlugins()
  pushToast(t('settings.pluginInstalled'), 'success')
}

function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/javascript;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function downloadExample(): void {
  downloadText('bit_pouch-plugin-example.js', USER_PLUGIN_EXAMPLE)
}

function deletePlugin(id: string): void {
  if (!window.confirm(t('settings.deletePluginConfirm'))) return
  const result = removeUserPlugin(id)
  if (result === 'not_found') return
  if (result === 'storage') {
    pluginError.value = t('userPlugin.error.PLUGIN_STORAGE')
    return
  }

  pluginError.value = ''
  refreshPlugins()
  pushToast(t('settings.pluginRemoved'), 'success')
}

function exportPlugin(plugin: UserPluginSummary): void {
  downloadText(`${plugin.id}.js`, plugin.code)
}

function pickFile(): void {
  fileInput.value?.click()
}

async function onFileChange(event: Event): Promise<void> {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  target.value = ''
  if (!file) return

  if (file.size > USER_PLUGIN_MAX_CODE) {
    pluginError.value = describePluginError({
      code: 'PLUGIN_TOO_LARGE',
      message: `${file.size} bytes`,
    })
    return
  }

  installPlugin(await file.text())
}
</script>

<template>
  <div class="page">
    <h1>{{ t('settings.title') }}</h1>
    <p class="sub">{{ t('app.tagline') }}</p>

    <div class="settings-grid">
      <section class="settings-card">
        <h2>{{ t('settings.appearance') }}</h2>
        <p class="hint">{{ t('settings.theme') }}</p>
        <div class="settings-row">
          <span class="label"><Sun v-if="theme === 'dark'" :size="14" /> <Moon v-else :size="14" /> {{ t('settings.theme') }}</span>
          <SegmentedControl
            :model-value="theme"
            :options="themeOptions"
            accent
            @update:model-value="setThemeValue"
          />
        </div>
        <div class="settings-row">
          <span class="label"><Languages :size="14" /> {{ t('settings.language') }}</span>
          <SegmentedControl :model-value="locale" :options="localeOptions" @update:model-value="setLocaleValue" />
        </div>
      </section>

      <section class="settings-card">
        <h2>{{ t('settings.privacy') }}</h2>
        <p class="hint">{{ t('settings.privacyText') }}</p>
        <div class="settings-row">
          <span class="label">{{ t('settings.data') }}</span>
          <button type="button" class="btn btn-sm" @click="clearRecent">{{ t('settings.clearRecent') }}</button>
        </div>
        <div class="settings-row">
          <span class="label">{{ t('settings.clearAll') }}</span>
          <button type="button" class="btn btn-danger btn-sm" @click="clearAll">{{ t('settings.clearAll') }}</button>
        </div>
      </section>

      <section class="settings-card">
        <h2>{{ t('settings.shortcuts') }}</h2>
        <p class="hint">{{ t('settings.shortcutPalette') }}</p>
        <ul class="shortcut-list">
          <li>
            <span>{{ t('settings.shortcutPalette') }}</span>
            <span class="keys"><kbd>Ctrl</kbd><kbd>K</kbd></span>
          </li>
          <li>
            <span>{{ t('settings.shortcutRun') }}</span>
            <span class="keys"><kbd>Ctrl</kbd><kbd>Enter</kbd></span>
          </li>
          <li>
            <span>{{ t('settings.shortcutBack') }}</span>
            <span class="keys"><kbd>Esc</kbd></span>
          </li>
        </ul>
      </section>

      <section class="settings-card">
        <h2>{{ t('settings.about') }}</h2>
        <p class="hint">bit_pouch</p>
        <div class="settings-row">
          <span class="label">{{ t('settings.version') }}</span>
          <span class="value">{{ appVersion }}</span>
        </div>
        <div class="settings-row">
          <span class="label">{{ t('settings.shell') }}</span>
          <span class="value" style="display: inline-flex; align-items: center; gap: 6px">
            <Monitor v-if="shellKind === 'desktop'" :size="14" />
            <Smartphone v-else-if="shellKind === 'mobile'" :size="14" />
            <span>{{ t(`settings.shell.${shellKind}`) }}</span>
          </span>
        </div>
        <div class="settings-row">
          <span class="label">Plugins</span>
          <span class="value">manifest + user</span>
        </div>
      </section>

      <section class="settings-card">
        <h2>{{ t('settings.update') }}</h2>
        <p class="hint">{{ t('settings.updateHint') }}</p>
        <p v-if="!updaterAvailable" class="hint">{{ t('settings.updateUnavailable') }}</p>
        <template v-else>
          <div class="settings-row">
            <span class="label">{{ t('settings.updateSource') }}</span>
            <select class="select update-source" :value="updateSettings.source" @change="onUpdateSourceChange">
              <option value="ihomy">{{ t('settings.updateSource.ihomy') }}</option>
              <option value="github">{{ t('settings.updateSource.github') }}</option>
            </select>
          </div>
          <div class="settings-row">
            <span class="label">{{ t('settings.updateAuto') }}</span>
            <button
              type="button"
              class="switch"
              :class="{ on: updateSettings.auto_update }"
              role="switch"
              :aria-checked="updateSettings.auto_update"
              :aria-label="t('settings.updateAuto')"
              @click="toggleAutoUpdate"
            ></button>
          </div>
          <div class="settings-row">
            <span class="label">{{ t('settings.updateCheck') }}</span>
            <button
              type="button"
              class="btn btn-sm"
              :disabled="updateBusy || !updateReady"
              @click="checkForUpdates()"
            >
              <RefreshCw :size="13" /> {{ t('settings.updateCheck') }}
            </button>
          </div>
          <p class="update-status" :class="{ 'is-error': updateStatus?.phase === 'error' }" aria-live="polite">
            {{ updateStatusText }}
          </p>
          <div v-if="canDownloadUpdate || canInstallUpdate" class="update-actions">
            <button
              v-if="canDownloadUpdate"
              type="button"
              class="btn btn-primary btn-sm"
              :disabled="updateBusy"
              @click="downloadUpdate()"
            >
              <Download :size="13" /> {{ t('settings.updateDownload') }}
            </button>
            <button
              v-if="canInstallUpdate"
              type="button"
              class="btn btn-primary btn-sm"
              :disabled="updateBusy"
              @click="installUpdate()"
            >
              <RefreshCw :size="13" /> {{ t('settings.updateInstall') }}
            </button>
          </div>
          <p class="hint update-note">{{ t('settings.updateNote') }}</p>
        </template>
      </section>

      <section class="settings-card wide">
        <h2>{{ t('settings.userPlugins') }}</h2>
        <p class="hint">{{ t('settings.userPluginsHint') }}</p>
        <p class="hint plugin-trust"><ShieldAlert :size="13" /> {{ t('settings.userPluginsTrust') }}</p>

        <div class="plugin-actions">
          <button type="button" class="btn btn-primary btn-sm" @click="pickFile">
            <Upload :size="13" /> {{ t('settings.importPlugin') }}
          </button>
          <button type="button" class="btn btn-sm btn-ghost" @click="downloadExample">
            <Download :size="13" /> {{ t('settings.examplePlugin') }}
          </button>
          <input ref="fileInput" type="file" accept=".js,.mjs,text/javascript" hidden @change="onFileChange" />
        </div>
        <p class="hint plugin-formats">{{ t('settings.pluginFileHint') }}</p>
        <p v-if="pluginError" class="plugin-error" role="alert">{{ pluginError }}</p>

        <div class="plugin-section-head">
          <span class="section-label">{{ t('settings.installedPlugins') }}</span>
          <span class="hint">{{ plugins.length }}</span>
        </div>
        <div v-if="plugins.length" class="plugin-list">
          <div v-for="plugin in plugins" :key="plugin.id" class="plugin-item">
            <div class="plugin-item-main">
              <div class="plugin-item-title">{{ localized(plugin.manifest.name) }}</div>
              <div class="plugin-item-meta">{{ plugin.id }} · v{{ plugin.manifest.version }}</div>
            </div>
            <div class="plugin-item-actions">
              <button
                type="button"
                class="btn btn-sm"
                :title="t('settings.exportPlugin')"
                :aria-label="t('settings.exportPlugin')"
                @click="exportPlugin(plugin)"
              >
                <Download :size="13" />
              </button>
              <button
                type="button"
                class="btn btn-danger btn-sm"
                :title="t('settings.deletePlugin')"
                :aria-label="t('settings.deletePlugin')"
                @click="deletePlugin(plugin.id)"
              >
                <Trash2 :size="13" />
              </button>
            </div>
          </div>
        </div>
        <p v-else class="hint plugin-empty">{{ t('settings.noUserPlugins') }}</p>

        <template v-if="problems.length">
          <div class="plugin-section-head">
            <span class="section-label">{{ t('settings.brokenPlugins') }}</span>
            <span class="hint">{{ problems.length }}</span>
          </div>
          <div class="plugin-list">
            <div v-for="(problem, index) in problems" :key="`${problem.id}-${index}`" class="plugin-item">
              <div class="plugin-item-main">
                <div class="plugin-item-title">{{ problem.id || 'unknown' }}</div>
                <div class="plugin-item-meta">{{ problem.message }}</div>
              </div>
              <div class="plugin-item-actions">
                <button type="button" class="btn btn-danger btn-sm" @click="deletePlugin(problem.id)">
                  {{ t('settings.deletePlugin') }}
                </button>
              </div>
            </div>
          </div>
        </template>
      </section>
    </div>
  </div>
</template>
