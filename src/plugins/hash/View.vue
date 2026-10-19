<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { FileUp, ShieldAlert, ShieldCheck, Sparkles } from 'lucide-vue-next'
import CopyButton from '@/components/CopyButton.vue'
import ErrorNote from '@/components/ErrorNote.vue'
import Pane from '@/components/Pane.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import StatChips from '@/components/StatChips.vue'
import { locale, t } from '@/core/i18n'
import { callTool } from '@/core/runner'
import { useToolPrefs } from '@/core/toolPrefs'
import type { ToolError } from '@/core/types'
import { formatBytes, runFile } from './run'

type HashMode = 'text' | 'file'
type HashFormat = 'hex' | 'base64'

interface HashItem {
  algorithm: string
  hex: string
  base64: string
  value: string
  bits: number
}

interface HashExpected {
  expected: string
  match: boolean
  algorithms: string[]
}

interface HashRunData {
  results: HashItem[]
  byteLength: number
  format: HashFormat
  hmac: boolean
  expected: HashExpected | null
  fileName?: string
}

// 只持久化选项;HMAC 密钥与期望值属于输入内容,不落盘。
const prefs = useToolPrefs('hash', {
  mode: 'text' as HashMode,
  algorithms: ['md5', 'sha256'] as string[],
  format: 'hex' as HashFormat,
})

const input = ref('bit_pouch')
const hmacKey = ref('')
const expected = ref('')
const output = ref('')
const error = ref<ToolError | null>(null)
const data = ref<HashRunData | null>(null)
const file = ref<File | null>(null)
const fileEl = ref<HTMLInputElement | null>(null)
const running = ref(false)

let seq = 0
let timer: ReturnType<typeof setTimeout> | undefined

const modeOptions = computed(() => [
  { value: 'text', label: locale.value === 'zh' ? '文本' : 'Text' },
  { value: 'file', label: locale.value === 'zh' ? '文件' : 'File' },
])

const formatOptions = computed(() => [
  { value: 'hex', label: 'HEX' },
  { value: 'base64', label: 'Base64' },
])

const algorithmOptions = [
  { value: 'md5', label: 'MD5' },
  { value: 'sha1', label: 'SHA-1' },
  { value: 'sha256', label: 'SHA-256' },
  { value: 'sha384', label: 'SHA-384' },
  { value: 'sha512', label: 'SHA-512' },
  { value: 'crc32', label: 'CRC32' },
]

const weakAlgorithm = computed(() =>
  (data.value?.results ?? []).some((item) => item.algorithm === 'md5' || item.algorithm === 'sha1'),
)

const statsItems = computed(() => {
  if (!data.value) return []
  const items = [
    { label: 'bytes', value: formatBytes(data.value.byteLength) },
    { label: locale.value === 'zh' ? '算法' : 'algorithms', value: data.value.results.length },
  ]
  if (data.value.fileName) items.push({ label: locale.value === 'zh' ? '文件' : 'file', value: data.value.fileName })
  return items
})

function currentOptions(): Record<string, unknown> {
  return {
    algorithms: [...prefs.algorithms],
    format: prefs.format,
    hmacKey: hmacKey.value,
    expected: expected.value,
  }
}

function clearResult(): void {
  output.value = ''
  data.value = null
  error.value = null
}

async function runNow(): Promise<void> {
  const current = ++seq

  if (prefs.mode === 'file') {
    if (!file.value) {
      clearResult()
      return
    }
    running.value = true
    // File 不能跨 Worker 传递,文件模式直接在主线程调用同一个核心(内部限制 64MB)。
    const result = await runFile(file.value, currentOptions(), { locale: locale.value })
    if (current !== seq) return
    running.value = false
    apply(result)
    return
  }

  running.value = true
  const result = await callTool<HashRunData>('hash', input.value, currentOptions(), locale.value)
  if (current !== seq) return
  running.value = false
  apply(result)
}

function apply(result: { ok: boolean; output?: string; data?: unknown; error?: ToolError }): void {
  if (result.ok) {
    output.value = result.output ?? ''
    data.value = (result.data as HashRunData | undefined) ?? null
    error.value = null
  } else {
    output.value = ''
    data.value = null
    error.value = result.error ?? { code: 'UNKNOWN', message: t('common.error') }
  }
}

function schedule(): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(runNow, 220)
}

function pickFile(): void {
  fileEl.value?.click()
}

function onFileChange(event: Event): void {
  const target = event.target as HTMLInputElement
  file.value = target.files?.[0] ?? null
  runNow()
}

function loadSample(): void {
  prefs.mode = 'text'
  prefs.algorithms = ['md5', 'sha256']
  prefs.format = 'hex'
  hmacKey.value = ''
  expected.value = ''
  input.value = 'bit_pouch'
  file.value = null
  runNow()
}

watch([input, () => prefs.mode, () => prefs.algorithms.join(','), () => prefs.format, hmacKey, expected], schedule)
runNow()
</script>

<template>
  <div class="workbench">
    <div class="option-bar">
      <SegmentedControl v-model="prefs.mode" :options="modeOptions" />
      <span class="field-label">{{ locale === 'zh' ? '输出' : 'Output' }}</span>
      <SegmentedControl v-model="prefs.format" :options="formatOptions" />
      <span class="option-spacer" />
      <button type="button" class="btn btn-sm" @click="loadSample">
        <Sparkles :size="13" /> {{ t('action.sample') }}
      </button>
    </div>

    <div class="option-bar">
      <span class="field-label">{{ locale === 'zh' ? '算法' : 'Algorithms' }}</span>
      <label v-for="item in algorithmOptions" :key="item.value" class="option-group" style="cursor: pointer">
        <input v-model="prefs.algorithms" type="checkbox" :value="item.value" />
        <span class="field-label">{{ item.label }}</span>
      </label>
      <div class="option-group" style="margin-left: auto">
        <span class="field-label">HMAC</span>
        <input
          v-model="hmacKey"
          class="input"
          type="password"
          autocomplete="off"
          spellcheck="false"
          :placeholder="locale === 'zh' ? '密钥(可选)' : 'key (optional)'"
          style="width: 130px"
        />
      </div>
      <div class="option-group">
        <span class="field-label">{{ locale === 'zh' ? '期望值' : 'Expected' }}</span>
        <input
          v-model="expected"
          class="input"
          spellcheck="false"
          :placeholder="locale === 'zh' ? '粘贴摘要比对' : 'paste a digest'"
          style="width: 210px"
        />
      </div>
    </div>

    <div class="split">
      <Pane
        v-if="prefs.mode === 'text'"
        :title="t('common.input')"
        :meta="`UTF-8 · ${input.length}`"
        :error="Boolean(error)"
      >
        <textarea
          v-model="input"
          class="editor"
          spellcheck="false"
          :placeholder="locale === 'zh' ? '输入要计算摘要的文本' : 'Enter text to hash'"
          style="min-height: 30vh"
        />
      </Pane>

      <Pane
        v-else
        :title="locale === 'zh' ? '文件' : 'File'"
        :meta="file ? formatBytes(file.size) : ''"
        :error="Boolean(error)"
      >
        <div style="width: 100%; padding: 16px; display: flex; flex-direction: column; gap: 12px">
          <input ref="fileEl" type="file" style="display: none" @change="onFileChange" />
          <button type="button" class="btn" style="align-self: flex-start" @click="pickFile">
            <FileUp :size="14" /> {{ locale === 'zh' ? '选择文件' : 'Choose file' }}
          </button>
          <div v-if="file" class="binary-line">
            <span class="net" style="word-break: break-all">{{ file.name }}</span>
          </div>
          <div class="faint">
            {{
              locale === 'zh'
                ? '文件不会离开本机；单个文件上限 64 MB。'
                : 'Files never leave this device; the limit is 64 MB per file.'
            }}
          </div>
        </div>
      </Pane>

      <Pane :title="t('common.output')" :error="Boolean(error)">
        <template #actions>
          <CopyButton :text="output" icon-only ghost />
        </template>

        <ErrorNote v-if="error" :error="error" />
        <div v-else-if="data" style="width: 100%; padding: 14px; overflow: auto">
          <div
            v-if="data.expected"
            class="binary-line"
            :style="{ color: data.expected.match ? 'var(--accent)' : 'var(--red)', marginBottom: '12px' }"
          >
            <ShieldCheck v-if="data.expected.match" :size="15" />
            <ShieldAlert v-else :size="15" />
            <span class="net">
              {{
                data.expected.match
                  ? locale === 'zh'
                    ? `与期望值一致：${data.expected.algorithms.join(' / ')}`
                    : `Matches baseline: ${data.expected.algorithms.join(' / ')}`
                  : locale === 'zh'
                    ? '与期望值不一致'
                    : 'Does not match the baseline'
              }}
            </span>
          </div>

          <div
            v-for="item in data.results"
            :key="item.algorithm"
            class="binary-line"
            style="margin-bottom: 8px; justify-content: space-between; gap: 10px"
          >
            <span class="section-label" style="min-width: 64px">{{ item.algorithm.toUpperCase() }}</span>
            <span class="net" style="flex: 1; word-break: break-all">{{ item.value }}</span>
            <CopyButton :text="item.value" icon-only ghost />
          </div>

          <div v-if="data.hmac" class="faint" style="margin-top: 10px">
            {{
              locale === 'zh'
                ? 'HMAC 仅适用于 SHA 系列，MD5 / CRC32 已自动跳过。'
                : 'HMAC covers SHA only; MD5 / CRC32 were skipped.'
            }}
          </div>
          <div v-if="weakAlgorithm" class="error-box" style="margin-top: 10px; padding: 0">
            {{
              locale === 'zh'
                ? 'MD5 / SHA-1 已不适合安全用途，只用于校验或兼容旧系统。'
                : 'MD5 / SHA-1 are not safe for security use; keep them for checksums or legacy compatibility only.'
            }}
          </div>
        </div>
        <div v-else class="pane-empty">{{ running ? t('common.loading') : t('common.empty') }}</div>

        <template v-if="data" #footer>
          <StatChips :items="statsItems" />
        </template>
      </Pane>
    </div>
  </div>
</template>
