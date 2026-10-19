import type { Component } from 'vue'

export type Locale = 'zh' | 'en'

export interface LocalizedText {
  zh: string
  en: string
}

export type ToolCategory = 'codec' | 'convert' | 'inspect' | 'network' | 'text'
export type ToolPlatform = 'web' | 'desktop' | 'mobile'
export type ToolRuntime = 'main' | 'worker'

/**
 * 插件清单是工具的唯一注册信息：列表、搜索、路由、平台过滤都只读它。
 * 清单必须保持纯数据（可被 import.meta.glob 静态收集），不要在这里 import 视图或运行时代码。
 */
export interface ToolManifest {
  id: string
  name: LocalizedText
  description: LocalizedText
  category: ToolCategory
  /** ToolIcon 中登记的图标名，如 braces / binary / network */
  icon: string
  keywords: string[]
  version: string
  /** main = 主线程直接跑；worker = 重计算下沉到 Worker */
  runtime: ToolRuntime
  platforms: ToolPlatform[]
  offline: boolean
  /** 首页排序，数字小的在前；缺省为 100 */
  order?: number
  experimental?: boolean
}

export interface ToolError {
  code: string
  message: string
  line?: number
  column?: number
  char?: string
  lineText?: string
}

export interface ToolResult<T = unknown> {
  ok: boolean
  output?: string
  error?: ToolError
  stats?: Record<string, number | string>
  data?: T
}

export interface ToolRunContext {
  locale: Locale
  signal?: AbortSignal
}

export type ToolRun<T = unknown> = (
  input: string,
  options: Record<string, unknown>,
  ctx: ToolRunContext,
) => ToolResult<T> | Promise<ToolResult<T>>

export interface ToolRuntimeModule<T = unknown> {
  run: ToolRun<T>
}

export interface ToolViewModule {
  default: Component
}
