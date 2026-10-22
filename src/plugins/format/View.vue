<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Eraser, Play, Sparkles } from 'lucide-vue-next'
import CopyButton from '@/components/CopyButton.vue'
import DropHint from '@/components/DropHint.vue'
import ErrorNote from '@/components/ErrorNote.vue'
import Pane from '@/components/Pane.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import StatChips from '@/components/StatChips.vue'
import { useFileDrop } from '@/core/fileDrop'
import { formatBytes } from '@/core/format'
import { locale, t } from '@/core/i18n'
import { callTool } from '@/core/runner'
import { useToolPrefs } from '@/core/toolPrefs'
import type { ToolError } from '@/core/types'
import {
  SAMPLE_HTML,
  SAMPLE_JSON,
  SAMPLE_XML,
  tokenizeFormat,
  type FormatMode,
  type FormatModeOption,
  type FormatRunData,
  type FormatToken,
} from './run'

interface FormatStats {
  lines: number
  chars: number
  bytes: number
  tags?: number
  depth?: number
}

const prefs = useToolPrefs('format', {
  mode: 'auto' as FormatModeOption,
  indent: '  ',
  sortKeys: false,
})
const input = ref('')
const output = ref('')
const error = ref<ToolError | null>(null)
const stats = ref<FormatStats | null>(null)
const resultMode = ref<FormatMode | null>(null)
const running = ref(false)
const inputEl = ref<HTMLTextAreaElement | null>(null)

let runSeq = 0
const HIGHLIGHT_LIMIT = 200_000

const modeOptions = computed(() => [
  { value: 'auto', label: locale.value === 'zh' ? '自动' : 'Auto' },
  { value: 'json', label: 'JSON' },
  { value: 'xml', label: 'XML' },
  { value: 'html', label: 'HTML' },
])

const indentOptions = computed(() => [
  { value: '  ', label: '2' },
  { value: '    ', label: '4' },
  { value: '\t', label: 'Tab' },
])

const showSortKeys = computed(() => prefs.mode === 'auto' || prefs.mode === 'json')

const tokens = computed<FormatToken[] | null>(() =>
  output.value && resultMode.value && output.value.length <= HIGHLIGHT_LIMIT
    ? tokenizeFormat(output.value, resultMode.value)
    : null,
)

const statsItems = computed(() => {
  if (!stats.value) return []
  const items: Array<{ label: string; value: string | number }> = []
  if (resultMode.value) {
    items.push({ label: locale.value === 'zh' ? '模式' : 'mode', value: resultMode.value.toUpperCase() })
  }
  if (stats.value.tags !== undefined) {
    items.push({ label: locale.value === 'zh' ? '标签' : 'tags', value: stats.value.tags })
  }
  items.push(
    { label: locale.value === 'zh' ? '行' : 'lines', value: stats.value.lines },
    { label: locale.value === 'zh' ? '字符' : 'chars', value: stats.value.chars },
    { label: locale.value === 'zh' ? '大小' : 'size', value: formatBytes(stats.value.bytes) },
  )
  return items
})

async function runFormat(minify = false): Promise<void> {
  if (!input.value.trim()) {
    output.value = ''
    error.value = null
    stats.value = null
    resultMode.value = null
    return
  }

  const seq = ++runSeq
  running.value = true
  const result = await callTool<FormatRunData>('format', input.value, {
    mode: prefs.mode,
    indent: prefs.indent,
    sortKeys: prefs.sortKeys,
    minify,
  }, locale.value)

  if (seq !== runSeq) return
  running.value = false

  if (result.ok) {
    output.value = result.output ?? ''
    stats.value = (result.stats as unknown as FormatStats) ?? null
    resultMode.value = result.data?.mode ?? null
    error.value = null
  } else {
    output.value = ''
    stats.value = null
    resultMode.value = null
    error.value = result.error ?? { code: 'UNKNOWN', message: t('common.error') }
  }
}

function loadSample(): void {
  if (prefs.mode === 'xml') input.value = SAMPLE_XML
  else if (prefs.mode === 'html') input.value = SAMPLE_HTML
  else input.value = SAMPLE_JSON
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
  resultMode.value = null
  nextTick(() => inputEl.value?.focus())
}

const { dragging, dropBinding } = useFileDrop(async (files) => {
  const file = files[0]
  if (!file) return
  input.value = await file.text()
  prefs.mode = 'auto'
  await nextTick()
  inputEl.value?.focus()
  runFormat()
})

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
  () => [prefs.mode, prefs.indent, prefs.sortKeys],
  () => {
    if (output.value || error.value) runFormat()
  },
)
</script>

<template>
  <div class="workbench" v-bind="dropBinding">
    <DropHint :visible="dragging" />
    <div class="option-bar">
      <div class="option-group">
        <span class="field-label">{{ locale === 'zh' ? '模式' : 'Mode' }}</span>
        <SegmentedControl v-model="prefs.mode" :options="modeOptions" />
      </div>
      <div class="option-group">
        <span class="field-label">{{ locale === 'zh' ? '缩进' : 'Indent' }}</span>
        <SegmentedControl v-model="prefs.indent" :options="indentOptions" />
      </div>
      <button v-if="showSortKeys" type="button" class="switch-row" @click="prefs.sortKeys = !prefs.sortKeys">
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
          :placeholder="locale === 'zh' ? '粘贴 JSON / XML / HTML / SVG，Ctrl + Enter 格式化' : 'Paste JSON / XML / HTML / SVG, then Ctrl + Enter'"
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
