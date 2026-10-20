<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import type { Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Cpu, Star } from 'lucide-vue-next'
import EmptyState from '@/components/EmptyState.vue'
import ToolIcon from '@/components/ToolIcon.vue'
import { localized, t } from '@/core/i18n'
import { getManifest, isUserTool, loadView } from '@/core/registry'
import { pushToast } from '@/core/toast'
import { useAppStore } from '@/stores/app'

const route = useRoute()
const router = useRouter()
const app = useAppStore()

const id = computed(() => String(route.params.id || ''))
const manifest = computed(() => getManifest(id.value))
const view = shallowRef<Component | null>(null)
const loadError = ref('')
const loading = computed(() => Boolean(manifest.value) && !view.value && !loadError.value)

let loadSeq = 0
watch(
  id,
  async (nextId) => {
    const seq = ++loadSeq
    view.value = null
    loadError.value = ''
    if (!getManifest(nextId)) return
    try {
      const component = await loadView(nextId)
      if (seq !== loadSeq) return
      view.value = component
      app.markOpened(nextId)
    } catch (error) {
      if (seq !== loadSeq) return
      loadError.value = error instanceof Error ? error.message : String(error)
    }
  },
  { immediate: true },
)

function back(): void {
  router.push('/')
}

function toggleFavorite(): void {
  if (!manifest.value) return
  const favorite = app.toggleFavorite(manifest.value.id)
  pushToast(t(favorite ? 'toast.favorited' : 'toast.unfavorited'), 'success')
}
</script>

<template>
  <div class="tool-page">
    <button type="button" class="back-link" @click="back">
      <ArrowLeft :size="13" /> {{ t('tool.back') }}
    </button>

    <template v-if="manifest">
      <header class="tool-head">
        <span class="tool-icon" style="width: 48px; height: 48px; border-radius: 14px">
          <ToolIcon :name="manifest.icon" :size="24" />
        </span>
        <div class="tool-head-main">
          <div class="tool-head-title">
            <h1>{{ localized(manifest.name) }}</h1>
            <span class="badge">{{ t(`category.${manifest.category}`) }}</span>
            <span v-if="isUserTool(manifest.id)" class="badge accent">{{ t('tool.userPlugin') }}</span>
            <span v-if="manifest.runtime === 'worker'" class="badge teal"><Cpu :size="10" /> {{ t('tool.worker') }}</span>
            <span v-if="manifest.experimental" class="badge">{{ t('tool.experimental') }}</span>
          </div>
          <p class="sub">{{ localized(manifest.description) }}</p>
        </div>
        <div class="tool-head-actions">
          <button
            type="button"
            class="star-btn"
            :class="{ active: app.isFavorite(manifest.id) }"
            :title="app.isFavorite(manifest.id) ? t('tool.unfavorite') : t('tool.favorite')"
            :aria-label="app.isFavorite(manifest.id) ? t('tool.unfavorite') : t('tool.favorite')"
            @click="toggleFavorite"
          >
            <Star :size="16" :fill="app.isFavorite(manifest.id) ? 'currentColor' : 'none'" />
          </button>
        </div>
      </header>

      <div class="tool-content">
        <div v-if="loading" class="split">
          <div class="skeleton-card" style="height: 320px" />
          <div class="skeleton-card" style="height: 320px" />
        </div>
        <EmptyState v-else-if="loadError" :title="t('common.notFound')" :hint="loadError" />
        <component :is="view" v-else-if="view" :key="manifest.id" />
      </div>
    </template>

    <EmptyState v-else :title="t('common.notFound')" :hint="t('common.notFoundHint')">
      <button type="button" class="btn btn-primary btn-sm" @click="back">{{ t('tool.back') }}</button>
    </EmptyState>
  </div>
</template>
