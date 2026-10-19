<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Sparkles } from 'lucide-vue-next'
import CopyButton from '@/components/CopyButton.vue'
import ErrorNote from '@/components/ErrorNote.vue'
import Pane from '@/components/Pane.vue'
import StatChips from '@/components/StatChips.vue'
import { locale, t } from '@/core/i18n'
import { callTool } from '@/core/runner'
import type { ToolError } from '@/core/types'
import type { UrlRunData } from './run'

const SAMPLE = 'https://user:pass@example.com:8080/path?a=1&b=%E4%BD%A0%E5%A5%BD#top'

const input = ref(SAMPLE)
const output = ref('')
const error = ref<ToolError | null>(null)
const data = ref<UrlRunData | null>(null)

let seq = 0
let timer: ReturnType<typeof setTimeout> | undefined

const componentRows = computed(() => {
  if (!data.value) return []
  return [
    ['origin', data.value.origin],
    ['protocol', data.value.protocol],
    ['username', data.value.username],
    ['password', data.value.password],
    ['host', data.value.host],
    ['hostname', data.value.hostname],
    ['port', data.value.port],
    ['pathname', data.value.pathname],
    ['search', data.value.search],
    ['hash', data.value.hash],
  ].filter(([, value]) => value !== '')
})

const statsItems = computed(() => [
  { label: locale.value === 'zh' ? '参数' : 'params', value: data.value?.params.length ?? 0 },
  { label: 'host', value: data.value?.host || '—' },
])

async function runNow(): Promise<void> {
  const current = ++seq
  const result = await callTool<UrlRunData>('url', input.value, {}, locale.value)
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
  timer = setTimeout(runNow, 100)
}

function loadSample(): void {
  input.value = SAMPLE
  runNow()
}

watch(input, schedule)
runNow()
</script>

<template>
  <div class="workbench">
    <div class="option-bar">
      <span class="faint">{{ locale === 'zh' ? '需要完整协议，如 https://' : 'A full scheme is required, e.g. https://' }}</span>
      <span class="option-spacer" />
      <button type="button" class="btn btn-sm" @click="loadSample">
        <Sparkles :size="13" /> {{ t('action.sample') }}
      </button>
    </div>

    <div class="split">
      <Pane
        :title="t('common.input')"
        :meta="locale === 'zh' ? '绝对 URL' : 'absolute URL'"
        :error="Boolean(error)"
      >
        <textarea
          v-model="input"
          class="editor"
          spellcheck="false"
          :placeholder="locale === 'zh' ? '粘贴完整 URL' : 'Paste a full URL'"
          style="min-height: 20vh"
        />
      </Pane>

      <Pane :title="t('common.output')" :error="Boolean(error)">
        <template #actions>
          <CopyButton :text="output" icon-only ghost />
        </template>

        <ErrorNote v-if="error" :error="error" />
        <div v-else-if="data" style="width: 100%; padding: 14px; overflow: auto">
          <div class="result-grid" style="margin-bottom: 12px">
            <div class="result-card">
              <div class="k">HOST</div>
              <div class="v big">{{ data.host || '—' }}</div>
            </div>
            <div class="result-card">
              <div class="k">PROTOCOL</div>
              <div class="v">{{ data.protocol }}</div>
            </div>
            <div class="result-card">
              <div class="k">PATH</div>
              <div class="v">{{ data.pathname }}</div>
            </div>
          </div>

          <div class="section-label" style="margin-bottom: 6px">{{ locale === 'zh' ? '组成部分' : 'Components' }}</div>
          <div class="table-wrap" style="max-height: 22vh; margin-bottom: 12px">
            <table class="data-table">
              <tbody>
                <tr v-for="[key, value] in componentRows" :key="key">
                  <td class="offset">{{ key }}</td>
                  <td class="strong" style="word-break: break-all">{{ value }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="section-label" style="margin-bottom: 6px">
            {{ locale === 'zh' ? '查询参数' : 'Query parameters' }} · {{ data.params.length }}
          </div>
          <div v-if="data.params.length" class="table-wrap" style="max-height: 24vh">
            <table class="data-table">
              <thead>
                <tr>
                  <th>KEY</th>
                  <th>VALUE</th>
                  <th>RAW</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(param, index) in data.params" :key="`${param.rawKey}-${index}`">
                  <td class="strong">{{ param.key }}</td>
                  <td>{{ param.value }}</td>
                  <td class="offset" style="word-break: break-all">{{ param.rawKey }}={{ param.rawValue }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else class="faint">{{ locale === 'zh' ? '没有查询参数' : 'No query parameters' }}</div>
        </div>
        <div v-else class="pane-empty">{{ t('common.empty') }}</div>

        <template v-if="data" #footer>
          <StatChips :items="statsItems" />
        </template>
      </Pane>
    </div>
  </div>
</template>
