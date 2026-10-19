<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Eraser, Play, Sparkles } from 'lucide-vue-next'
import CopyButton from '@/components/CopyButton.vue'
import ErrorNote from '@/components/ErrorNote.vue'
import Pane from '@/components/Pane.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import StatChips from '@/components/StatChips.vue'
import { formatBytes } from '@/core/format'
import { locale, t } from '@/core/i18n'
import { callTool } from '@/core/runner'
import { useToolPrefs } from '@/core/toolPrefs'
import type { ToolError } from '@/core/types'
import { SAMPLE_JSON, tokenizeJson, type JsonStats, type JsonToken } from './run'

const prefs = useToolPrefs('json', { indent: '  ', sortKeys: false })
const input = ref('')
const output = ref('')
const error = ref<ToolError | null>(null)
const stats = ref<JsonStats | null>(null)
const running = ref(false)
const inputEl = ref<HTMLTextAreaElement | null>(null)

let runSeq = 0
const HIGHLIGHT_LIMIT = 200_000

const indentOptions = computed(() => [
  { value: '  ', label: '2' },
  { value: '    ', label: '4' },
  { value: '\t', label: 'Tab' },
])

const tokens = computed<JsonToken[] | null>(() =>
  output.value && output.value.length <= HIGHLIGHT_LIMIT ? tokenizeJson(output.value) : null,
)

const statsItems = computed(() => {
  if (!stats.value) return []
  return [
    { label: locale.value === 'zh' ? '行' : 'lines', value: stats.value.lines },
    { label: locale.value === 'zh' ? '字符' : 'chars', value: stats.value.chars },
    { label: locale.value === 'zh' ? '大小' : 'size', value: formatBytes(stats.value.bytes) },
  ]
})

async function runFormat(minify = false): Promise<void> {
  if (!input.value.trim()) {
    output.value = ''
    error.value = null
    stats.value = null
    return
  }

  const seq = ++runSeq
  running.value = true
  const result = await callTool('json', input.value, {
    indent: prefs.indent,
    sortKeys: prefs.sortKeys,
    minify,
  }, locale.value)

  if (seq !== runSeq) return
  running.value = false

  if (result.ok) {
    output.value = result.output ?? ''
    stats.value = (result.stats as unknown as JsonStats) ?? null
    error.value = null
  } else {
    output.value = ''
    stats.value = null
    error.value = result.error ?? { code: 'UNKNOWN', message: t('common.error') }
  }
}

function loadSample(): void {
  input.value = SAMPLE_JSON
  nextTick(() => {
    inputEl.value?.focus()
    runFormat()
  })
}

function clearAll(): void {
  runSeq++
  running.value = false
  input.value = ''
  output.value = ''
  error.value = null
  stats.value = null
  nextTick(() => inputEl.value?.focus())
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault()
    runFormat()
    return
  }
  if (event.key !== 'Tab' || event.shiftKey) return
  event.preventDefault()
  const el = inputEl.value
  if (!el) return
  const start = el.selectionStart
  const end = el.selectionEnd
  input.value = input.value.slice(0, start) + prefs.indent + input.value.slice(end)
  nextTick(() => {
    el.selectionStart = el.selectionEnd = start + prefs.indent.length
  })
}

watch(
  () => [prefs.indent, prefs.sortKeys],
  () => {
    if (output.value || error.value) runFormat()
  },
)
</script>

<template>
  <div class="workbench">
    <div class="option-bar">
      <div class="option-group">
        <span class="field-label">{{ locale === 'zh' ? '缩进' : 'Indent' }}</span>
        <SegmentedControl v-model="prefs.indent" :options="indentOptions" />
      </div>
      <button type="button" class="switch-row" @click="prefs.sortKeys = !prefs.sortKeys">
        <span class="switch" :class="{ on: prefs.sortKeys }" />
        {{ locale === 'zh' ? '键名排序' : 'Sort keys' }}
      </button>
      <span class="option-spacer" />
      <button type="button" class="btn btn-sm" @click="loadSample"><Sparkles :size="13" /> {{ t('action.sample') }}</button>
      <button type="button" class="btn btn-sm" :disabled="!input && !output" @click="clearAll">
        <Eraser :size="13" /> {{ t('action.clear') }}
      </button>
      <button type="button" class="btn btn-sm" :disabled="!input.trim() || running" @click="runFormat(true)">
        {{ t('action.minify') }}
      </button>
      <button type="button" class="btn btn-primary btn-sm" :disabled="!input.trim() || running" @click="runFormat()">
        <Play :size="13" /> {{ running ? t('common.loading') : t('action.format') }}
      </button>
    </div>

    <div class="split">
      <Pane
        :title="t('common.input')"
        :meta="locale === 'zh' ? `${input.length} 字符` : `${input.length} chars`"
      >
        <template #actions>
          <span class="pane-meta">Ctrl + Enter</span>
        </template>
        <textarea
          ref="inputEl"
          v-model="input"
          class="editor"
          spellcheck="false"
          autocomplete="off"
          autocapitalize="off"
          :placeholder="locale === 'zh' ? '粘贴 JSON，Ctrl + Enter 格式化' : 'Paste JSON, then Ctrl + Enter'"
          @keydown="onKeydown"
        />
      </Pane>

      <Pane :title="t('common.output')" :error="Boolean(error)">
        <template #actions>
          <CopyButton :text="output" icon-only ghost />
        </template>
        <ErrorNote v-if="error" :error="error" />
        <pre v-else-if="output" class="output"><code v-if="tokens"><span
          v-for="(token, index) in tokens"
          :key="index"
          :class="`tk-${token.type}`"
        >{{ token.text }}</span></code><code v-else>{{ output }}</code></pre>
        <div v-else class="pane-empty">{{ t('common.empty') }}</div>
        <template v-if="stats" #footer>
          <StatChips :items="statsItems" />
        </template>
      </Pane>
    </div>
  </div>
</template>
