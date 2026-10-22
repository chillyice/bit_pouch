<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Clock3, Sparkles } from 'lucide-vue-next'
import CopyButton from '@/components/CopyButton.vue'
import ErrorNote from '@/components/ErrorNote.vue'
import Pane from '@/components/Pane.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import StatChips from '@/components/StatChips.vue'
import { locale, t } from '@/core/i18n'
import { callTool } from '@/core/runner'
import { useToolPrefs } from '@/core/toolPrefs'
import type { ToolError } from '@/core/types'
import { TIME_ZONES } from './run'

type Mode = 'convert' | 'diff' | 'add' | 'cron'
type TimestampUnit = 'auto' | 's' | 'ms'

interface FormattedTime {
  ms: number
  milliseconds: number
  seconds: number
  iso: string
  utc: string
  local: string
  zoned: string
  zone: string
  offset: string
  weekday: string
}

interface TimeRunData {
  mode: Mode
  ms?: number
  milliseconds?: number
  seconds?: number
  iso?: string
  utc?: string
  zoned?: string
  zone?: string
  offset?: string
  weekday?: string
  numeric?: boolean
  unit?: string
  sign?: number
  days?: number
  hours?: number
  minutes?: number
  totalMs?: number
  totalDays?: number
  start?: FormattedTime
  end?: FormattedTime
  amount?: number
  next?: FormattedTime[]
  hasSeconds?: boolean
  exhausted?: boolean
}

const prefs = useToolPrefs('timestamp', {
  mode: 'convert' as Mode,
  unit: 'auto' as TimestampUnit,
  timeZone: '',
  amount: 1,
  addUnit: 'day',
  cronCount: 5,
})

const inputs = ref<Record<Mode, string>>({
  convert: String(Math.floor(Date.now() / 1000)),
  diff: '2026-01-01T00:00:00Z\n2026-01-02T02:03:04Z',
  add: '2024-01-31T00:00:00Z',
  cron: '*/15 * * * *',
})

const output = ref('')
const error = ref<ToolError | null>(null)
const data = ref<TimeRunData | null>(null)
const running = ref(false)

type CronFrequency = 'every' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom'
const cronFreq = ref<CronFrequency>('custom')
const cronStep = ref(15)
const cronMinute = ref(0)
const cronHour = ref(9)
const cronDay = ref(1)
const cronWeekday = ref(1)

const cronFrequencyOptions = computed(() => [
  { value: 'every', label: locale.value === 'zh' ? '每 N 分钟' : 'Every N min' },
  { value: 'hourly', label: locale.value === 'zh' ? '每小时' : 'Hourly' },
  { value: 'daily', label: locale.value === 'zh' ? '每天' : 'Daily' },
  { value: 'weekly', label: locale.value === 'zh' ? '每周' : 'Weekly' },
  { value: 'monthly', label: locale.value === 'zh' ? '每月' : 'Monthly' },
  { value: 'custom', label: locale.value === 'zh' ? '自定义' : 'Custom' },
])

const stepOptions = [1, 2, 5, 10, 15, 20, 30]
const minuteOptions = Array.from({ length: 12 }, (_, index) => index * 5)
const hourOptions = Array.from({ length: 24 }, (_, index) => index)
const dayOptions = Array.from({ length: 31 }, (_, index) => index + 1)
const weekdayOptions = computed(() =>
  (locale.value === 'zh' ? ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']).map(
    (label, index) => ({ value: index, label }),
  ),
)

const cronBuilderExpression = computed(() => {
  const minute = cronMinute.value
  const hour = cronHour.value
  switch (cronFreq.value) {
    case 'every':
      return `*/${cronStep.value} * * * *`
    case 'hourly':
      return `${minute} * * * *`
    case 'daily':
      return `${minute} ${hour} * * *`
    case 'weekly':
      return `${minute} ${hour} * * ${cronWeekday.value}`
    case 'monthly':
      return `${minute} ${hour} ${cronDay.value} * *`
    default:
      return ''
  }
})

watch(cronBuilderExpression, (expression) => {
  if (expression && cronFreq.value !== 'custom') inputs.value.cron = expression
})

let seq = 0
let timer: ReturnType<typeof setTimeout> | undefined

const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

const modeOptions = computed(() => [
  { value: 'convert', label: locale.value === 'zh' ? '时间戳' : 'Timestamp' },
  { value: 'diff', label: locale.value === 'zh' ? '日期差' : 'Difference' },
  { value: 'add', label: locale.value === 'zh' ? '日期加减' : 'Add / subtract' },
  { value: 'cron', label: 'Cron' },
])

const unitOptions = computed(() => [
  { value: 'auto', label: locale.value === 'zh' ? '自动' : 'Auto' },
  { value: 's', label: locale.value === 'zh' ? '秒' : 'Seconds' },
  { value: 'ms', label: locale.value === 'zh' ? '毫秒' : 'Millis' },
])

const addUnits = computed(() => [
  { value: 'minute', label: locale.value === 'zh' ? '分钟' : 'Minutes' },
  { value: 'hour', label: locale.value === 'zh' ? '小时' : 'Hours' },
  { value: 'day', label: locale.value === 'zh' ? '天' : 'Days' },
  { value: 'week', label: locale.value === 'zh' ? '周' : 'Weeks' },
  { value: 'month', label: locale.value === 'zh' ? '月' : 'Months' },
  { value: 'year', label: locale.value === 'zh' ? '年' : 'Years' },
])

const browserLocal = computed(() => {
  if (!data.value || typeof data.value.ms !== 'number') return ''
  return new Intl.DateTimeFormat(locale.value === 'zh' ? 'zh-CN' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(data.value.ms))
})

const nextRuns = computed(() => data.value?.next ?? [])

const statsItems = computed(() => {
  if (!data.value) return []
  if (data.value.mode === 'convert') {
    return [
      { label: locale.value === 'zh' ? '单位' : 'unit', value: data.value.unit ?? '—' },
      { label: 'zone', value: data.value.zone ?? '—' },
    ]
  }
  if (data.value.mode === 'diff') {
    return [{ label: locale.value === 'zh' ? '总天数' : 'total days', value: data.value.totalDays ?? 0 }]
  }
  if (data.value.mode === 'add') {
    return [
      { label: locale.value === 'zh' ? '数量' : 'amount', value: data.value.amount ?? 0 },
      { label: locale.value === 'zh' ? '单位' : 'unit', value: data.value.unit ?? '—' },
    ]
  }
  return [
    { label: locale.value === 'zh' ? '次数' : 'runs', value: nextRuns.value.length },
    { label: locale.value === 'zh' ? '段数' : 'fields', value: data.value.hasSeconds ? 6 : 5 },
  ]
})

async function runNow(): Promise<void> {
  const current = ++seq
  const mode = prefs.mode
  const options: Record<string, unknown> = { mode, timeZone: prefs.timeZone || undefined }
  if (mode === 'convert') options.unit = prefs.unit
  if (mode === 'add') {
    options.amount = Number(prefs.amount)
    options.unit = prefs.addUnit
  }
  if (mode === 'cron') {
    options.from = Date.now()
    options.count = Number(prefs.cronCount)
  }

  running.value = true
  const result = await callTool<TimeRunData>('timestamp', inputs.value[mode], options, locale.value)
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
  const samples: Record<Mode, string> = {
    convert: '1700000000',
    diff: '2026-01-01T00:00:00Z\n2026-01-02T02:03:04Z',
    add: '2024-01-31T00:00:00Z',
    cron: '*/15 9-18 * * MON-FRI',
  }
  inputs.value[prefs.mode] = samples[prefs.mode]
  runNow()
}

function useNow(): void {
  prefs.mode = 'convert'
  prefs.unit = 'auto'
  inputs.value.convert = String(Math.floor(Date.now() / 1000))
  runNow()
}

watch(
  [
    () => prefs.mode,
    () => prefs.unit,
    () => prefs.timeZone,
    () => prefs.amount,
    () => prefs.addUnit,
    () => prefs.cronCount,
  ],
  schedule,
)
watch(inputs, schedule, { deep: true })
runNow()
</script>

<template>
  <div class="workbench">
    <div class="option-bar">
      <SegmentedControl v-model="prefs.mode" :options="modeOptions" />

      <div class="option-group">
        <span class="field-label">{{ locale === 'zh' ? '时区' : 'Time zone' }}</span>
        <select v-model="prefs.timeZone" class="select" style="max-width: 220px">
          <option value="">
            {{ locale === 'zh' ? `本机（${localZone}）` : `Local (${localZone})` }}
          </option>
          <option v-for="zone in TIME_ZONES" :key="zone" :value="zone">{{ zone }}</option>
        </select>
      </div>

      <div v-if="prefs.mode === 'convert'" class="option-group">
        <span class="field-label">{{ locale === 'zh' ? '单位' : 'Unit' }}</span>
        <select v-model="prefs.unit" class="select" style="width: 100px">
          <option v-for="item in unitOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
      </div>

      <template v-else-if="prefs.mode === 'add'">
        <div class="option-group">
          <span class="field-label">{{ locale === 'zh' ? '数量' : 'Amount' }}</span>
          <input v-model.number="prefs.amount" class="input" type="number" step="1" style="width: 80px" />
        </div>
        <div class="option-group">
          <select v-model="prefs.addUnit" class="select" style="width: 100px">
            <option v-for="item in addUnits" :key="item.value" :value="item.value">{{ item.label }}</option>
          </select>
        </div>
      </template>

      <div v-else-if="prefs.mode === 'cron'" class="option-group">
        <span class="field-label">{{ locale === 'zh' ? '次数' : 'Runs' }}</span>
        <input v-model.number="prefs.cronCount" class="input" type="number" min="1" max="20" style="width: 72px" />
      </div>

      <span class="option-spacer" />
      <button v-if="prefs.mode === 'convert'" type="button" class="btn btn-sm" @click="useNow">
        <Clock3 :size="13" /> {{ locale === 'zh' ? '当前时间' : 'Now' }}
      </button>
      <button type="button" class="btn btn-sm btn-ghost" @click="loadSample">
        <Sparkles :size="13" /> {{ t('action.sample') }}
      </button>
    </div>

    <div class="split">
      <Pane
        :title="
          prefs.mode === 'diff'
            ? locale === 'zh'
              ? '两个时间（每行一个）'
              : 'Two times (one per line)'
            : prefs.mode === 'cron'
              ? locale === 'zh'
                ? 'Cron 表达式'
                : 'Cron expression'
              : t('common.input')
        "
        :meta="
          prefs.mode === 'cron'
            ? locale === 'zh'
              ? '5 段或 6 段'
              : '5 or 6 fields'
            : locale === 'zh'
              ? '时间戳或日期'
              : 'timestamp or date'
        "
        :error="Boolean(error)"
      >
        <textarea
          v-if="prefs.mode === 'diff'"
          v-model="inputs.diff"
          class="editor"
          spellcheck="false"
          style="min-height: 24vh"
          :placeholder="locale === 'zh' ? '开始时间\n结束时间' : 'Start time\nEnd time'"
        />
        <template v-else>
          <details v-if="prefs.mode === 'cron'" class="cron-builder" open>
            <summary>{{ locale === 'zh' ? '可视化生成表达式' : 'Visual expression builder' }}</summary>
            <div class="option-bar" style="border: 0; padding: 8px 0 0">
              <div class="option-group">
                <span class="field-label">{{ locale === 'zh' ? '频率' : 'Frequency' }}</span>
                <select v-model="cronFreq" class="select" style="width: 110px">
                  <option v-for="item in cronFrequencyOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
                </select>
              </div>
              <div v-if="cronFreq === 'every'" class="option-group">
                <span class="field-label">{{ locale === 'zh' ? '间隔' : 'Step' }}</span>
                <select v-model.number="cronStep" class="select" style="width: 88px">
                  <option v-for="value in stepOptions" :key="value" :value="value">{{ value }} min</option>
                </select>
              </div>
              <template v-else-if="cronFreq !== 'custom'">
                <div v-if="cronFreq === 'weekly'" class="option-group">
                  <span class="field-label">{{ locale === 'zh' ? '星期' : 'Weekday' }}</span>
                  <select v-model.number="cronWeekday" class="select" style="width: 96px">
                    <option v-for="item in weekdayOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
                  </select>
                </div>
                <div v-if="cronFreq === 'monthly'" class="option-group">
                  <span class="field-label">{{ locale === 'zh' ? '日' : 'Day' }}</span>
                  <select v-model.number="cronDay" class="select" style="width: 80px">
                    <option v-for="value in dayOptions" :key="value" :value="value">{{ value }}</option>
                  </select>
                </div>
                <div v-if="cronFreq !== 'hourly'" class="option-group">
                  <span class="field-label">{{ locale === 'zh' ? '时' : 'Hour' }}</span>
                  <select v-model.number="cronHour" class="select" style="width: 76px">
                    <option v-for="value in hourOptions" :key="value" :value="value">{{ value }}</option>
                  </select>
                </div>
                <div class="option-group">
                  <span class="field-label">{{ locale === 'zh' ? '分' : 'Minute' }}</span>
                  <select v-model.number="cronMinute" class="select" style="width: 76px">
                    <option v-for="value in minuteOptions" :key="value" :value="value">{{ value }}</option>
                  </select>
                </div>
              </template>
              <code v-if="cronBuilderExpression" class="faint" style="margin-left: auto">{{ cronBuilderExpression }}</code>
            </div>
          </details>
          <input
            v-model="inputs[prefs.mode]"
            class="input"
            spellcheck="false"
            style="margin: 14px"
            :placeholder="
              prefs.mode === 'cron'
                ? '*/15 9-18 * * MON-FRI'
                : locale === 'zh'
                  ? '如 1700000000 或 2023-11-14T22:13:20Z'
                  : 'e.g. 1700000000 or 2023-11-14T22:13:20Z'
            "
          />
        </template>
        <div class="faint" style="padding: 0 14px 14px">
          <template v-if="prefs.mode === 'convert'">
            {{
              locale === 'zh'
                ? '自动模式下，10 位按秒、13 位按毫秒；ISO 8601 直接解析。'
                : 'Auto mode treats 10 digits as seconds and 13 as milliseconds; ISO 8601 is parsed directly.'
            }}
          </template>
          <template v-else-if="prefs.mode === 'diff'">
            {{ locale === 'zh' ? '两行都支持时间戳或日期字符串。' : 'Both lines accept a timestamp or a date string.' }}
          </template>
          <template v-else-if="prefs.mode === 'cron'">
            {{
              locale === 'zh'
                ? '支持 *、*/n、a-b、列表与月份/星期缩写；按本机时区求值。'
                : 'Supports *, */n, a-b, lists and month/weekday names; evaluated in the local time zone.'
            }}
          </template>
          <template v-else>
            {{
              locale === 'zh'
                ? '月份加减按日历语义，月末自动夹取。'
                : 'Month arithmetic follows the calendar and clamps to month end.'
            }}
          </template>
        </div>
      </Pane>

      <Pane :title="t('common.output')" :error="Boolean(error)">
        <template #actions>
          <CopyButton :text="output" icon-only ghost />
        </template>

        <ErrorNote v-if="error" :error="error" />
        <div v-else-if="data" style="width: 100%; padding: 14px; overflow: auto">
          <template v-if="data.mode === 'convert'">
            <div class="result-grid" style="margin-bottom: 12px">
              <div class="result-card">
                <div class="k">UNIX (s)</div>
                <div class="v big">{{ data.seconds }}</div>
              </div>
              <div class="result-card">
                <div class="k">UNIX (ms)</div>
                <div class="v">{{ data.milliseconds }}</div>
              </div>
            </div>

            <div class="section-label">ISO 8601</div>
            <div class="binary-line" style="margin-bottom: 10px">
              <span class="net">{{ data.iso }}</span>
            </div>

            <div class="section-label">UTC</div>
            <div class="binary-line" style="margin-bottom: 10px">
              <span class="net">{{ data.utc }}</span>
            </div>

            <div class="section-label">{{ data.zone }} · {{ data.offset }}</div>
            <div class="binary-line" style="margin-bottom: 10px">
              <span class="net">{{ data.zoned }} · {{ data.weekday }}</span>
            </div>

            <div class="section-label">{{ locale === 'zh' ? '本机时间' : 'Local time' }}</div>
            <div class="binary-line">
              <span class="net">{{ browserLocal }}</span>
            </div>
          </template>

          <template v-else-if="data.mode === 'diff'">
            <div class="result-grid" style="margin-bottom: 12px">
              <div class="result-card">
                <div class="k">{{ locale === 'zh' ? '天' : 'days' }}</div>
                <div class="v big">{{ data.days }}</div>
              </div>
              <div class="result-card">
                <div class="k">{{ locale === 'zh' ? '时' : 'hours' }}</div>
                <div class="v">{{ data.hours }}</div>
              </div>
              <div class="result-card">
                <div class="k">{{ locale === 'zh' ? '分' : 'minutes' }}</div>
                <div class="v">{{ data.minutes }}</div>
              </div>
              <div class="result-card">
                <div class="k">{{ locale === 'zh' ? '秒' : 'seconds' }}</div>
                <div class="v">{{ data.seconds }}</div>
              </div>
            </div>

            <div class="section-label">{{ locale === 'zh' ? '总时长' : 'Total' }}</div>
            <div class="binary-line" style="margin-bottom: 10px">
              <span class="net">{{ data.totalMs }} ms · {{ data.totalDays }} days</span>
            </div>

            <template v-if="data.start && data.end">
              <div class="section-label">{{ locale === 'zh' ? '开始' : 'Start' }}</div>
              <div class="binary-line" style="margin-bottom: 10px">
                <span class="net">{{ data.start.zoned }}</span>
              </div>
              <div class="section-label">{{ locale === 'zh' ? '结束' : 'End' }}</div>
              <div class="binary-line">
                <span class="net">{{ data.end.zoned }}</span>
              </div>
            </template>
          </template>

          <template v-else-if="data.mode === 'add'">
            <div class="result-grid" style="margin-bottom: 12px">
              <div class="result-card">
                <div class="k">ISO 8601</div>
                <div class="v">{{ data.iso }}</div>
              </div>
              <div class="result-card">
                <div class="k">{{ data.zone }}</div>
                <div class="v">{{ data.zoned }}</div>
              </div>
            </div>
            <div class="faint">{{ locale === 'zh' ? '偏移' : 'Offset' }} {{ data.offset }} · {{ data.weekday }}</div>
          </template>

          <template v-else>
            <div
              v-for="(item, index) in nextRuns"
              :key="item.ms"
              class="binary-line"
              style="margin-bottom: 8px; justify-content: space-between; gap: 10px"
            >
              <span class="faint" style="min-width: 24px">{{ index + 1 }}</span>
              <span class="net" style="flex: 1; word-break: break-all">{{ item.zoned }} · {{ item.weekday }}</span>
              <CopyButton :text="item.iso" icon-only ghost />
            </div>
            <div v-if="data.exhausted" class="faint" style="margin-top: 8px">
              {{ locale === 'zh' ? '近期只找到这些匹配时间。' : 'Only these matches were found in the near future.' }}
            </div>
          </template>
        </div>
        <div v-else class="pane-empty">{{ running ? t('common.loading') : t('common.empty') }}</div>

        <template v-if="data" #footer>
          <StatChips :items="statsItems" />
        </template>
      </Pane>
    </div>
  </div>
</template>
