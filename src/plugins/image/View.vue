<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Download, FileUp, ImageDown, Sparkles } from 'lucide-vue-next'
import CopyButton from '@/components/CopyButton.vue'
import Pane from '@/components/Pane.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import StatChips from '@/components/StatChips.vue'
import { locale, t } from '@/core/i18n'
import { useToolPrefs } from '@/core/toolPrefs'
import { ICO_SIZES, MAX_IMAGE_BYTES, buildIco, parseJpegExif } from './core'

type Mode = 'compress' | 'ico' | 'exif'
type Format = 'auto' | 'png' | 'jpeg' | 'webp'

interface Compressed {
  blob: Blob
  url: string
  width: number
  height: number
  size: number
  dataUrl: string
  ext: string
}

interface ExifResult {
  hasExif: boolean
  tags: Array<{ tag: string; name: string; value: string | number }>
}

interface IcoResult {
  blob: Blob
  entries: Array<{ width: number; height: number }>
}

const prefs = useToolPrefs('image', {
  mode: 'compress' as Mode,
  maxWidth: 1920,
  quality: 82,
  format: 'auto' as Format,
  sizes: [16, 32, 48, 256] as number[],
})

const file = ref<File | null>(null)
const fileEl = ref<HTMLInputElement | null>(null)
const busy = ref(false)
const error = ref('')
const compressed = ref<Compressed | null>(null)
const ico = ref<IcoResult | null>(null)
const exif = ref<ExifResult | null>(null)

const modeOptions = computed(() => [
  { value: 'compress', label: locale.value === 'zh' ? '压缩' : 'Compress' },
  { value: 'ico', label: 'ICO' },
  { value: 'exif', label: 'EXIF' },
])

const formatOptions = computed(() => [
  { value: 'auto', label: locale.value === 'zh' ? '自动' : 'Auto' },
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'webp', label: 'WebP' },
])

const saved = computed(() => {
  if (!compressed.value || !file.value?.size) return ''
  const ratio = Math.round((1 - compressed.value.size / file.value.size) * 100)
  if (ratio >= 0) return locale.value === 'zh' ? `节省 ${ratio}%` : `${ratio}% smaller`
  return locale.value === 'zh' ? `增大 ${Math.abs(ratio)}%` : `${Math.abs(ratio)}% larger`
})

const statsItems = computed(() => {
  const items: Array<{ label: string; value: string | number }> = []
  if (file.value) items.push({ label: locale.value === 'zh' ? '原始' : 'source', value: formatBytes(file.value.size) })
  if (compressed.value) items.push({ label: locale.value === 'zh' ? '输出' : 'output', value: formatBytes(compressed.value.size) })
  if (exif.value?.tags.length) items.push({ label: 'EXIF', value: exif.value.tags.length })
  if (ico.value) items.push({ label: locale.value === 'zh' ? '图像' : 'frames', value: ico.value.entries.length })
  return items
})

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function resetResult(): void {
  if (compressed.value?.url) URL.revokeObjectURL(compressed.value.url)
  compressed.value = null
  ico.value = null
  exif.value = null
  error.value = ''
}

function pickFile(): void {
  fileEl.value?.click()
}

function loadImage(source: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('decode'))
    image.src = URL.createObjectURL(source)
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

async function compress(): Promise<void> {
  resetResult()
  if (!file.value) return
  busy.value = true
  try {
    const image = await loadImage(file.value)
    const scale = Math.min(1, Number(prefs.maxWidth) / image.naturalWidth)
    const width = Math.max(1, Math.round(image.naturalWidth * scale))
    const height = Math.max(1, Math.round(image.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d')?.drawImage(image, 0, 0, width, height)
    const type =
      prefs.format === 'auto' ? (file.value.type === 'image/png' ? 'image/png' : 'image/jpeg') : `image/${prefs.format}`
    const blob = await canvasToBlob(canvas, type, Number(prefs.quality) / 100)
    if (!blob) throw new Error('encode')
    const actualType = blob.type || type
    compressed.value = {
      blob,
      url: URL.createObjectURL(blob),
      width,
      height,
      size: blob.size,
      dataUrl: canvas.toDataURL(actualType, Number(prefs.quality) / 100),
      ext: actualType.includes('png') ? 'png' : actualType.includes('webp') ? 'webp' : 'jpg',
    }
  } catch {
    error.value = locale.value === 'zh' ? '图片处理失败' : 'Image processing failed'
  } finally {
    busy.value = false
  }
}

async function makeIco(): Promise<void> {
  resetResult()
  if (!file.value) return
  if (!prefs.sizes.length) {
    error.value = locale.value === 'zh' ? '至少选择一个尺寸' : 'Pick at least one size'
    return
  }
  busy.value = true
  try {
    const image = await loadImage(file.value)
    const frames: Array<{ width: number; height: number; data: Uint8Array }> = []
    for (const size of [...prefs.sizes].sort((a, b) => a - b)) {
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const context = canvas.getContext('2d')
      if (!context) throw new Error('canvas')
      const scale = Math.max(size / image.naturalWidth, size / image.naturalHeight)
      const width = image.naturalWidth * scale
      const height = image.naturalHeight * scale
      context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height)
      const blob = await canvasToBlob(canvas, 'image/png')
      if (!blob) throw new Error('encode')
      frames.push({ width: size, height: size, data: new Uint8Array(await blob.arrayBuffer()) })
    }
    const bytes = buildIco(frames)
    ico.value = { blob: new Blob([bytes], { type: 'image/x-icon' }), entries: frames.map((f) => ({ width: f.width, height: f.height })) }
  } catch (err) {
    const code = (err as { code?: string })?.code
    error.value =
      code === 'invalidSize'
        ? locale.value === 'zh'
          ? '尺寸必须是 1–256 的正方形'
          : 'Sizes must be squares between 1 and 256'
        : locale.value === 'zh'
          ? 'ICO 生成失败'
          : 'ICO generation failed'
  } finally {
    busy.value = false
  }
}

async function readExif(): Promise<void> {
  resetResult()
  if (!file.value) return
  busy.value = true
  try {
    exif.value = parseJpegExif(new Uint8Array(await file.value.arrayBuffer())) as ExifResult
  } catch (err) {
    error.value =
      (err as { code?: string })?.code === 'notJpeg'
        ? locale.value === 'zh'
          ? '请选择 JPEG 图片'
          : 'Choose a JPEG image'
        : locale.value === 'zh'
          ? 'EXIF 读取失败'
          : 'Failed to read EXIF'
  } finally {
    busy.value = false
  }
}

async function onFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const next = input.files?.[0] ?? null
  resetResult()
  if (!next) {
    file.value = null
    return
  }
  if (next.size > MAX_IMAGE_BYTES) {
    file.value = null
    error.value = locale.value === 'zh' ? `图片不能超过 ${formatBytes(MAX_IMAGE_BYTES)}` : `Images must stay under ${formatBytes(MAX_IMAGE_BYTES)}`
    return
  }
  file.value = next
  await run()
}

async function run(): Promise<void> {
  if (prefs.mode === 'compress') await compress()
  else if (prefs.mode === 'ico') await makeIco()
  else await readExif()
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

function loadSample(): void {
  prefs.mode = 'compress'
  error.value = locale.value === 'zh' ? '选择一张图片开始' : 'Choose an image to begin'
}

watch(
  () => prefs.mode,
  () => {
    resetResult()
    if (file.value) run()
  },
)

onBeforeUnmount(resetResult)
</script>

<template>
  <div class="workbench">
    <div class="option-bar">
      <SegmentedControl v-model="prefs.mode" :options="modeOptions" />
      <span class="option-spacer" />
      <button type="button" class="btn btn-sm" @click="loadSample">
        <Sparkles :size="13" /> {{ t('action.sample') }}
      </button>
    </div>

    <div v-if="prefs.mode === 'compress'" class="option-bar">
      <div class="option-group">
        <span class="field-label">{{ locale === 'zh' ? '最大宽度' : 'Max width' }}</span>
        <input v-model.number="prefs.maxWidth" class="input" type="number" min="1" style="width: 100px" />
      </div>
      <div class="option-group">
        <span class="field-label">{{ locale === 'zh' ? '质量' : 'Quality' }}</span>
        <input v-model.number="prefs.quality" type="range" min="10" max="100" style="width: 130px" />
        <span class="mono faint">{{ prefs.quality }}</span>
      </div>
      <div class="option-group">
        <span class="field-label">{{ locale === 'zh' ? '格式' : 'Format' }}</span>
        <SegmentedControl v-model="prefs.format" :options="formatOptions" />
      </div>
    </div>

    <div v-if="prefs.mode === 'ico'" class="option-bar">
      <span class="field-label">{{ locale === 'zh' ? '尺寸' : 'Sizes' }}</span>
      <label v-for="size in ICO_SIZES" :key="size" class="option-group" style="cursor: pointer">
        <input v-model="prefs.sizes" type="checkbox" :value="size" />
        <span class="mono">{{ size }}</span>
      </label>
    </div>

    <div class="split">
      <Pane :title="locale === 'zh' ? '图片' : 'Image'" :meta="file ? formatBytes(file.size) : ''" :error="Boolean(error)">
        <div style="width: 100%; padding: 16px; display: flex; flex-direction: column; gap: 12px">
          <input ref="fileEl" type="file" :accept="prefs.mode === 'exif' ? 'image/jpeg' : 'image/*'" style="display: none" @change="onFileChange" />
          <button type="button" class="btn" style="align-self: flex-start" @click="pickFile">
            <FileUp :size="14" /> {{ locale === 'zh' ? '选择图片' : 'Choose image' }}
          </button>
          <div v-if="file" class="binary-line" style="word-break: break-all">{{ file.name }}</div>
          <div class="faint">
            {{
              locale === 'zh'
                ? `单张上限 ${formatBytes(MAX_IMAGE_BYTES)}；图片只在本机处理。`
                : `Up to ${formatBytes(MAX_IMAGE_BYTES)} per image; everything stays on this device.`
            }}
          </div>
          <button v-if="prefs.mode !== 'exif'" type="button" class="btn btn-primary" :disabled="!file || busy" @click="run">
            <ImageDown :size="14" /> {{ busy ? t('common.loading') : locale === 'zh' ? '开始处理' : 'Process' }}
          </button>
          <div v-if="error" class="error-box" style="padding: 0">{{ error }}</div>
        </div>
      </Pane>

      <Pane :title="locale === 'zh' ? '结果' : 'Result'">
        <div v-if="compressed" style="width: 100%; padding: 16px; display: flex; flex-direction: column; gap: 12px; overflow: auto">
          <img :src="compressed.url" alt="" style="max-width: 100%; max-height: 34vh; object-fit: contain; border-radius: 8px; background: var(--panel-2)" />
          <div class="binary-line" style="justify-content: space-between">
            <span class="mono">{{ compressed.width }} × {{ compressed.height }}</span>
            <span class="faint">{{ formatBytes(compressed.size) }} · {{ saved }}</span>
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap">
            <button type="button" class="btn btn-primary btn-sm" @click="download(compressed.blob, `image.${compressed.ext}`)">
              <Download :size="13" /> {{ locale === 'zh' ? '下载' : 'Download' }}
            </button>
            <CopyButton :text="compressed.dataUrl" :label="locale === 'zh' ? '复制 Data URI' : 'Copy Data URI'" ghost />
          </div>
        </div>

        <div v-else-if="ico" style="width: 100%; padding: 16px; display: flex; flex-direction: column; gap: 12px">
          <div class="result-card highlight">
            <div class="k">ICO</div>
            <div class="v big">{{ ico.entries.map((entry) => entry.width).join(' / ') }}</div>
            <div class="faint">{{ formatBytes(ico.blob.size) }}</div>
          </div>
          <button type="button" class="btn btn-primary btn-sm" style="align-self: flex-start" @click="download(ico.blob, 'favicon.ico')">
            <Download :size="13" /> favicon.ico
          </button>
        </div>

        <div v-else-if="exif" style="width: 100%; padding: 16px; overflow: auto">
          <div v-if="!exif.hasExif" class="pane-empty" style="min-height: 20vh">
            {{ locale === 'zh' ? '没有 EXIF 信息' : 'No EXIF metadata' }}
          </div>
          <table v-else class="data-table">
            <thead>
              <tr>
                <th>{{ locale === 'zh' ? '标签' : 'Tag' }}</th>
                <th>{{ locale === 'zh' ? '值' : 'Value' }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="tag in exif.tags" :key="tag.tag">
                <td>{{ tag.name }} <span class="faint">{{ tag.tag }}</span></td>
                <td>{{ tag.value }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-else class="pane-empty">{{ busy ? t('common.loading') : t('common.empty') }}</div>

        <template v-if="statsItems.length" #footer>
          <StatChips :items="statsItems" />
        </template>
      </Pane>
    </div>
  </div>
</template>
