<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ArrowLeftRight, ChevronDown, Sparkles } from 'lucide-vue-next'
import CopyButton from '@/components/CopyButton.vue'
import ErrorNote from '@/components/ErrorNote.vue'
import Pane from '@/components/Pane.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import StatChips from '@/components/StatChips.vue'
import { locale, t } from '@/core/i18n'
import { callTool } from '@/core/runner'
import { useToolPrefs } from '@/core/toolPrefs'
import type { ToolError } from '@/core/types'
import type { CodecFormat, CodecRunData } from './run'

const prefs = useToolPrefs('codec', { format: 'unicode' as CodecFormat, direction: 'encode' as 'encode' | 'decode' })
const input = ref('你好, bit_pouch 👋')
const output = ref('')
const error = ref<ToolError | null>(null)
const chars = ref<CodecRunData['chars'] | null>(null)
const running = ref(false)
const showChars = ref(false)

let seq = 0
let timer: ReturnType<typeof setTimeout> | undefined

const formatOptions = computed(() => [
  { value: 'unicode', label: 'Unicode' },
  { value: 'html', label: 'HTML' },
  { value: 'url', label: 'URL' },
  { value: 'base64', label: 'Base64' },
  { value: 'hex', label: 'UTF-8 HEX' },
])

const directionOptions = computed(() => [
  { value: 'encode', label: locale.value === 'zh' ? '编码' : 'Encode' },
  { value: 'decode', label: locale.value === 'zh' ? '解码' : 'Decode' },
])

const statsItems = computed(() => {
  if (!chars.value) return []
  return [
    { label: locale.value === 'zh' ? '字符' : 'chars', value: chars.value.total },
    { label: 'UTF-8', value: `${new TextEncoder().encode(output.value).length} B` },
  ]
})

async function runNow(): Promise<void> {
  const current = ++seq
  running.value = true
  const result = await callTool<CodecRunData>('codec', input.value, {
    format: prefs.format,
    direction: prefs.direction,
  }, locale.value)
  if (current !== seq) return
  running.value = false

  if (result.ok) {
    output.value = result.output ?? ''
    chars.value = result.data?.chars ?? null
    error.value = null
  } else {
    output.value = ''
    chars.value = null
    error.value = result.error ?? { code: 'UNKNOWN', message: t('common.error') }
  }
}

function schedule(): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(runNow, 120)
}

function setFormat(value: string): void {
  prefs.format = value as CodecFormat
}

function swap(): void {
  if (!output.value) return
  input.value = output.value
  prefs.direction = prefs.direction === 'encode' ? 'decode' : 'encode'
  runNow()
}

function loadSample(): void {
  input.value = '你好, bit_pouch 👋'
  prefs.direction = 'encode'
  runNow()
}

watch([input, () => prefs.format, () => prefs.direction], schedule)
watch(input, () => {
  if (!input.value) {
    output.value = ''
    chars.value = null
    error.value = null
  }
})

runNow()
</script>

<template>
  <div class="workbench">
    <div class="option-bar">
      <div class="tabs" role="tablist">
        <button
          v-for="option in formatOptions"
          :key="option.value"
          type="button"
          :class="{ active: prefs.format === option.value }"
          role="tab"
          :aria-selected="prefs.format === option.value"
          @click="setFormat(option.value)"
        >
          {{ option.label }}
        </button>
      </div>
      <SegmentedControl v-model="prefs.direction" :options="directionOptions" />
      <span class="option-spacer" />
      <button type="button" class="btn btn-sm" @click="loadSample"><Sparkles :size="13" /> {{ t('action.sample') }}</button>
      <button type="button" class="btn btn-sm" :disabled="!output" @click="swap">
        <ArrowLeftRight :size="13" /> {{ t('action.swap') }}
      </button>
    </div>

    <div class="split">
      <Pane :title="prefs.direction === 'encode' ? t('common.input') : (locale === 'zh' ? '已编码内容' : 'Encoded input')">
        <template #actions>
          <button type="button" class="btn btn-sm btn-ghost" @click="input = ''">{{ t('action.clear') }}</button>
        </template>
        <textarea
          v-model="input"
          class="editor"
          spellcheck="false"
          :placeholder="locale === 'zh' ? '输入要转换的内容…' : 'Type something to convert…'"
        />
      </Pane>

      <Pane :title="prefs.direction === 'encode' ? (locale === 'zh' ? '编码结果' : 'Encoded output') : t('common.output')" :error="Boolean(error)">
        <template #actions>
          <CopyButton :text="output" icon-only ghost />
        </template>
        <ErrorNote v-if="error" :error="error" />
        <pre v-else-if="output" class="output wrap">{{ output }}</pre>
        <div v-else class="pane-empty">{{ t('common.empty') }}</div>
        <template v-if="chars" #footer>
          <StatChips :items="statsItems" />
          <button type="button" class="btn btn-sm btn-ghost" style="margin-left: auto" @click="showChars = !showChars">
            <ChevronDown :size="13" class="chev" :class="{ open: showChars }" />
            {{ locale === 'zh' ? '逐字码位' : 'Code points' }}
          </button>
        </template>
      </Pane>
    </div>

    <section v-if="chars && showChars" class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>{{ locale === 'zh' ? '字符' : 'Char' }}</th>
            <th>Code point</th>
            <th>DEC</th>
            <th>UTF-8</th>
            <th>HTML</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in chars.items" :key="index">
            <td class="accent">{{ row.char }}</td>
            <td class="strong">{{ row.codePoint }}</td>
            <td class="num">{{ row.dec }}</td>
            <td>{{ row.utf8 }}</td>
            <td>{{ row.entity }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="chars.truncated" class="pane-foot" style="border-top: 1px solid var(--line)">
        {{ locale === 'zh' ? `仅显示前 ${chars.items.length} / ${chars.total} 个字符` : `Showing ${chars.items.length} of ${chars.total} characters` }}
      </div>
    </section>
  </div>
</template>
