<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowLeftRight } from 'lucide-vue-next'
import CopyButton from '@/components/CopyButton.vue'
import { locale, t } from '@/core/i18n'
import { useToolPrefs } from '@/core/toolPrefs'
import { CATEGORY_IDS, convert, convertAll, formatNumber, unitsOf } from './core'

const CATEGORY_LABELS: Record<string, { zh: string; en: string }> = {
  length: { zh: '长度', en: 'Length' },
  area: { zh: '面积', en: 'Area' },
  volume: { zh: '体积', en: 'Volume' },
  weight: { zh: '重量', en: 'Weight' },
  speed: { zh: '速度', en: 'Speed' },
  pressure: { zh: '压力', en: 'Pressure' },
  data: { zh: '数据量', en: 'Data' },
  time: { zh: '时间', en: 'Time' },
  temperature: { zh: '温度', en: 'Temperature' },
}

const UNIT_LABELS: Record<string, { zh: string; en: string }> = {
  mm: { zh: '毫米', en: 'Millimeter' },
  cm: { zh: '厘米', en: 'Centimeter' },
  m: { zh: '米', en: 'Meter' },
  km: { zh: '千米', en: 'Kilometer' },
  in: { zh: '英寸', en: 'Inch' },
  ft: { zh: '英尺', en: 'Foot' },
  yd: { zh: '码', en: 'Yard' },
  mi: { zh: '英里', en: 'Mile' },
  nmi: { zh: '海里', en: 'Nautical mile' },
  cm2: { zh: '平方厘米', en: 'cm²' },
  m2: { zh: '平方米', en: 'm²' },
  km2: { zh: '平方千米', en: 'km²' },
  ha: { zh: '公顷', en: 'Hectare' },
  mu: { zh: '亩', en: 'Mu' },
  acre: { zh: '英亩', en: 'Acre' },
  ft2: { zh: '平方英尺', en: 'ft²' },
  in2: { zh: '平方英寸', en: 'in²' },
  ml: { zh: '毫升', en: 'Milliliter' },
  l: { zh: '升', en: 'Liter' },
  m3: { zh: '立方米', en: 'm³' },
  tsp: { zh: '茶匙', en: 'Teaspoon' },
  tbsp: { zh: '汤匙', en: 'Tablespoon' },
  floz: { zh: '液体盎司', en: 'Fluid ounce' },
  cup: { zh: '杯', en: 'Cup' },
  pt: { zh: '品脱', en: 'Pint' },
  qt: { zh: '夸脱', en: 'Quart' },
  gal: { zh: '加仑', en: 'Gallon' },
  mg: { zh: '毫克', en: 'Milligram' },
  g: { zh: '克', en: 'Gram' },
  kg: { zh: '千克', en: 'Kilogram' },
  t: { zh: '吨', en: 'Tonne' },
  jin: { zh: '斤', en: 'Jin' },
  oz: { zh: '盎司', en: 'Ounce' },
  lb: { zh: '磅', en: 'Pound' },
  mps: { zh: '米/秒', en: 'm/s' },
  kmh: { zh: '千米/时', en: 'km/h' },
  mph: { zh: '英里/时', en: 'mph' },
  knot: { zh: '节', en: 'Knot' },
  fts: { zh: '英尺/秒', en: 'ft/s' },
  pa: { zh: '帕斯卡', en: 'Pascal' },
  hpa: { zh: '百帕', en: 'Hectopascal' },
  kpa: { zh: '千帕', en: 'Kilopascal' },
  mpa: { zh: '兆帕', en: 'Megapascal' },
  bar: { zh: '巴', en: 'Bar' },
  atm: { zh: '标准大气压', en: 'Atmosphere' },
  psi: { zh: '磅/平方英寸', en: 'PSI' },
  mmhg: { zh: '毫米汞柱', en: 'mmHg' },
  bit: { zh: '比特', en: 'Bit' },
  b: { zh: '字节', en: 'Byte' },
  kb: { zh: '千字节', en: 'KB' },
  mb: { zh: '兆字节', en: 'MB' },
  gb: { zh: '吉字节', en: 'GB' },
  tb: { zh: '太字节', en: 'TB' },
  kib: { zh: 'KiB', en: 'KiB' },
  mib: { zh: 'MiB', en: 'MiB' },
  gib: { zh: 'GiB', en: 'GiB' },
  tib: { zh: 'TiB', en: 'TiB' },
  ms: { zh: '毫秒', en: 'Millisecond' },
  s: { zh: '秒', en: 'Second' },
  min: { zh: '分钟', en: 'Minute' },
  h: { zh: '小时', en: 'Hour' },
  day: { zh: '天', en: 'Day' },
  week: { zh: '周', en: 'Week' },
  month: { zh: '月', en: 'Month' },
  year: { zh: '年', en: 'Year' },
  c: { zh: '摄氏度', en: 'Celsius' },
  f: { zh: '华氏度', en: 'Fahrenheit' },
  k: { zh: '开尔文', en: 'Kelvin' },
}

const prefs = useToolPrefs('unit', {
  category: 'length',
  from: 'm',
  to: 'km',
})

const value = ref('1')

const unitLabel = (id: string): string => UNIT_LABELS[id]?.[locale.value] ?? id
const categoryLabel = (id: string): string => CATEGORY_LABELS[id]?.[locale.value] ?? id

const units = computed(() => unitsOf(prefs.category))

if (!CATEGORY_IDS.includes(prefs.category)) {
  prefs.category = 'length'
  prefs.from = 'm'
  prefs.to = 'km'
} else if (!units.value.includes(prefs.from) || !units.value.includes(prefs.to)) {
  prefs.from = units.value[0]
  prefs.to = units.value[1] || units.value[0]
}
const parsed = computed(() => {
  const number = Number(value.value)
  return Number.isFinite(number) && value.value.trim() !== '' ? number : null
})

const resultText = computed(() => {
  if (parsed.value === null) return ''
  try {
    return `${formatNumber(parsed.value)} ${unitLabel(prefs.from)} = ${formatNumber(
      convert(parsed.value, prefs.category, prefs.from, prefs.to),
    )} ${unitLabel(prefs.to)}`
  } catch {
    return ''
  }
})

const errorText = computed(() => (parsed.value === null && value.value.trim() !== '' ? t('common.error') : ''))

const rows = computed(() => {
  if (parsed.value === null) return []
  return convertAll(parsed.value, prefs.category, prefs.from).map((item: { unit: string; value: number }) => ({
    unit: item.unit,
    label: unitLabel(item.unit),
    text: `${formatNumber(item.value)} ${unitLabel(item.unit)}`,
    current: item.unit === prefs.to,
  }))
})

function onCategoryChange(): void {
  const list = units.value
  prefs.from = list[0]
  prefs.to = list[1] || list[0]
}

function swap(): void {
  const previous = prefs.from
  prefs.from = prefs.to
  prefs.to = previous
}
</script>

<template>
  <div class="workbench">
    <div class="option-bar">
      <div class="option-group">
        <span class="field-label">{{ locale === 'zh' ? '类别' : 'Category' }}</span>
        <select v-model="prefs.category" class="select" style="width: 150px" @change="onCategoryChange">
          <option v-for="id in CATEGORY_IDS" :key="id" :value="id">{{ categoryLabel(id) }}</option>
        </select>
      </div>
      <span class="option-spacer" />
      <span class="faint">{{ locale === 'zh' ? '换算在本机完成' : 'Conversions run locally' }}</span>
    </div>

    <div class="split">
      <Pane :title="locale === 'zh' ? '换算' : 'Convert'">
        <div style="width: 100%; padding: 16px; display: flex; flex-direction: column; gap: 14px">
          <input v-model="value" class="input" inputmode="decimal" style="font-family: var(--mono); font-size: 18px" placeholder="1" />
          <div style="display: flex; align-items: end; gap: 10px; flex-wrap: wrap">
            <div class="field" style="flex: 1; min-width: 120px">
              <span class="field-label">{{ locale === 'zh' ? '从' : 'From' }}</span>
              <select v-model="prefs.from" class="select" style="width: 100%">
                <option v-for="id in units" :key="`f-${id}`" :value="id">{{ unitLabel(id) }}</option>
              </select>
            </div>
            <button type="button" class="btn btn-sm" :aria-label="t('action.swap')" @click="swap">
              <ArrowLeftRight :size="14" />
            </button>
            <div class="field" style="flex: 1; min-width: 120px">
              <span class="field-label">{{ locale === 'zh' ? '到' : 'To' }}</span>
              <select v-model="prefs.to" class="select" style="width: 100%">
                <option v-for="id in units" :key="`t-${id}`" :value="id">{{ unitLabel(id) }}</option>
              </select>
            </div>
          </div>
          <div class="result-card highlight">
            <div class="k">{{ locale === 'zh' ? '结果' : 'Result' }}</div>
            <div class="v big" style="word-break: break-all">{{ resultText || '—' }}</div>
          </div>
          <div v-if="errorText" class="error-box" style="padding: 0">{{ errorText }}</div>
        </div>
      </Pane>

      <Pane :title="locale === 'zh' ? '全部单位' : 'All units'">
        <div v-if="rows.length" class="table-wrap" style="max-height: 56vh">
          <table class="data-table">
            <thead>
              <tr>
                <th>{{ locale === 'zh' ? '单位' : 'Unit' }}</th>
                <th>{{ locale === 'zh' ? '数值' : 'Value' }}</th>
                <th style="width: 48px"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rows" :key="row.unit" :style="row.current ? { color: 'var(--accent)' } : undefined">
                <td>{{ row.label }}</td>
                <td class="num">{{ row.text }}</td>
                <td><CopyButton :text="row.text" icon-only ghost /></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="pane-empty">{{ t('common.empty') }}</div>
      </Pane>
    </div>
  </div>
</template>
