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
import type { DecodedField } from './decode'
import type { PacketRunData } from './run'

const SAMPLE = `00 11 22 33 44 55 66 77 88 99 AA BB 08 00
45 00 00 2D 1C 46 40 00 40 06 9C 6C C0 A8 00 01 C0 A8 00 C7
00 50 01 BB 00 00 00 00 00 00 00 00 50 02 20 00 00 00 00 00
68 65 6C 6C 6F`

const prefs = useToolPrefs('packet', {
  mode: 'auto' as 'auto' | 'hex' | 'text',
  template: '',
})
const input = ref(SAMPLE)
const data = ref<PacketRunData | null>(null)
const error = ref<ToolError | null>(null)
const showAdvanced = ref(false)
const pinned = ref('')
const tip = ref<{ x: number; y: number; name: string; value: string; meaning: string } | null>(null)
const activeRange = ref<[number, number] | null>(null)

let seq = 0
let timer: ReturnType<typeof setTimeout> | undefined

const modeOptions = computed(() => [
  { value: 'auto', label: locale.value === 'zh' ? '自动' : 'Auto' },
  { value: 'hex', label: locale.value === 'zh' ? '十六进制' : 'Hex' },
  { value: 'text', label: locale.value === 'zh' ? '文本' : 'Text' },
])

const kindLabel = computed(() => (data.value?.kind === 'hexdump' ? 'HEXDUMP' : data.value?.mode === 'text' ? 'UTF-8' : 'HEX'))

const hint = computed(() =>
  prefs.mode === 'text'
    ? locale.value === 'zh'
      ? '文本会按 UTF-8 编码后解析，左侧同时给出每行 ASCII。'
      : 'Text is encoded as UTF-8; each input line keeps a matching ASCII row.'
    : locale.value === 'zh'
      ? '支持连续 HEX、空格/逗号分隔、Wireshark/xxd 风格的带偏移转储；左侧按原行分上下展示原文与 ASCII。'
      : 'Accepts continuous hex, spaced/comma-separated bytes, and Wireshark/xxd dumps; raw and ASCII stay line-aligned.',
)

const flatFields = computed(() => data.value?.analysis.layers.flatMap((layer) => layer.fields) ?? [])

const statsItems = computed(() => {
  if (!data.value) return []
  return [
    { label: locale.value === 'zh' ? '字节' : 'bytes', value: data.value.byteCount },
    { label: locale.value === 'zh' ? '层' : 'layers', value: data.value.analysis.layers.length },
    { label: locale.value === 'zh' ? '字段' : 'fields', value: flatFields.value.length },
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

const detailText = computed(() => {
  if (!data.value) return ''
  const rows: string[] = [`${data.value.analysis.format} · ${data.value.byteCount} bytes`]
  for (const layer of data.value.analysis.layers) {
    rows.push(`\n[${layer.name}]`)
    for (const field of layer.fields) rows.push(`${field.name}: ${field.value}  (+${field.offset}, ${field.length}B)  ${field.meaning}`)
  }
  return rows.join('\n')
})

const hexByte = (byte: number): string => byte.toString(16).toUpperCase().padStart(2, '0')

const fieldKey = (layerIndex: number, fieldIndex: number): string => `${layerIndex}:${fieldIndex}`

function fieldAt(offset: number): DecodedField | null {
  let best: DecodedField | null = null
  for (const field of flatFields.value) {
    if (field.length > 0 && offset >= field.offset && offset < field.offset + field.length) {
      if (!best || field.length < best.length) best = field
    }
  }
  return best
}

function isActive(offset: number): boolean {
  const range = activeRange.value
  return Boolean(range && offset >= range[0] && offset < range[1])
}

function moveTip(event: MouseEvent): void {
  if (!tip.value) return
  tip.value.x = Math.min(event.clientX + 14, Math.max(8, window.innerWidth - 316))
  tip.value.y = Math.min(event.clientY + 16, Math.max(8, window.innerHeight - 150))
}

function showTip(field: DecodedField | null, event: MouseEvent | FocusEvent): void {
  if (!field) return
  activeRange.value = [field.offset, field.offset + field.length]
  tip.value = { x: 0, y: 0, name: field.name, value: field.value, meaning: field.meaning }
  if (event instanceof MouseEvent) {
    moveTip(event)
    return
  }
  const rect = (event.target as HTMLElement | null)?.getBoundingClientRect()
  tip.value.x = rect ? Math.min(rect.left + 12, Math.max(8, window.innerWidth - 316)) : 16
  tip.value.y = rect ? Math.min(rect.bottom + 7, Math.max(8, window.innerHeight - 150)) : 16
}

function hideTip(): void {
  tip.value = null
  activeRange.value = null
}

function togglePin(key: string): void {
  pinned.value = pinned.value === key ? '' : key
}

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
    pinned.value = ''
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
  input.value = SAMPLE
  prefs.mode = 'auto'
  runNow()
}

watch([input, () => prefs.mode, () => prefs.template], schedule)
runNow()
</script>

<template>
  <div class="workbench pkt">
    <div class="option-bar">
      <SegmentedControl v-model="prefs.mode" :options="modeOptions" />
      <span class="faint pkt-kind">{{ kindLabel }}</span>
      <span class="option-spacer" />
      <button type="button" class="btn btn-sm" @click="loadSample"><Sparkles :size="13" /> {{ t('action.sample') }}</button>
      <button type="button" class="btn btn-sm" :disabled="!input" @click="input = ''">
        <Trash2 :size="13" /> {{ t('action.clear') }}
      </button>
    </div>

    <section class="pkt-input">
      <textarea
        v-model="input"
        class="code-input pkt-source"
        spellcheck="false"
        :placeholder="locale === 'zh' ? '粘贴 HEX、带偏移的十六进制转储，或文本报文' : 'Paste hex, a hex dump with offsets, or a text message'"
        @keydown.ctrl.enter.prevent="runNow"
        @keydown.meta.enter.prevent="runNow"
      />
      <div class="pkt-input-foot">
        <span class="faint">{{ hint }}</span>
        <span v-if="data" class="pkt-input-meta">{{ data.byteCount }} B · {{ data.lines.length }} lines</span>
      </div>
    </section>

    <ErrorNote v-if="error" :error="error" />

    <div v-else-if="data && data.byteCount" class="split">
      <Pane :title="locale === 'zh' ? '报文原文' : 'Raw packet'" :meta="kindLabel">
        <template #actions>
          <CopyButton :text="data.hex" icon-only ghost />
        </template>
        <div class="pkt-raw" @mousemove="moveTip" @mouseleave="hideTip">
          <div v-for="(line, index) in data.lines" :key="index" class="pkt-line">
            <div v-if="data.mode === 'text'" class="pkt-hexline pkt-textline">{{ line.text || ' ' }}</div>
            <div v-else class="pkt-hexline">
              <span
                v-for="(byte, byteIndex) in line.bytes"
                :key="byteIndex"
                class="pkt-byte"
                :class="{ on: isActive(line.offset + byteIndex) }"
                @mouseenter="showTip(fieldAt(line.offset + byteIndex), $event)"
              >{{ hexByte(byte) }}</span>
            </div>
            <div class="pkt-asciiline">{{ line.ascii || ' ' }}</div>
          </div>
        </div>
        <template #footer>
          <span>{{ data.byteCount }} B</span>
          <span style="margin-left: auto">{{ data.analysis.format }}</span>
        </template>
      </Pane>

      <Pane :title="locale === 'zh' ? '解析详解' : 'Decoded detail'" :meta="data.analysis.kind.toUpperCase()">
        <template #actions>
          <CopyButton :text="detailText" icon-only ghost />
        </template>
        <div class="pkt-detail" @mousemove="moveTip" @mouseleave="hideTip">
          <div class="pkt-format">{{ data.analysis.summary }}</div>
          <section v-for="(layer, layerIndex) in data.analysis.layers" :key="layerIndex" class="pkt-layer">
            <header class="pkt-layer-head">
              <span class="pkt-layer-name">{{ layer.name }}</span>
              <span v-if="layer.note" class="pkt-layer-note">{{ layer.note }}</span>
            </header>
            <div
              v-for="(field, fieldIndex) in layer.fields"
              :key="fieldIndex"
              class="pkt-field"
              :class="{ pinned: pinned === fieldKey(layerIndex, fieldIndex) }"
              tabindex="0"
              @mouseenter="showTip(field, $event)"
              @focus="showTip(field, $event)"
              @click="togglePin(fieldKey(layerIndex, fieldIndex))"
              @keydown.enter.prevent="togglePin(fieldKey(layerIndex, fieldIndex))"
            >
              <span class="pkt-fname">{{ field.name }}</span>
              <span class="pkt-fval">{{ field.value }}</span>
              <span class="pkt-fpos">+{{ field.offset }} · {{ field.length }}B</span>
              <p v-if="pinned === fieldKey(layerIndex, fieldIndex)" class="pkt-fmean">{{ field.meaning }}</p>
            </div>
          </section>
          <p v-for="(warning, index) in data.analysis.warnings" :key="`w-${index}`" class="pkt-warn">· {{ warning }}</p>
        </div>
        <template #footer>
          <StatChips :items="statsItems" />
        </template>
      </Pane>
    </div>

    <div v-else class="pane pkt-empty">
      {{ locale === 'zh' ? '粘贴报文后，左侧按原行显示 HEX 与 ASCII，右侧自动识别协议并逐字段解释。' : 'Paste a packet: the left keeps hex and ASCII line-aligned, the right auto-detects protocols and explains each field.' }}
    </div>

    <section v-if="data && data.byteCount" class="expander">
      <button type="button" class="expander-head" @click="showAdvanced = !showAdvanced">
        <ChevronDown :size="14" class="chev" :class="{ open: showAdvanced }" />
        {{ locale === 'zh' ? '高级：字段模板 / 逐字节 / 校验值' : 'Advanced: field template, bytes, checksums' }}
      </button>
      <div v-if="showAdvanced" class="expander-body pkt-advanced">
        <div class="pkt-adv-block">
          <label class="field-label" style="display: block; margin-bottom: 6px">
            {{ locale === 'zh' ? '每行：字段名 + 空格/冒号/逗号 + 字节数' : 'One field per line: name + separator + byte length' }}
          </label>
          <textarea
            v-model="prefs.template"
            class="code-input pkt-template"
            spellcheck="false"
            :placeholder="locale === 'zh' ? '帧头 2\n长度:2\n数据,4' : 'header 2\nlength:2\npayload,4'"
          />
          <p class="faint" style="margin: 6px 0 0; font-size: 11px">
            {{ locale === 'zh' ? '用于自定义拆包；网络协议解析不受模板影响。' : 'Custom field splitting; protocol decoding does not depend on it.' }}
          </p>
          <div v-if="data.split.rows.length" class="table-wrap" style="margin-top: 8px; max-height: 26vh">
            <table class="data-table">
              <thead>
                <tr>
                  <th>{{ locale === 'zh' ? '字段' : 'Field' }}</th>
                  <th>OFFSET</th>
                  <th>{{ locale === 'zh' ? '实际' : 'Actual' }}</th>
                  <th>HEX</th>
                  <th>ASCII</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, index) in data.split.rows" :key="index">
                  <td class="strong">{{ row.name }}<span v-if="row.truncated" class="badge" style="margin-left: 5px">truncated</span></td>
                  <td class="offset">{{ row.offset }}</td>
                  <td class="num">{{ row.length }}</td>
                  <td class="accent">{{ row.hex || '—' }}</td>
                  <td>{{ row.ascii || '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="pkt-adv-block">
          <div class="field-label">{{ locale === 'zh' ? '校验值（整包 / 除末尾 2 字节）' : 'Checksums (full / last 2 bytes excluded)' }}</div>
          <div class="checksum-grid" style="margin-top: 7px">
            <div v-for="row in checksumRows" :key="row.key" class="checksum">
              <div class="k">{{ row.key }}</div>
              <div class="v">{{ row.full }} <small>/ {{ row.body }}</small></div>
            </div>
          </div>
        </div>

        <div class="pkt-adv-block">
          <div class="field-label">{{ locale === 'zh' ? '逐字节' : 'Bytes' }} · {{ data.byteCount }}</div>
          <div class="table-wrap" style="margin-top: 7px; max-height: 30vh">
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
          <p v-if="data.truncated" class="faint" style="margin: 6px 0 0; font-size: 11px">
            {{ locale === 'zh' ? `仅显示前 ${data.rows.length} / ${data.byteCount} 字节` : `Showing ${data.rows.length} of ${data.byteCount} bytes` }}
          </p>
        </div>
      </div>
    </section>

    <div v-if="tip" class="pkt-tip" :style="{ left: `${tip.x}px`, top: `${tip.y}px` }">
      <div class="pkt-tip-head"><strong>{{ tip.name }}</strong><span>{{ tip.value }}</span></div>
      <p>{{ tip.meaning }}</p>
    </div>
  </div>
</template>

<style scoped>
.pkt-kind {
  font-family: var(--mono);
  font-size: 10.5px;
  letter-spacing: 0.08em;
}
.pkt-input {
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--panel);
}
.pkt-source {
  min-height: 96px;
}
.pkt-input-foot {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-top: 8px;
  font-size: 11px;
}
.pkt-input-meta {
  margin-left: auto;
  font-family: var(--mono);
  color: var(--text-faint);
  white-space: nowrap;
}
.pkt-raw,
.pkt-detail {
  width: 100%;
  padding: 12px 14px;
  overflow: auto;
  max-height: 62vh;
}
.pkt-raw {
  font-family: var(--mono);
  font-size: 12px;
  line-height: 1.6;
}
.pkt-line + .pkt-line {
  margin-top: 7px;
  padding-top: 7px;
  border-top: 1px dashed var(--line);
}
.pkt-hexline {
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--text);
}
.pkt-textline {
  color: var(--text-dim);
}
.pkt-byte {
  display: inline-block;
  margin-right: 5px;
  padding: 0 1px;
  border-radius: 3px;
  cursor: crosshair;
}
.pkt-byte.on {
  background: var(--accent-soft);
  color: var(--accent);
}
.pkt-asciiline {
  margin-top: 2px;
  color: var(--text-faint);
  white-space: pre-wrap;
  word-break: break-all;
}
.pkt-format {
  margin-bottom: 10px;
  padding: 7px 9px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--bg-soft);
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--accent);
  overflow-wrap: anywhere;
}
.pkt-layer + .pkt-layer {
  margin-top: 12px;
}
.pkt-layer-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 4px 6px;
  border-bottom: 1px solid var(--line);
}
.pkt-layer-name {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-faint);
}
.pkt-layer-note {
  margin-left: auto;
  font-family: var(--mono);
  font-size: 10px;
  color: var(--text-faint);
}
.pkt-field {
  display: grid;
  grid-template-columns: minmax(96px, 0.9fr) minmax(0, 1.5fr) auto;
  gap: 4px 10px;
  align-items: baseline;
  padding: 5px 6px;
  border-radius: 6px;
  cursor: help;
}
.pkt-field:hover,
.pkt-field:focus-visible,
.pkt-field.pinned {
  background: var(--panel-2);
  outline: none;
}
.pkt-fname {
  color: var(--text-dim);
  font-size: 11.5px;
}
.pkt-fval {
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--accent);
  overflow-wrap: anywhere;
}
.pkt-fpos {
  font-family: var(--mono);
  font-size: 9.5px;
  color: var(--text-faint);
  white-space: nowrap;
}
.pkt-fmean {
  grid-column: 1 / -1;
  margin: 2px 0 0;
  padding-top: 4px;
  border-top: 1px dashed var(--line);
  color: var(--text-dim);
  font-size: 11px;
  line-height: 1.55;
}
.pkt-warn {
  margin: 8px 0 0;
  color: var(--amber);
  font-size: 11.5px;
  line-height: 1.55;
}
.pkt-empty {
  min-height: 26vh;
  padding: 24px;
  color: var(--text-faint);
  font-size: 12px;
  text-align: center;
}
.pkt-advanced {
  display: grid;
  gap: 14px;
}
.pkt-adv-block {
  min-width: 0;
}
.pkt-template {
  min-height: 78px;
}
.pkt-tip {
  position: fixed;
  z-index: 120;
  max-width: 300px;
  padding: 9px 11px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--panel-2);
  box-shadow: var(--shadow);
  pointer-events: none;
}
.pkt-tip-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 4px;
}
.pkt-tip-head strong {
  font-size: 11.5px;
  color: var(--text);
}
.pkt-tip-head span {
  margin-left: auto;
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--accent);
}
.pkt-tip p {
  margin: 0;
  font-size: 11px;
  line-height: 1.55;
  color: var(--text-dim);
}
</style>
