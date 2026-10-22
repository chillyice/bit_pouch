#!/usr/bin/env node
/**
 * 文档一致性闸门：AGENTS 体积与链接、工具数口径、工具索引新鲜度、现状页版本。
 * 用法：node scripts/docs-check.mjs（归档/发版前跑，失败退出码 1）
 */
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { buildIndex, readTools } from './docs-index.mjs'

const root = resolve(import.meta.dirname, '..')
const errors = []
const warnings = []
const read = (rel) => readFile(join(root, rel), 'utf8')

const AGENTS_LIMIT = 16 * 1024
const AGENTS_REQUIRED = [
  '## 2. 任务路由表',
  '## 3. 代码地图',
  '## 4. 硬性不变量',
  'docs/现状.md',
  'docs/工具索引.md',
  'docs/踩坑速查.md',
  'docs/变更归档.md',
  'docs/需求设计说明书.md',
  'plugin-author',
  'build-verify',
  'archive',
  'release',
  'sync-from-ihomy',
  'npm run check:plugins',
  'npm run docs:check',
]

const EXACT_PATHS = new Set(['AGENTS.md', 'README.md', 'VERSION', 'package.json'])

function isRepoPath(token) {
  const clean = token.split('#')[0].split('?')[0]
  if (!clean || /^[a-z]+:/i.test(clean) || clean.startsWith('//')) return false
  if (clean.includes('*') || clean.includes('{') || clean.includes(' ') || clean.includes('<')) return false
  if (clean.startsWith('../')) return true
  return /^(src|docs|scripts|test|\.github|src-tauri)\//.test(clean) || EXACT_PATHS.has(clean)
}

async function checkPaths(file) {
  const text = await read(file)
  const base = dirname(join(root, file))
  const tokens = new Set()
  for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) tokens.add(match[1])
  for (const match of text.matchAll(/`([^`\n]+)`/g)) tokens.add(match[1])

  for (const token of tokens) {
    if (!isRepoPath(token)) continue
    const clean = token.split('#')[0].split('?')[0]
    // 文档里的路径两种写法都有：仓库根相对（docs/…）与文件相对（../src/…）。
    const candidates = [resolve(root, clean), resolve(base, clean)]
    if (!candidates.some((path) => existsSync(path))) {
      errors.push(`${file}: 引用了不存在的路径 ${token}`)
    }
  }
}

async function main() {
  const agents = await read('AGENTS.md')
  const agentsSize = Buffer.byteLength(agents)
  if (agentsSize > AGENTS_LIMIT) {
    errors.push(`AGENTS.md ${agentsSize}B 超过 ${AGENTS_LIMIT}B；细节移回 docs/`)
  }
  for (const needle of AGENTS_REQUIRED) {
    if (!agents.includes(needle)) errors.push(`AGENTS.md 缺少必备内容：${needle}`)
  }

  await checkPaths('AGENTS.md')
  await checkPaths('docs/README.md')
  await checkPaths('docs/现状.md')

  const tools = await readTools()
  const toolCount = tools.length

  const readme = await read('README.md')
  const readmeCount = readme.match(/工具清单（(\d+) 个）/)
  if (!readmeCount) errors.push('README.md 缺少 “工具清单（N 个）” 标题')
  else if (Number(readmeCount[1]) !== toolCount) {
    errors.push(`README.md 写 ${readmeCount[1]} 个工具，实际 ${toolCount} 个`)
  }

  const index = (await read('docs/工具索引.md')).replace(/\r\n/g, '\n')
  const indexCount = index.match(/当前 \*\*(\d+) 个工具\*\*/)
  if (!indexCount) errors.push('docs/工具索引.md 缺少工具数量行')
  else if (Number(indexCount[1]) !== toolCount) {
    errors.push(`docs/工具索引.md 写 ${indexCount[1]} 个工具，实际 ${toolCount} 个`)
  }
  if (index !== (await buildIndex())) errors.push('docs/工具索引.md 已过期：运行 npm run docs:index')

  const version = (await read('VERSION')).trim()
  const state = await read('docs/现状.md')
  if (!state.includes(version)) errors.push(`docs/现状.md 未包含当前版本 ${version}`)
  const stateCount = state.match(/工具 \*\*(\d+) 个\*\*/)
  if (!stateCount) errors.push('docs/现状.md 缺少 “工具 **N 个**” 行')
  else if (Number(stateCount[1]) !== toolCount) {
    errors.push(`docs/现状.md 写 ${stateCount[1]} 个工具，实际 ${toolCount} 个`)
  }

  const docRoot = join(root, 'docs')
  const docs = (await readdir(docRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
  const docsReadme = await read('docs/README.md')
  for (const name of docs) {
    if (!docsReadme.includes(name)) errors.push(`docs/README.md 未收录 docs/${name}`)
  }

  const missingReadme = tools.filter((tool) => !tool.hasReadme).length
  if (missingReadme) warnings.push(`${missingReadme} 个插件目录缺 README.md（先查 docs/需求设计说明书.md）`)

  console.log(`\nbit_pouch docs check`)
  console.log(`  AGENTS.md          ${(agentsSize / 1024).toFixed(1)} KB（上限 16 KB）`)
  console.log(`  plugins            ${toolCount}`)
  console.log(`  docs/工具索引.md   ${index === (await buildIndex()) ? '最新' : '过期'}`)
  console.log(`  版本               ${version}`)
  if (warnings.length) {
    console.log('\nWarnings:')
    for (const warning of warnings) console.log(`  ! ${warning}`)
  }
  if (errors.length) {
    console.error('\nErrors:')
    for (const error of errors) console.error(`  x ${error}`)
    console.error(`\nDocs check failed with ${errors.length} error(s).\n`)
    process.exit(1)
  }
  console.log('\nDocs check passed.\n')
}

await main()
