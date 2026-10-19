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
import type { UuidRunData } from './run'

const prefs = useToolPrefs('uuid', { count: 5, uppercase: false, hyphens: true })
const input = ref('')
const output = ref('')
const error = ref<ToolError | null>(null)
const data = ref<UuidRunData | null>(null)

let seq = 0
let timer: ReturnType<typeof setTimeout> | undefined

const statsItems = computed(() => [
  { label: locale.value === 'zh' ? '模式' : 'mode', value: data.value?.mode ?? '—' },
  { label: locale.value === 'zh' ? '数量' : 'count', value: data.value?.uuids.length ?? 0 },
])

async function runNow(): Promise<void> {
  const current = ++seq
  const result = await callTool<UuidRunData>(
    'uuid',
    input.value,
    { count: prefs.count, uppercase: prefs.uppercase, hyphens: prefs.hyphens },
    locale.value,
  )
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

function loadSample(): void {
  input.value = ''
  prefs.count = 5
  prefs.uppercase = false
  prefs.hyphens = true
  runNow()
}

watch([input, () => prefs.count, () => prefs.uppercase, () => prefs.hyphens], schedule)
runNow()
</script>

<template>
  <div class="workbench">
    <div class="option-bar">
      <div class="option-group">
        <span class="field-label">{{ locale === 'zh' ? '数量' : 'Count' }}</span>
        <input v-model.number="prefs.count" class="input" type="number" min="1" max="100" style="width: 76px" />
      </div>
      <label class="option-group" style="cursor: pointer">
        <input v-model="prefs.uppercase" type="checkbox" />
        <span class="field-label">{{ locale === 'zh' ? '大写' : 'Uppercase' }}</span>
      </label>
      <label class="option-group" style="cursor: pointer">
        <input v-model="prefs.hyphens" type="checkbox" />
        <span class="field-label">{{ locale === 'zh' ? '连字符' : 'Hyphens' }}</span>
      </label>
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
        :title="t('common.input')"
        :meta="locale === 'zh' ? '留空生成 · 填入解析' : 'empty = generate · filled = parse'"
        :error="Boolean(error)"
      >
        <textarea
          v-model="input"
          class="editor"
          spellcheck="false"
          :placeholder="locale === 'zh' ? '留空批量生成；粘贴一个 UUID 可解析版本与变体' : 'Leave empty to generate; paste a UUID to inspect version and variant'"
          style="min-height: 24vh"
        />
      </Pane>

      <Pane :title="t('common.output')" :error="Boolean(error)">
        <template #actions>
          <CopyButton :text="output" icon-only ghost />
        </template>

        <ErrorNote v-if="error" :error="error" />
        <div v-else-if="data" style="width: 100%; padding: 14px; overflow: auto">
          <template v-if="data.mode === 'parse' && data.parsed">
            <div class="result-grid" style="margin-bottom: 12px">
              <div class="result-card">
                <div class="k">VERSION</div>
                <div class="v big">{{ data.parsed.version }}</div>
              </div>
              <div class="result-card">
                <div class="k">VARIANT</div>
                <div class="v">{{ data.parsed.variant }}</div>
              </div>
            </div>
            <div class="section-label">NORMALIZED</div>
            <div class="binary-line">
              <span class="net">{{ data.parsed.normalized }}</span>
            </div>
          </template>

          <template v-else>
            <div
              v-for="(uuid, index) in data.uuids"
              :key="uuid"
              class="binary-line"
              style="margin-bottom: 6px; justify-content: space-between; gap: 10px"
            >
              <span class="faint" style="min-width: 28px">{{ index + 1 }}</span>
              <span class="net" style="flex: 1; word-break: break-all">{{ uuid }}</span>
              <CopyButton :text="uuid" icon-only ghost />
            </div>
          </template>
        </div>
        <div v-else class="pane-empty">{{ t('common.empty') }}</div>

        <template v-if="data" #footer>
          <StatChips :items="statsItems" />
        </template>
      </Pane>
    </div>
  </div>
</template>
