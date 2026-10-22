<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Eraser, Play, Sparkles } from 'lucide-vue-next'
import CopyButton from '@/components/CopyButton.vue'
import ErrorNote from '@/components/ErrorNote.vue'
import Pane from '@/components/Pane.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import StatChips from '@/components/StatChips.vue'
import { locale, t } from '@/core/i18n'
import { callTool } from '@/core/runner'
import { useToolPrefs } from '@/core/toolPrefs'
import type { ToolError } from '@/core/types'
import {
  SAMPLE_CONTAINS,
  SAMPLE_EXCLUDE,
  SAMPLE_MERGE,
  SAMPLE_RANGE,
  type IpRangeData,
  type IpRangeMode,
} from './run'

const prefs = useToolPrefs('ip-range', {
  mode: 'merge' as IpRangeMode,
})

const input = ref('')
const output = ref('')
const data = ref<IpRangeData | null>(null)
const stats = ref<Record<string, number | string> | null>(null)
const error = ref<ToolError | null>(null)
const running = ref(false)
const inputEl = ref<HTMLTextAreaElement | null>(null)

let runSeq = 0

const modeOptions = computed<Array<{ value: string; label: string }>>(() => [
  { value: 'merge', label: locale.value === 'zh' ? '合并' : 'Merge' },
  { value: 'range', label: locale.value === 'zh' ? '范围' : 'Range' },
  { value: 'contains', label: locale.value === 'zh' ? '包含' : 'Contains' },
  { value: 'exclude', label: locale.value === 'zh' ? '排除' : 'Exclude' },
])

const hint = computed(() => {
  if (prefs.mode === 'contains') {
    return locale.value === 'zh'
      ? '第一行是基准 CIDR / 范围，后续每行是要判断的地址'
      : 'First line is the base CIDR / range; following lines are addresses to test'
  }
  if (prefs.mode === 'exclude') {
    return locale.value === 'zh'
      ? '第一行是基准 CIDR / 范围，后续每行是要排除的子段'
      : 'First line is the base CIDR / range; following lines are sub-ranges to exclude'
  }
  if (prefs.mode === 'range') {
    return locale.value === 'zh'
      ? '每行一个 CIDR（输出起止）或 start-end（输出 CIDR 集）'
      : 'One CIDR per line (→ start/end) or start-end (→ CIDR set)'
  }
  return locale.value === 'zh'
    ? '每行一个 CIDR / 地址 / start-end，自动合并相邻段'
    : 'One CIDR / address / start-end per line; adjacent spans are merged'
})

const statsItems = computed(() => {
  const items: Array<{ label: string; value: string | number }> = []
  if (data.value) items.push({ label: 'family', value: data.value.family })
  if (stats.value?.ranges !== undefined) items.push({ label: locale.value === 'zh' ? '段' : 'ranges', value: Number(stats.value.ranges) })
  if (stats.value?.cidrs !== undefined) items.push({ label: 'CIDR', value: Number(stats.value.cidrs) })
  if (stats.value?.tested !== undefined) items.push({ label: locale.value === 'zh' ? '测试' : 'tested', value: Number(stats.value.tested) })
  if (stats.value?.contained !== undefined) items.push({ label: locale.value === 'zh' ? '命中' : 'hit', value: Number(stats.value.contained) })
  return items
})

async function runCalc(): Promise<void> {
  if (!input.value.trim()) {
    output.value = ''
    data.value = null
    stats.value = null
    error.value = null
    return
  }

  const seq = ++runSeq
  running.value = true
  const result = await callTool<IpRangeData>('ip-range', input.value, { mode: prefs.mode }, locale.value)
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
  if (prefs.mode === 'contains') input.value = SAMPLE_CONTAINS
  else if (prefs.mode === 'exclude') input.value = SAMPLE_EXCLUDE
  else input.value = prefs.mode === 'range' ? SAMPLE_RANGE : SAMPLE_MERGE
  nextTick(() => {
    inputEl.value?.focus()
    runCalc()
  })
}

function clearAll(): void {
  runSeq++
  running.value = false
  input.value = ''
  output.value = ''
  data.value = null
  stats.value = null
  error.value = null
  nextTick(() => inputEl.value?.focus())
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault()
    runCalc()
  }
}

watch(
  () => prefs.mode,
  () => {
    if (output.value || error.value) runCalc()
  },
)
</script>

<template>
  <div class="workbench">
    <div class="option-bar">
      <div class="option-group">
        <span class="field-label">{{ locale === 'zh' ? '模式' : 'Mode' }}</span>
        <SegmentedControl v-model="prefs.mode" :options="modeOptions" />
      </div>
      <span class="faint" style="font-size: 11.5px">{{ hint }}</span>
      <span class="option-spacer" />
      <button type="button" class="btn btn-sm" @click="loadSample">
        <Sparkles :size="13" /> {{ t('action.sample') }}
      </button>
      <button type="button" class="btn btn-sm" :disabled="!input && !output" @click="clearAll">
        <Eraser :size="13" /> {{ t('action.clear') }}
      </button>
      <button type="button" class="btn btn-primary btn-sm" :disabled="!input.trim() || running" @click="runCalc">
        <Play :size="13" /> {{ running ? t('common.loading') : t('action.run') }}
      </button>
    </div>

    <div class="split">
      <Pane
        :title="t('common.input')"
        :meta="locale === 'zh' ? 'IPv4 / IPv6' : 'IPv4 / IPv6'"
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
          :placeholder="hint"
          @keydown="onKeydown"
        />
      </Pane>

      <Pane :title="t('common.output')" :error="Boolean(error)">
        <template #actions>
          <CopyButton :text="output" icon-only ghost />
        </template>
        <ErrorNote v-if="error" :error="error" />
        <div v-else-if="data" class="http-result">
          <div v-if="data.base" class="result-card" style="margin-bottom: 10px">
            <div class="k">{{ locale === 'zh' ? '基准' : 'BASE' }}</div>
            <div class="v" style="word-break: break-all">{{ data.base.start }} — {{ data.base.end }}</div>
          </div>

          <div v-if="prefs.mode === 'contains'" class="table-wrap" style="max-height: 44vh">
            <table class="data-table">
              <thead>
                <tr>
                  <th>ADDRESS</th>
                  <th>IN RANGE</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, index) in data.rows" :key="index">
                  <td class="strong" style="word-break: break-all">{{ row.input }}</td>
                  <td :class="row.contained ? 'accent' : 'offset'">{{ row.contained ? 'true' : 'false' }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div v-else class="table-wrap" style="max-height: 44vh">
            <table class="data-table">
              <thead>
                <tr>
                  <th v-if="prefs.mode !== 'merge'">{{ locale === 'zh' ? '输入' : 'INPUT' }}</th>
                  <th v-if="prefs.mode === 'range'">{{ locale === 'zh' ? '起止 / CIDR' : 'RANGE / CIDR' }}</th>
                  <th v-else>CIDR</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, index) in data.rows" :key="index">
                  <td v-if="prefs.mode !== 'merge'" class="offset" style="word-break: break-all">{{ row.input }}</td>
                  <td class="strong" style="word-break: break-all">
                    <template v-if="row.cidrs">{{ row.cidrs.join(', ') }}</template>
                    <template v-else>{{ row.start }} - {{ row.end }}</template>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <pre v-if="output" class="output" style="max-height: 20vh; margin-top: 10px"><code>{{ output }}</code></pre>
        </div>
        <div v-else class="pane-empty">{{ t('common.empty') }}</div>
        <template v-if="data" #footer>
          <StatChips :items="statsItems" />
        </template>
      </Pane>
    </div>
  </div>
</template>
