#!/usr/bin/env node
/**
 * 生成 docs/工具索引.md：工具事实只从各插件目录的 manifest.ts 与文件存在性读取。
 * 用法：
 *   node scripts/docs-index.mjs           写文件
 *   node scripts/docs-index.mjs --check   只校验是否最新（不一致时退出码 1）
 */
import { access, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const pluginsDir = join(root, 'src', 'plugins')
const indexPath = join(root, 'docs', '工具索引.md')
const FILES = ['manifest.ts', 'run.ts', 'View.vue', 'run.spec.js', 'README.md']

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function countCases(source) {
  return (source.match(/\b(?:it|test)\(/g) ?? []).length
}

export async function readTools() {
  const entries = await readdir(pluginsDir, { withFileTypes: true })
  const folders = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
  const tools = []

  for (const folder of folders) {
    const dir = join(pluginsDir, folder)
    const manifest = (await import(pathToFileURL(join(dir, 'manifest.ts')).href)).default
    const files = {}
    for (const file of FILES) files[file] = await exists(join(dir, file))
    const cases = files['run.spec.js'] ? countCases(await readFile(join(dir, 'run.spec.js'), 'utf8')) : 0
    tools.push({
      id: manifest.id,
      folder,
      name: manifest.name?.zh ?? manifest.id,
      category: manifest.category ?? '?',
      runtime: manifest.runtime ?? '?',
      order: Number(manifest.order ?? 0),
      cases,
      hasReadme: files['README.md'],
      hasSpec: files['run.spec.js'],
    })
  }

  tools.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  return tools
}

export async function buildIndex() {
  const tools = await readTools()
  const caseTotal = tools.reduce((sum, tool) => sum + tool.cases, 0)
  const lines = [
    '# bit_pouch 工具索引',
    '',
    '> 自动生成，勿手改。来源：`src/plugins/*/manifest.ts` 与各目录文件。',
    '> 重新生成：`npm run docs:index`；一致性校验：`npm run docs:check`。',
    `> 当前 **${tools.length} 个工具**；插件 \`run.spec.js\` 共 **${caseTotal}** 条 it/test（不含 core 测试）。`,
    '',
    '| 工具 | id | 分类 | 运行时 | 顺序 | 测试 | README | 目录 |',
    '|------|----|------|--------|-----:|------|--------|------|',
  ]

  for (const tool of tools) {
    const spec = tool.hasSpec ? `✓ ${tool.cases}` : '—'
    const readme = tool.hasReadme ? '✓' : '—'
    lines.push(
      `| ${tool.name} | \`${tool.id}\` | ${tool.category} | ${tool.runtime} | ${tool.order} | ${spec} | ${readme} | [${tool.folder}/](../src/plugins/${tool.folder}/) |`,
    )
  }

  lines.push('')
  return lines.join('\n')
}

async function main() {
  const content = await buildIndex()

  if (process.argv.includes('--check')) {
    let current = ''
    try {
      current = (await readFile(indexPath, 'utf8')).replace(/\r\n/g, '\n')
    } catch {
      // 缺失按过期处理
    }
    if (current === content) {
      console.log('工具索引已是最新。')
      return
    }
    console.error('工具索引过期：运行 npm run docs:index')
    process.exit(1)
  }

  await writeFile(indexPath, content, 'utf8')
  console.log('已生成 docs/工具索引.md')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
