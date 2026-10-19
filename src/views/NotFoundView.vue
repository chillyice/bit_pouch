<script setup lang="ts">
import EmptyState from '@/components/EmptyState.vue'
import { t } from '@/core/i18n'
</script>

<template>
  <div class="page">
    <EmptyState :title="t('common.notFound')" :hint="t('common.notFoundHint')">
      <RouterLink to="/" class="btn btn-primary btn-sm">{{ t('tool.back') }}</RouterLink>
    </EmptyState>
  </div>
</template>
