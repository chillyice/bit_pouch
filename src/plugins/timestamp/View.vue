<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Clock3, Sparkles } from 'lucide-vue-next'
import CopyButton from '@/components/CopyButton.vue'
import ErrorNote from '@/components/ErrorNote.vue'
import Pane from '@/components/Pane.vue'
import StatChips from '@/components/StatChips.vue'
import { locale, t } from '@/core/i18n'
import { callTool } from '@/core/runner'
import { useToolPrefs } from '@/core/toolPrefs'
import type { ToolError } from '@/core/types'
import type { TimestampRunData, TimestampUnit } from './run'

const prefs = useToolPrefs('timestamp', { unit: 'auto' as TimestampUnit })
const input = ref(String(Math.floor(Date.now() / 1000)))
const output = ref('')
const error = ref<ToolError | null>(null)
const data = ref<TimestampRunData | null>(null)

let seq = 0
let timer: ReturnType<typeof setTimeout> | undefined

const units = computed<Array<{ value: TimestampUnit; label: string }>>(() => [
  { value: 'auto', label: locale.value === 'zh' ? '自动' : 'Auto' },
  { value: 's', label: locale.value === 'zh' ? '秒' : 'Seconds' },
  { value: 'ms', label: locale.value === 'zh' ? '毫秒' : 'Millis' },
])

const localTime = computed(() => {
  if (!data.value) return '—'
  return new Intl.DateTimeFormat(locale.value === 'zh' ? 'zh-CN' : 'en-US', {
    dateStyle: 'full',
    timeStyle: 'medium',
  }).format(new Date(data.value.milliseconds))
})

const statsItems = computed(() => [
  { label: locale.value === 'zh' ? '单位' : 'unit', value: data.value?.unit ?? '—' },
  { label: locale.value === 'zh' ? '类型' : 'kind', value: data.value?.numeric ? 'number' : 'date' },
])

async function runNow(): Promise<void> {
  const current = ++seq
  const result = await callTool<TimestampRunData>('timestamp', input.value, { unit: prefs.unit }, locale.value)
  if (current !== seq) return

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
  timer = setTimeout(runNow, 60)
}

function useNow(): void {
  input.value = String(Math.floor(Date.now() / 1000))
  prefs.unit = 'auto'
  runNow()
}

function loadSample(): void {
  input.value = '1700000000'
  prefs.unit = 'auto'
  runNow()
}

watch([input, () => prefs.unit], schedule)
runNow()
</script>

<template>
  <div class="workbench">
    <div class="option-bar">
      <div class="option-group">
        <span class="field-label">{{ locale === 'zh' ? '单位' : 'Unit' }}</span>
        <select v-model="prefs.unit" class="select" style="width: 96px">
          <option v-for="item in units" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
      </div>
      <span class="option-spacer" />
      <button type="button" class="btn btn-sm" @click="useNow">
        <Clock3 :size="13" /> {{ locale === 'zh' ? '当前时间' : 'Now' }}
      </button>
      <button type="button" class="btn btn-sm btn-ghost" @click="loadSample">
        <Sparkles :size="13" /> {{ t('action.sample') }}
      </button>
    </div>

    <div class="split">
      <Pane
        :title="t('common.input')"
        :meta="locale === 'zh' ? '时间戳或日期' : 'timestamp or date'"
        :error="Boolean(error)"
      >
        <input
          v-model="input"
          class="input"
          spellcheck="false"
          :placeholder="locale === 'zh' ? '如 1700000000、1700000000000 或 2023-11-14T22:13:20Z' : 'e.g. 1700000000, 1700000000000 or 2023-11-14T22:13:20Z'"
        />
        <div class="faint" style="margin-top: 10px">
          {{ locale === 'zh'
            ? '自动模式下，10 位按秒、13 位按毫秒；ISO 8601 直接解析。'
            : 'Auto mode treats 10 digits as seconds and 13 as milliseconds; ISO 8601 is parsed directly.' }}
        </div>
      </Pane>

      <Pane :title="t('common.output')" :error="Boolean(error)">
        <template #actions>
          <CopyButton :text="output" icon-only ghost />
        </template>

        <ErrorNote v-if="error" :error="error" />
        <div v-else-if="data" style="width: 100%; padding: 14px; overflow: auto">
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

          <div class="section-label">{{ locale === 'zh' ? '本地时间' : 'Local time' }}</div>
          <div class="binary-line">
            <span class="net">{{ localTime }}</span>
          </div>
        </div>
        <div v-else class="pane-empty">{{ t('common.empty') }}</div>

        <template v-if="data" #footer>
          <StatChips :items="statsItems" />
        </template>
      </Pane>
    </div>
  </div>
</template>
