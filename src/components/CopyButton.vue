<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { Check, Copy } from 'lucide-vue-next'
import { copyText } from '@/core/clipboard'
import { t } from '@/core/i18n'

const props = withDefaults(
  defineProps<{
    text: string
    label?: string
    iconOnly?: boolean
    ghost?: boolean
  }>(),
  { label: '', iconOnly: false, ghost: false },
)

const copied = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined

async function onClick(): Promise<void> {
  const ok = await copyText(props.text)
  if (!ok) return
  copied.value = true
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => (copied.value = false), 1200)
}

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
})
</script>

<template>
  <button
    type="button"
    class="btn btn-sm"
    :class="[ghost ? 'btn-ghost' : '', iconOnly ? 'btn-icon' : '']"
    :disabled="!text"
    :title="label || t('action.copy')"
    :aria-label="label || t('action.copy')"
    @click="onClick"
  >
    <Check v-if="copied" :size="14" />
    <Copy v-else :size="14" />
    <span v-if="!iconOnly">{{ copied ? t('action.copied') : label || t('action.copy') }}</span>
  </button>
</template>
