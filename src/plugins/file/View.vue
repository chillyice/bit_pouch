<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Download, FileArchive, FileUp, Trash2 } from 'lucide-vue-next'
import CopyButton from '@/components/CopyButton.vue'
import DropHint from '@/components/DropHint.vue'
import Pane from '@/components/Pane.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import StatChips from '@/components/StatChips.vue'
import { useFileDrop } from '@/core/fileDrop'
import { locale, t } from '@/core/i18n'
import { useToolPrefs } from '@/core/toolPrefs'
import { detectFileType, formatFileSize, planZipNames } from './core'

type Mode = 'detect' | 'pack' | 'unpack'

const MAX_PACK_BYTES = 200 * 1024 * 1024
const HEAD_BYTES = 64

const prefs = useToolPrefs('file', { mode: 'detect' as Mode })
const files = ref<File[]>([])
const fileEl = ref<HTMLInputElement | null>(null)
const head = ref('')
const detected = ref<{ name: string; mime: string; ext: string } | null>(null)
const sha256 = ref('')
const zipName = ref('archive')
const packed = ref<{ bytes: Uint8Array; count: number; size: number } | null>(null)
const entries = ref<Array<{ name: string; data: Uint8Array; size: number }>>([])
const error = ref('')
const busy = ref(false)

const modeOptions = computed(() => [
  { value: 'detect', label: locale.value === 'zh' ? '识别' : 'Detect' },
  { value: 'pack', label: locale.value === 'zh' ? '打包' : 'Pack' },
  { value: 'unpack', label: locale.value === 'zh' ? '解包' : 'Unpack' },
])

const accept = computed(() => (prefs.mode === 'unpack' ? '.zip,application/zip' : ''))
const hint = computed(() => {
  if (prefs.mode === 'pack') return locale.value === 'zh' ? '可多选；合计上限 200 MB' : 'Multi-select; 200 MB total limit'
  if (prefs.mode === 'unpack') return locale.value === 'zh' ? '选择 ZIP 文件，逐个下载条目' : 'Pick a ZIP and download entries one by one'
  return locale.value === 'zh' ? '读取文件头识别类型，并计算 SHA-256' : 'Reads the magic bytes and computes SHA-256'
})
const previewNames = computed(() => planZipNames(files.value.map((file) => file.name)))
const totalSize = computed(() => files.value.reduce((sum, file) => sum + file.size, 0))

const statsItems = computed(() => {
  const items: Array<{ label: string; value: string | number }> = []
  if (files.value.length) items.push({ label: locale.value === 'zh' ? '文件' : 'files', value: files.value.length })
  if (packed.value) items.push({ label: locale.value === 'zh' ? '条目' : 'entries', value: packed.value.count })
  if (entries.value.length) items.push({ label: locale.value === 'zh' ? '条目' : 'entries', value: entries.value.length })
  return items
})

function resetResult(): void {
  head.value = ''
  detected.value = null
  sha256.value = ''
  packed.value = null
  entries.value = []
  error.value = ''
}

function clearAll(): void {
  files.value = []
  resetResult()
  if (fileEl.value) fileEl.value.value = ''
}

function pickFile(): void {
  fileEl.value?.click()
}

async function inspect(file: File): Promise<void> {
  busy.value = true
  error.value = ''
  try {
    const bytes = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer())
    head.value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(' ')
    detected.value = detectFileType(bytes)
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))
    sha256.value = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
  } catch {
    error.value = locale.value === 'zh' ? '文件读取失败' : 'Failed to read the file'
  } finally {
    busy.value = false
  }
}

async function pack(): Promise<void> {
  if (!files.value.length) return
  busy.value = true
  error.value = ''
  packed.value = null
  try {
    if (totalSize.value > MAX_PACK_BYTES) {
      error.value = locale.value === 'zh' ? `合计超过 ${formatFileSize(MAX_PACK_BYTES)}` : `Total exceeds ${formatFileSize(MAX_PACK_BYTES)}`
      return
    }
    const { zipSync } = await import('fflate')
    const input: Record<string, Uint8Array> = {}
    const names = previewNames.value
    for (let index = 0; index < files.value.length; index += 1) {
      input[names[index]] = new Uint8Array(await files.value[index].arrayBuffer())
    }
    const output = zipSync(input, { level: 6 })
    packed.value = { bytes: output, count: names.length, size: output.length }
  } catch {
    error.value = locale.value === 'zh' ? '打包失败' : 'Pack failed'
  } finally {
    busy.value = false
  }
}

async function unpack(file: File): Promise<void> {
  busy.value = true
  error.value = ''
  try {
    const { unzipSync } = await import('fflate')
    const map = unzipSync(new Uint8Array(await file.arrayBuffer()))
    entries.value = Object.entries(map)
      .filter(([name]) => !name.endsWith('/'))
      .map(([name, data]) => ({ name, data, size: data.length }))
    if (!entries.value.length) error.value = locale.value === 'zh' ? '压缩包是空的' : 'The archive is empty'
  } catch {
    error.value = locale.value === 'zh' ? '解包失败，文件可能不是 ZIP' : 'Unpack failed; this may not be a ZIP'
  } finally {
    busy.value = false
  }
}

async function onFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  await acceptFiles(Array.from(input.files ?? []))
}

async function acceptFiles(list: File[]): Promise<void> {
  clearAll()
  if (!list.length) return
  files.value = prefs.mode === 'pack' ? list : list.slice(0, 1)
  if (prefs.mode === 'detect') await inspect(files.value[0])
  if (prefs.mode === 'unpack') await unpack(files.value[0])
}

const { dragging, dropBinding } = useFileDrop((list) => {
  void acceptFiles(list)
})

function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

function downloadPacked(): void {
  if (!packed.value) return
  saveBlob(new Blob([packed.value.bytes.buffer as ArrayBuffer], { type: 'application/zip' }), `${zipName.value || 'archive'}.zip`)
}

function downloadEntry(entry: { name: string; data: Uint8Array }): void {
  saveBlob(new Blob([entry.data.buffer as ArrayBuffer]), entry.name.split('/').pop() || 'file')
}

watch(
  () => prefs.mode,
  () => {
    const current = files.value
    clearAll()
    if (!current.length) return
    files.value = prefs.mode === 'pack' ? current : current.slice(0, 1)
    if (prefs.mode === 'detect') inspect(files.value[0])
    if (prefs.mode === 'unpack') unpack(files.value[0])
  },
)
</script>

<template>
  <div class="workbench" v-bind="dropBinding">
    <DropHint :visible="dragging" />
    <div class="option-bar">
      <SegmentedControl v-model="prefs.mode" :options="modeOptions" />
      <span class="option-spacer" />
      <span v-if="files.length" class="faint">{{ formatFileSize(totalSize) }}</span>
      <button type="button" class="btn btn-sm btn-ghost" :disabled="!files.length && !packed && !entries.length" @click="clearAll">
        <Trash2 :size="13" /> {{ t('action.clear') }}
      </button>
    </div>

    <div class="split">
      <Pane :title="prefs.mode === 'pack' ? (locale === 'zh' ? '选择文件' : 'Choose files') : (locale === 'zh' ? '文件' : 'File')">
        <div style="width: 100%; padding: 16px; display: flex; flex-direction: column; gap: 12px">
          <input
            ref="fileEl"
            type="file"
            :accept="accept"
            :multiple="prefs.mode === 'pack'"
            style="display: none"
            @change="onFileChange"
          />
          <button type="button" class="btn" style="align-self: flex-start" @click="pickFile">
            <FileUp :size="14" /> {{ locale === 'zh' ? '选择文件' : 'Choose file' }}
          </button>
          <div class="faint">{{ hint }}</div>

          <div v-if="files.length" class="binary-line" style="flex-direction: column; align-items: stretch; gap: 6px">
            <div v-for="(file, index) in files" :key="`${file.name}-${index}`" style="display: flex; justify-content: space-between; gap: 10px">
              <span class="mono" style="word-break: break-all">{{ prefs.mode === 'pack' ? previewNames[index] : file.name }}</span>
              <span class="faint">{{ formatFileSize(file.size) }}</span>
            </div>
          </div>

          <template v-if="prefs.mode === 'pack'">
            <div class="field">
              <span class="field-label">{{ locale === 'zh' ? '压缩包名' : 'Archive name' }}</span>
              <input v-model="zipName" class="input" placeholder="archive" />
            </div>
            <button type="button" class="btn btn-primary" :disabled="!files.length || busy" @click="pack">
              <FileArchive :size="14" /> {{ busy ? t('common.loading') : locale === 'zh' ? '打包 ZIP' : 'Pack ZIP' }}
            </button>
          </template>

          <template v-if="prefs.mode === 'unpack' && entries.length">
            <div class="section-label">{{ locale === 'zh' ? '条目' : 'Entries' }}</div>
            <div class="binary-line" style="flex-direction: column; align-items: stretch; gap: 6px">
              <div v-for="entry in entries" :key="entry.name" style="display: flex; align-items: center; gap: 8px">
                <span class="mono" style="flex: 1; word-break: break-all">{{ entry.name }}</span>
                <span class="faint">{{ formatFileSize(entry.size) }}</span>
                <button type="button" class="btn btn-sm btn-ghost" :aria-label="locale === 'zh' ? '下载' : 'Download'" @click="downloadEntry(entry)">
                  <Download :size="13" />
                </button>
              </div>
            </div>
          </template>
        </div>
      </Pane>

      <Pane :title="locale === 'zh' ? '结果' : 'Result'" :error="Boolean(error)">
        <div v-if="error" class="error-box">{{ error }}</div>

        <div v-else-if="prefs.mode === 'detect' && detected" style="width: 100%; padding: 16px; display: flex; flex-direction: column; gap: 12px">
          <div class="result-card highlight">
            <div class="k">{{ locale === 'zh' ? '类型' : 'Type' }}</div>
            <div class="v big">{{ detected.name }}</div>
            <div class="faint mono">{{ detected.mime }}</div>
          </div>
          <div>
            <div class="section-label" style="margin-bottom: 6px">{{ locale === 'zh' ? '文件头' : 'Magic bytes' }}</div>
            <pre class="output wrap" style="min-height: 0; padding: 10px; border: 1px solid var(--line); border-radius: 8px">{{ head }}</pre>
          </div>
          <div>
            <div class="section-label" style="margin-bottom: 6px">SHA-256</div>
            <div class="binary-line" style="gap: 8px">
              <code class="mono" style="flex: 1; word-break: break-all">{{ sha256 }}</code>
              <CopyButton :text="sha256" icon-only ghost />
            </div>
          </div>
        </div>

        <div v-else-if="prefs.mode === 'detect' && files.length && !busy" class="pane-empty">
          {{ locale === 'zh' ? '无法从文件头识别类型' : 'Could not detect the type from the header' }}
        </div>

        <div v-else-if="prefs.mode === 'pack' && packed" style="width: 100%; padding: 16px; display: flex; flex-direction: column; gap: 12px">
          <div class="result-card highlight">
            <div class="k">ZIP</div>
            <div class="v big">{{ packed.count }} {{ locale === 'zh' ? '个条目' : 'entries' }}</div>
            <div class="faint">{{ formatFileSize(packed.size) }}</div>
          </div>
          <button type="button" class="btn btn-primary" style="align-self: flex-start" @click="downloadPacked">
            <Download :size="14" /> {{ locale === 'zh' ? '下载 ZIP' : 'Download ZIP' }}
          </button>
        </div>

        <div v-else-if="prefs.mode === 'unpack' && entries.length" style="width: 100%; padding: 16px">
          <div class="result-card">
            <div class="k">{{ locale === 'zh' ? '条目' : 'Entries' }}</div>
            <div class="v big">{{ entries.length }}</div>
          </div>
        </div>

        <div v-else class="pane-empty">{{ busy ? t('common.loading') : t('common.empty') }}</div>

        <template v-if="statsItems.length" #footer>
          <StatChips :items="statsItems" />
        </template>
      </Pane>
    </div>

    <div class="faint" style="font-size: 12px">
      {{ locale === 'zh' ? '文件只在本机读取与打包，不会上传。' : 'Files are read and packed locally and never uploaded.' }}
    </div>
  </div>
</template>
