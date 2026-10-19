<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Sparkles } from 'lucide-vue-next'
import CopyButton from '@/components/CopyButton.vue'
import ErrorNote from '@/components/ErrorNote.vue'
import Pane from '@/components/Pane.vue'
import StatChips from '@/components/StatChips.vue'
import { locale, t } from '@/core/i18n'
import { callTool } from '@/core/runner'
import { useToolPrefs } from '@/core/toolPrefs'
import type { ToolError } from '@/core/types'
import type { BaseRunData } from './run'

const prefs = useToolPrefs('base', { fromBase: 10, targetBase: 16 })
const input = ref('255')
const output = ref('')
const error = ref<ToolError | null>(null)
const data = ref<BaseRunData | null>(null)

let seq = 0
let timer: ReturnType<typeof setTimeout> | undefined

const bases = Array.from({ length: 35 }, (_, i) => i + 2)
const commonFrom = [2, 8, 10, 16, 36]

const statsItems = computed(() => {
  if (!data.value) return []
  return [
    { label: locale.value === 'zh' ? '位宽' : 'bits', value: data.value.bitLength },
    { label: locale.value === 'zh' ? '目标进制' : 'target', value: data.value.targetBase },
  ]
})

async function runNow(): Promise<void> {
  const current = ++seq
  const result = await callTool<BaseRunData>('base', input.value, {
    fromBase: prefs.fromBase,
    targetBase: prefs.targetBase,
  }, locale.value)
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

function quickFrom(base: number): void {
  prefs.fromBase = base
}

function loadSample(): void {
  input.value = '255'
  prefs.fromBase = 10
  prefs.targetBase = 16
  runNow()
}

watch([input, () => prefs.fromBase, () => prefs.targetBase], schedule)
runNow()
</script>

<template>
  <div class="workbench">
    <div class="option-bar">
      <div class="option-group">
        <span class="field-label">{{ locale === 'zh' ? '源进制' : 'From' }}</span>
        <select v-model.number="prefs.fromBase" class="select" style="width: 82px">
          <option v-for="base in bases" :key="base" :value="base">{{ base }}</option>
        </select>
      </div>
      <div class="option-group">
        <span class="field-label">{{ locale === 'zh' ? '目标进制' : 'To' }}</span>
        <select v-model.number="prefs.targetBase" class="select" style="width: 82px">
          <option v-for="base in bases" :key="base" :value="base">{{ base }}</option>
        </select>
      </div>
      <span class="option-spacer" />
      <button type="button" class="btn btn-sm" @click="loadSample"><Sparkles :size="13" /> {{ t('action.sample') }}</button>
    </div>

    <div class="split">
      <Pane
        :title="t('common.input')"
        :meta="locale === 'zh' ? `BASE ${prefs.fromBase}` : `BASE ${prefs.fromBase}`"
        :error="Boolean(error)"
      >
        <template #actions>
          <span class="pane-meta">0–9 · A–Z</span>
        </template>
        <textarea
          v-model="input"
          class="editor"
          spellcheck="false"
          :placeholder="locale === 'zh' ? '输入数值，支持小数、下划线与 0x / 0b 前缀' : 'Enter a value; fractions, underscores and 0x / 0b prefixes are supported'"
          style="min-height: 28vh"
        />
        <template #footer>
          <div class="option-group" style="gap: 5px">
            <span class="faint">{{ locale === 'zh' ? '快捷' : 'Quick' }}:</span>
            <button
              v-for="base in commonFrom"
              :key="base"
              type="button"
              class="btn btn-sm btn-ghost"
              :class="{ 'btn-primary': prefs.fromBase === base }"
              @click="quickFrom(base)"
            >
              {{ base }}
            </button>
          </div>
        </template>
      </Pane>

      <Pane :title="t('common.output')" :error="Boolean(error)">
        <template #actions>
          <CopyButton :text="output" icon-only ghost />
        </template>
        <ErrorNote v-if="error" :error="error" />
        <div v-else-if="data" style="width: 100%; padding: 14px; overflow: auto">
          <div class="result-grid" style="margin-bottom: 12px">
            <div
              v-for="row in data.results"
              :key="row.base"
              class="result-card"
              :class="{ highlight: row.base === data.targetBase }"
            >
              <CopyButton class="copy-mini" :text="row.text" icon-only ghost />
              <div class="k">
                BASE {{ row.base }}
                <span v-if="row.approximate" class="badge">≈</span>
              </div>
              <div class="v" :class="{ big: row.base === data.targetBase }">{{ row.text }}</div>
            </div>
          </div>

          <div class="binary-line" style="margin-bottom: 12px">
            <span style="color: var(--text-faint)">{{ data.bitLength }} bits · BASE 2</span>
            <div class="net">{{ data.negative ? '-' : '' }}{{ data.results.find((r) => r.base === 2)?.text ?? '' }}</div>
          </div>

          <div class="table-wrap" style="max-height: 24vh">
            <table class="data-table">
              <thead>
                <tr>
                  <th>BASE</th>
                  <th>{{ locale === 'zh' ? '结果' : 'Value' }}</th>
                  <th>{{ locale === 'zh' ? '精确' : 'Exact' }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in data.results" :key="row.base">
                  <td class="offset">{{ row.base }}</td>
                  <td class="strong" :class="{ accent: row.base === data.targetBase }">{{ row.text }}</td>
                  <td>
                    <span v-if="row.approximate" class="badge">≈ {{ locale === 'zh' ? '截断' : 'truncated' }}</span>
                    <span v-else class="badge teal">exact</span>
                  </td>
                </tr>
              </tbody>
            </table>
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
