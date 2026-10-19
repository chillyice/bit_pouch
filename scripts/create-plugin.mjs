#!/usr/bin/env node
/**
 * 插件脚手架：npm run plugin:new -- <id> "<中文名>" "<English name>" [category]
 * 生成 manifest.ts / run.ts / View.vue / run.spec.js / README.md，不修改任何全局注册文件。
 */
import { access, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const [, , id, zhName, enName, category = 'text'] = process.argv
const root = resolve(import.meta.dirname, '..')
const target = join(root, 'src', 'plugins', id ?? '')

const categories = ['codec', 'convert', 'inspect', 'network', 'text']
const ID_RE = /^[a-z][a-z0-9-]*$/

function usage(message) {
  if (message) console.error(`\n${message}\n`)
  console.error('Usage: npm run plugin:new -- <id> "<中文名>" "<English name>" [category]\n')
  console.error(`  id        kebab-case, e.g. "jwt"`)
  console.error(`  category  ${categories.join(' | ')}`)
  console.error('')
  process.exit(1)
}

if (!id || !zhName || !enName) usage('缺少参数')
if (!ID_RE.test(id)) usage(`id "${id}" 必须匹配 ${ID_RE}`)
if (!categories.includes(category)) usage(`category "${category}" 不在允许列表内`)

try {
  await access(target)
  usage(`目录已存在：src/plugins/${id}`)
} catch {
  // expected
}

await mkdir(target, { recursive: true })

const manifest = `import type { ToolManifest } from '@/core/types'

export default {
  id: '${id}',
  name: { zh: '${zhName}', en: '${enName}' },
  description: {
    zh: '一句话说明这个工具做什么',
    en: 'One line describing what this tool does',
  },
  category: '${category}',
  icon: 'wrench',
  keywords: ['${id}'],
  version: '0.1.0',
  runtime: 'main',
  platforms: ['web', 'desktop', 'mobile'],
  offline: true,
  order: 100,
} satisfies ToolManifest
`

const run = `import type { ToolRun } from '@/core/types'

export interface ${pascal(id)}RunData {
  length: number
}

/** 纯函数入口：不要访问 DOM / window / localStorage；Worker 插件还必须保持结果可结构化克隆。 */
export const run: ToolRun<${pascal(id)}RunData> = (input, _options, _ctx) => {
  return {
    ok: true,
    output: input,
    stats: { chars: input.length },
    data: { length: input.length },
  }
}
`

const view = `<script setup lang="ts">
import { ref } from 'vue'
import Pane from '@/components/Pane.vue'
import CopyButton from '@/components/CopyButton.vue'
import { locale } from '@/core/i18n'
import { callTool } from '@/core/runner'
import type { ${pascal(id)}RunData } from './run'

const input = ref('')
const output = ref('')
let seq = 0

async function runNow(): Promise<void> {
  const current = ++seq
  const result = await callTool<${pascal(id)}RunData>('${id}', input.value, {}, locale.value)
  if (current !== seq) return
  output.value = result.ok ? (result.output ?? '') : (result.error?.message ?? '')
}

runNow()
</script>

<template>
  <div class="split">
    <Pane title="Input">
      <textarea v-model="input" class="editor" spellcheck="false" @input="runNow" />
    </Pane>
    <Pane title="Output">
      <template #actions>
        <CopyButton :text="output" icon-only ghost />
      </template>
      <pre v-if="output" class="output wrap">{{ output }}</pre>
      <div v-else class="pane-empty">{{ locale === 'zh' ? '暂无内容' : 'Nothing here yet' }}</div>
    </Pane>
  </div>
</template>
`

const spec = `import { describe, it, expect } from 'vitest'
import { run } from './run'

describe('${id}', () => {
  it('returns a result', () => {
    const result = run('hello', {}, { locale: 'zh' })
    expect(result.ok).toBe(true)
    expect(result.output).toBe('hello')
  })
})
`

const readme = `# ${id} · ${zhName}

- 清单：\`manifest.ts\`（id / 分类 / 运行时 / 平台）
- 逻辑：\`run.ts\`（纯函数，必须有测试）
- 界面：\`View.vue\`
- 测试：\`run.spec.js\`

## 约束

- 不访问 DOM、window、localStorage；输入内容不落盘。
- 重计算（> 50ms）把 manifest 的 \`runtime\` 改为 \`worker\`，并确保返回值可结构化克隆。
- 新增依赖前先评估体积与离线可用性。
`

await writeFile(join(target, 'manifest.ts'), manifest, 'utf8')
await writeFile(join(target, 'run.ts'), run, 'utf8')
await writeFile(join(target, 'View.vue'), view, 'utf8')
await writeFile(join(target, 'run.spec.js'), spec, 'utf8')
await writeFile(join(target, 'README.md'), readme, 'utf8')

console.log(`\nCreated src/plugins/${id}/`)
console.log('Next:')
console.log('  1. npm run check:plugins')
console.log('  2. npm test')
console.log('  3. npm run dev\n')

function pascal(value) {
  return value
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}
