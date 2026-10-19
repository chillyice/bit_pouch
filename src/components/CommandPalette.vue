<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { CornerDownLeft, Search } from 'lucide-vue-next'
import ToolIcon from './ToolIcon.vue'
import { localized, locale, t } from '@/core/i18n'
import { searchTools, toolPath } from '@/core/registry'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const router = useRouter()
const query = ref('')
const selected = ref(0)
const inputEl = ref<HTMLInputElement | null>(null)

const results = computed(() => searchTools(query.value, locale.value))
const selectedId = computed(() => results.value[selected.value]?.id ?? '')

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    query.value = ''
    selected.value = 0
    await nextTick()
    inputEl.value?.focus()
  },
)

watch(query, () => {
  selected.value = 0
})

watch(selected, async () => {
  await nextTick()
  document.querySelector('.cmd-item.selected')?.scrollIntoView({ block: 'nearest' })
})

function move(delta: number): void {
  if (!results.value.length) return
  selected.value = (selected.value + delta + results.value.length) % results.value.length
}

function choose(id = selectedId.value): void {
  if (!id) return
  emit('close')
  router.push(toolPath(id))
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    move(1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    move(-1)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    choose()
  } else if (event.key === 'Escape') {
    emit('close')
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="cmd">
      <div v-if="open" class="cmd-overlay" @click.self="emit('close')">
        <div class="cmd-panel" role="dialog" aria-modal="true" :aria-label="t('palette.placeholder')">
          <div class="cmd-input-row">
            <Search :size="17" />
            <input
              ref="inputEl"
              v-model="query"
              :placeholder="t('palette.placeholder')"
              spellcheck="false"
              @keydown="onKeydown"
            />
            <kbd>Esc</kbd>
          </div>

          <div class="cmd-list">
            <button
              v-for="(tool, index) in results"
              :key="tool.id"
              type="button"
              class="cmd-item"
              :class="{ selected: index === selected }"
              @mouseenter="selected = index"
              @click="choose(tool.id)"
            >
              <span class="cmd-icon"><ToolIcon :name="tool.icon" :size="16" /></span>
              <span class="cmd-text">
                <span class="cmd-name">{{ localized(tool.name) }}</span>
                <span class="cmd-desc">{{ localized(tool.description) }}</span>
              </span>
              <span class="badge">{{ t(`category.${tool.category}`) }}</span>
            </button>
            <div v-if="!results.length" class="pane-empty" style="min-height: 120px">
              {{ t('palette.noResults') }}
            </div>
          </div>

          <div class="cmd-foot">
            <span class="keys"><kbd>↑</kbd><kbd>↓</kbd> {{ t('palette.hint').split('·')[0] }}</span>
            <span class="keys"><CornerDownLeft :size="12" /> Enter</span>
            <span class="option-spacer" />
            <span>{{ t('palette.hint') }}</span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
