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
import { SAMPLE_MATCH, SAMPLE_PARSE, SAMPLE_VALIDATE, type MqttData, type MqttMode } from './run'

const prefs = useToolPrefs('mqtt-topic', {
  mode: 'parse' as MqttMode,
})

const input = ref('')
const output = ref('')
const data = ref<MqttData | null>(null)
const stats = ref<Record<string, number | string> | null>(null)
const error = ref<ToolError | null>(null)
const running = ref(false)
const inputEl = ref<HTMLTextAreaElement | null>(null)

let runSeq = 0

const modeOptions = computed<Array<{ value: string; label: string }>>(() => [
  { value: 'parse', label: locale.value === 'zh' ? '解析' : 'Parse' },
  { value: 'match', label: locale.value === 'zh' ? '匹配' : 'Match' },
  { value: 'validate', label: locale.value === 'zh' ? '校验' : 'Validate' },
])

const hint = computed(() => {
  if (prefs.mode === 'match') {
    return locale.value === 'zh'
      ? '第一行是主题过滤器，后续每行是要匹配的具体主题'
      : 'First line is the filter; following lines are concrete topics'
  }
  if (prefs.mode === 'validate') {
    return locale.value === 'zh'
      ? '每行分别校验：能否作为过滤器、能否作为发布主题'
      : 'Each line is checked as both a filter and a publish topic'
  }
  return locale.value === 'zh'
    ? '每行一个主题或过滤器；# 不是注释'
    : 'One topic or filter per line; # is a wildcard, not a comment'
})

const statsItems = computed(() => {
  const items: Array<{ label: string; value: string | number }> = []
  if (!data.value) return items
  if (prefs.mode === 'parse') {
    items.push({ label: locale.value === 'zh' ? '主题' : 'topics', value: data.value.rows.length })
    if (stats.value?.wildcards !== undefined) items.push({ label: 'wildcards', value: Number(stats.value.wildcards) })
    if (stats.value?.shared !== undefined) items.push({ label: 'shared', value: Number(stats.value.shared) })
  } else if (prefs.mode === 'match') {
    if (stats.value?.matched !== undefined) items.push({ label: locale.value === 'zh' ? '命中' : 'matched', value: Number(stats.value.matched) })
    if (stats.value?.tested !== undefined) items.push({ label: locale.value === 'zh' ? '测试' : 'tested', value: Number(stats.value.tested) })
  } else {
    if (stats.value?.validFilters !== undefined) items.push({ label: locale.value === 'zh' ? '合法过滤器' : 'valid filters', value: Number(stats.value.validFilters) })
    if (stats.value?.validTopics !== undefined) items.push({ label: locale.value === 'zh' ? '合法主题' : 'valid topics', value: Number(stats.value.validTopics) })
  }
  return items
})

function wildcardText(row: MqttData['rows'][number]): string {
  return (row.wildcards ?? []).map((wildcard) => `${wildcard.kind}@${wildcard.level}`).join(', ') || '—'
}

async function runTool(): Promise<void> {
  if (!input.value.trim()) {
    output.value = ''
    data.value = null
    stats.value = null
    error.value = null
    return
  }

  const seq = ++runSeq
  running.value = true
  const result = await callTool<MqttData>('mqtt-topic', input.value, { mode: prefs.mode }, locale.value)
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
  input.value = prefs.mode === 'match' ? SAMPLE_MATCH : prefs.mode === 'validate' ? SAMPLE_VALIDATE : SAMPLE_PARSE
  nextTick(() => {
    inputEl.value?.focus()
    runTool()
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
    runTool()
  }
}

watch(
  () => prefs.mode,
  () => {
    if (output.value || error.value) runTool()
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
      <button type="button" class="btn btn-primary btn-sm" :disabled="!input.trim() || running" @click="runTool">
        <Play :size="13" /> {{ running ? t('common.loading') : t('action.run') }}
      </button>
    </div>

    <div class="split">
      <Pane :title="t('common.input')" :meta="locale === 'zh' ? 'MQTT 主题' : 'MQTT topics'" :error="Boolean(error)">
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
          <div class="table-wrap" style="max-height: 46vh">
            <table v-if="prefs.mode === 'parse'" class="data-table">
              <thead>
                <tr>
                  <th>TOPIC</th>
                  <th>LEVELS</th>
                  <th>WILDCARDS</th>
                  <th>FLAGS</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, index) in data.rows" :key="index">
                  <td class="strong" style="word-break: break-all">{{ row.input }}</td>
                  <td class="offset">{{ row.levels?.length ?? 0 }}</td>
                  <td>{{ wildcardText(row) }}</td>
                  <td class="offset">
                    <template v-if="row.shared">shared:{{ row.shared.group }}</template>
                    <template v-else-if="row.system">$system</template>
                    <template v-else>—</template>
                  </td>
                </tr>
              </tbody>
            </table>

            <table v-else-if="prefs.mode === 'match'" class="data-table">
              <thead>
                <tr>
                  <th>TOPIC</th>
                  <th>MATCHED</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, index) in data.rows" :key="index">
                  <td class="strong" style="word-break: break-all">{{ row.input }}</td>
                  <td :class="row.matched ? 'accent' : 'offset'">{{ row.matched ? 'true' : 'false' }}</td>
                </tr>
              </tbody>
            </table>

            <table v-else class="data-table">
              <thead>
                <tr>
                  <th>TOPIC</th>
                  <th>FILTER</th>
                  <th>PUBLISH</th>
                  <th>ERRORS</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, index) in data.rows" :key="index">
                  <td class="strong" style="word-break: break-all">{{ row.input }}</td>
                  <td :class="row.validFilter ? 'accent' : 'offset'">{{ row.validFilter ? 'true' : 'false' }}</td>
                  <td :class="row.validTopic ? 'accent' : 'offset'">{{ row.validTopic ? 'true' : 'false' }}</td>
                  <td class="offset" style="word-break: break-word">{{ row.errors?.join(' · ') || '—' }}</td>
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
