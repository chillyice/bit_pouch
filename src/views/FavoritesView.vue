<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import EmptyState from '@/components/EmptyState.vue'
import ToolCard from '@/components/ToolCard.vue'
import { t } from '@/core/i18n'
import { getManifest, toolPath } from '@/core/registry'
import { pushToast } from '@/core/toast'
import { useAppStore } from '@/stores/app'

const router = useRouter()
const app = useAppStore()

const tools = computed(() =>
  app.favorites.map((id) => getManifest(id)).filter((tool): tool is NonNullable<typeof tool> => Boolean(tool)),
)

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
    <p class="eyebrow">bit_pouch / favorites</p>
    <h1>{{ t('nav.favorites') }}</h1>
    <p class="sub">{{ t('home.emptyFavorites') }}</p>

    <section class="section">
      <div v-if="tools.length" class="tool-grid">
        <ToolCard
          v-for="(tool, index) in tools"
          :key="tool.id"
          :tool="tool"
          :index="index"
          :favorite="true"
          @open="openTool"
          @toggle-favorite="toggleFavorite"
        />
      </div>
      <EmptyState v-else :title="t('home.emptyFavorites')">
        <RouterLink to="/" class="btn btn-primary btn-sm">{{ t('nav.all') }}</RouterLink>
      </EmptyState>
    </section>
  </div>
</template>
