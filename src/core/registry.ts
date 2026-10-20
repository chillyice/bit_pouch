import { shallowRef } from 'vue'
import type { Component } from 'vue'
import { validateManifest } from './manifest'
import {
  compileUserPlugin,
  loadUserPluginRecords,
  normalizeToolResult,
  saveUserPluginRecords,
  USER_PLUGIN_MAX_COUNT,
  UserPluginError,
} from './userPlugins'
import type { CompiledUserPlugin, UserPluginRecord } from './userPlugins'
import type { Locale, ToolCategory, ToolManifest, ToolRuntimeModule, ToolViewModule } from './types'

/**
 * 插件发现完全由文件系统约定完成：
 *   src/plugins/<id>/manifest.ts  （必需，静态收集，供列表/搜索）
 *   src/plugins/<id>/run.ts       （必需，纯函数入口）
 *   src/plugins/<id>/View.vue     （必需，工具界面）
 * 新增工具不需要改任何全局路由或列表文件。
 *
 * 另一条来源是运行时用户插件：代码存在 localStorage，启动时由 loadUserPlugins()
 * 编译并注册进同一张表；它们复用首页、搜索、命令面板和 /t/:id 路由。
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

// shallowRef 让 listTools/getManifest 等消费方在插件增删后自动重新计算。
// 注意：Map 的内部变更不会触发，所以每次修改都替换整个 Map。
const userPlugins = shallowRef<Map<string, CompiledUserPlugin>>(new Map())
let userRecords: UserPluginRecord[] = []
const userProblems: UserPluginProblem[] = []

export interface UserPluginProblem {
  /** 存储记录里的 id；损坏到没有 id 时为空字符串。 */
  id: string
  message: string
}

export interface UserPluginSummary {
  id: string
  code: string
  installedAt: number
  manifest: ToolManifest
}

export interface UserPluginInstallResult {
  ok: boolean
  manifest?: ToolManifest
  error?: { code: string; message: string }
}

export type UserPluginRemoveResult = 'ok' | 'not_found' | 'storage'

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

/**
 * 加载本机用户插件。坏插件只记录问题，不影响应用启动；
 * 用户可以在设置页看到并删除它。
 */
export function loadUserPlugins(): void {
  userRecords = loadUserPluginRecords()
  userProblems.length = 0

  const next = new Map<string, CompiledUserPlugin>()
  const seen = new Set<string>()
  for (const record of userRecords) {
    try {
      const compiled = compileUserPlugin(record.code, new Set(manifests.keys()))
      const id = compiled.manifest.id
      if (seen.has(id)) {
        throw new UserPluginError('PLUGIN_ID_CONFLICT', `duplicate user plugin id "${id}"`)
      }
      seen.add(id)
      record.id = id
      next.set(id, compiled)
    } catch (error) {
      userProblems.push({
        id: record.id,
        message: error instanceof UserPluginError ? error.message : String(error),
      })
    }
  }

  userPlugins.value = next
}

export function listTools(): ToolManifest[] {
  const all = [...manifests.values()]
  for (const plugin of userPlugins.value.values()) all.push(plugin.manifest)
  return all.sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.name.zh.localeCompare(b.name.zh))
}

export function getManifest(id: string): ToolManifest | undefined {
  return manifests.get(id) ?? userPlugins.value.get(id)?.manifest
}

export function hasTool(id: string): boolean {
  return manifests.has(id) || userPlugins.value.has(id)
}

export function isUserTool(id: string): boolean {
  return userPlugins.value.has(id)
}

export function getCategoryCounts(): Record<ToolCategory, number> {
  const counts: Record<ToolCategory, number> = { codec: 0, convert: 0, inspect: 0, network: 0, text: 0 }
  for (const tool of listTools()) counts[tool.category]++
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
  const user = userPlugins.value.get(id)
  if (user) {
    return {
      run: async (input, options, ctx) => normalizeToolResult(await user.run(input, options, ctx)),
    }
  }
  const entry = Object.entries(runLoaders).find(([path]) => folderIdOf(path) === id)
  if (!entry) throw new Error(`插件 ${id} 缺少 run.ts`)
  return entry[1]()
}

let userViewPromise: Promise<Component> | null = null

export async function loadView(id: string): Promise<Component> {
  if (userPlugins.value.has(id)) {
    userViewPromise ??= import('@/components/UserToolView.vue').then((module) => module.default)
    return userViewPromise
  }
  const entry = Object.entries(viewLoaders).find(([path]) => folderIdOf(path) === id)
  if (!entry) throw new Error(`插件 ${id} 缺少 View.vue`)
  const mod = await entry[1]()
  return mod.default
}

export function listUserPlugins(): UserPluginSummary[] {
  const seen = new Set<string>()
  const result: UserPluginSummary[] = []
  for (const record of userRecords) {
    const plugin = userPlugins.value.get(record.id)
    if (!plugin || seen.has(record.id)) continue
    seen.add(record.id)
    result.push({ id: record.id, code: record.code, installedAt: record.installedAt, manifest: plugin.manifest })
  }
  return result.sort((a, b) => a.installedAt - b.installedAt || a.id.localeCompare(b.id))
}

export function getUserPluginProblems(): UserPluginProblem[] {
  return userProblems.map((problem) => ({ ...problem }))
}

/** 安装或按 id 更新一个用户插件。成功后立即出现在工具列表里。 */
export function installUserPlugin(code: string): UserPluginInstallResult {
  try {
    const compiled = compileUserPlugin(code, new Set(manifests.keys()))
    const id = compiled.manifest.id
    const existing = userRecords.findIndex((record) => record.id === id)
    if (existing < 0 && userRecords.length >= USER_PLUGIN_MAX_COUNT) {
      throw new UserPluginError('PLUGIN_LIMIT', `at most ${USER_PLUGIN_MAX_COUNT} user plugins`)
    }

    const record: UserPluginRecord = { id, code, installedAt: Date.now() }
    const nextRecords = [...userRecords]
    if (existing >= 0) nextRecords.splice(existing, 1, record)
    else nextRecords.push(record)
    if (!saveUserPluginRecords(nextRecords)) {
      throw new UserPluginError('PLUGIN_STORAGE', 'localStorage is unavailable or full')
    }

    userRecords = nextRecords
    const next = new Map(userPlugins.value)
    next.set(id, compiled)
    userPlugins.value = next

    const problemIndex = userProblems.findIndex((problem) => problem.id === id)
    if (problemIndex >= 0) userProblems.splice(problemIndex, 1)

    return { ok: true, manifest: compiled.manifest }
  } catch (error) {
    return {
      ok: false,
      error: {
        code: error instanceof UserPluginError ? error.code : 'PLUGIN_LOAD',
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

export function removeUserPlugin(id: string): UserPluginRemoveResult {
  const next = userRecords.filter((record) => record.id !== id)
  if (next.length === userRecords.length) return 'not_found'
  if (!saveUserPluginRecords(next)) return 'storage'

  userRecords = next
  const plugins = new Map(userPlugins.value)
  plugins.delete(id)
  userPlugins.value = plugins
  const problemIndex = userProblems.findIndex((problem) => problem.id === id)
  if (problemIndex >= 0) userProblems.splice(problemIndex, 1)

  return 'ok'
}

export function toolPath(id: string): string {
  return `/t/${id}`
}
