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
  SAMPLE_ENV,
  SAMPLE_INI,
  SAMPLE_JSON,
  SAMPLE_PROPERTIES,
  SAMPLE_TOML,
  SAMPLE_YAML,
  type DataFormat,
  type DataFormatData,
  type DataFormatMode,
  type FormatChoice,
} from './run'

const prefs = useToolPrefs('data-format', {
  mode: 'toJson' as DataFormatMode,
  format: 'auto' as FormatChoice,
  target: 'yaml' as DataFormat,
  indent: '2' as '2' | '4' | 'tab',
  flatten: true,
  sortKeys: false,
})

const input = ref('')
const output = ref('')
const error = ref<ToolError | null>(null)
const data = ref<DataFormatData | null>(null)
const stats = ref<Record<string, number | string> | null>(null)
const running = ref(false)
const inputEl = ref<HTMLTextAreaElement | null>(null)

let runSeq = 0

const SAMPLES: Record<DataFormat, string> = {
  json: SAMPLE_JSON,
  yaml: SAMPLE_YAML,
  toml: SAMPLE_TOML,
  ini: SAMPLE_INI,
  env: SAMPLE_ENV,
  properties: SAMPLE_PROPERTIES,
}

const formatOptions = computed<Array<{ value: string; label: string }>>(() => [
  { value: 'auto', label: locale.value === 'zh' ? '自动' : 'Auto' },
  { value: 'json', label: 'JSON' },
  { value: 'yaml', label: 'YAML' },
  { value: 'toml', label: 'TOML' },
  { value: 'ini', label: 'INI' },
  { value: 'env', label: '.env' },
  { value: 'properties', label: 'Properties' },
])

const targetOptions = computed(() => formatOptions.value.filter((option) => option.value !== 'auto'))

const modeOptions = computed(() => [
  { value: 'toJson', label: locale.value === 'zh' ? '转 JSON' : 'To JSON' },
  { value: 'fromJson', label: locale.value === 'zh' ? '从 JSON 转出' : 'From JSON' },
])

const indentOptions = computed(() => [
  { value: '2', label: '2' },
  { value: '4', label: '4' },
  { value: 'tab', label: 'Tab' },
])

const showFlatten = computed(() => prefs.mode === 'fromJson' && prefs.target === 'ini')

const statsItems = computed(() => {
  if (!data.value) return []
  const items: Array<{ label: string; value: string | number }> = [
    {
      label: locale.value === 'zh' ? '转换' : 'convert',
      value: `${data.value.sourceFormat} → ${data.value.targetFormat}`,
    },
    { label: locale.value === 'zh' ? '键' : 'keys', value: data.value.keyCount },
  ]
  if (stats.value?.chars !== undefined) {
    items.push({ label: locale.value === 'zh' ? '字符' : 'chars', value: stats.value.chars })
  }
  if (stats.value?.bytes !== undefined) {
    items.push({ label: locale.value === 'zh' ? '大小' : 'size', value: formatBytes(Number(stats.value.bytes)) })
  }
  return items
})

async function runConvert(): Promise<void> {
  if (!input.value.trim()) {
    output.value = ''
    error.value = null
    data.value = null
    stats.value = null
    return
  }

  const seq = ++runSeq
  running.value = true
  const result = await callTool<DataFormatData>(
    'data-format',
    input.value,
    {
      mode: prefs.mode,
      format: prefs.format,
      target: prefs.target,
      indent: prefs.indent,
      flatten: prefs.flatten,
      sortKeys: prefs.sortKeys,
    },
    locale.value,
  )

  if (seq !== runSeq) return
  running.value = false

  if (result.ok) {
    output.value = result.output ?? ''
    data.value = result.data ?? null
    stats.value = result.stats ?? null
    error.value = null
  } else {
    output.value = ''
    data.value = null
    stats.value = null
    error.value = result.error ?? { code: 'UNKNOWN', message: t('common.error') }
  }
}

function loadSample(): void {
  if (prefs.mode === 'fromJson') {
    input.value = SAMPLE_JSON
  } else {
    const format = prefs.format === 'auto' ? 'yaml' : prefs.format
    input.value = SAMPLES[format] ?? SAMPLE_YAML
  }
  nextTick(() => {
    inputEl.value?.focus()
    runConvert()
  })
}

function clearAll(): void {
  runSeq++
  running.value = false
  input.value = ''
  output.value = ''
  error.value = null
  data.value = null
  stats.value = null
  nextTick(() => inputEl.value?.focus())
}

const { dragging, dropBinding } = useFileDrop(async (files) => {
  const file = files[0]
  if (!file) return
  input.value = await file.text()
  prefs.mode = 'toJson'
  prefs.format = 'auto'
  await nextTick()
  inputEl.value?.focus()
  runConvert()
})

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault()
    runConvert()
    return
  }
  if (event.key !== 'Tab' || event.shiftKey) return
  event.preventDefault()
  const el = inputEl.value
  if (!el) return
  const indent = prefs.indent === 'tab' ? '\t' : ' '.repeat(Number(prefs.indent))
  const start = el.selectionStart
  const end = el.selectionEnd
  input.value = input.value.slice(0, start) + indent + input.value.slice(end)
  nextTick(() => {
    el.selectionStart = el.selectionEnd = start + indent.length
  })
}

watch(
  () => [prefs.mode, prefs.format, prefs.target, prefs.indent, prefs.flatten, prefs.sortKeys],
  () => {
    if (output.value || error.value) runConvert()
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
        <span class="field-label">{{ prefs.mode === 'toJson' ? (locale === 'zh' ? '源格式' : 'Source') : (locale === 'zh' ? '目标格式' : 'Target') }}</span>
        <select v-if="prefs.mode === 'toJson'" v-model="prefs.format" class="select" style="width: 128px">
          <option v-for="option in formatOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
        <select v-else v-model="prefs.target" class="select" style="width: 128px">
          <option v-for="option in targetOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
      </div>
      <div class="option-group">
        <span class="field-label">{{ locale === 'zh' ? '缩进' : 'Indent' }}</span>
        <SegmentedControl v-model="prefs.indent" :options="indentOptions" />
      </div>
      <button v-if="showFlatten" type="button" class="switch-row" @click="prefs.flatten = !prefs.flatten">
        <span class="switch" :class="{ on: prefs.flatten }" />
        {{ locale === 'zh' ? '展开嵌套' : 'Flatten nested' }}
      </button>
      <button type="button" class="switch-row" @click="prefs.sortKeys = !prefs.sortKeys">
        <span class="switch" :class="{ on: prefs.sortKeys }" />
        {{ locale === 'zh' ? '键名排序' : 'Sort keys' }}
      </button>
      <span class="option-spacer" />
      <button type="button" class="btn btn-sm" @click="loadSample">
        <Sparkles :size="13" /> {{ t('action.sample') }}
      </button>
      <button type="button" class="btn btn-sm" :disabled="!input && !output" @click="clearAll">
        <Eraser :size="13" /> {{ t('action.clear') }}
      </button>
      <button type="button" class="btn btn-primary btn-sm" :disabled="!input.trim() || running" @click="runConvert">
        <Play :size="13" /> {{ running ? t('common.loading') : t('action.run') }}
      </button>
    </div>

    <div class="split">
      <Pane
        :title="t('common.input')"
        :meta="locale === 'zh' ? `${input.length} 字符` : `${input.length} chars`"
        :error="Boolean(error)"
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
          :placeholder="prefs.mode === 'toJson'
            ? (locale === 'zh' ? '粘贴 YAML / TOML / INI / .env / Properties 文本' : 'Paste YAML / TOML / INI / .env / Properties text')
            : (locale === 'zh' ? '粘贴 JSON，选择目标格式' : 'Paste JSON, then pick a target format')"
          @keydown="onKeydown"
        />
      </Pane>

      <Pane :title="t('common.output')" :error="Boolean(error)">
        <template #actions>
          <CopyButton :text="output" icon-only ghost />
        </template>
        <ErrorNote v-if="error" :error="error" />
        <div v-else-if="output || data?.warnings.length" class="convert-result">
          <div v-if="data?.warnings.length" class="warn-box" role="status">
            <strong>{{ locale === 'zh' ? '提示' : 'Notes' }}</strong>
            <ul>
              <li v-for="warning in data.warnings" :key="warning">{{ warning }}</li>
            </ul>
          </div>
          <pre v-if="output" class="output"><code>{{ output }}</code></pre>
        </div>
        <div v-else class="pane-empty">{{ t('common.empty') }}</div>
        <template v-if="data" #footer>
          <StatChips :items="statsItems" />
        </template>
      </Pane>
    </div>
  </div>
</template>
