<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Copy, Search } from 'lucide-vue-next'
import { copyText } from '@/core/clipboard'
import { locale, t } from '@/core/i18n'
import { callTool } from '@/core/runner'
import { useToolPrefs } from '@/core/toolPrefs'
import { OPS_DOMAINS, OPS_REFERENCES } from './data'
import type { OpsRunData, OpsReference } from './run'

interface DomainMeta {
  id: string
  title: { zh: string; en: string }
}

const prefs = useToolPrefs('ops', { domain: 'all' })
const keyword = ref('')
const data = ref<OpsRunData | null>(null)
const running = ref(false)

let seq = 0
let timer: ReturnType<typeof setTimeout> | undefined

const domains = OPS_DOMAINS as unknown as DomainMeta[]
const references = OPS_REFERENCES as unknown as OpsReference[]

const label = (value: { zh: string; en: string }): string => value[locale.value] ?? value.zh

const total = computed(() => data.value?.total ?? 0)
const visibleDomains = computed(() => data.value?.domains ?? [])

async function runNow(): Promise<void> {
  const current = ++seq
  running.value = true
  const result = await callTool<OpsRunData>('ops', keyword.value, { domain: prefs.domain }, locale.value)
  if (current !== seq) return
  running.value = false
  if (result.ok) data.value = result.data ?? null
}

function schedule(): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(runNow, 120)
}

async function copy(command: { command: string; dangerous?: boolean; title: { zh: string; en: string } }): Promise<void> {
  if (command.dangerous) {
    const ok = window.confirm(
      locale.value === 'zh'
        ? `“${label(command.title)}”可能影响线上服务，确认复制？`
        : `"${label(command.title)}" can affect a live service. Copy anyway?`,
    )
    if (!ok) return
  }
  await copyText(command.command)
}

watch([keyword, () => prefs.domain], schedule)
runNow()
</script>

<template>
  <div class="workbench">
    <div class="option-bar">
      <div class="option-group" style="flex: 1; min-width: 220px">
        <Search :size="14" class="faint" />
        <input
          v-model="keyword"
          class="input"
          style="flex: 1"
          :placeholder="locale === 'zh' ? '搜索命令、说明或域' : 'Search commands, notes or domains'"
        />
      </div>
      <select v-model="prefs.domain" class="select" style="width: 150px">
        <option value="all">{{ locale === 'zh' ? '全部领域' : 'All domains' }}</option>
        <option v-for="domain in domains" :key="domain.id" :value="domain.id">{{ label(domain.title) }}</option>
      </select>
      <span class="faint">{{ total }} {{ locale === 'zh' ? '条' : 'commands' }}</span>
    </div>

    <div v-if="visibleDomains.length" style="display: flex; flex-direction: column; gap: 14px">
      <section v-for="domain in visibleDomains" :key="domain.id" class="card" style="padding: 14px 16px">
        <div class="section-label" style="margin-bottom: 8px">{{ label(domain.title) }}</div>
        <div v-for="command in domain.commands" :key="command.id" style="padding: 10px 0; border-top: 1px solid var(--line)">
          <div style="display: flex; align-items: center; gap: 8px">
            <span style="font-size: 13px; font-weight: 600">{{ label(command.title) }}</span>
            <span v-if="command.dangerous" class="badge" style="color: var(--red); border-color: rgba(251, 113, 133, 0.35)">
              {{ locale === 'zh' ? '危险' : 'Danger' }}
            </span>
            <button type="button" class="btn btn-sm btn-ghost" @click="copy(command)">
              <Copy :size="13" /> {{ locale === 'zh' ? '复制' : 'Copy' }}
            </button>
          </div>
          <pre class="output wrap" style="min-height: 0; padding: 8px 10px; margin-top: 6px; border-radius: 8px; background: var(--bg-soft)">{{ command.command }}</pre>
          <p class="faint" style="margin: 5px 0 0; font-size: 12px">{{ label(command.note) }}</p>
        </div>
      </section>
    </div>
    <div v-else class="pane-empty" style="min-height: 30vh">
      {{ running ? t('common.loading') : locale === 'zh' ? '没有匹配的命令' : 'No matching commands' }}
    </div>

    <section class="card" style="padding: 14px 16px">
      <div class="section-label" style="margin-bottom: 10px">{{ locale === 'zh' ? '速查表' : 'Reference' }}</div>
      <div v-for="reference in references" :key="reference.id" style="margin-top: 14px">
        <div style="font-size: 13px; font-weight: 600; margin-bottom: 6px">{{ label(reference.title) }}</div>
        <div v-if="reference.columns" class="table-wrap" style="max-height: none">
          <table class="data-table">
            <thead>
              <tr>
                <th v-for="(column, index) in reference.columns" :key="index">{{ label(column) }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in reference.rows" :key="index">
                <td v-for="(cell, cellIndex) in row" :key="cellIndex">
                  {{ typeof cell === 'string' ? cell : label(cell) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else style="display: flex; flex-direction: column; gap: 10px">
          <div v-for="(row, index) in reference.rows" :key="index">
            <pre class="output wrap" style="min-height: 0; padding: 8px 10px; border-radius: 8px; background: var(--bg-soft)">{{ typeof row[0] === 'string' ? row[0] : label(row[0]) }}</pre>
            <p class="faint" style="margin: 4px 0 0; font-size: 12px">{{ typeof row[1] === 'string' ? row[1] : label(row[1]) }}</p>
          </div>
        </div>
      </div>
    </section>

    <div class="faint" style="font-size: 12px">
      {{ locale === 'zh' ? '静态速查，不连接任何服务；复制后请自行确认参数。' : 'Static reference only; it never connects anywhere. Verify parameters before running.' }}
    </div>
  </div>
</template>
