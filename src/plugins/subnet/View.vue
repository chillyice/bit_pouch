<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Sparkles } from 'lucide-vue-next'
import CopyButton from '@/components/CopyButton.vue'
import ErrorNote from '@/components/ErrorNote.vue'
import StatChips from '@/components/StatChips.vue'
import { formatInt } from '@/core/format'
import { locale, t } from '@/core/i18n'
import { callTool } from '@/core/runner'
import { useToolPrefs } from '@/core/toolPrefs'
import type { ToolError } from '@/core/types'
import { parseMask, type SubnetRunData } from './run'

const prefs = useToolPrefs('subnet', { mask: '24' })
const ip = ref('192.168.1.10')
const prefix = ref(24)
const data = ref<SubnetRunData | null>(null)
const error = ref<ToolError | null>(null)

let seq = 0
let timer: ReturnType<typeof setTimeout> | undefined

const typeLabel = computed(() => {
  if (!data.value) return ''
  const map: Record<string, { zh: string; en: string }> = {
    PRIVATE: { zh: '私有地址', en: 'Private' },
    SHARED: { zh: '运营商级 NAT', en: 'CGNAT' },
    LOOPBACK: { zh: '回环地址', en: 'Loopback' },
    LINK_LOCAL: { zh: '链路本地', en: 'Link-local' },
    MULTICAST: { zh: '组播地址', en: 'Multicast' },
    RESERVED: { zh: '保留地址', en: 'Reserved' },
    PUBLIC: { zh: '公网地址', en: 'Public' },
  }
  return map[data.value.type]?.[locale.value] ?? data.value.type
})

const statsItems = computed(() => {
  if (!data.value) return []
  return [
    { label: locale.value === 'zh' ? '前缀' : 'prefix', value: `/${data.value.prefix}` },
    { label: locale.value === 'zh' ? '可用主机' : 'hosts', value: formatInt(data.value.hosts) },
    { label: locale.value === 'zh' ? '总地址' : 'total', value: formatInt(data.value.total) },
  ]
})

const binaryParts = computed(() => {
  const value = data.value?.binary ?? ''
  const [net, host] = value.split('|')
  return { net: net ?? '', host: host ?? '' }
})

const cards = computed(() => {
  if (!data.value) return []
  return [
    { key: locale.value === 'zh' ? '网络地址' : 'Network', value: `${data.value.network}/${data.value.prefix}`, big: true },
    { key: locale.value === 'zh' ? '广播地址' : 'Broadcast', value: data.value.broadcast, big: false },
    { key: locale.value === 'zh' ? '首个可用' : 'First host', value: data.value.first, big: false },
    { key: locale.value === 'zh' ? '最后可用' : 'Last host', value: data.value.last, big: false },
    { key: locale.value === 'zh' ? '子网掩码' : 'Subnet mask', value: data.value.mask, big: false },
    { key: locale.value === 'zh' ? '通配符' : 'Wildcard', value: data.value.wildcard, big: false },
    { key: locale.value === 'zh' ? '可用主机数' : 'Usable hosts', value: formatInt(data.value.hosts), big: false },
    { key: locale.value === 'zh' ? '地址总数' : 'Total addresses', value: formatInt(data.value.total), big: false },
  ]
})

async function runNow(): Promise<void> {
  const current = ++seq
  const result = await callTool<SubnetRunData>('subnet', ip.value, { mask: prefs.mask }, locale.value)
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
  timer = setTimeout(runNow, 90)
}

function onPrefixInput(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  prefix.value = value
  prefs.mask = String(value)
}

function loadSample(): void {
  ip.value = '192.168.1.10'
  prefs.mask = '24'
  prefix.value = 24
  runNow()
}

watch(
  () => prefs.mask,
  (value) => {
    try {
      prefix.value = parseMask(value).prefix
    } catch {
      // 输入过程中的非法掩码交给 run 报错，滑块保持上一次有效值
    }
    schedule()
  },
)

watch(ip, schedule)
runNow()
</script>

<template>
  <div class="workbench">
    <div class="option-bar">
      <label class="field" style="min-width: 190px; flex: 1">
        <span class="field-label">IPv4</span>
        <input v-model="ip" class="input" spellcheck="false" placeholder="192.168.1.10" />
      </label>
      <label class="field" style="min-width: 150px">
        <span class="field-label">{{ locale === 'zh' ? '掩码 / 前缀' : 'Mask / prefix' }}</span>
        <input v-model="prefs.mask" class="input" spellcheck="false" placeholder="24 / 255.255.255.0" />
      </label>
      <label class="field" style="flex: 1; min-width: 180px">
        <span class="field-label">/{{ prefix }}</span>
        <input class="range" type="range" min="0" max="32" :value="prefix" @input="onPrefixInput" />
      </label>
      <button type="button" class="btn btn-sm" @click="loadSample"><Sparkles :size="13" /> {{ t('action.sample') }}</button>
    </div>

    <ErrorNote v-if="error" :error="error" />

    <template v-else-if="data">
      <div class="result-grid">
        <div v-for="card in cards" :key="card.key" class="result-card" :class="{ highlight: card.big }">
          <CopyButton class="copy-mini" :text="card.value" icon-only ghost />
          <div class="k">{{ card.key }}</div>
          <div class="v" :class="{ big: card.big }">{{ card.value }}</div>
        </div>
        <div class="result-card">
          <div class="k">{{ locale === 'zh' ? '地址类型' : 'Address type' }}</div>
          <div class="v" style="font-size: 13px">
            <span class="badge teal">{{ typeLabel }}</span>
          </div>
        </div>
      </div>

      <div class="binary-line">
        <div><span class="faint">ADDRESS&nbsp;</span><span class="net">{{ binaryParts.net }}</span><span class="bar">|</span>{{ binaryParts.host }}</div>
        <div><span class="faint">NETWORK&nbsp;</span>{{ data.networkBinary }}</div>
        <div><span class="faint">BCAST&nbsp;&nbsp;&nbsp;</span>{{ data.broadcastBinary }}</div>
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>{{ locale === 'zh' ? '项目' : 'Item' }}</th>
              <th>{{ locale === 'zh' ? '值' : 'Value' }}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{{ locale === 'zh' ? '输入地址' : 'Input address' }}</td>
              <td class="strong">{{ data.ip }}</td>
              <td><CopyButton :text="data.ip" icon-only ghost /></td>
            </tr>
            <tr>
              <td>{{ locale === 'zh' ? 'CIDR' : 'CIDR' }}</td>
              <td class="strong accent">{{ data.network }}/{{ data.prefix }}</td>
              <td><CopyButton :text="`${data.network}/${data.prefix}`" icon-only ghost /></td>
            </tr>
            <tr>
              <td>{{ locale === 'zh' ? '地址范围' : 'Host range' }}</td>
              <td class="strong">{{ data.first }} – {{ data.last }}</td>
              <td><CopyButton :text="`${data.first} - ${data.last}`" icon-only ghost /></td>
            </tr>
            <tr>
              <td>{{ locale === 'zh' ? '二进制（竖线为网络位分界）' : 'Binary (bar = network boundary)' }}</td>
              <td class="mono">{{ data.binary }}</td>
              <td><CopyButton :text="data.binary" icon-only ghost /></td>
            </tr>
          </tbody>
        </table>
      </div>

      <StatChips :items="statsItems" />
    </template>

    <div v-else class="card" style="padding: 24px; text-align: center; color: var(--text-faint)">
      {{ t('common.empty') }}
    </div>
  </div>
</template>
