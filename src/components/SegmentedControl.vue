<script setup lang="ts">
export interface SegmentOption {
  value: string
  label: string
}

withDefaults(
  defineProps<{
    modelValue: string
    options: SegmentOption[]
    accent?: boolean
  }>(),
  { accent: false },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <div class="segmented" role="group">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      :class="{ active: modelValue === option.value, accent }"
      :aria-pressed="modelValue === option.value"
      @click="emit('update:modelValue', option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>
