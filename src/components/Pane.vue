<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string
    meta?: string
    error?: boolean
  }>(),
  { meta: '', error: false },
)
</script>

<template>
  <section class="pane">
    <header class="pane-head">
      <div class="pane-title">
        <span class="section-label">{{ title }}</span>
        <span v-if="meta" class="pane-meta">{{ meta }}</span>
      </div>
      <div class="pane-actions">
        <slot name="actions" />
      </div>
    </header>
    <div class="pane-body" :class="{ error }">
      <slot />
    </div>
    <footer v-if="$slots.footer" class="pane-foot">
      <slot name="footer" />
    </footer>
  </section>
</template>
