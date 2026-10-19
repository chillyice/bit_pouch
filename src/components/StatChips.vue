<script setup lang="ts">
defineProps<{
  items: Array<{ label: string; value: string | number }>
}>()
</script>

<template>
  <div class="stat-chips">
    <span v-for="item in items" :key="item.label" class="stat-chip">
      {{ item.label }} <b>{{ item.value }}</b>
    </span>
  </div>
</template>
