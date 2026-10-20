<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef } from 'vue'
import { ArrowDown, ArrowUp, Download, FileText, ImagePlus, Trash2, Upload } from 'lucide-vue-next'
import CopyButton from '@/components/CopyButton.vue'
import Pane from '@/components/Pane.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import StatChips from '@/components/StatChips.vue'
import { locale, t } from '@/core/i18n'
import { useToolPrefs } from '@/core/toolPrefs'
import {
  buildImagePdf,
  createZip,
  downloadBlob,
  extractPdfText,
  formatBytes,
  loadPdfDocument,
  normalizeImage,
  parsePageRange,
  renderPdfPageToBlob,
} from './core'

type Tab = 'pdf2img' | 'img2pdf' | 'pdf2txt'
type Scale = 'standard' | 'high' | 'ultra'

interface PdfPage {
  cleanup?: () => void
}

interface PdfDoc {
  numPages: number
  getPage: (page: number) => Promise<PdfPage>
  destroy?: () => Promise<void> | void
}

interface PageResult {
  page: number
  blob: Blob
  url: string
  ext: string
}

interface ImageItem {
  file: File
  url: string
}

interface TextPage {
  page: number
  text: string
}

const MAX_IMAGE_PAGES = 200
const MAX_IMAGES = 100
const QUALITY_SCALE: Record<Scale, number> = { standard: 1.5, high: 2, ultra: 3 }

const prefs = useToolPrefs('pdf', {
  tab: 'pdf2img' as Tab,
  imgFormat: 'png' as 'png' | 'jpeg',
  imgQuality: 'high' as Scale,
  pageSize: 'A4' as 'A4' | 'A4_LANDSCAPE' | 'IMAGE',
  margin: 24,
})

const pdfInput = ref<HTMLInputElement | null>(null)
const imageInput = ref<HTMLInputElement | null>(null)
const pdfFile = ref<File | null>(null)
const pdfDoc = shallowRef<PdfDoc | null>(null)
const pdfPageCount = ref(0)
const pdfThumbUrl = ref('')
const pdfLoading = ref(false)
const dragPdf = ref(false)

const pageRange = ref('')
const results = ref<PageResult[]>([])
const textPages = ref<TextPage[]>([])

const images = ref<ImageItem[]>([])
const dragImages = ref(false)
const generatedUrl = ref('')
const generatedName = ref('')

const busy = ref(false)
const cancelFlag = ref(false)
const phase = ref('')
const progress = ref({ current: 0, total: 0 })

const tabOptions = computed(() => [
  { value: 'pdf2img', label: locale.value === 'zh' ? 'PDF 转图片' : 'PDF → Images' },
  { value: 'img2pdf', label: locale.value === 'zh' ? '图片转 PDF' : 'Images → PDF' },
  { value: 'pdf2txt', label: locale.value === 'zh' ? 'PDF 提取文字' : 'PDF → Text' },
])

const qualityOptions = computed(() => [
  { value: 'standard', label: locale.value === 'zh' ? '标准' : 'Standard' },
  { value: 'high', label: locale.value === 'zh' ? '高清' : 'High' },
  { value: 'ultra', label: locale.value === 'zh' ? '超清' : 'Ultra' },
])

const pageSizeOptions = computed(() => [
  { value: 'A4', label: 'A4' },
  { value: 'A4_LANDSCAPE', label: locale.value === 'zh' ? 'A4 横向' : 'A4 landscape' },
  { value: 'IMAGE', label: locale.value === 'zh' ? '跟随图片' : 'Image size' },
])

const displayText = computed(() => textPages.value.map((page) => `--- Page ${page.page} ---\n${page.text}`).join('\n\n'))
const pdfBaseName = computed(() => (pdfFile.value?.name || 'document').replace(/\.pdf$/i, ''))
const progressText = computed(() => (progress.value.total ? `${progress.value.current} / ${progress.value.total}` : ''))

const statsItems = computed(() => {
  const items: Array<{ label: string; value: string | number }> = []
  if (pdfFile.value) items.push({ label: locale.value === 'zh' ? '页数' : 'pages', value: pdfPageCount.value })
  if (results.value.length) items.push({ label: locale.value === 'zh' ? '输出' : 'outputs', value: results.value.length })
  if (textPages.value.length) items.push({ label: locale.value === 'zh' ? '文本页' : 'text pages', value: textPages.value.length })
  if (images.value.length) items.push({ label: locale.value === 'zh' ? '图片' : 'images', value: images.value.length })
  return items
})

function revoke(url: string): void {
  if (url) URL.revokeObjectURL(url)
}

function destroyPdf(): void {
  pdfDoc.value?.destroy?.()
  pdfDoc.value = null
}

function clearResults(): void {
  results.value.forEach((item) => revoke(item.url))
  results.value = []
}

function resetPdf(): void {
  destroyPdf()
  revoke(pdfThumbUrl.value)
  pdfThumbUrl.value = ''
  pdfFile.value = null
  pdfPageCount.value = 0
  pageRange.value = ''
  clearResults()
  textPages.value = []
}

function pickPdf(): void {
  if (!busy.value) pdfInput.value?.click()
}

async function loadPdf(file: File | undefined): Promise<void> {
  if (!file) return
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
    window.alert(locale.value === 'zh' ? '请选择 PDF 文件' : 'Choose a PDF file')
    return
  }
  pdfLoading.value = true
  resetPdf()
  try {
    const doc = (await loadPdfDocument(await file.arrayBuffer())) as PdfDoc
    pdfDoc.value = doc
    pdfFile.value = file
    pdfPageCount.value = doc.numPages
    const page = await doc.getPage(1)
    const thumb = await renderPdfPageToBlob(page, { scale: 0.5, format: 'jpeg', quality: 0.7 })
    page.cleanup?.()
    pdfThumbUrl.value = URL.createObjectURL(thumb as Blob)
  } catch (err) {
    window.alert(
      (err as { name?: string })?.name === 'PasswordException'
        ? locale.value === 'zh'
          ? '这个 PDF 有密码，无法处理'
          : 'This PDF is password protected'
        : locale.value === 'zh'
          ? 'PDF 加载失败'
          : 'Failed to load the PDF',
    )
    resetPdf()
  } finally {
    pdfLoading.value = false
  }
}

function onPdfPick(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  loadPdf(file)
}

function onPdfDrop(event: DragEvent): void {
  dragPdf.value = false
  loadPdf(event.dataTransfer?.files?.[0])
}

function resolvePages(): number[] | null {
  const pages = parsePageRange(pageRange.value, pdfPageCount.value) as number[] | null
  if (!pages) {
    window.alert(locale.value === 'zh' ? `页码范围不合法，共 ${pdfPageCount.value} 页` : `Invalid range; the PDF has ${pdfPageCount.value} pages`)
    return null
  }
  if (pages.length > MAX_IMAGE_PAGES) {
    window.alert(locale.value === 'zh' ? `一次最多 ${MAX_IMAGE_PAGES} 页` : `At most ${MAX_IMAGE_PAGES} pages at once`)
    return null
  }
  return pages
}

function cancel(): void {
  cancelFlag.value = true
}

async function pdfToImages(): Promise<void> {
  if (!pdfDoc.value || busy.value) return
  const pages = resolvePages()
  if (!pages) return
  clearResults()
  textPages.value = []
  busy.value = true
  cancelFlag.value = false
  phase.value = 'render'
  progress.value = { current: 0, total: pages.length }
  const scale = QUALITY_SCALE[prefs.imgQuality] || 2
  const format = prefs.imgFormat
  const ext = format === 'png' ? 'png' : 'jpg'
  try {
    for (let index = 0; index < pages.length; index += 1) {
      if (cancelFlag.value) break
      const page = await pdfDoc.value.getPage(pages[index])
      const blob = (await renderPdfPageToBlob(page, { scale, format })) as Blob
      page.cleanup?.()
      results.value.push({ page: pages[index], blob, url: URL.createObjectURL(blob), ext })
      progress.value.current = index + 1
    }
  } catch {
    window.alert(locale.value === 'zh' ? '转换失败' : 'Conversion failed')
  } finally {
    busy.value = false
    phase.value = ''
  }
}

function downloadOne(item: PageResult): void {
  downloadBlob(item.blob, `${pdfBaseName.value}-p${String(item.page).padStart(3, '0')}.${item.ext}`)
}

async function downloadZip(): Promise<void> {
  if (!results.value.length || busy.value) return
  busy.value = true
  try {
    const width = String(Math.max(...results.value.map((item) => item.page))).length
    const zip = await createZip(
      results.value.map((item) => ({
        name: `page-${String(item.page).padStart(width, '0')}.${item.ext}`,
        data: item.blob,
      })),
    )
    downloadBlob(zip, `${pdfBaseName.value}-images.zip`)
  } finally {
    busy.value = false
  }
}

async function pdfToText(): Promise<void> {
  if (!pdfDoc.value || busy.value) return
  const pages = resolvePages()
  if (!pages) return
  clearResults()
  textPages.value = []
  busy.value = true
  cancelFlag.value = false
  phase.value = 'text'
  progress.value = { current: 0, total: pages.length }
  try {
    textPages.value = await extractPdfText(pdfDoc.value, pages, {
      onProgress: (done: number, total: number) => (progress.value = { current: done, total }),
      isCancelled: () => cancelFlag.value,
    })
  } catch {
    window.alert(locale.value === 'zh' ? '提取失败' : 'Extraction failed')
  } finally {
    busy.value = false
    phase.value = ''
  }
}

function downloadText(): void {
  const blob = new Blob(['\ufeff', displayText.value], { type: 'text/plain;charset=utf-8' })
  downloadBlob(blob, `${pdfBaseName.value}.txt`)
}

function pickImages(): void {
  if (!busy.value) imageInput.value?.click()
}

function addImages(fileList: FileList | null | undefined): void {
  const files = Array.from(fileList ?? []).filter(
    (file) => file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name),
  )
  if (!files.length) return
  for (const file of files.slice(0, MAX_IMAGES - images.value.length)) {
    images.value.push({ file, url: URL.createObjectURL(file) })
  }
}

function onImagesPick(event: Event): void {
  const input = event.target as HTMLInputElement
  addImages(input.files)
  input.value = ''
}

function onImagesDrop(event: DragEvent): void {
  dragImages.value = false
  addImages(event.dataTransfer?.files)
}

function moveImage(index: number, delta: number): void {
  const target = index + delta
  if (target < 0 || target >= images.value.length) return
  const list = [...images.value]
  const [item] = list.splice(index, 1)
  list.splice(target, 0, item)
  images.value = list
}

function removeImage(index: number): void {
  revoke(images.value[index].url)
  images.value.splice(index, 1)
}

function clearGenerated(): void {
  revoke(generatedUrl.value)
  generatedUrl.value = ''
  generatedName.value = ''
}

async function imagesToPdf(): Promise<void> {
  if (!images.value.length || busy.value) return
  busy.value = true
  cancelFlag.value = false
  phase.value = 'pdf'
  progress.value = { current: 0, total: images.value.length }
  clearGenerated()
  try {
    const normalized = []
    for (let index = 0; index < images.value.length; index += 1) {
      if (cancelFlag.value) break
      const image = (await normalizeImage(images.value[index].file)) as { blob: Blob; width: number; height: number }
      normalized.push({ data: new Uint8Array(await image.blob.arrayBuffer()), width: image.width, height: image.height })
      progress.value.current = index + 1
    }
    if (!normalized.length) return
    const blob = buildImagePdf(normalized, { pageSize: prefs.pageSize, margin: Number(prefs.margin) }) as Blob
    generatedUrl.value = URL.createObjectURL(blob)
    generatedName.value = 'images.pdf'
  } catch {
    window.alert(locale.value === 'zh' ? '生成 PDF 失败' : 'Failed to build the PDF')
  } finally {
    busy.value = false
    phase.value = ''
  }
}

function downloadGenerated(): void {
  if (!generatedUrl.value) return
  const anchor = document.createElement('a')
  anchor.href = generatedUrl.value
  anchor.download = generatedName.value
  anchor.click()
}

onBeforeUnmount(() => {
  resetPdf()
  images.value.forEach((item) => revoke(item.url))
  clearGenerated()
})
</script>

<template>
  <div class="workbench">
    <div class="option-bar">
      <SegmentedControl v-model="prefs.tab" :options="tabOptions" />
      <span class="option-spacer" />
      <span v-if="progressText" class="mono faint">{{ progressText }}</span>
      <button v-if="busy" type="button" class="btn btn-sm btn-danger" @click="cancel">
        {{ locale === 'zh' ? '取消' : 'Cancel' }}
      </button>
    </div>

    <div class="split">
      <Pane :title="locale === 'zh' ? '输入' : 'Input'" :meta="pdfFile ? formatBytes(pdfFile.size) : ''">
        <div v-if="prefs.tab !== 'img2pdf'" style="width: 100%; padding: 16px; display: flex; flex-direction: column; gap: 12px">
          <input ref="pdfInput" type="file" accept=".pdf,application/pdf" style="display: none" @change="onPdfPick" />
          <div
            v-if="!pdfFile"
            class="card"
            :style="{
              padding: '28px 16px',
              textAlign: 'center',
              cursor: 'pointer',
              borderStyle: 'dashed',
              background: dragPdf ? 'var(--accent-soft)' : 'var(--panel-2)',
            }"
            @click="pickPdf"
            @dragover.prevent="dragPdf = true"
            @dragleave="dragPdf = false"
            @drop.prevent="onPdfDrop"
          >
            <Upload :size="30" class="faint" />
            <div style="margin-top: 8px; font-weight: 600">{{ locale === 'zh' ? '拖入或选择 PDF' : 'Drop or choose a PDF' }}</div>
            <div class="faint" style="font-size: 12px; margin-top: 4px">
              {{ locale === 'zh' ? '文件只在本机处理，不上传' : 'Processed locally, never uploaded' }}
            </div>
          </div>

          <div v-else style="display: flex; gap: 12px; align-items: center">
            <img v-if="pdfThumbUrl" :src="pdfThumbUrl" alt="" style="width: 64px; height: 84px; object-fit: cover; border-radius: 6px; border: 1px solid var(--line)" />
            <div style="flex: 1; min-width: 0">
              <div style="font-weight: 600; word-break: break-all">{{ pdfFile.name }}</div>
              <div class="faint">{{ pdfPageCount }} {{ locale === 'zh' ? '页' : 'pages' }} · {{ formatBytes(pdfFile.size) }}</div>
            </div>
            <button type="button" class="btn btn-sm btn-ghost" :disabled="busy" @click="pickPdf">
              {{ locale === 'zh' ? '重选' : 'Change' }}
            </button>
          </div>

          <div v-if="pdfLoading" class="faint">{{ locale === 'zh' ? '正在加载 PDF…' : 'Loading PDF…' }}</div>

          <template v-if="pdfFile">
            <div class="field">
              <span class="field-label">{{ locale === 'zh' ? '页码范围' : 'Page range' }}</span>
              <input v-model="pageRange" class="input" :placeholder="locale === 'zh' ? '留空 = 全部，如 1-3,5' : 'Empty = all, e.g. 1-3,5'" />
            </div>

            <template v-if="prefs.tab === 'pdf2img'">
              <div class="option-group">
                <span class="field-label">{{ locale === 'zh' ? '格式' : 'Format' }}</span>
                <SegmentedControl
                  v-model="prefs.imgFormat"
                  :options="[
                    { value: 'png', label: 'PNG' },
                    { value: 'jpeg', label: 'JPEG' },
                  ]"
                />
              </div>
              <div class="option-group">
                <span class="field-label">{{ locale === 'zh' ? '质量' : 'Quality' }}</span>
                <SegmentedControl v-model="prefs.imgQuality" :options="qualityOptions" />
              </div>
              <button type="button" class="btn btn-primary" :disabled="busy" @click="pdfToImages">
                <Download :size="14" /> {{ busy ? t('common.loading') : locale === 'zh' ? '转换' : 'Convert' }}
              </button>
            </template>

            <template v-else>
              <button type="button" class="btn btn-primary" :disabled="busy" @click="pdfToText">
                <FileText :size="14" /> {{ busy ? t('common.loading') : locale === 'zh' ? '提取文字' : 'Extract text' }}
              </button>
            </template>
          </template>
        </div>

        <div v-else style="width: 100%; padding: 16px; display: flex; flex-direction: column; gap: 12px">
          <input ref="imageInput" type="file" accept="image/*" multiple style="display: none" @change="onImagesPick" />
          <div
            class="card"
            :style="{
              padding: '18px 16px',
              textAlign: 'center',
              cursor: 'pointer',
              borderStyle: 'dashed',
              background: dragImages ? 'var(--accent-soft)' : 'var(--panel-2)',
            }"
            @click="pickImages"
            @dragover.prevent="dragImages = true"
            @dragleave="dragImages = false"
            @drop.prevent="onImagesDrop"
          >
            <ImagePlus :size="26" class="faint" />
            <div style="margin-top: 6px; font-weight: 600">{{ locale === 'zh' ? '添加图片' : 'Add images' }}</div>
            <div class="faint" style="font-size: 12px; margin-top: 4px">
              {{ locale === 'zh' ? `最多 ${MAX_IMAGES} 张，JPEG / PNG / WebP / GIF / BMP` : `Up to ${MAX_IMAGES}; JPEG / PNG / WebP / GIF / BMP` }}
            </div>
          </div>

          <div v-if="images.length" style="display: flex; flex-direction: column; gap: 6px">
            <div v-for="(item, index) in images" :key="item.url" style="display: flex; align-items: center; gap: 8px">
              <img :src="item.url" alt="" style="width: 34px; height: 34px; object-fit: cover; border-radius: 5px; border: 1px solid var(--line)" />
              <span class="mono" style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{{ item.file.name }}</span>
              <span class="faint">{{ formatBytes(item.file.size) }}</span>
              <button type="button" class="btn btn-sm btn-ghost" :disabled="index === 0" :aria-label="locale === 'zh' ? '上移' : 'Move up'" @click="moveImage(index, -1)">
                <ArrowUp :size="13" />
              </button>
              <button type="button" class="btn btn-sm btn-ghost" :disabled="index === images.length - 1" :aria-label="locale === 'zh' ? '下移' : 'Move down'" @click="moveImage(index, 1)">
                <ArrowDown :size="13" />
              </button>
              <button type="button" class="btn btn-sm btn-ghost" :aria-label="locale === 'zh' ? '移除' : 'Remove'" @click="removeImage(index)">
                <Trash2 :size="13" />
              </button>
            </div>
          </div>

          <div class="option-group">
            <span class="field-label">{{ locale === 'zh' ? '页面' : 'Page' }}</span>
            <SegmentedControl v-model="prefs.pageSize" :options="pageSizeOptions" />
          </div>
          <div v-if="prefs.pageSize !== 'IMAGE'" class="option-group">
            <span class="field-label">{{ locale === 'zh' ? '页边距' : 'Margin' }}</span>
            <input v-model.number="prefs.margin" class="input" type="number" min="0" max="96" style="width: 90px" />
            <span class="faint">pt</span>
          </div>
          <button type="button" class="btn btn-primary" :disabled="busy || !images.length" @click="imagesToPdf">
            <Download :size="14" /> {{ busy ? t('common.loading') : locale === 'zh' ? '生成 PDF' : 'Build PDF' }}
          </button>
        </div>
      </Pane>

      <Pane :title="locale === 'zh' ? '结果' : 'Result'">
        <div v-if="prefs.tab === 'pdf2img' && results.length" style="width: 100%; padding: 14px; display: flex; flex-direction: column; gap: 12px; overflow: auto">
          <div style="display: flex; gap: 8px; flex-wrap: wrap">
            <button type="button" class="btn btn-sm btn-primary" @click="downloadZip">
              <Download :size="13" /> {{ locale === 'zh' ? '下载全部 ZIP' : 'Download ZIP' }}
            </button>
          </div>
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 10px">
            <div v-for="item in results" :key="item.page" class="card" style="padding: 6px; display: flex; flex-direction: column; gap: 5px">
              <img :src="item.url" alt="" style="width: 100%; border-radius: 5px; background: var(--panel-2)" />
              <div style="display: flex; align-items: center; justify-content: space-between">
                <span class="faint mono">p{{ item.page }}</span>
                <button type="button" class="btn btn-sm btn-ghost" :aria-label="locale === 'zh' ? '下载' : 'Download'" @click="downloadOne(item)">
                  <Download :size="13" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div v-else-if="prefs.tab === 'pdf2txt' && textPages.length" style="width: 100%; padding: 14px; display: flex; flex-direction: column; gap: 10px; overflow: auto">
          <div style="display: flex; gap: 8px">
            <CopyButton :text="displayText" :label="locale === 'zh' ? '复制全部' : 'Copy all'" />
            <button type="button" class="btn btn-sm" @click="downloadText">
              <Download :size="13" /> .txt
            </button>
          </div>
          <pre class="output wrap" style="min-height: 0; max-height: 58vh; padding: 10px; border: 1px solid var(--line); border-radius: 8px">{{ displayText }}</pre>
        </div>

        <div v-else-if="prefs.tab === 'img2pdf' && generatedUrl" style="width: 100%; padding: 16px; display: flex; flex-direction: column; gap: 12px">
          <div class="result-card highlight">
            <div class="k">PDF</div>
            <div class="v big">{{ images.length }} {{ locale === 'zh' ? '页' : 'pages' }}</div>
          </div>
          <button type="button" class="btn btn-primary" style="align-self: flex-start" @click="downloadGenerated">
            <Download :size="14" /> {{ locale === 'zh' ? '下载 PDF' : 'Download PDF' }}
          </button>
        </div>

        <div v-else class="pane-empty" :style="{ textAlign: 'center' }">
          {{ busy ? (phase === 'render' ? (locale === 'zh' ? '正在渲染…' : 'Rendering…') : phase === 'text' ? (locale === 'zh' ? '正在提取…' : 'Extracting…') : (locale === 'zh' ? '正在生成…' : 'Building…')) : t('common.empty') }}
        </div>

        <template v-if="statsItems.length" #footer>
          <StatChips :items="statsItems" />
        </template>
      </Pane>
    </div>

    <div class="faint" style="font-size: 12px">
      {{ locale === 'zh' ? 'PDF 渲染与文字提取使用 pdfjs，全部在本机完成；图片与文档不会上传。' : 'Rendering and text extraction use pdfjs locally; documents and images never leave this device.' }}
    </div>
  </div>
</template>
