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
import { SAMPLE_BUILD, SAMPLE_PARSE, type HttpMessageData } from './run'

const prefs = useToolPrefs('http-message', {
  mode: 'parse' as 'parse' | 'build',
  kind: 'auto' as 'auto' | 'request' | 'response',
  lineEnding: 'crlf' as 'crlf' | 'lf',
  autoContentLength: true,
})

const input = ref('')
const output = ref('')
const data = ref<HttpMessageData | null>(null)
const stats = ref<Record<string, number | string> | null>(null)
const error = ref<ToolError | null>(null)
const running = ref(false)
const inputEl = ref<HTMLTextAreaElement | null>(null)

let runSeq = 0

const modeOptions = computed(() => [
  { value: 'parse', label: locale.value === 'zh' ? '解析' : 'Parse' },
  { value: 'build', label: locale.value === 'zh' ? '生成' : 'Build' },
])

const kindOptions = computed(() => [
  { value: 'auto', label: locale.value === 'zh' ? '自动' : 'Auto' },
  { value: 'request', label: locale.value === 'zh' ? '请求' : 'Request' },
  { value: 'response', label: locale.value === 'zh' ? '响应' : 'Response' },
])

const lineEndingOptions = computed(() => [
  { value: 'crlf', label: 'CRLF' },
  { value: 'lf', label: 'LF' },
])

const statsItems = computed(() => {
  const items: Array<{ label: string; value: string | number }> = []
  if (stats.value?.kind) items.push({ label: locale.value === 'zh' ? '类型' : 'kind', value: String(stats.value.kind) })
  if (stats.value?.headers !== undefined) items.push({ label: 'headers', value: Number(stats.value.headers) })
  if (stats.value?.cookies !== undefined) items.push({ label: 'cookies', value: Number(stats.value.cookies) })
  if (stats.value?.bytes !== undefined) items.push({ label: locale.value === 'zh' ? '大小' : 'size', value: formatBytes(Number(stats.value.bytes)) })
  return items
})

const startLine = computed(() => {
  const value = data.value
  if (!value) return ''
  if (value.response) return `${value.response.version} ${value.response.status} ${value.response.reason}`.trim()
  if (value.request) return `${value.request.method} ${value.request.target} ${value.request.version}`
  return ''
})

const bodyPreview = computed(() => {
  const body = data.value?.body
  if (!body) return ''
  if (body.json !== undefined) return JSON.stringify(body.json, null, 2)
  return body.raw
})

const cookieRows = computed(() =>
  (data.value?.cookies ?? []).map((cookie) => ({
    name: cookie.name,
    value: cookie.value,
    attributes: Object.entries(cookie.attributes)
      .map(([key, value]) => (value === '' ? key : `${key}=${value}`))
      .join('; '),
  })),
)

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
  const result = await callTool<HttpMessageData>(
    'http-message',
    input.value,
    {
      mode: prefs.mode,
      kind: prefs.kind,
      lineEnding: prefs.lineEnding,
      autoContentLength: prefs.autoContentLength,
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
  input.value = prefs.mode === 'build' ? SAMPLE_BUILD : SAMPLE_PARSE
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
  () => [prefs.mode, prefs.kind, prefs.lineEnding, prefs.autoContentLength],
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
      <div class="option-group">
        <span class="field-label">{{ locale === 'zh' ? '报文类型' : 'Kind' }}</span>
        <select v-model="prefs.kind" class="select" style="width: 108px">
          <option v-for="option in kindOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
      </div>
      <template v-if="prefs.mode === 'build'">
        <div class="option-group">
          <span class="field-label">{{ locale === 'zh' ? '换行' : 'Newline' }}</span>
          <SegmentedControl v-model="prefs.lineEnding" :options="lineEndingOptions" />
        </div>
        <button type="button" class="switch-row" @click="prefs.autoContentLength = !prefs.autoContentLength">
          <span class="switch" :class="{ on: prefs.autoContentLength }" />
          Content-Length
        </button>
      </template>
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
      <Pane
        :title="t('common.input')"
        :meta="prefs.mode === 'build' ? (locale === 'zh' ? 'JSON 描述' : 'JSON description') : (locale === 'zh' ? '原始报文' : 'raw message')"
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
          :placeholder="prefs.mode === 'build'
            ? (locale === 'zh' ? '粘贴 JSON 描述，生成原始报文' : 'Paste a JSON description to build a raw message')
            : (locale === 'zh' ? '粘贴原始 HTTP 请求或响应（含空行与正文）' : 'Paste a raw HTTP request or response')"
          @keydown="onKeydown"
        />
      </Pane>

      <Pane :title="t('common.output')" :error="Boolean(error)">
        <template #actions>
          <CopyButton :text="output" icon-only ghost />
        </template>
        <ErrorNote v-if="error" :error="error" />
        <div v-else-if="prefs.mode === 'parse' && data" class="http-result">
          <div v-if="data.warnings.length" class="warn-box" role="status">
            <strong>{{ locale === 'zh' ? '提示' : 'Notes' }}</strong>
            <ul>
              <li v-for="warning in data.warnings" :key="warning">{{ warning }}</li>
            </ul>
          </div>

          <div class="result-card">
            <div class="k">{{ data.kind === 'request' ? 'REQUEST' : 'RESPONSE' }}</div>
            <div class="v big" style="word-break: break-all">{{ startLine }}</div>
          </div>

          <div class="section-label" style="margin: 10px 0 6px">
            {{ locale === 'zh' ? '头部' : 'Headers' }} · {{ data.headers.length }}
          </div>
          <div class="table-wrap" style="max-height: 20vh">
            <table class="data-table">
              <tbody>
                <tr v-for="(header, index) in data.headers" :key="`${header.rawName}-${index}`">
                  <td class="strong">{{ header.rawName }}</td>
                  <td style="word-break: break-all">{{ header.value }}</td>
                  <td style="width: 34px">
                    <CopyButton :text="`${header.rawName}: ${header.value}`" icon-only ghost />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <template v-if="cookieRows.length">
            <div class="section-label" style="margin: 12px 0 6px">{{ locale === 'zh' ? 'Cookie' : 'Cookies' }} · {{ cookieRows.length }}</div>
            <div class="table-wrap" style="max-height: 18vh">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>NAME</th>
                    <th>VALUE</th>
                    <th>ATTRIBUTES</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(cookie, index) in cookieRows" :key="`${cookie.name}-${index}`">
                    <td class="strong">{{ cookie.name }}</td>
                    <td style="word-break: break-all">{{ cookie.value }}</td>
                    <td class="offset">{{ cookie.attributes || '—' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>

          <template v-if="data.query.length">
            <div class="section-label" style="margin: 12px 0 6px">{{ locale === 'zh' ? '查询参数' : 'Query' }} · {{ data.query.length }}</div>
            <div class="table-wrap" style="max-height: 18vh">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>KEY</th>
                    <th>VALUE</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(item, index) in data.query" :key="`${item.key}-${index}`">
                    <td class="strong">{{ item.key }}</td>
                    <td style="word-break: break-all">{{ item.value }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>

          <div class="section-label" style="margin: 12px 0 6px">
            {{ locale === 'zh' ? '正文' : 'Body' }} · {{ data.body.bytes }} B · {{ data.body.encoding }}
            <template v-if="data.body.contentType"> · {{ data.body.contentType }}</template>
          </div>

          <template v-if="data.body.form?.length">
            <div class="table-wrap" style="max-height: 18vh">
              <table class="data-table">
                <tbody>
                  <tr v-for="(item, index) in data.body.form" :key="`${item.key}-${index}`">
                    <td class="strong">{{ item.key }}</td>
                    <td style="word-break: break-all">{{ item.value }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>

          <template v-else-if="data.body.multipart?.length">
            <div class="table-wrap" style="max-height: 20vh">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>NAME</th>
                    <th>FILENAME</th>
                    <th>TYPE</th>
                    <th>BYTES</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(part, index) in data.body.multipart" :key="`${part.name}-${index}`">
                    <td class="strong">{{ part.name }}</td>
                    <td>{{ part.filename || '—' }}</td>
                    <td class="offset">{{ part.contentType || '—' }}</td>
                    <td>{{ part.bytes }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>

          <template v-else-if="data.body.chunks?.length">
            <div class="table-wrap" style="max-height: 18vh">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>SIZE</th>
                    <th>BYTES</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(chunk, index) in data.body.chunks" :key="index">
                    <td class="offset">{{ index + 1 }}</td>
                    <td>{{ chunk.size }}</td>
                    <td>{{ chunk.bytes }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>

          <pre v-if="bodyPreview" class="output" style="max-height: 28vh; margin-top: 8px"><code>{{ bodyPreview }}</code></pre>
        </div>

        <div v-else-if="prefs.mode === 'build' && output" class="convert-result">
          <pre class="output"><code>{{ output }}</code></pre>
        </div>

        <div v-else class="pane-empty">{{ t('common.empty') }}</div>

        <template v-if="stats" #footer>
          <StatChips :items="statsItems" />
        </template>
      </Pane>
    </div>

    <p class="faint" style="margin: 0; font-size: 11.5px">
      {{ locale === 'zh'
        ? 'Cookie、Authorization 与正文只在本页内存中存在，不会写入本地存储或发送到任何服务器。'
        : 'Cookies, Authorization and bodies stay in page memory only; nothing is stored or sent anywhere.' }}
    </p>
  </div>
</template>
