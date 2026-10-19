<script setup lang="ts">
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-vue-next'
import { dismissToast, toasts } from '@/core/toast'

function iconFor(tone: string) {
  if (tone === 'success') return CheckCircle2
  if (tone === 'error' || tone === 'warn') return AlertTriangle
  return Info
}
</script>

<template>
  <Teleport to="body">
    <div class="toast-stack" aria-live="polite">
      <TransitionGroup name="toast">
        <div v-for="item in toasts" :key="item.id" class="toast" :class="item.tone">
          <component :is="iconFor(item.tone)" :size="14" />
          <span>{{ item.message }}</span>
          <button
            type="button"
            class="btn btn-ghost btn-icon btn-sm"
            style="margin-left: auto"
            aria-label="close"
            @click="dismissToast(item.id)"
          >
            <X :size="12" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
