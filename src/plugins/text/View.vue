<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Sparkles, Trash2 } from 'lucide-vue-next'
import CopyButton from '@/components/CopyButton.vue'
import ErrorNote from '@/components/ErrorNote.vue'
import Pane from '@/components/Pane.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import StatChips from '@/components/StatChips.vue'
import { locale, t } from '@/core/i18n'
import { callTool } from '@/core/runner'
import { useToolPrefs } from '@/core/toolPrefs'
import type { ToolError } from '@/core/types'

type Mode = 'clean' | 'case' | 'table' | 'diff'
type Sort = 'none' | 'asc' | 'desc' | 'length'
type Width = 'none' | 'half' | 'full'

interface DiffRow {
  type: 'same' | 'add' | 'del'
  left?: string
  right?: string
  leftNo?: number
  rightNo?: number
}

interface TextData {
  stats?: Record<string, number>
  camel?: string
  pascal?: string
  snake?: string
  kebab?: string
  constant?: string
  rows?: string[][]
}

interface TextResult {
  output: string
  data: TextData | DiffRow[] | null
  stats: Record<string, number>
}

const prefs = useToolPrefs('text', {
  mode: 'clean' as Mode,
  trim: true,
  dropEmpty: false,
  dedupe: false,
  reverse: false,
  numberLines: false,
  sort: 'none' as Sort,
  width: 'none' as Width,
  prefix: '',
  suffix: '',
  joinWith: '',
  tableDirection: 'markdown' as 'markdown' | 'csv',
  tableAlign: 'left' as 'left' | 'center' | 'right',
  diffIgnoreWhitespace: false,
  diffIgnoreCase: false,
})

const left = ref('hello world\n  hello world\nHELLO WORLD\n')
const right = ref('hello world\nHello World\n')
const output = ref('')
const data = ref<TextData | DiffRow[] | null>(null)
const stats = ref<Record<string, string | number>>({})
const error = ref<ToolError | null>(null)
const running = ref(false)

let seq = 0
let timer: ReturnType<typeof setTimeout> | undefined

const modeOptions = computed(() => [
  { value: 'clean', label: locale.value === 'zh' ? '清洗' : 'Clean' },
  { value: 'case', label: locale.value === 'zh' ? '命名' : 'Case' },
  { value: 'table', label: locale.value === 'zh' ? '表格' : 'Table' },
  { value: 'diff', label: locale.value === 'zh' ? '对比' : 'Diff' },
])

const sortOptions = computed(() => [
  { value: 'none', label: locale.value === 'zh' ? '原序' : 'Original' },
  { value: 'asc', label: locale.value === 'zh' ? '升序' : 'A → Z' },
  { value: 'desc', label: locale.value === 'zh' ? '降序' : 'Z → A' },
  { value: 'length', label: locale.value === 'zh' ? '按长度' : 'By length' },
])

const widthOptions = computed(() => [
  { value: 'none', label: locale.value === 'zh' ? '保持' : 'Keep' },
  { value: 'half', label: locale.value === 'zh' ? '半角' : 'Half' },
  { value: 'full', label: locale.value === 'zh' ? '全角' : 'Full' },
])

const caseRows = computed(() => {
  if (prefs.mode !== 'case' || !data.value || Array.isArray(data.value)) return []
  const value = data.value
  return [
    { key: 'camel', label: 'camelCase', value: value.camel ?? '' },
    { key: 'pascal', label: 'PascalCase', value: value.pascal ?? '' },
    { key: 'snake', label: 'snake_case', value: value.snake ?? '' },
    { key: 'kebab', label: 'kebab-case', value: value.kebab ?? '' },
    { key: 'constant', label: 'CONSTANT_CASE', value: value.constant ?? '' },
  ]
})

const diffRows = computed<DiffRow[]>(() => (prefs.mode === 'diff' && Array.isArray(data.value) ? data.value : []))

const statsItems = computed(() => {
  const value = stats.value
  const items: Array<{ label: string; value: string | number }> = []
  if (typeof value.chars === 'number') items.push({ label: locale.value === 'zh' ? '字符' : 'chars', value: value.chars })
  if (typeof value.lines === 'number') items.push({ label: locale.value === 'zh' ? '行' : 'lines', value: value.lines })
  if (typeof value.bytes === 'number') items.push({ label: locale.value === 'zh' ? '字节' : 'bytes', value: value.bytes })
  if (typeof value.words === 'number') items.push({ label: locale.value === 'zh' ? '词' : 'words', value: value.words })
  if (typeof value.rows === 'number') items.push({ label: locale.value === 'zh' ? '行' : 'rows', value: value.rows })
  if (typeof value.columns === 'number') items.push({ label: locale.value === 'zh' ? '列' : 'cols', value: value.columns })
  if (typeof value.added === 'number') items.push({ label: '+', value: value.added })
  if (typeof value.removed === 'number') items.push({ label: '−', value: value.removed })
  return items
})

const copyText = computed(() => (prefs.mode === 'case' ? caseRows.value.map((row) => `${row.label}: ${row.value}`).join('\n') : output.value))

function currentOptions(): Record<string, unknown> {
  const options: Record<string, unknown> = { mode: prefs.mode }
  if (prefs.mode === 'clean') {
    Object.assign(options, {
      trim: prefs.trim,
      dropEmpty: prefs.dropEmpty,
      dedupe: prefs.dedupe,
      reverse: prefs.reverse,
      numberLines: prefs.numberLines,
      sort: prefs.sort,
      width: prefs.width,
      prefix: prefs.prefix,
      suffix: prefs.suffix,
      joinWith: prefs.joinWith,
    })
  } else if (prefs.mode === 'table') {
    Object.assign(options, {
      tableTo: prefs.tableDirection === 'csv' ? 'delimited' : 'markdown',
      align: prefs.tableAlign,
    })
  } else if (prefs.mode === 'diff') {
    Object.assign(options, {
      second: right.value,
      ignoreWhitespace: prefs.diffIgnoreWhitespace,
      ignoreCase: prefs.diffIgnoreCase,
    })
  }
  return options
}

async function runNow(): Promise<void> {
  const current = ++seq
  running.value = true
  const result = await callTool<TextResult['data']>('text', left.value, currentOptions(), locale.value)
  if (current !== seq) return
  running.value = false

  if (result.ok) {
    output.value = result.output ?? ''
    data.value = (result.data as TextData | DiffRow[]) ?? null
    stats.value = result.stats ?? {}
    error.value = null
  } else {
    output.value = ''
    data.value = null
    stats.value = {}
    error.value = result.error ?? { code: 'UNKNOWN', message: t('common.error') }
  }
}

function schedule(): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(runNow, 180)
}

function loadSample(): void {
  prefs.mode = 'diff'
  left.value = 'alpha\nbravo\ncharlie\ndelta'
  right.value = 'alpha\ncharlie\nbravo\necho'
  runNow()
}

function clearAll(): void {
  left.value = ''
  right.value = ''
  runNow()
}

watch(
  [
    left,
    right,
    () => prefs.mode,
    () => prefs.trim,
    () => prefs.dropEmpty,
    () => prefs.dedupe,
    () => prefs.reverse,
    () => prefs.numberLines,
    () => prefs.sort,
    () => prefs.width,
    () => prefs.prefix,
    () => prefs.suffix,
    () => prefs.joinWith,
    () => prefs.tableDirection,
    () => prefs.tableAlign,
    () => prefs.diffIgnoreWhitespace,
    () => prefs.diffIgnoreCase,
  ],
  schedule,
)
runNow()
</script>

<template>
  <div class="workbench">
    <div class="option-bar">
      <SegmentedControl v-model="prefs.mode" :options="modeOptions" />
      <span class="option-spacer" />
      <button type="button" class="btn btn-sm" @click="loadSample">
        <Sparkles :size="13" /> {{ t('action.sample') }}
      </button>
      <button type="button" class="btn btn-sm btn-ghost" @click="clearAll">
        <Trash2 :size="13" /> {{ t('action.clear') }}
      </button>
    </div>

    <div v-if="prefs.mode === 'clean'" class="option-bar">
      <label class="option-group" style="cursor: pointer">
        <input v-model="prefs.trim" type="checkbox" />
        <span class="field-label">{{ locale === 'zh' ? '去首尾空白' : 'Trim' }}</span>
      </label>
      <label class="option-group" style="cursor: pointer">
        <input v-model="prefs.dropEmpty" type="checkbox" />
        <span class="field-label">{{ locale === 'zh' ? '删空行' : 'Drop empty' }}</span>
      </label>
      <label class="option-group" style="cursor: pointer">
        <input v-model="prefs.dedupe" type="checkbox" />
        <span class="field-label">{{ locale === 'zh' ? '去重' : 'Dedupe' }}</span>
      </label>
      <label class="option-group" style="cursor: pointer">
        <input v-model="prefs.reverse" type="checkbox" />
        <span class="field-label">{{ locale === 'zh' ? '倒序' : 'Reverse' }}</span>
      </label>
      <label class="option-group" style="cursor: pointer">
        <input v-model="prefs.numberLines" type="checkbox" />
        <span class="field-label">{{ locale === 'zh' ? '行号' : 'Number' }}</span>
      </label>
      <div class="option-group">
        <span class="field-label">{{ locale === 'zh' ? '排序' : 'Sort' }}</span>
        <SegmentedControl v-model="prefs.sort" :options="sortOptions" />
      </div>
      <div class="option-group">
        <span class="field-label">{{ locale === 'zh' ? '宽度' : 'Width' }}</span>
        <SegmentedControl v-model="prefs.width" :options="widthOptions" />
      </div>
    </div>

    <div v-if="prefs.mode === 'clean'" class="option-bar">
      <div class="option-group">
        <span class="field-label">{{ locale === 'zh' ? '前缀' : 'Prefix' }}</span>
        <input v-model="prefs.prefix" class="input" style="width: 120px" placeholder="// " />
      </div>
      <div class="option-group">
        <span class="field-label">{{ locale === 'zh' ? '后缀' : 'Suffix' }}</span>
        <input v-model="prefs.suffix" class="input" style="width: 120px" placeholder=";" />
      </div>
      <div class="option-group">
        <span class="field-label">{{ locale === 'zh' ? '合并符' : 'Join' }}</span>
        <input v-model="prefs.joinWith" class="input" style="width: 120px" placeholder=", " />
      </div>
    </div>

    <div v-if="prefs.mode === 'table'" class="option-bar">
      <SegmentedControl
        v-model="prefs.tableDirection"
        :options="[
          { value: 'markdown', label: 'Markdown' },
          { value: 'csv', label: 'CSV' },
        ]"
      />
      <div v-if="prefs.tableDirection === 'markdown'" class="option-group">
        <span class="field-label">{{ locale === 'zh' ? '对齐' : 'Align' }}</span>
        <select v-model="prefs.tableAlign" class="select" style="width: 110px">
          <option value="left">{{ locale === 'zh' ? '左' : 'Left' }}</option>
          <option value="center">{{ locale === 'zh' ? '中' : 'Center' }}</option>
          <option value="right">{{ locale === 'zh' ? '右' : 'Right' }}</option>
        </select>
      </div>
      <span class="faint">
        {{ locale === 'zh' ? '首行为表头；支持逗号 / 制表符 / 竖线分隔' : 'First row is the header; comma / tab / pipe delimited' }}
      </span>
    </div>

    <div v-if="prefs.mode === 'diff'" class="option-bar">
      <label class="option-group" style="cursor: pointer">
        <input v-model="prefs.diffIgnoreWhitespace" type="checkbox" />
        <span class="field-label">{{ locale === 'zh' ? '忽略空白' : 'Ignore whitespace' }}</span>
      </label>
      <label class="option-group" style="cursor: pointer">
        <input v-model="prefs.diffIgnoreCase" type="checkbox" />
        <span class="field-label">{{ locale === 'zh' ? '忽略大小写' : 'Ignore case' }}</span>
      </label>
      <span class="faint">{{ locale === 'zh' ? '最多 2000 行' : 'Up to 2000 lines' }}</span>
    </div>

    <div class="split">
      <Pane :title="prefs.mode === 'diff' ? (locale === 'zh' ? '左侧' : 'Left') : t('common.input')" :meta="`${left.length}`">
        <div style="display: flex; flex-direction: column; width: 100%">
          <textarea
            v-model="left"
            class="editor"
            spellcheck="false"
            :placeholder="locale === 'zh' ? '粘贴文本；表格模式支持 CSV / TSV / Markdown' : 'Paste text; table mode accepts CSV / TSV / Markdown'"
          />
          <textarea
            v-if="prefs.mode === 'diff'"
            v-model="right"
            class="editor"
            spellcheck="false"
            style="border-top: 1px solid var(--line)"
            :placeholder="locale === 'zh' ? '粘贴对比文本' : 'Paste the right side'"
          />
        </div>
      </Pane>

      <Pane :title="t('common.output')" :error="Boolean(error)">
        <template #actions>
          <CopyButton :text="copyText" icon-only ghost />
        </template>

        <ErrorNote v-if="error" :error="error" />

        <template v-else-if="prefs.mode === 'case'">
          <div style="width: 100%; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px">
            <div v-for="row in caseRows" :key="row.key" class="binary-line" style="justify-content: space-between; gap: 10px">
              <span class="section-label" style="min-width: 104px">{{ row.label }}</span>
              <code class="mono" style="flex: 1; word-break: break-all">{{ row.value || '—' }}</code>
              <CopyButton :text="row.value" icon-only ghost />
            </div>
          </div>
        </template>

        <template v-else-if="prefs.mode === 'diff'">
          <div style="width: 100%; overflow: auto">
            <table class="data-table">
              <thead>
                <tr>
                  <th style="width: 40px"></th>
                  <th>{{ locale === 'zh' ? '左' : 'Left' }}</th>
                  <th style="width: 40px"></th>
                  <th>{{ locale === 'zh' ? '右' : 'Right' }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, index) in diffRows" :key="index">
                  <td class="faint">{{ row.leftNo ?? '' }}</td>
                  <td :style="{ color: row.type === 'del' ? 'var(--red)' : undefined }">{{ row.left ?? '' }}</td>
                  <td class="faint">{{ row.rightNo ?? '' }}</td>
                  <td :style="{ color: row.type === 'add' ? 'var(--accent)' : undefined }">{{ row.right ?? '' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>

        <pre v-else class="output wrap">{{ output }}</pre>

        <div v-if="!error && !output && !data && !running" class="pane-empty">{{ t('common.empty') }}</div>

        <template v-if="statsItems.length" #footer>
          <StatChips :items="statsItems" />
        </template>
      </Pane>
    </div>
  </div>
</template>
