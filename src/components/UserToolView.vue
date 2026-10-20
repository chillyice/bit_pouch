<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Play } from 'lucide-vue-next'
import CopyButton from '@/components/CopyButton.vue'
import ErrorNote from '@/components/ErrorNote.vue'
import Pane from '@/components/Pane.vue'
import StatChips from '@/components/StatChips.vue'
import { locale, t } from '@/core/i18n'
import { callTool } from '@/core/runner'
import type { ToolError } from '@/core/types'

/**
 * 用户插件的通用界面：用户只提供 manifest + run，视图由这里统一承载。
 * 输入变化后自动运行；Ctrl/Cmd+Enter 立即运行。
 */
const route = useRoute()
const id = computed(() => String(route.params.id || ''))

const input = ref('')
const output = ref('')
const dataText = ref('')
const stats = ref<Record<string, number | string>>({})
const error = ref<ToolError | null>(null)
const running = ref(false)

let seq = 0
let timer: ReturnType<typeof setTimeout> | undefined

const visibleOutput = computed(() => output.value || dataText.value)
const statItems = computed(() =>
  Object.entries(stats.value).map(([label, value]) => ({ label, value })),
)

function stringifyData(value: unknown): string {
  if (value === undefined) return ''
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

function localizeError(next: ToolError | undefined): ToolError {
  if (!next) return { code: 'PLUGIN_ERROR', message: t('common.error') }
  if (next.code === 'PLUGIN_RESULT') return { ...next, message: t('userPlugin.error.PLUGIN_RESULT') }
  return next
}

async function runNow(): Promise<void> {
  const current = ++seq
  running.value = true
  const result = await callTool(id.value, input.value, {}, locale.value)
  if (current !== seq) return

  running.value = false
  if (result.ok) {
    output.value = result.output ?? ''
    dataText.value = stringifyData(result.data)
    stats.value = result.stats ?? {}
    error.value = null
  } else {
    output.value = ''
    dataText.value = ''
    stats.value = {}
    error.value = localizeError(result.error)
  }
}

function schedule(): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(runNow, 120)
}

function onKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault()
    if (timer) clearTimeout(timer)
    runNow()
  }
}

watch(input, schedule)
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
})
runNow()
</script>

<template>
  <div class="workbench">
    <div class="option-bar">
      <span class="field-label">{{ t('tool.userPlugin') }}</span>
      <span class="hint faint">{{ t('userPlugin.runHint') }}</span>
      <span class="option-spacer" />
      <button type="button" class="btn btn-sm btn-primary" :disabled="running" @click="runNow">
        <Play :size="13" /> {{ running ? t('common.loading') : t('action.run') }}
      </button>
    </div>

    <div class="split">
      <Pane :title="t('common.input')" :meta="id" :error="Boolean(error)">
        <textarea
          v-model="input"
          class="editor"
          spellcheck="false"
          :placeholder="t('userPlugin.inputPlaceholder')"
          @keydown="onKeydown"
        />
      </Pane>

      <Pane :title="t('common.output')" :error="Boolean(error)">
        <template #actions>
          <CopyButton :text="visibleOutput" icon-only ghost />
        </template>

        <ErrorNote v-if="error" :error="error" />
        <pre v-else-if="visibleOutput" class="output wrap">{{ visibleOutput }}</pre>
        <div v-else class="pane-empty">{{ t('userPlugin.empty') }}</div>

        <template v-if="statItems.length" #footer>
          <StatChips :items="statItems" />
        </template>
      </Pane>
    </div>

    <p class="hint plugin-trust">{{ t('userPlugin.trust') }}</p>
  </div>
</template>
