<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { Grid2x2, Languages, Moon, Search, Settings, Star, Sun } from 'lucide-vue-next'
import CommandPalette from '@/components/CommandPalette.vue'
import ToastHost from '@/components/ToastHost.vue'
import ToolIcon from '@/components/ToolIcon.vue'
import { t, toggleLocale, localized } from '@/core/i18n'
import { getManifest, listTools } from '@/core/registry'
import { theme, toggleTheme } from '@/core/theme'
import type { ToolCategory } from '@/core/types'
import { disposeUpdateBridge, initUpdateBridge } from '@/core/updater'
import { useAppStore } from '@/stores/app'

const route = useRoute()
const app = useAppStore()

const paletteOpen = ref(false)
const appVersion = __APP_VERSION__
const allTools = computed(() => listTools())
const categories: Array<{ key: ToolCategory }> = [
  { key: 'codec' },
  { key: 'convert' },
  { key: 'inspect' },
  { key: 'network' },
  { key: 'text' },
]

const recentTools = computed(() =>
  app.recent
    .map((id) => getManifest(id))
    .filter((tool): tool is NonNullable<typeof tool> => Boolean(tool))
    .slice(0, 4),
)

const activeCategory = computed(() => (route.name === 'home' ? String(route.query.category || 'all') : 'none'))

function onKeydown(event: KeyboardEvent): void {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    paletteOpen.value = true
    return
  }
  if (event.key === 'Escape') paletteOpen.value = false
}

// 工具页自己处理拖入；没处理时阻止 WebView 直接打开文件，避免页面被替换。
function blockFileDrop(event: DragEvent): void {
  if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('dragover', blockFileDrop)
  window.addEventListener('drop', blockFileDrop)
  void initUpdateBridge()
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('dragover', blockFileDrop)
  window.removeEventListener('drop', blockFileDrop)
  disposeUpdateBridge()
})
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <RouterLink to="/" class="brand">
        <span class="brand-mark">b_</span>
        <span>
          <span class="brand-name">bit_pouch</span>
          <span class="brand-tagline">比特口袋</span>
        </span>
      </RouterLink>

      <button type="button" class="side-search" @click="paletteOpen = true">
        <Search :size="14" />
        <span>{{ t('search.placeholder') }}</span>
        <kbd>⌘K</kbd>
      </button>

      <nav class="side-section">
        <span class="side-label">{{ t('nav.all') }}</span>
        <RouterLink to="/" class="side-link">
          <Grid2x2 :size="15" />
          {{ t('nav.all') }}
          <span class="count">{{ allTools.length }}</span>
        </RouterLink>
        <RouterLink to="/favorites" class="side-link">
          <Star :size="15" />
          {{ t('nav.favorites') }}
          <span class="count">{{ app.favorites.length }}</span>
        </RouterLink>
        <RouterLink to="/settings" class="side-link">
          <Settings :size="15" />
          {{ t('nav.settings') }}
        </RouterLink>
      </nav>

      <nav class="side-section">
        <span class="side-label">{{ t('common.options') }}</span>
        <RouterLink
          v-for="category in categories"
          :key="category.key"
          v-slot="{ href, navigate }"
          :to="{ name: 'home', query: activeCategory === category.key ? {} : { category: category.key } }"
          custom
        >
          <a
            :href="href"
            class="side-link"
            :class="{ 'router-link-active': activeCategory === category.key }"
            @click="navigate"
          >
            <span>{{ t(`category.${category.key}`) }}</span>
          </a>
        </RouterLink>
      </nav>

      <div v-if="recentTools.length" class="side-latest">
        <h4>{{ t('nav.recent') }}</h4>
        <RouterLink v-for="tool in recentTools" :key="tool.id" :to="`/t/${tool.id}`">
          <span class="dot" />
          <ToolIcon :name="tool.icon" :size="13" />
          <span>{{ localized(tool.name) }}</span>
        </RouterLink>
      </div>

      <div class="side-footer">
        <span>{{ appVersion }}</span>
        <div style="display: flex; gap: 2px">
          <button type="button" class="btn btn-ghost btn-icon btn-sm" :title="t('settings.language')" @click="toggleLocale">
            <Languages :size="14" />
          </button>
          <button type="button" class="btn btn-ghost btn-icon btn-sm" :title="t('settings.theme')" @click="toggleTheme">
            <Sun v-if="theme === 'dark'" :size="14" />
            <Moon v-else :size="14" />
          </button>
        </div>
      </div>
    </aside>

    <header class="mobile-topbar">
      <RouterLink to="/" class="brand">
        <span class="brand-mark">b_</span>
        <span class="brand-name">bit_pouch</span>
      </RouterLink>
      <span class="spacer" />
      <button type="button" class="btn btn-ghost btn-icon" :aria-label="t('search.placeholder')" @click="paletteOpen = true">
        <Search :size="17" />
      </button>
      <button type="button" class="btn btn-ghost btn-icon" :aria-label="t('settings.theme')" @click="toggleTheme">
        <Sun v-if="theme === 'dark'" :size="17" />
        <Moon v-else :size="17" />
      </button>
    </header>

    <main class="main-scroll">
      <RouterView v-slot="{ Component }">
        <Transition name="page" mode="out-in">
          <component :is="Component" />
        </Transition>
      </RouterView>
    </main>

    <nav class="bottom-nav">
      <RouterLink to="/">
        <Grid2x2 :size="18" />
        {{ t('nav.all') }}
      </RouterLink>
      <RouterLink to="/favorites">
        <Star :size="18" />
        {{ t('nav.favorites') }}
      </RouterLink>
      <RouterLink to="/settings">
        <Settings :size="18" />
        {{ t('nav.settings') }}
      </RouterLink>
    </nav>

    <CommandPalette :open="paletteOpen" @close="paletteOpen = false" />
    <ToastHost />
  </div>
</template>
