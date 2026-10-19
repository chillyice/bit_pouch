<script setup lang="ts">
import { computed } from 'vue'
import { Languages, Monitor, Moon, Smartphone, Sun } from 'lucide-vue-next'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { locale, setLocale, t } from '@/core/i18n'
import { shellKind } from '@/core/platform'
import { clearAppStorage } from '@/core/storage'
import { setTheme, theme } from '@/core/theme'
import { pushToast } from '@/core/toast'
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
</script>

<template>
  <div class="page">
    <p class="eyebrow">bit_pouch / settings</p>
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
          <span class="value">manifest-driven</span>
        </div>
      </section>
    </div>
  </div>
</template>
