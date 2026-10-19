<script setup lang="ts">
import { AlertTriangle } from 'lucide-vue-next'
import type { ToolError } from '@/core/types'

defineProps<{
  error: ToolError | null | undefined
}>()
</script>

<template>
  <div v-if="error" class="error-box" role="alert">
    <span class="error-title"><AlertTriangle :size="15" /> {{ error.message }}</span>
    <span v-if="error.line" class="error-pos">
      {{ error.code }} · L{{ error.line }}:{{ error.column }}<template v-if="error.char"> · “{{ error.char }}”</template>
    </span>
    <code v-if="error.lineText" class="error-line">{{ error.lineText }}</code>
  </div>
</template>
