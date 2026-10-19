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
import type { HashAlgorithm, HashFormat, HashRunData } from './run'

const prefs = useToolPrefs('hash', {
  algorithm: 'sha256' as HashAlgorithm,
  format: 'hex' as HashFormat,
})

const input = ref('bit_pouch')
const output = ref('')
const error = ref<ToolError | null>(null)
const data = ref<HashRunData | null>(null)

let seq = 0
let timer: ReturnType<typeof setTimeout> | undefined

const algorithms: Array<{ value: HashAlgorithm; label: string }> = [
  { value: 'md5', label: 'MD5' },
  { value: 'sha1', label: 'SHA-1' },
  { value: 'sha256', label: 'SHA-256' },
  { value: 'sha384', label: 'SHA-384' },
  { value: 'sha512', label: 'SHA-512' },
]

const statsItems = computed(() => [
  { label: 'UTF-8', value: `${data.value?.byteLength ?? 0} B` },
  { label: 'HEX', value: `${data.value?.hexLength ?? 0} chars` },
])

const weakAlgorithm = computed(() => data.value?.algorithm === 'md5' || data.value?.algorithm === 'sha1')

async function runNow(): Promise<void> {
  const current = ++seq
  const result = await callTool<HashRunData>(
    'hash',
    input.value,
    { algorithm: prefs.algorithm, format: prefs.format },
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
  timer = setTimeout(runNow, 80)
}

function loadSample(): void {
  input.value = 'bit_pouch'
  prefs.algorithm = 'sha256'
  prefs.format = 'hex'
  runNow()
}

watch([input, () => prefs.algorithm, () => prefs.format], schedule)
runNow()
</script>

<template>
  <div class="workbench">
    <div class="option-bar">
      <div class="option-group">
        <span class="field-label">{{ locale === 'zh' ? '算法' : 'Algorithm' }}</span>
        <select v-model="prefs.algorithm" class="select" style="width: 110px">
          <option v-for="item in algorithms" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
      </div>
      <div class="option-group">
        <span class="field-label">{{ locale === 'zh' ? '输出' : 'Output' }}</span>
        <select v-model="prefs.format" class="select" style="width: 90px">
          <option value="hex">HEX</option>
          <option value="base64">Base64</option>
        </select>
      </div>
      <span class="option-spacer" />
      <button type="button" class="btn btn-sm" @click="loadSample">
        <Sparkles :size="13" /> {{ t('action.sample') }}
      </button>
    </div>

    <div class="split">
      <Pane
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

      <Pane :title="t('common.output')" :error="Boolean(error)">
        <template #actions>
          <CopyButton :text="output" icon-only ghost />
        </template>

        <ErrorNote v-if="error" :error="error" />
        <div v-else-if="data" style="width: 100%; padding: 14px; overflow: auto">
          <div class="section-label">{{ data.algorithm.toUpperCase() }} · {{ data.format.toUpperCase() }}</div>
          <pre class="output wrap" style="margin-bottom: 12px">{{ data.format === 'base64' ? data.base64 : data.hex }}</pre>

          <div class="section-label">HEX</div>
          <div class="binary-line" style="margin-bottom: 10px">
            <span class="net" style="word-break: break-all">{{ data.hex }}</span>
          </div>

          <div class="section-label">BASE64</div>
          <div class="binary-line" style="margin-bottom: 10px">
            <span class="net" style="word-break: break-all">{{ data.base64 }}</span>
          </div>

          <div v-if="weakAlgorithm" class="error-box" style="margin-top: 12px">
            {{ locale === 'zh'
              ? 'MD5 / SHA-1 已不适合安全用途，只用于校验或兼容旧系统。'
              : 'MD5 / SHA-1 are not safe for security use; keep them for checksums or legacy compatibility only.' }}
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
