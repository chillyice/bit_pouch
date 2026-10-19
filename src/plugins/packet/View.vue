<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronDown, Sparkles, Trash2 } from 'lucide-vue-next'
import CopyButton from '@/components/CopyButton.vue'
import ErrorNote from '@/components/ErrorNote.vue'
import Pane from '@/components/Pane.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import StatChips from '@/components/StatChips.vue'
import { locale, t } from '@/core/i18n'
import { callTool } from '@/core/runner'
import { useToolPrefs } from '@/core/toolPrefs'
import type { ToolError } from '@/core/types'
import type { PacketRunData } from './run'

const prefs = useToolPrefs('packet', {
  mode: 'hex' as 'hex' | 'text',
  template: '帧头 2\n长度 2\n命令 1\n数据 4\n校验 2',
})
const input = ref('AA 55 00 0C 01 03 04 05 12 34')
const data = ref<PacketRunData | null>(null)
const error = ref<ToolError | null>(null)
const showTemplate = ref(false)
const showBytes = ref(true)

let seq = 0
let timer: ReturnType<typeof setTimeout> | undefined

const modeOptions = computed(() => [
  { value: 'hex', label: locale.value === 'zh' ? '十六进制' : 'Hex' },
  { value: 'text', label: locale.value === 'zh' ? '文本' : 'Text' },
])

const statsItems = computed(() => {
  if (!data.value) return []
  return [
    { label: locale.value === 'zh' ? '字节' : 'bytes', value: data.value.byteCount },
    { label: locale.value === 'zh' ? '字段' : 'fields', value: data.value.fields.length },
    { label: locale.value === 'zh' ? '行' : 'rows', value: data.value.rows.length },
  ]
})

const checksumRows = computed(() => {
  if (!data.value) return []
  return [
    { key: 'SUM8', full: data.value.checksums.full.sum8, body: data.value.checksums.body.sum8 },
    { key: 'XOR8', full: data.value.checksums.full.xor8, body: data.value.checksums.body.xor8 },
    { key: 'SUM16', full: data.value.checksums.full.sum16, body: data.value.checksums.body.sum16 },
    { key: 'CRC16', full: data.value.checksums.full.crc16, body: data.value.checksums.body.crc16 },
  ]
})

async function runNow(): Promise<void> {
  const current = ++seq
  const result = await callTool<PacketRunData>('packet', input.value, {
    mode: prefs.mode,
    template: prefs.template,
  }, locale.value)
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
  timer = setTimeout(runNow, 180)
}

function loadSample(): void {
  input.value = 'AA 55 00 0C 01 03 04 05 12 34'
  prefs.mode = 'hex'
  runNow()
}

watch([input, () => prefs.mode, () => prefs.template], schedule)
runNow()
</script>

<template>
  <div class="workbench">
    <div class="option-bar">
      <SegmentedControl v-model="prefs.mode" :options="modeOptions" />
      <button type="button" class="btn btn-sm" :class="{ 'btn-primary': showTemplate }" @click="showTemplate = !showTemplate">
        <ChevronDown :size="13" class="chev" :class="{ open: showTemplate }" />
        {{ locale === 'zh' ? '字段模板' : 'Field template' }}
      </button>
      <span class="option-spacer" />
      <button type="button" class="btn btn-sm" @click="loadSample"><Sparkles :size="13" /> {{ t('action.sample') }}</button>
      <button type="button" class="btn btn-sm" :disabled="!input" @click="input = ''">
        <Trash2 :size="13" /> {{ t('action.clear') }}
      </button>
    </div>

    <section v-if="showTemplate" class="card" style="padding: 12px 14px">
      <label class="field-label" style="display: block; margin-bottom: 6px">
        {{ locale === 'zh' ? '每行：字段名 + 空格/冒号/逗号 + 字节数' : 'One field per line: name + separator + byte length' }}
      </label>
      <textarea
        v-model="prefs.template"
        class="code-input"
        spellcheck="false"
        :placeholder="locale === 'zh' ? '帧头 2\n长度:2\n数据,4' : 'header 2\nlength:2\npayload,4'"
      />
      <p class="faint" style="margin: 7px 0 0; font-size: 11px">
        {{ locale === 'zh' ? '支持 # 注释与「字节 / B / bytes」单位；无法识别的行会在下方提示。' : 'Supports # comments and byte units; invalid lines are reported below.' }}
      </p>
    </section>

    <div class="split">
      <Pane
        :title="t('common.input')"
        :meta="prefs.mode === 'hex' ? (locale === 'zh' ? 'HEX' : 'HEX') : 'UTF-8'"
        :error="Boolean(error)"
      >
        <textarea
          v-model="input"
          class="editor"
          spellcheck="false"
          :placeholder="prefs.mode === 'hex' ? 'AA 55 00 0C …' : 'hello, bit_pouch'"
        />
        <template v-if="data" #footer>
          <span class="faint">{{ locale === 'zh' ? 'HEX' : 'HEX' }}</span>
          <span style="word-break: break-all">{{ data.hex || '—' }}</span>
        </template>
      </Pane>

      <Pane :title="locale === 'zh' ? '概览与校验' : 'Summary & checksums'" :error="Boolean(error)">
        <template #actions>
          <CopyButton :text="data?.hex ?? ''" icon-only ghost />
        </template>
        <ErrorNote v-if="error" :error="error" />
        <div v-else-if="data" style="width: 100%; padding: 14px; overflow: auto">
          <div class="field-label">{{ locale === 'zh' ? 'ASCII' : 'ASCII' }}</div>
          <div class="binary-line" style="margin: 5px 0 12px; min-height: 38px">{{ data.ascii || '—' }}</div>

          <div class="field-label" style="margin-bottom: 6px">
            {{ locale === 'zh' ? '校验值（整包 / 除末尾 2 字节）' : 'Checksums (full / last 2 bytes excluded)' }}
          </div>
          <div class="checksum-grid">
            <div v-for="row in checksumRows" :key="row.key" class="checksum">
              <div class="k">{{ row.key }}</div>
              <div class="v">{{ row.full }} <small>/ {{ row.body }}</small></div>
            </div>
          </div>

          <div v-if="data.invalid.length" class="error-box" style="padding-left: 0">
            <span class="error-title">{{ locale === 'zh' ? '模板中有无法识别的行' : 'Unrecognized template lines' }}</span>
            <span v-for="line in data.invalid" :key="line.line" class="error-pos">L{{ line.line }}: {{ line.text }}</span>
          </div>
        </div>
        <div v-else class="pane-empty">{{ t('common.empty') }}</div>
        <template v-if="data" #footer>
          <StatChips :items="statsItems" />
        </template>
      </Pane>
    </div>

    <section v-if="data && (data.split.rows.length || data.split.rest.bytes.length)" class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>{{ locale === 'zh' ? '字段' : 'Field' }}</th>
            <th>OFFSET</th>
            <th>{{ locale === 'zh' ? '声明' : 'Declared' }}</th>
            <th>{{ locale === 'zh' ? '实际' : 'Actual' }}</th>
            <th>HEX</th>
            <th>ASCII</th>
            <th>INT</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in data.split.rows" :key="index">
            <td class="strong">
              {{ row.name }}
              <span v-if="row.truncated" class="badge" style="margin-left: 5px">truncated</span>
            </td>
            <td class="offset">{{ row.offset }}</td>
            <td class="num">{{ row.declared }}</td>
            <td class="num">{{ row.length }}</td>
            <td class="accent">{{ row.hex || '—' }}</td>
            <td>{{ row.ascii || '—' }}</td>
            <td>{{ row.int ?? '—' }}</td>
          </tr>
          <tr v-if="data.split.rest.bytes.length">
            <td class="strong">{{ locale === 'zh' ? '其余' : 'Rest' }}</td>
            <td class="offset">{{ data.split.rest.offset }}</td>
            <td class="num">—</td>
            <td class="num">{{ data.split.rest.bytes.length }}</td>
            <td class="accent">{{ data.split.rest.hex }}</td>
            <td>{{ data.split.rest.ascii }}</td>
            <td>—</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-if="data && data.rows.length" class="expander">
      <button type="button" class="expander-head" @click="showBytes = !showBytes">
        <ChevronDown :size="14" class="chev" :class="{ open: showBytes }" />
        {{ locale === 'zh' ? '逐字节查看' : 'Byte inspector' }}
        <span class="badge" style="margin-left: auto">{{ data.byteCount }} bytes</span>
      </button>
      <div v-if="showBytes" class="expander-body" style="padding: 0">
        <div class="table-wrap" style="max-height: 46vh; border: 0; border-radius: 0">
          <table class="data-table">
            <thead>
              <tr>
                <th>OFFSET</th>
                <th>HEX</th>
                <th>DEC</th>
                <th>BIN</th>
                <th>ASCII</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in data.rows" :key="row.offset">
                <td class="offset">{{ row.offset.toString(16).toUpperCase().padStart(4, '0') }}</td>
                <td class="accent">{{ row.hex }}</td>
                <td class="num">{{ row.dec }}</td>
                <td>{{ row.bin }}</td>
                <td>{{ row.ascii }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="data.truncated" class="pane-foot" style="border-top: 1px solid var(--line)">
          {{ locale === 'zh' ? `仅显示前 ${data.rows.length} / ${data.byteCount} 字节` : `Showing ${data.rows.length} of ${data.byteCount} bytes` }}
        </div>
      </div>
    </section>
  </div>
</template>
