<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RefreshCw, Sparkles } from 'lucide-vue-next'
import CopyButton from '@/components/CopyButton.vue'
import ErrorNote from '@/components/ErrorNote.vue'
import Pane from '@/components/Pane.vue'
import StatChips from '@/components/StatChips.vue'
import { locale, t } from '@/core/i18n'
import { callTool } from '@/core/runner'
import { useToolPrefs } from '@/core/toolPrefs'
import type { ToolError } from '@/core/types'

type Mode = 'password' | 'pin' | 'uuid' | 'ulid' | 'nano' | 'bytes' | 'number' | 'pick' | 'shuffle' | 'group'

interface GeneratorData {
  mode: Mode
  items: string[]
  length?: number
  poolSize?: number
  entropy?: number
  strength?: string
  version?: string
  format?: string
  unique?: boolean
  groups?: string[][]
}

const LIST_MODES: Mode[] = ['pick', 'shuffle', 'group']
const SAMPLE_ITEMS = '苹果\n香蕉\n橙子\n葡萄\n西瓜'

const prefs = useToolPrefs('generator', {
  mode: 'password' as Mode,
  count: 5,
  length: 20,
  lower: true,
  upper: true,
  digits: true,
  symbols: true,
  excludeAmbiguous: true,
  requireEach: true,
  pinLength: 6,
  uuidVersion: 'v4' as 'v4' | 'v7',
  uppercase: false,
  hyphens: true,
  lowercase: false,
  nanoLength: 21,
  alphabet: '_-0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
  bytesLength: 16,
  bytesFormat: 'hex' as 'hex' | 'base64',
  min: 1,
  max: 100,
  unique: false,
  groupCount: 2,
})

const input = ref('')
const output = ref('')
const error = ref<ToolError | null>(null)
const data = ref<GeneratorData | null>(null)
const running = ref(false)

let seq = 0
let timer: ReturnType<typeof setTimeout> | undefined

const STRENGTH: Record<string, { zh: string; en: string }> = {
  weak: { zh: '弱', en: 'Weak' },
  fair: { zh: '一般', en: 'Fair' },
  strong: { zh: '强', en: 'Strong' },
  veryStrong: { zh: '很强', en: 'Very strong' },
}

const modeOptions: Array<{ value: Mode; zh: string; en: string }> = [
  { value: 'password', zh: '密码', en: 'Password' },
  { value: 'pin', zh: 'PIN', en: 'PIN' },
  { value: 'uuid', zh: 'UUID', en: 'UUID' },
  { value: 'ulid', zh: 'ULID', en: 'ULID' },
  { value: 'nano', zh: 'NanoID', en: 'NanoID' },
  { value: 'bytes', zh: '随机字节', en: 'Random bytes' },
  { value: 'number', zh: '随机整数', en: 'Random numbers' },
  { value: 'pick', zh: '抽取', en: 'Pick' },
  { value: 'shuffle', zh: '洗牌', en: 'Shuffle' },
  { value: 'group', zh: '分组', en: 'Group' },
]

const usesList = computed(() => LIST_MODES.includes(prefs.mode))
const usesCount = computed(() => prefs.mode !== 'shuffle' && prefs.mode !== 'group')

const strengthText = computed(() => {
  const key = data.value?.strength
  if (!key) return ''
  return STRENGTH[key]?.[locale.value] ?? key
})

const weakStrength = computed(() => data.value?.strength === 'weak' || data.value?.strength === 'fair')

const statsItems = computed(() => {
  if (!data.value) return []
  const items = [{ label: locale.value === 'zh' ? '数量' : 'count', value: data.value.items.length }]
  if (data.value.length) items.push({ label: locale.value === 'zh' ? '长度' : 'length', value: data.value.length })
  if (typeof data.value.entropy === 'number') items.push({ label: 'bits', value: data.value.entropy })
  return items
})

function buildOptions(): Record<string, unknown> {
  const mode = prefs.mode
  const options: Record<string, unknown> = { mode, count: Number(prefs.count) }

  if (mode === 'password') {
    options.length = Number(prefs.length)
    options.lower = prefs.lower
    options.upper = prefs.upper
    options.digits = prefs.digits
    options.symbols = prefs.symbols
    options.excludeAmbiguous = prefs.excludeAmbiguous
    options.requireEach = prefs.requireEach
  } else if (mode === 'pin') {
    options.length = Number(prefs.pinLength)
  } else if (mode === 'uuid') {
    options.version = prefs.uuidVersion
    options.uppercase = prefs.uppercase
    options.hyphens = prefs.hyphens
  } else if (mode === 'ulid') {
    options.lowercase = prefs.lowercase
  } else if (mode === 'nano') {
    options.length = Number(prefs.nanoLength)
    options.alphabet = prefs.alphabet
  } else if (mode === 'bytes') {
    options.length = Number(prefs.bytesLength)
    options.format = prefs.bytesFormat
  } else if (mode === 'number') {
    options.min = Number(prefs.min)
    options.max = Number(prefs.max)
    options.unique = prefs.unique
  } else if (mode === 'group') {
    options.groupCount = Number(prefs.groupCount)
  }

  return options
}

async function runNow(): Promise<void> {
  const current = ++seq
  running.value = true
  const result = await callTool<GeneratorData>(
    'generator',
    usesList.value ? input.value : '',
    buildOptions(),
    locale.value,
  )
  if (current !== seq) return
  running.value = false

  if (result.ok) {
    output.value = result.output ?? ''
    data.value = result.data ?? null
    error.value = null
  } else {
    output.value = ''
    data.value = null
    error.value = result.error ?? { code: 'UNKNOWN', message: t('common.error') }
  }
}

function schedule(): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(runNow, 80)
}

function loadSample(): void {
  if (usesList.value) input.value = SAMPLE_ITEMS
  runNow()
}

watch(prefs, schedule, { deep: true })
watch(input, schedule)
runNow()
</script>

<template>
  <div class="workbench">
    <div class="option-bar">
      <div class="option-group">
        <span class="field-label">{{ locale === 'zh' ? '类型' : 'Type' }}</span>
        <select v-model="prefs.mode" class="select" style="width: 150px">
          <option v-for="item in modeOptions" :key="item.value" :value="item.value">
            {{ locale === 'zh' ? item.zh : item.en }}
          </option>
        </select>
      </div>
      <div v-if="usesCount" class="option-group">
        <span class="field-label">{{ locale === 'zh' ? '数量' : 'Count' }}</span>
        <input v-model.number="prefs.count" class="input" type="number" min="1" max="200" style="width: 76px" />
      </div>
      <span class="option-spacer" />
      <button type="button" class="btn btn-sm btn-primary" @click="runNow">
        <RefreshCw :size="13" /> {{ locale === 'zh' ? '生成' : 'Generate' }}
      </button>
      <button type="button" class="btn btn-sm btn-ghost" @click="loadSample">
        <Sparkles :size="13" /> {{ t('action.sample') }}
      </button>
    </div>

    <div class="split">
      <Pane
        :title="usesList ? t('common.input') : locale === 'zh' ? '选项' : 'Options'"
        :meta="usesList ? (locale === 'zh' ? '每行一个条目' : 'one item per line') : ''"
        :error="Boolean(error)"
      >
        <textarea
          v-if="usesList"
          v-model="input"
          class="editor"
          spellcheck="false"
          style="min-height: 30vh"
          :placeholder="locale === 'zh' ? '苹果\n香蕉\n橙子\n葡萄' : 'apple\nbanana\norange\ngrape'"
        />

        <div v-else style="width: 100%; padding: 14px; display: flex; flex-direction: column; gap: 12px">
          <template v-if="prefs.mode === 'password'">
            <div class="option-group">
              <span class="field-label">{{ locale === 'zh' ? '长度' : 'Length' }}</span>
              <input v-model.number="prefs.length" class="input" type="number" min="4" max="128" style="width: 92px" />
            </div>
            <label class="option-group" style="cursor: pointer">
              <input v-model="prefs.lower" type="checkbox" />
              <span class="field-label">{{ locale === 'zh' ? '小写字母' : 'Lowercase' }}</span>
            </label>
            <label class="option-group" style="cursor: pointer">
              <input v-model="prefs.upper" type="checkbox" />
              <span class="field-label">{{ locale === 'zh' ? '大写字母' : 'Uppercase' }}</span>
            </label>
            <label class="option-group" style="cursor: pointer">
              <input v-model="prefs.digits" type="checkbox" />
              <span class="field-label">{{ locale === 'zh' ? '数字' : 'Digits' }}</span>
            </label>
            <label class="option-group" style="cursor: pointer">
              <input v-model="prefs.symbols" type="checkbox" />
              <span class="field-label">{{ locale === 'zh' ? '符号' : 'Symbols' }}</span>
            </label>
            <label class="option-group" style="cursor: pointer">
              <input v-model="prefs.excludeAmbiguous" type="checkbox" />
              <span class="field-label">{{ locale === 'zh' ? '排除易混淆字符' : 'Exclude ambiguous' }}</span>
            </label>
            <label class="option-group" style="cursor: pointer">
              <input v-model="prefs.requireEach" type="checkbox" />
              <span class="field-label">{{ locale === 'zh' ? '每类至少一个' : 'At least one of each' }}</span>
            </label>
          </template>

          <template v-else-if="prefs.mode === 'pin'">
            <div class="option-group">
              <span class="field-label">{{ locale === 'zh' ? '位数' : 'Digits' }}</span>
              <input
                v-model.number="prefs.pinLength"
                class="input"
                type="number"
                min="3"
                max="12"
                style="width: 92px"
              />
            </div>
          </template>

          <template v-else-if="prefs.mode === 'uuid'">
            <div class="option-group">
              <span class="field-label">{{ locale === 'zh' ? '版本' : 'Version' }}</span>
              <select v-model="prefs.uuidVersion" class="select" style="width: 100px">
                <option value="v4">v4</option>
                <option value="v7">v7</option>
              </select>
            </div>
            <label class="option-group" style="cursor: pointer">
              <input v-model="prefs.uppercase" type="checkbox" />
              <span class="field-label">{{ locale === 'zh' ? '大写' : 'Uppercase' }}</span>
            </label>
            <label class="option-group" style="cursor: pointer">
              <input v-model="prefs.hyphens" type="checkbox" />
              <span class="field-label">{{ locale === 'zh' ? '连字符' : 'Hyphens' }}</span>
            </label>
          </template>

          <template v-else-if="prefs.mode === 'ulid'">
            <label class="option-group" style="cursor: pointer">
              <input v-model="prefs.lowercase" type="checkbox" />
              <span class="field-label">{{ locale === 'zh' ? '小写' : 'Lowercase' }}</span>
            </label>
          </template>

          <template v-else-if="prefs.mode === 'nano'">
            <div class="option-group">
              <span class="field-label">{{ locale === 'zh' ? '长度' : 'Length' }}</span>
              <input
                v-model.number="prefs.nanoLength"
                class="input"
                type="number"
                min="4"
                max="128"
                style="width: 92px"
              />
            </div>
            <div class="option-group" style="align-items: flex-start">
              <span class="field-label" style="padding-top: 8px">{{ locale === 'zh' ? '字符表' : 'Alphabet' }}</span>
              <input v-model="prefs.alphabet" class="input" spellcheck="false" style="flex: 1" />
            </div>
          </template>

          <template v-else-if="prefs.mode === 'bytes'">
            <div class="option-group">
              <span class="field-label">{{ locale === 'zh' ? '字节数' : 'Bytes' }}</span>
              <input
                v-model.number="prefs.bytesLength"
                class="input"
                type="number"
                min="1"
                max="1024"
                style="width: 92px"
              />
            </div>
            <div class="option-group">
              <span class="field-label">{{ locale === 'zh' ? '输出' : 'Output' }}</span>
              <select v-model="prefs.bytesFormat" class="select" style="width: 110px">
                <option value="hex">HEX</option>
                <option value="base64">Base64</option>
              </select>
            </div>
          </template>

          <template v-else-if="prefs.mode === 'number'">
            <div class="option-group">
              <span class="field-label">{{ locale === 'zh' ? '最小值' : 'Min' }}</span>
              <input v-model.number="prefs.min" class="input" type="number" style="width: 110px" />
            </div>
            <div class="option-group">
              <span class="field-label">{{ locale === 'zh' ? '最大值' : 'Max' }}</span>
              <input v-model.number="prefs.max" class="input" type="number" style="width: 110px" />
            </div>
            <label class="option-group" style="cursor: pointer">
              <input v-model="prefs.unique" type="checkbox" />
              <span class="field-label">{{ locale === 'zh' ? '不重复' : 'Unique' }}</span>
            </label>
          </template>

          <template v-else-if="prefs.mode === 'group'">
            <div class="option-group">
              <span class="field-label">{{ locale === 'zh' ? '分组数' : 'Groups' }}</span>
              <input
                v-model.number="prefs.groupCount"
                class="input"
                type="number"
                min="2"
                max="200"
                style="width: 92px"
              />
            </div>
          </template>

          <div class="faint">
            {{
              locale === 'zh'
                ? '全部在本地生成；随机数只来自系统的安全随机源。'
                : 'Everything is generated locally; randomness comes only from the system CSPRNG.'
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
          <div v-if="data.mode === 'password' && data.strength" class="binary-line" style="margin-bottom: 12px">
            <span :style="{ color: weakStrength ? 'var(--red)' : 'var(--accent)' }">
              {{ locale === 'zh' ? '强度' : 'Strength' }}: {{ strengthText }} · {{ data.entropy }} bits
            </span>
          </div>

          <div
            v-for="(item, index) in data.items"
            :key="`${index}-${item}`"
            class="binary-line"
            style="margin-bottom: 6px; justify-content: space-between; gap: 10px"
          >
            <span class="faint" style="min-width: 24px">{{ index + 1 }}</span>
            <span class="net" style="flex: 1; word-break: break-all">{{ item }}</span>
            <CopyButton :text="item" icon-only ghost />
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
