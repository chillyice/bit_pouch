<script setup lang="ts">
import { computed } from 'vue'
import { Star } from 'lucide-vue-next'
import ToolIcon from './ToolIcon.vue'
import { localized, t } from '@/core/i18n'
import { isUserTool } from '@/core/registry'
import type { ToolManifest } from '@/core/types'

const props = withDefaults(
  defineProps<{
    tool: ToolManifest
    favorite?: boolean
    compact?: boolean
    index?: number
  }>(),
  { favorite: false, compact: false, index: 0 },
)

const emit = defineEmits<{
  open: [id: string]
  toggleFavorite: [id: string]
}>()

const delay = computed(() => `${Math.min(props.index, 12) * 26}ms`)
</script>

<template>
  <div
    class="tool-card"
    :class="{ compact }"
    role="link"
    tabindex="0"
    :data-tool-id="tool.id"
    :style="{ animationDelay: delay }"
    @click="emit('open', tool.id)"
    @keydown.enter.prevent="emit('open', tool.id)"
    @keydown.space.prevent="emit('open', tool.id)"
  >
    <div class="tool-card-top">
      <span class="tool-icon"><ToolIcon :name="tool.icon" :size="compact ? 17 : 21" /></span>
      <button
        type="button"
        class="star-btn"
        :class="{ active: favorite }"
        :title="favorite ? t('tool.unfavorite') : t('tool.favorite')"
        :aria-label="favorite ? t('tool.unfavorite') : t('tool.favorite')"
        @click.stop="emit('toggleFavorite', tool.id)"
        @keydown.stop
      >
        <Star :size="14" :fill="favorite ? 'currentColor' : 'none'" />
      </button>
    </div>

    <div>
      <h3>{{ localized(tool.name) }}</h3>
      <p v-if="!compact">{{ localized(tool.description) }}</p>
    </div>

    <div v-if="!compact && (isUserTool(tool.id) || tool.experimental)" class="tool-card-foot">
      <span v-if="isUserTool(tool.id)" class="badge accent">{{ t('tool.userPlugin') }}</span>
      <span v-if="tool.experimental" class="badge">{{ t('tool.experimental') }}</span>
    </div>
  </div>
</template>
