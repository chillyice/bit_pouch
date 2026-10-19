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
import type { RegexRunData } from './run'

const prefs = useToolPrefs('regex', { flags: 'g' })
const pattern = ref('(\\w+)@(\\w+\\.\\w+)')
const input = ref('Contact alice@example.com and bob@test.io for details.')
const replacement = ref('')
const output = ref('')
const error = ref<ToolError | null>(null)
const data = ref<RegexRunData | null>(null)

let seq = 0
let timer: ReturnType<typeof setTimeout> | undefined

const statsItems = computed(() => [
  { label: locale.value === 'zh' ? '匹配' : 'matches', value: data.value?.count ?? 0 },
  { label: 'flags', value: data.value?.flags ?? prefs.flags },
])

async function runNow(): Promise<void> {
  const current = ++seq
  const result = await callTool<RegexRunData>(
    'regex',
    input.value,
    { pattern: pattern.value, flags: prefs.flags, replacement: replacement.value },
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
  timer = setTimeout(runNow, 120)
}

function loadSample(): void {
  pattern.value = '(\\w+)@(\\w+\\.\\w+)'
  input.value = 'Contact alice@example.com and bob@test.io for details.'
  replacement.value = ''
  prefs.flags = 'g'
  runNow()
}

watch([pattern, input, replacement, () => prefs.flags], schedule)
runNow()
</script>

<template>
  <div class="workbench">
    <div class="option-bar">
      <div class="option-group" style="flex: 1; min-width: 200px">
        <span class="field-label">{{ locale === 'zh' ? '正则' : 'Pattern' }}</span>
        <input
          v-model="pattern"
          class="input mono"
          spellcheck="false"
          style="flex: 1"
          :placeholder="locale === 'zh' ? '如 \\d+' : 'e.g. \\d+'"
        />
      </div>
      <div class="option-group">
        <span class="field-label">Flags</span>
        <input v-model="prefs.flags" class="input mono" spellcheck="false" style="width: 78px" />
      </div>
      <span class="option-spacer" />
      <button type="button" class="btn btn-sm" @click="loadSample">
        <Sparkles :size="13" /> {{ t('action.sample') }}
      </button>
    </div>

    <div class="split">
      <Pane
        :title="locale === 'zh' ? '测试文本' : 'Test text'"
        :meta="`${input.length} chars`"
        :error="Boolean(error)"
      >
        <textarea
          v-model="input"
          class="editor"
          spellcheck="false"
          :placeholder="locale === 'zh' ? '输入要匹配的文本' : 'Enter text to match against'"
          style="min-height: 28vh"
        />
        <template #footer>
          <div class="option-group" style="flex: 1">
            <span class="field-label">{{ locale === 'zh' ? '替换为' : 'Replace' }}</span>
            <input
              v-model="replacement"
              class="input mono"
              spellcheck="false"
              style="flex: 1"
              :placeholder="locale === 'zh' ? '可选，如 [$1]' : 'optional, e.g. [$1]'"
            />
          </div>
        </template>
      </Pane>

      <Pane :title="t('common.output')" :error="Boolean(error)">
        <template #actions>
          <CopyButton :text="output" icon-only ghost />
        </template>

        <ErrorNote v-if="error" :error="error" />
        <div v-else-if="data" style="width: 100%; padding: 14px; overflow: auto">
          <template v-if="data.replaced !== null">
            <div class="section-label">{{ locale === 'zh' ? '替换结果' : 'Replacement' }}</div>
            <pre class="output wrap">{{ data.replaced }}</pre>
          </template>

          <template v-else>
            <div class="section-label" style="margin-bottom: 6px">
              {{ locale === 'zh' ? '匹配结果' : 'Matches' }} · {{ data.count }}
            </div>
            <div v-if="data.matches.length" class="table-wrap" style="max-height: 42vh">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>INDEX</th>
                    <th>MATCH</th>
                    <th>GROUPS</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(match, index) in data.matches" :key="`${match.index}-${index}`">
                    <td class="offset">{{ index + 1 }}</td>
                    <td class="num">{{ match.index }}</td>
                    <td class="strong" style="word-break: break-all">{{ match.value }}</td>
                    <td style="word-break: break-all">
                      <span v-if="match.groups.length" class="mono">{{ match.groups.join(' · ') }}</span>
                      <span v-if="match.named" class="badge teal" style="margin-left: 6px">
                        {{ JSON.stringify(match.named) }}
                      </span>
                      <span v-if="!match.groups.length && !match.named" class="faint">—</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-else class="faint">{{ locale === 'zh' ? '没有匹配' : 'No matches' }}</div>

            <div v-if="data.truncated" class="faint" style="margin-top: 8px">
              {{ locale === 'zh' ? '匹配过多，仅显示前 500 条' : 'Too many matches; showing the first 500' }}
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
