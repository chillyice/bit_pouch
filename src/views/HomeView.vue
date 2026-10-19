<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Search } from 'lucide-vue-next'
import EmptyState from '@/components/EmptyState.vue'
import ToolCard from '@/components/ToolCard.vue'
import { locale, t } from '@/core/i18n'
import { getCategoryCounts, getManifest, listTools, searchTools, toolPath } from '@/core/registry'
import { pushToast } from '@/core/toast'
import type { ToolCategory } from '@/core/types'
import { useAppStore } from '@/stores/app'

const route = useRoute()
const router = useRouter()
const app = useAppStore()

const search = ref('')
const counts = getCategoryCounts()
const totalTools = listTools().length
const categories: Array<{ key: ToolCategory | 'all' }> = [
  { key: 'all' },
  { key: 'codec' },
  { key: 'convert' },
  { key: 'inspect' },
  { key: 'network' },
  { key: 'text' },
]

const activeCategory = computed<ToolCategory | 'all'>(() => {
  const value = String(route.query.category || 'all')
  return categories.some((c) => c.key === value) ? (value as ToolCategory | 'all') : 'all'
})

const tools = computed(() => searchTools(search.value, locale.value, activeCategory.value))
const showShelves = computed(() => !search.value.trim() && activeCategory.value === 'all')

const favoriteTools = computed(() =>
  app.favorites.map((id) => getManifest(id)).filter((tool): tool is NonNullable<typeof tool> => Boolean(tool)),
)
const recentTools = computed(() =>
  app.recent
    .map((id) => getManifest(id))
    .filter((tool): tool is NonNullable<typeof tool> => Boolean(tool))
    .slice(0, 4),
)

function setCategory(category: ToolCategory | 'all'): void {
  router.replace({ name: 'home', query: category === 'all' ? {} : { category } })
}

function countFor(category: ToolCategory | 'all'): number {
  return category === 'all' ? totalTools : counts[category]
}

function openTool(id: string): void {
  app.markOpened(id)
  router.push(toolPath(id))
}

function toggleFavorite(id: string): void {
  const favorite = app.toggleFavorite(id)
  pushToast(t(favorite ? 'toast.favorited' : 'toast.unfavorited'), 'success')
}
</script>

<template>
  <div class="page">
    <div class="hero">
      <p class="eyebrow">bit_pouch / local-first</p>
      <div class="hero-row">
        <div>
          <h1>{{ t('home.title') }}</h1>
          <p class="sub">{{ t('home.subtitle') }}</p>
        </div>
        <label class="hero-search">
          <Search :size="16" />
          <input v-model="search" :placeholder="t('search.placeholder')" spellcheck="false" />
          <kbd>⌘K</kbd>
        </label>
      </div>

      <div class="filter-row">
        <button
          v-for="category in categories"
          :key="category.key"
          type="button"
          class="filter-chip"
          :class="{ active: activeCategory === category.key }"
          @click="setCategory(category.key)"
        >
          {{ category.key === 'all' ? t('home.all') : t(`category.${category.key}`) }}
          <span class="n">{{ countFor(category.key) }}</span>
        </button>
        <span class="option-spacer" />
        <span class="hint faint mono">{{ t('home.count', { n: tools.length }) }}</span>
      </div>
    </div>

    <template v-if="showShelves">
      <section v-if="favoriteTools.length" class="section">
        <div class="section-head">
          <h2>{{ t('home.favorites') }}</h2>
          <span class="hint">{{ favoriteTools.length }}</span>
        </div>
        <div class="compact-grid">
          <ToolCard
            v-for="(tool, index) in favoriteTools"
            :key="tool.id"
            :tool="tool"
            :index="index"
            :favorite="true"
            compact
            @open="openTool"
            @toggle-favorite="toggleFavorite"
          />
        </div>
      </section>

      <section v-if="recentTools.length" class="section">
        <div class="section-head">
          <h2>{{ t('home.recent') }}</h2>
          <span class="hint">{{ recentTools.length }}</span>
        </div>
        <div class="compact-grid">
          <ToolCard
            v-for="(tool, index) in recentTools"
            :key="tool.id"
            :tool="tool"
            :index="index"
            :favorite="app.isFavorite(tool.id)"
            compact
            @open="openTool"
            @toggle-favorite="toggleFavorite"
          />
        </div>
      </section>
    </template>

    <section class="section">
      <div class="section-head">
        <h2>{{ search.trim() ? t('search.placeholder').replace('…', '') : t('nav.all') }}</h2>
        <span class="hint">{{ tools.length }}</span>
      </div>

      <div v-if="tools.length" class="tool-grid">
        <ToolCard
          v-for="(tool, index) in tools"
          :key="tool.id"
          :tool="tool"
          :index="index"
          :favorite="app.isFavorite(tool.id)"
          @open="openTool"
          @toggle-favorite="toggleFavorite"
        />
      </div>
      <EmptyState v-else :title="t('search.empty')" :hint="t('home.emptyRecent')" />
    </section>
  </div>
</template>
