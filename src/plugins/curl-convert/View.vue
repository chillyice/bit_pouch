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
import { SAMPLE_FORM, SAMPLE_JSON, type CurlConvertData, type CurlTarget } from './run'

const prefs = useToolPrefs('curl-convert', {
  target: 'fetch' as CurlTarget,
})

const input = ref('')
const output = ref('')
const data = ref<CurlConvertData | null>(null)
const stats = ref<Record<string, number | string> | null>(null)
const error = ref<ToolError | null>(null)
const running = ref(false)
const inputEl = ref<HTMLTextAreaElement | null>(null)

let runSeq = 0

const targetOptions = computed<Array<{ value: string; label: string }>>(() => [
  { value: 'fetch', label: 'fetch' },
  { value: 'axios', label: 'axios' },
  { value: 'python', label: 'Python' },
  { value: 'go', label: 'Go' },
  { value: 'powershell', label: 'PowerShell' },
])

const bodyKind = computed(() => {
  const request = data.value?.request
  if (!request) return '—'
  if (request.form?.length) return locale.value === 'zh' ? `表单 · ${request.form.length} 字段` : `form · ${request.form.length} fields`
  if (request.body) return locale.value === 'zh' ? `正文 · ${request.body.length} 字符` : `body · ${request.body.length} chars`
  return locale.value === 'zh' ? '无正文' : 'no body'
})

const statsItems = computed(() => {
  const items: Array<{ label: string; value: string | number }> = []
  if (data.value) {
    items.push({ label: 'method', value: data.value.request.method })
    items.push({ label: 'headers', value: data.value.request.headers.length })
    items.push({ label: locale.value === 'zh' ? '正文' : 'body', value: bodyKind.value })
  }
  if (stats.value?.target) items.push({ label: 'target', value: String(stats.value.target) })
  return items
})

async function runConvert(): Promise<void> {
  if (!input.value.trim()) {
    output.value = ''
    data.value = null
    stats.value = null
    error.value = null
    return
  }

  const seq = ++runSeq
  running.value = true
  const result = await callTool<CurlConvertData>('curl-convert', input.value, { target: prefs.target }, locale.value)

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

function loadSample(kind: 'json' | 'form'): void {
  input.value = kind === 'json' ? SAMPLE_JSON : SAMPLE_FORM
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
  data.value = null
  stats.value = null
  error.value = null
  nextTick(() => inputEl.value?.focus())
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault()
    runConvert()
  }
}

watch(
  () => prefs.target,
  () => {
    if (output.value || error.value) runConvert()
  },
)
</script>

<template>
  <div class="workbench">
    <div class="option-bar">
      <div class="option-group">
        <span class="field-label">{{ locale === 'zh' ? '目标' : 'Target' }}</span>
        <SegmentedControl v-model="prefs.target" :options="targetOptions" />
      </div>
      <span class="option-spacer" />
      <button type="button" class="btn btn-sm" @click="loadSample('json')">
        <Sparkles :size="13" /> JSON
      </button>
      <button type="button" class="btn btn-sm" @click="loadSample('form')">
        <Sparkles :size="13" /> Form
      </button>
      <button type="button" class="btn btn-sm" :disabled="!input && !output" @click="clearAll">
        <Eraser :size="13" /> {{ t('action.clear') }}
      </button>
      <button type="button" class="btn btn-primary btn-sm" :disabled="!input.trim() || running" @click="runConvert">
        <Play :size="13" /> {{ running ? t('common.loading') : t('action.run') }}
      </button>
    </div>

    <div class="split">
      <Pane :title="t('common.input')" :meta="locale === 'zh' ? 'cURL 命令' : 'cURL command'" :error="Boolean(error)">
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
          :placeholder="locale === 'zh' ? '粘贴 cURL 命令（只解析，不执行）' : 'Paste a cURL command (parsed, never executed)'"
          @keydown="onKeydown"
        />
      </Pane>

      <Pane :title="t('common.output')" :error="Boolean(error)">
        <template #actions>
          <CopyButton :text="output" icon-only ghost />
        </template>
        <ErrorNote v-if="error" :error="error" />
        <div v-else-if="output" class="convert-result">
          <div v-if="data?.warnings.length" class="warn-box" role="status">
            <strong>{{ locale === 'zh' ? '提示' : 'Notes' }}</strong>
            <ul>
              <li v-for="warning in data.warnings" :key="warning">{{ warning }}</li>
            </ul>
          </div>
          <div v-if="data" class="result-card" style="margin: 10px 12px 0">
            <div class="k">{{ data.request.method }}</div>
            <div class="v" style="word-break: break-all">{{ data.request.url }}</div>
          </div>
          <pre class="output"><code>{{ output }}</code></pre>
        </div>
        <div v-else class="pane-empty">{{ t('common.empty') }}</div>
        <template v-if="data" #footer>
          <StatChips :items="statsItems" />
        </template>
      </Pane>
    </div>

    <p class="faint" style="margin: 0; font-size: 11.5px">
      {{ locale === 'zh'
        ? '只做词法解析，不执行命令、不展开变量、不发起网络请求；URL、Cookie 与 token 不会写入本地存储。'
        : 'Lexical parsing only: nothing is executed, expanded or sent. URLs, cookies and tokens are never stored.' }}
    </p>
  </div>
</template>
