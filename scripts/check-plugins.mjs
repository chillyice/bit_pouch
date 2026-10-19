#!/usr/bin/env node
/**
 * 插件清单闸门：构建前运行。
 * 校验目录约定、清单形状、run/View 是否存在，避免半成品插件进入产物。
 * Node 22.18+ / 24 原生支持直接 import .ts（类型导入会被剥离）。
 */
import { access, readdir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const pluginsDir = join(root, 'src', 'plugins')
const { validateManifest } = await import(pathToFileURL(join(root, 'src', 'core', 'manifest.ts')).href)

const errors = []
const warnings = []
const rows = []

const entries = await readdir(pluginsDir, { withFileTypes: true })
const folders = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.')).map((entry) => entry.name)

for (const folder of folders) {
  const dir = join(pluginsDir, folder)
  const required = ['manifest.ts', 'run.ts', 'View.vue']
  for (const file of required) {
    try {
      await access(join(dir, file))
    } catch {
      errors.push(`${folder}: 缺少 ${file}`)
    }
  }

  let manifest
  try {
    manifest = (await import(pathToFileURL(join(dir, 'manifest.ts')).href)).default
  } catch (error) {
    errors.push(`${folder}: manifest.ts 无法加载（${error.message}）`)
    continue
  }

  const issues = validateManifest(folder, manifest)
  errors.push(...issues)

  try {
    const runSource = await readFile(join(dir, 'run.ts'), 'utf8')
    if (!/export\s+const\s+run\b/.test(runSource)) errors.push(`${folder}: run.ts 必须 export const run`)
  } catch {
    // 缺失已在上面记录
  }

  try {
    const viewSource = await readFile(join(dir, 'View.vue'), 'utf8')
    if (!viewSource.includes('<template>')) errors.push(`${folder}: View.vue 缺少 <template>`)
  } catch {
    // 缺失已在上面记录
  }

  const specPath = join(dir, 'run.spec.js')
  try {
    const info = await stat(specPath)
    if (info.isFile() && info.size < 40) warnings.push(`${folder}: run.spec.js 内容过少`)
  } catch {
    warnings.push(`${folder}: 建议补充 run.spec.js 行为测试`)
  }

  rows.push({
    id: manifest?.id ?? folder,
    runtime: manifest?.runtime ?? '?',
    category: manifest?.category ?? '?',
    platforms: Array.isArray(manifest?.platforms) ? manifest.platforms.join('+') : '?',
  })
}

console.log(`\nbit_pouch plugin check — ${rows.length} plugin(s)\n`)
for (const row of rows) {
  console.log(`  ${row.id.padEnd(12)} ${String(row.runtime).padEnd(7)} ${String(row.category).padEnd(10)} ${row.platforms}`)
}
if (warnings.length) {
  console.log('\nWarnings:')
  for (const warning of warnings) console.log(`  ! ${warning}`)
}
if (errors.length) {
  console.error('\nErrors:')
  for (const error of errors) console.error(`  x ${error}`)
  console.error(`\nPlugin check failed with ${errors.length} error(s).\n`)
  process.exit(1)
}
console.log('\nPlugin check passed.\n')
