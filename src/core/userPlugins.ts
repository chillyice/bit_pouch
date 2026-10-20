// 用户插件：运行时注入的本地 JavaScript 工具。
//
// 与 src/plugins 下的内置插件不同，用户插件不需要构建，也不进入产物：
// 代码保存在本机 localStorage，启动时编译成 { manifest, run } 注册进 registry。
//
// 约定：代码被当作函数体执行，最后 return 一个对象；也兼容 `export default { ... }`。
// 不支持 import，插件必须自包含。用户插件固定跑在主线程（runtime: 'main'）。
import { validateManifest } from './manifest'
import { readJson, STORAGE_KEYS, writeJson } from './storage'
import type { ToolCategory, ToolError, ToolManifest, ToolPlatform, ToolResult, ToolRun } from './types'

/** 单个插件源码上限（字符数）。localStorage 通常只有 5MB，这里留足余量。 */
export const USER_PLUGIN_MAX_CODE = 64 * 1024
/** 用户插件数量上限，避免把首页和本地存储撑爆。 */
export const USER_PLUGIN_MAX_COUNT = 32

export type UserPluginErrorCode =
  | 'PLUGIN_SYNTAX'
  | 'PLUGIN_EVAL'
  | 'PLUGIN_EXPORT'
  | 'PLUGIN_MANIFEST'
  | 'PLUGIN_RUN'
  | 'PLUGIN_ID_CONFLICT'
  | 'PLUGIN_TOO_LARGE'
  | 'PLUGIN_LIMIT'
  | 'PLUGIN_RESULT'
  | 'PLUGIN_LOAD'
  | 'PLUGIN_STORAGE'

export class UserPluginError extends Error {
  readonly code: UserPluginErrorCode

  constructor(code: UserPluginErrorCode, message: string) {
    super(message)
    this.name = 'UserPluginError'
    this.code = code
  }
}

/** localStorage 里的原始记录；id 只是索引，加载时会以重编译出的 manifest.id 为准。 */
export interface UserPluginRecord {
  id: string
  code: string
  installedAt: number
}

export interface CompiledUserPlugin {
  manifest: ToolManifest
  run: ToolRun
}

const DEFAULT_PLATFORMS: ToolPlatform[] = ['web', 'desktop', 'mobile']
const isPlatform = (value: unknown): value is ToolPlatform =>
  value === 'web' || value === 'desktop' || value === 'mobile'

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * 把用户源码编译成插件对象。
 * 编译失败抛 UserPluginError，调用方用 code 做本地化展示。
 */
export function compileUserPlugin(code: string, reservedIds: ReadonlySet<string>): CompiledUserPlugin {
  if (code.length > USER_PLUGIN_MAX_CODE) {
    throw new UserPluginError('PLUGIN_TOO_LARGE', `plugin code exceeds ${USER_PLUGIN_MAX_CODE} characters`)
  }

  const body = moduleBody(code)
  let factory: () => unknown
  try {
    factory = new Function(`"use strict";\n${body}`) as () => unknown
  } catch (error) {
    throw new UserPluginError('PLUGIN_SYNTAX', messageOf(error))
  }

  let value: unknown
  try {
    value = factory()
  } catch (error) {
    throw new UserPluginError('PLUGIN_EVAL', messageOf(error))
  }

  return normalizeUserPluginModule(value, reservedIds)
}

const moduleBody = (code: string): string => {
  const source = code.trim()
  if (!source) throw new UserPluginError('PLUGIN_EXPORT', 'plugin code is empty')
  // 兼容 `export default { ... }`；其余 export 语法仍会报语法错误。
  if (/^\s*export\s+default\s+/m.test(source)) {
    return source.replace(/^\s*export\s+default\s+/m, 'return ')
  }
  return source
}

/** 校验并补全插件对象。默认值让用户只写必填字段也能工作。 */
export function normalizeUserPluginModule(value: unknown, reservedIds: ReadonlySet<string>): CompiledUserPlugin {
  if (!value || typeof value !== 'object') {
    throw new UserPluginError('PLUGIN_EXPORT', 'plugin code must return an object')
  }

  const candidate = value as { manifest?: unknown; run?: unknown }
  if (typeof candidate.run !== 'function') {
    throw new UserPluginError('PLUGIN_RUN', 'plugin must expose a run(input, options, ctx) function')
  }
  if (!candidate.manifest || typeof candidate.manifest !== 'object') {
    throw new UserPluginError('PLUGIN_MANIFEST', 'plugin must expose a manifest object')
  }

  const source = candidate.manifest as Partial<ToolManifest>
  const id = typeof source.id === 'string' ? source.id.trim() : ''
  const manifest: ToolManifest = {
    id,
    name: source.name as ToolManifest['name'],
    description: source.description as ToolManifest['description'],
    category: source.category as ToolCategory,
    icon: typeof source.icon === 'string' && source.icon.trim() ? source.icon.trim() : 'wrench',
    keywords: Array.isArray(source.keywords)
      ? source.keywords.filter((keyword): keyword is string => typeof keyword === 'string')
      : [],
    version: typeof source.version === 'string' && source.version.trim() ? source.version.trim() : '0.1.0',
    runtime: 'main',
    platforms:
      Array.isArray(source.platforms) && source.platforms.length
        ? source.platforms.filter(isPlatform)
        : [...DEFAULT_PLATFORMS],
    offline: typeof source.offline === 'boolean' ? source.offline : true,
    order: typeof source.order === 'number' && Number.isFinite(source.order) ? source.order : 100,
  }
  if (source.experimental === true) manifest.experimental = true

  const issues = validateManifest(id, manifest)
  if (issues.length) throw new UserPluginError('PLUGIN_MANIFEST', issues.join('; '))
  if (reservedIds.has(id)) {
    throw new UserPluginError('PLUGIN_ID_CONFLICT', `id "${id}" is reserved by a built-in tool`)
  }

  return { manifest, run: candidate.run as ToolRun }
}

const PRIMITIVES = new Set(['number', 'boolean', 'bigint'])

const invalidResult = (): ToolResult => ({
  ok: false,
  error: {
    code: 'PLUGIN_RESULT',
    message: 'run() must return a string or { ok, output?, data?, stats?, error? }',
  },
})

/** 把用户 run() 的返回值收敛成统一 ToolResult，避免视图直接碰到任意形状。 */
export function normalizeToolResult(value: unknown): ToolResult {
  if (typeof value === 'string') return { ok: true, output: value }
  if (value === null || value === undefined) return { ok: true, output: '' }
  if (PRIMITIVES.has(typeof value)) return { ok: true, output: String(value) }
  if (typeof value !== 'object') return invalidResult()

  const candidate = value as Partial<ToolResult>
  if (typeof candidate.ok !== 'boolean') return invalidResult()
  if (!candidate.ok) return { ok: false, error: normalizeToolError(candidate.error) }

  let output = ''
  if (candidate.output !== undefined && candidate.output !== null) {
    if (typeof candidate.output === 'string') output = candidate.output
    else if (PRIMITIVES.has(typeof candidate.output)) output = String(candidate.output)
    else return invalidResult()
  }

  const result: ToolResult = { ok: true, output }
  if (candidate.stats && typeof candidate.stats === 'object') {
    const stats: Record<string, number | string> = {}
    for (const [key, entry] of Object.entries(candidate.stats)) {
      if (typeof entry === 'number' || typeof entry === 'string') stats[key] = entry
    }
    if (Object.keys(stats).length) result.stats = stats
  }
  if ('data' in candidate) result.data = candidate.data
  return result
}

function normalizeToolError(error: unknown): ToolError {
  if (error && typeof error === 'object') {
    const candidate = error as Partial<ToolError>
    const normalized: ToolError = {
      code: typeof candidate.code === 'string' && candidate.code ? candidate.code : 'PLUGIN_ERROR',
      message:
        typeof candidate.message === 'string' && candidate.message ? candidate.message : 'Plugin error',
    }
    if (typeof candidate.line === 'number') normalized.line = candidate.line
    if (typeof candidate.column === 'number') normalized.column = candidate.column
    if (typeof candidate.char === 'string') normalized.char = candidate.char
    if (typeof candidate.lineText === 'string') normalized.lineText = candidate.lineText
    return normalized
  }
  return {
    code: 'PLUGIN_ERROR',
    message: typeof error === 'string' && error ? error : 'Plugin error',
  }
}

export function loadUserPluginRecords(): UserPluginRecord[] {
  const value = readJson<unknown>(STORAGE_KEYS.userPlugins, [])
  if (!Array.isArray(value)) return []
  const records: UserPluginRecord[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const record = item as Partial<UserPluginRecord>
    if (typeof record.code !== 'string' || !record.code.trim()) continue
    records.push({
      id: typeof record.id === 'string' ? record.id : '',
      code: record.code,
      installedAt: typeof record.installedAt === 'number' ? record.installedAt : 0,
    })
  }
  return records
}

export function saveUserPluginRecords(records: UserPluginRecord[]): boolean {
  return writeJson(STORAGE_KEYS.userPlugins, records)
}

export const USER_PLUGIN_EXAMPLE = `// 示例：把输入转成大写。
// 代码会被当作函数体执行，最后必须 return { manifest, run }。
return {
  manifest: {
    id: 'my-upper',
    name: { zh: '我的大写工具', en: 'My uppercase tool' },
    description: { zh: '把输入文本转成大写', en: 'Turn the input into uppercase' },
    category: 'text',
    icon: 'text',
    keywords: ['upper', 'demo'],
    version: '0.1.0',
  },
  run(input) {
    return { ok: true, output: input.toUpperCase() }
  },
}
`
