<script setup lang="ts">
import { PackageOpen } from 'lucide-vue-next'

defineProps<{
  title: string
  hint?: string
}>()
</script>

<template>
  <div class="empty-state card" style="padding: 34px; text-align: center; color: var(--text-faint)">
    <PackageOpen :size="30" style="margin-bottom: 10px; opacity: 0.65" />
    <h3 style="margin: 0 0 4px; color: var(--text); font-size: 15px">{{ title }}</h3>
    <p v-if="hint" style="margin: 0; font-size: 12.5px">{{ hint }}</p>
    <div v-if="$slots.default" style="margin-top: 14px">
      <slot />
    </div>
  </div>
</template>
