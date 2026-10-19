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
import type { JwtRunData } from './run'

const SAMPLE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6ImJpdF9wb3VjaCIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjoxOTAwMDAwMDAwfQ.demo-signature'

const input = ref(SAMPLE)
const error = ref<ToolError | null>(null)
const data = ref<JwtRunData | null>(null)

let seq = 0
let timer: ReturnType<typeof setTimeout> | undefined

const headerText = computed(() => (data.value ? JSON.stringify(data.value.header, null, 2) : ''))
const payloadText = computed(() => (data.value ? JSON.stringify(data.value.payload, null, 2) : ''))

const status = computed(() => {
  if (!data.value) return '—'
  if (data.value.expired === null) return locale.value === 'zh' ? '无 exp' : 'no exp'
  return data.value.expired ? (locale.value === 'zh' ? '已过期' : 'expired') : locale.value === 'zh' ? '有效' : 'valid'
})

const statsItems = computed(() => [
  {
    label: locale.value === 'zh' ? '签名段' : 'signature',
    value: data.value?.signature.present ? `${data.value.signature.length} chars` : '—',
  },
  { label: locale.value === 'zh' ? '剩余' : 'left', value: formatRemaining(data.value?.secondsLeft ?? null) },
])

function formatTime(seconds: number | null): string {
  if (seconds === null) return '—'
  return new Date(seconds * 1000).toLocaleString(locale.value === 'zh' ? 'zh-CN' : 'en-US')
}

function formatRemaining(seconds: number | null): string {
  if (seconds === null) return '—'
  const abs = Math.abs(seconds)
  const value =
    abs >= 86400
      ? `${Math.round(abs / 86400)}d`
      : abs >= 3600
        ? `${Math.round(abs / 3600)}h`
        : abs >= 60
          ? `${Math.round(abs / 60)}m`
          : `${abs}s`
  return seconds >= 0 ? `${value} left` : `${value} ago`
}

async function runNow(): Promise<void> {
  const current = ++seq
  const result = await callTool<JwtRunData>('jwt', input.value, {}, locale.value)
  if (current !== seq) return

  if (result.ok) {
    data.value = result.data ?? null
    error.value = null
  } else {
    data.value = null
    error.value = result.error ?? { code: 'UNKNOWN', message: t('common.error') }
  }
}

function schedule(): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(runNow, 120)
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
      <span class="badge">{{ locale === 'zh' ? '只读 · 不验签' : 'read-only · no signature check' }}</span>
      <span class="faint">{{ locale === 'zh' ? '支持 Bearer 前缀与两段令牌' : 'Bearer prefix and unsigned tokens supported' }}</span>
      <span class="option-spacer" />
      <button type="button" class="btn btn-sm" @click="loadSample">
        <Sparkles :size="13" /> {{ t('action.sample') }}
      </button>
    </div>

    <div class="split">
      <Pane
        :title="t('common.input')"
        :meta="locale === 'zh' ? 'JWT' : 'JWT'"
        :error="Boolean(error)"
      >
        <textarea
          v-model="input"
          class="editor"
          spellcheck="false"
          :placeholder="locale === 'zh' ? '粘贴 JWT 或 Bearer <token>' : 'Paste a JWT or Bearer <token>'"
          style="min-height: 34vh"
        />
      </Pane>

      <Pane :title="t('common.output')" :error="Boolean(error)">
        <template #actions>
          <CopyButton :text="payloadText" icon-only ghost />
        </template>

        <ErrorNote v-if="error" :error="error" />
        <div v-else-if="data" style="width: 100%; padding: 14px; overflow: auto">
          <div class="result-grid" style="margin-bottom: 12px">
            <div class="result-card">
              <div class="k">STATUS</div>
              <div class="v big">{{ status }}</div>
            </div>
            <div class="result-card">
              <div class="k">ALG</div>
              <div class="v">{{ data.algorithm ?? '—' }}</div>
            </div>
            <div class="result-card">
              <div class="k">EXP</div>
              <div class="v">{{ formatTime(data.expiresAt) }}</div>
            </div>
          </div>

          <div class="section-label">HEADER</div>
          <pre class="output wrap" style="margin-bottom: 12px">{{ headerText }}</pre>

          <div class="section-label">PAYLOAD</div>
          <pre class="output wrap">{{ payloadText }}</pre>

          <div class="faint" style="margin-top: 10px">
            iat {{ formatTime(data.issuedAt) }} · nbf {{ formatTime(data.notBefore) }} ·
            {{ formatRemaining(data.secondsLeft) }}
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
