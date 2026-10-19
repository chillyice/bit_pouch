import type { ToolCategory, ToolManifest, ToolPlatform, ToolRuntime } from './types'

const CATEGORIES: ToolCategory[] = ['codec', 'convert', 'inspect', 'network', 'text']
const RUNTIMES: ToolRuntime[] = ['main', 'worker']
const PLATFORMS: ToolPlatform[] = ['web', 'desktop', 'mobile']
const ID_RE = /^[a-z][a-z0-9-]*$/

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

/**
 * 清单自检：返回问题列表而不是抛错，方便构建脚本一次报出全部问题。
 * 这里不检查文件是否存在（registry 已按文件名推导 id），只校验数据形状。
 */
export function validateManifest(folderId: string, value: unknown): string[] {
  const issues: string[] = []
  if (!value || typeof value !== 'object') return [`${folderId}: manifest 必须是对象`]
  const m = value as Partial<ToolManifest>

  if (!isNonEmptyString(m.id)) issues.push(`${folderId}: id 缺失`)
  else if (!ID_RE.test(m.id)) issues.push(`${folderId}: id 必须匹配 ${ID_RE}`)
  else if (m.id !== folderId) issues.push(`${folderId}: id "${m.id}" 必须与目录名一致`)

  for (const field of ['name', 'description'] as const) {
    const text = m[field]
    if (!text || !isNonEmptyString(text.zh) || !isNonEmptyString(text.en)) {
      issues.push(`${folderId}: ${field} 必须同时提供 zh 与 en`)
    }
  }

  if (!m.category || !CATEGORIES.includes(m.category)) {
    issues.push(`${folderId}: category 必须是 ${CATEGORIES.join(' / ')}`)
  }
  if (!isNonEmptyString(m.icon)) issues.push(`${folderId}: icon 缺失`)
  if (!Array.isArray(m.keywords) || m.keywords.some((k) => typeof k !== 'string')) {
    issues.push(`${folderId}: keywords 必须是字符串数组`)
  }
  if (!isNonEmptyString(m.version)) issues.push(`${folderId}: version 缺失`)
  if (!m.runtime || !RUNTIMES.includes(m.runtime)) {
    issues.push(`${folderId}: runtime 必须是 main / worker`)
  }
  if (!Array.isArray(m.platforms) || m.platforms.length === 0 || m.platforms.some((p) => !PLATFORMS.includes(p))) {
    issues.push(`${folderId}: platforms 必须是 ${PLATFORMS.join(' / ')} 的非空子集`)
  }
  if (typeof m.offline !== 'boolean') issues.push(`${folderId}: offline 必须是布尔值`)
  if (m.order !== undefined && !Number.isFinite(m.order)) issues.push(`${folderId}: order 必须是数字`)

  return issues
}
