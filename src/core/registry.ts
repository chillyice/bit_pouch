import type { Component } from 'vue'
import { validateManifest } from './manifest'
import type { Locale, ToolCategory, ToolManifest, ToolRuntimeModule, ToolViewModule } from './types'

/**
 * 插件发现完全由文件系统约定完成：
 *   src/plugins/<id>/manifest.ts  （必需，静态收集，供列表/搜索）
 *   src/plugins/<id>/run.ts       （必需，纯函数入口）
 *   src/plugins/<id>/View.vue     （必需，工具界面）
 * 新增工具不需要改任何全局路由或列表文件。
 */
const manifestModules = import.meta.glob<ToolManifest>('../plugins/*/manifest.ts', {
  eager: true,
  import: 'default',
})
const runLoaders = import.meta.glob<ToolRuntimeModule>('../plugins/*/run.ts')
const viewLoaders = import.meta.glob<ToolViewModule>('../plugins/*/View.vue')

const PLUGIN_PATH_RE = /\/plugins\/([^/]+)\/(manifest|run|View)\.(?:ts|vue)$/

const folderIdOf = (path: string): string => {
  const match = PLUGIN_PATH_RE.exec(path)
  return match?.[1] ?? ''
}

const problems: string[] = []
const manifests = new Map<string, ToolManifest>()

for (const [path, manifest] of Object.entries(manifestModules)) {
  const folderId = folderIdOf(path)
  const issues = validateManifest(folderId, manifest)
  if (issues.length) {
    problems.push(...issues)
    continue
  }
  manifests.set(manifest.id, manifest)
}

/** 在 main.ts 启动时调用：清单有问题就直接失败，避免半残的插件列表进入运行态。 */
export function assertRegistry(): void {
  if (problems.length) {
    throw new Error(`[bit_pouch] 插件清单校验失败：\n${problems.join('\n')}`)
  }
}

export function registryProblems(): string[] {
  return [...problems]
}

export function listTools(): ToolManifest[] {
  return [...manifests.values()].sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.name.zh.localeCompare(b.name.zh))
}

export function getManifest(id: string): ToolManifest | undefined {
  return manifests.get(id)
}

export function hasTool(id: string): boolean {
  return manifests.has(id)
}

export function getCategoryCounts(): Record<ToolCategory, number> {
  const counts: Record<ToolCategory, number> = { codec: 0, convert: 0, inspect: 0, network: 0, text: 0 }
  for (const tool of manifests.values()) counts[tool.category]++
  return counts
}

export function searchTools(query: string, _locale: Locale, category?: ToolCategory | 'all'): ToolManifest[] {
  const q = query.trim().toLowerCase()
  return listTools().filter((tool) => {
    if (category && category !== 'all' && tool.category !== category) return false
    if (!q) return true
    const haystack = [tool.name.zh, tool.name.en, tool.description.zh, tool.description.en, tool.id, ...tool.keywords]
      .join(' ')
      .toLowerCase()
    return haystack.includes(q)
  })
}

export async function loadRun(id: string): Promise<ToolRuntimeModule> {
  const entry = Object.entries(runLoaders).find(([path]) => folderIdOf(path) === id)
  if (!entry) throw new Error(`插件 ${id} 缺少 run.ts`)
  return entry[1]()
}

export async function loadView(id: string): Promise<Component> {
  const entry = Object.entries(viewLoaders).find(([path]) => folderIdOf(path) === id)
  if (!entry) throw new Error(`插件 ${id} 缺少 View.vue`)
  const mod = await entry[1]()
  return mod.default
}

export function toolPath(id: string): string {
  return `/t/${id}`
}
