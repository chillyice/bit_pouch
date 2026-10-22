<script setup lang="ts">
import { FileDown } from 'lucide-vue-next'
import { t } from '@/core/i18n'

defineProps<{ visible: boolean }>()
</script>

<template>
  <div v-if="visible" class="drop-mask">
    <FileDown :size="22" />
    <span>{{ t('common.dropHint') }}</span>
  </div>
</template>
