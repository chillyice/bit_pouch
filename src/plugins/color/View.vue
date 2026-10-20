<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Sparkles } from 'lucide-vue-next'
import CopyButton from '@/components/CopyButton.vue'
import ErrorNote from '@/components/ErrorNote.vue'
import Pane from '@/components/Pane.vue'
import { locale, t } from '@/core/i18n'
import { callTool } from '@/core/runner'
import type { ToolError } from '@/core/types'

interface Rgb {
  r: number
  g: number
  b: number
  a?: number
}

interface ColorData {
  hex: string
  rgb: Rgb
  hsl: { h: number; s: number; l: number }
  hsv: { h: number; s: number; v: number }
  lab: { l: number; a: number; b: number }
  onWhite: number
  onBlack: number
  harmonize: Array<{ kind: string; colors: string[] }>
  css: string
}

const HARMONY_LABELS: Record<string, { zh: string; en: string }> = {
  complementary: { zh: '互补色', en: 'Complementary' },
  analogous: { zh: '邻近色', en: 'Analogous' },
  triadic: { zh: '三角配色', en: 'Triadic' },
  split: { zh: '分裂互补', en: 'Split complementary' },
  tetradic: { zh: '四角配色', en: 'Tetradic' },
}

const input = ref('#b8ff3d')
const error = ref<ToolError | null>(null)
const data = ref<ColorData | null>(null)
const running = ref(false)

let seq = 0
let timer: ReturnType<typeof setTimeout> | undefined

const formats = computed(() => {
  const value = data.value
  if (!value) return []
  return [
    { label: 'HEX', value: value.hex },
    { label: 'RGB', value: `rgb(${value.rgb.r}, ${value.rgb.g}, ${value.rgb.b})` },
    { label: 'HSL', value: `hsl(${value.hsl.h}, ${value.hsl.s}%, ${value.hsl.l}%)` },
    { label: 'HSV', value: `hsv(${value.hsv.h}, ${value.hsv.s}%, ${value.hsv.v}%)` },
    { label: 'LAB', value: `lab(${value.lab.l}, ${value.lab.a}, ${value.lab.b})` },
    { label: 'CSS', value: value.css },
  ]
})

const contrastRows = computed(() => {
  if (!data.value) return []
  return [
    { label: locale.value === 'zh' ? '白底' : 'On white', ratio: data.value.onWhite },
    { label: locale.value === 'zh' ? '黑底' : 'On black', ratio: data.value.onBlack },
  ]
})

const harmonies = computed(() =>
  (data.value?.harmonize ?? []).map((group) => ({
    kind: group.kind,
    label: HARMONY_LABELS[group.kind]?.[locale.value] ?? group.kind,
    colors: group.colors,
  })),
)

function pass(ratio: number, level: 'aa' | 'aaa'): boolean {
  return ratio >= (level === 'aa' ? 4.5 : 7)
}

async function runNow(): Promise<void> {
  const current = ++seq
  running.value = true
  const result = await callTool<ColorData>('color', input.value, {}, locale.value)
  if (current !== seq) return
  running.value = false
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
  input.value = '#b8ff3d'
  runNow()
}

watch(input, schedule)
runNow()
</script>

<template>
  <div class="workbench">
    <div class="option-bar">
      <div class="option-group" style="flex: 1">
        <span class="field-label">{{ locale === 'zh' ? '颜色' : 'Color' }}</span>
        <input v-model="input" class="input" style="flex: 1; font-family: var(--mono)" placeholder="#b8ff3d / rgb(184 255 61) / hsl(80 100% 62%)" />
      </div>
      <div
        v-if="data"
        :style="{
          width: '46px',
          height: '34px',
          borderRadius: '8px',
          border: '1px solid var(--line-strong)',
          background: data.hex,
        }"
      />
      <button type="button" class="btn btn-sm" @click="loadSample">
        <Sparkles :size="13" /> {{ t('action.sample') }}
      </button>
    </div>

    <div class="split">
      <Pane :title="locale === 'zh' ? '格式' : 'Formats'" :error="Boolean(error)">
        <ErrorNote v-if="error" :error="error" />
        <div v-else-if="data" style="width: 100%; padding: 12px 14px; display: flex; flex-direction: column; gap: 4px">
          <div
            v-for="item in formats"
            :key="item.label"
            class="binary-line"
            style="justify-content: space-between; gap: 10px; padding: 6px 0"
          >
            <span class="section-label" style="min-width: 44px">{{ item.label }}</span>
            <code class="mono" style="flex: 1; word-break: break-all; white-space: pre-wrap">{{ item.value }}</code>
            <CopyButton :text="item.value" icon-only ghost />
          </div>
        </div>
        <div v-else class="pane-empty">{{ running ? t('common.loading') : t('common.empty') }}</div>
      </Pane>

      <div style="display: flex; flex-direction: column; gap: 14px; min-width: 0">
        <Pane :title="locale === 'zh' ? '对比度 (WCAG)' : 'Contrast (WCAG)'">
          <div v-if="data" style="width: 100%; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px">
            <div v-for="row in contrastRows" :key="row.label" class="binary-line" style="justify-content: space-between">
              <span class="field-label">{{ row.label }}</span>
              <span style="display: flex; align-items: center; gap: 6px">
                <b class="mono">{{ row.ratio.toFixed(2) }}:1</b>
                <span class="badge" :class="pass(row.ratio, 'aa') ? 'teal' : ''">AA</span>
                <span class="badge" :class="pass(row.ratio, 'aaa') ? 'teal' : ''">AAA</span>
              </span>
            </div>
            <div class="faint">
              {{ locale === 'zh' ? '普通文字 AA ≥ 4.5，AAA ≥ 7' : 'Normal text: AA ≥ 4.5, AAA ≥ 7' }}
            </div>
          </div>
          <div v-else class="pane-empty">{{ t('common.empty') }}</div>
        </Pane>

        <Pane :title="locale === 'zh' ? '配色' : 'Palettes'">
          <div v-if="data" style="width: 100%; padding: 12px 14px; display: flex; flex-direction: column; gap: 12px">
            <div v-for="group in harmonies" :key="group.kind">
              <div class="section-label" style="margin-bottom: 6px">{{ group.label }}</div>
              <div style="display: flex; gap: 6px; flex-wrap: wrap">
                <button
                  v-for="color in group.colors"
                  :key="color"
                  type="button"
                  :title="color"
                  :style="{
                    width: '52px',
                    height: '32px',
                    borderRadius: '8px',
                    border: '1px solid var(--line)',
                    background: color,
                    fontFamily: 'var(--mono)',
                    fontSize: '9px',
                    color: '#000',
                  }"
                  @click="input = color"
                >
                  {{ color.slice(1) }}
                </button>
              </div>
            </div>
          </div>
          <div v-else class="pane-empty">{{ t('common.empty') }}</div>
        </Pane>
      </div>
    </div>
  </div>
</template>
