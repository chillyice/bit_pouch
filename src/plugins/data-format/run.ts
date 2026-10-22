// 数据格式互转：YAML / TOML / INI / .env / Properties / JSON。
// 纯函数，可安全跑在 Worker；所有解析结果先归一化为普通对象再序列化，
// 拒绝原型污染键，日期统一转 ISO 字符串。
// YAML / TOML 依赖按需动态加载，避免把重型解析器打进工具入口 chunk。
import type { Locale, ToolResult, ToolRun } from '@/core/types'

let yamlModule: Promise<typeof import('yaml')> | null = null
let tomlModule: Promise<typeof import('smol-toml')> | null = null

function loadYaml(): Promise<typeof import('yaml')> {
  yamlModule ??= import('yaml')
  return yamlModule
}

function loadToml(): Promise<typeof import('smol-toml')> {
  tomlModule ??= import('smol-toml')
  return tomlModule
}

export type DataFormat = 'json' | 'yaml' | 'toml' | 'ini' | 'env' | 'properties'
export type DataFormatMode = 'toJson' | 'fromJson'
export type FormatChoice = 'auto' | DataFormat

export interface DataFormatOptions {
  mode?: DataFormatMode
  format?: FormatChoice
  target?: DataFormat
  indent?: '2' | '4' | 'tab'
  flatten?: boolean
  sortKeys?: boolean
}

export interface DataFormatData {
  sourceFormat: DataFormat
  targetFormat: DataFormat
  keyCount: number
  warnings: string[]
}

const MAX_INPUT = 1_000_000
const MAX_DEPTH = 100
const MAX_ALIASES = 100
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const FORMATS: DataFormat[] = ['json', 'yaml', 'toml', 'ini', 'env', 'properties']
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

type ErrorCode =
  | 'empty'
  | 'tooLarge'
  | 'tooDeep'
  | 'syntaxError'
  | 'unsupportedFormat'
  | 'multiDocument'
  | 'tooManyAliases'
  | 'cyclicReference'
  | 'unsafeKey'
  | 'nestedNotSupported'
  | 'invalidKey'
  | 'unsupportedValue'

type WarningCode =
  | 'nonFiniteNumber'
  | 'commentsDropped'
  | 'precisionLoss'
  | 'duplicateKey'

const ERROR_TEXT: Record<ErrorCode, { zh: string; en: string }> = {
  empty: { zh: '内容为空', en: 'Input is empty' },
  tooLarge: { zh: '输入超过 1,000,000 字符', en: 'Input exceeds 1,000,000 characters' },
  tooDeep: { zh: '嵌套超过 100 层', en: 'Nesting exceeds 100 levels' },
  syntaxError: { zh: '语法错误', en: 'Syntax error' },
  unsupportedFormat: {
    zh: '无法自动识别格式，请手动选择',
    en: 'Could not detect the format; select one manually',
  },
  multiDocument: {
    zh: '输入包含多个 YAML 文档，本版只支持单个文档',
    en: 'Input contains multiple YAML documents; only single documents are supported',
  },
  tooManyAliases: {
    zh: 'YAML 别名超过上限（100）',
    en: 'YAML alias count exceeds the limit (100)',
  },
  cyclicReference: { zh: 'YAML 锚点存在循环引用', en: 'YAML anchors contain a cyclic reference' },
  unsafeKey: { zh: '不安全的键名', en: 'Unsafe key' },
  nestedNotSupported: {
    zh: '目标格式不支持嵌套对象或数组',
    en: 'The target format does not support nested objects or arrays',
  },
  invalidKey: { zh: '键名不合法', en: 'Invalid key' },
  unsupportedValue: {
    zh: '目标格式不支持该值类型',
    en: 'The target format does not support this value type',
  },
}

const WARNING_TEXT: Record<WarningCode, { zh: string; en: string }> = {
  nonFiniteNumber: {
    zh: '非有限数字已转为字符串',
    en: 'Non-finite numbers were converted to strings',
  },
  commentsDropped: { zh: '注释已丢弃', en: 'Comments were dropped' },
  precisionLoss: {
    zh: '超过安全范围的整数可能丢失精度',
    en: 'Integers beyond the safe range may lose precision',
  },
  duplicateKey: { zh: '重复键，后者覆盖前者', en: 'Duplicate key; the later value wins' },
}

class DataError extends Error {
  code: ErrorCode
  line?: number
  column?: number
  lineText?: string
  detail?: string

  constructor(code: ErrorCode, detail?: string, pos?: { line?: number; column?: number; lineText?: string }) {
    super(code)
    this.code = code
    this.detail = detail
    this.line = pos?.line
    this.column = pos?.column
    this.lineText = pos?.lineText
  }
}

type Warner = (code: WarningCode, detail?: string) => void

function makeWarner(locale: Locale): { warn: Warner; warnings: string[] } {
  const warnings: string[] = []
  const seen = new Set<string>()
  const warn: Warner = (code, detail) => {
    const key = `${code}:${detail ?? ''}`
    if (seen.has(key)) return
    seen.add(key)
    const text = WARNING_TEXT[code][locale]
    warnings.push(detail ? `${code}: ${text} (${detail})` : `${code}: ${text}`)
  }
  return { warn, warnings }
}

function setSafe(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
}

/** 统一归一化：日期转 ISO、非有限数字转字符串、BigInt 降级、拒绝不安全键并复检深度。 */
function normalizeValue(value: unknown, warn: Warner, depth = 1): unknown {
  if (depth > MAX_DEPTH) throw new DataError('tooDeep')
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'bigint') {
    const asNumber = Number(value)
    if (Number.isSafeInteger(asNumber)) return asNumber
    warn('precisionLoss', String(value))
    return String(value)
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    warn('nonFiniteNumber')
    if (Number.isNaN(value)) return 'nan'
    return value > 0 ? 'inf' : '-inf'
  }
  if (Array.isArray(value)) return value.map((item) => normalizeValue(item, warn, depth + 1))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (UNSAFE_KEYS.has(key)) throw new DataError('unsafeKey', key)
      setSafe(out, key, normalizeValue((value as Record<string, unknown>)[key], warn, depth + 1))
    }
    return out
  }
  return value
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      setSafe(out, key, sortDeep((value as Record<string, unknown>)[key]))
    }
    return out
  }
  return value
}

function isScalar(value: unknown): boolean {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value)
}

function scalarText(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
}

function countKeys(value: unknown): number {
  if (Array.isArray(value)) return value.length
  if (value && typeof value === 'object') return Object.keys(value as Record<string, unknown>).length
  return 0
}

function lineAt(text: string, line: number): string | undefined {
  return text.split(/\r?\n/)[line - 1]
}

function jsonErrorPosition(message: string, text: string): { line: number; column: number; lineText?: string } {
  const match = /position\s+(\d+)/i.exec(message)
  const position = match ? Number(match[1]) : -1
  if (position < 0) return { line: 1, column: 1, lineText: lineAt(text, 1) }
  const before = text.slice(0, position)
  const line = before.split(/\r?\n/).length
  const column = position - before.lastIndexOf('\n')
  return { line, column, lineText: lineAt(text, line) }
}

function parseJsonText(text: string, warn: Warner): unknown {
  const unsafe = findUnsafeInteger(text)
  if (unsafe) warn('precisionLoss', unsafe)
  try {
    return JSON.parse(text)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new DataError('syntaxError', message, jsonErrorPosition(message, text))
  }
}

/** 扫描 JSON 文本中的整数字面量，找出超过 Number.MAX_SAFE_INTEGER 的值（跳过字符串）。 */
function findUnsafeInteger(text: string): string | null {
  let index = 0
  while (index < text.length) {
    const char = text[index]
    if (char === '"') {
      index += 1
      while (index < text.length) {
        if (text[index] === '\\') {
          index += 2
          continue
        }
        if (text[index] === '"') {
          index += 1
          break
        }
        index += 1
      }
      continue
    }
    if (char === '-' || (char >= '0' && char <= '9')) {
      const start = index
      if (char === '-') index += 1
      while (index < text.length && text[index] >= '0' && text[index] <= '9') index += 1
      if (text[index] === '.' || text[index] === 'e' || text[index] === 'E') {
        index += 1
        while (index < text.length && /[0-9eE+-]/.test(text[index])) index += 1
        continue
      }
      const literal = text.slice(start, index)
      try {
        const value = BigInt(literal)
        if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) return literal
      } catch {
        // 非法数字交给 JSON.parse 报错
      }
      continue
    }
    index += 1
  }
  return null
}

function hasComment(text: string, markers: string[]): boolean {
  let quote: string | null = null
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quote) {
      if (quote === '"' && char === '\\') {
        index += 1
        continue
      }
      if (char === quote) quote = null
      if (char === '\n') quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (markers.includes(char) && (index === 0 || /[\s;,]/.test(text[index - 1]))) return true
    if (char === '\n') quote = null
  }
  return false
}

function hasLineComment(text: string, markers: string[]): boolean {
  return text.split(/\r?\n/).some((line) => {
    const trimmed = line.trimStart()
    return markers.some((marker) => trimmed.startsWith(marker))
  })
}

function yamlError(error: { message: string; linePos?: Array<{ line: number; col: number }> }, text: string): DataError {
  const pos = error.linePos?.[0]
  return new DataError('syntaxError', error.message, {
    line: pos?.line,
    column: pos?.col,
    lineText: pos ? lineAt(text, pos.line) : undefined,
  })
}

async function parseYamlText(text: string, warn: Warner): Promise<unknown> {
  const { parseAllDocuments } = await loadYaml()
  let docs
  try {
    docs = parseAllDocuments(text, { schema: 'core' })
  } catch (error) {
    const first = (error as { linePos?: Array<{ line: number; col: number }> }).linePos?.[0]
    throw new DataError('syntaxError', (error as Error).message, {
      line: first?.line,
      column: first?.col,
      lineText: first ? lineAt(text, first.line) : undefined,
    })
  }
  const firstError = docs.flatMap((doc) => doc.errors)[0]
  if (firstError) throw yamlError(firstError, text)
  if (docs.length > 1) throw new DataError('multiDocument')
  if (!docs.length) throw new DataError('empty')

  if (hasComment(text, ['#'])) warn('commentsDropped')

  try {
    return docs[0].toJS({ maxAliasCount: MAX_ALIASES })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/circular/i.test(message)) throw new DataError('cyclicReference')
    if (/alias/i.test(message)) throw new DataError('tooManyAliases')
    throw new DataError('syntaxError', message)
  }
}

async function parseTomlText(text: string, warn: Warner): Promise<unknown> {
  if (hasComment(text, ['#'])) warn('commentsDropped')
  const { parse } = await loadToml()
  try {
    return parse(text)
  } catch (error) {
    const problem = error as Error & { line?: number; column?: number }
    throw new DataError('syntaxError', problem.message, {
      line: problem.line,
      column: problem.column,
      lineText: problem.line ? lineAt(text, problem.line) : undefined,
    })
  }
}

function parseIniText(text: string, warn: Warner): Record<string, unknown> {
  if (hasLineComment(text, [';', '#'])) warn('commentsDropped')
  const result: Record<string, unknown> = {}
  let section = ''
  const lines = text.split(/\r?\n/)

  lines.forEach((raw, index) => {
    const line = raw.trim()
    if (!line || line.startsWith(';') || line.startsWith('#')) return
    if (line.startsWith('[')) {
      if (!line.endsWith(']')) {
        throw new DataError('syntaxError', line, { line: index + 1, column: 1, lineText: raw })
      }
      section = line.slice(1, -1).trim()
      return
    }
    const separator = findSeparator(line)
    if (separator < 0) {
      throw new DataError('syntaxError', line, { line: index + 1, column: 1, lineText: raw })
    }
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()
    if (!key) throw new DataError('syntaxError', line, { line: index + 1, column: 1, lineText: raw })
    const fullKey = section ? `${section}.${key}` : key
    if (Object.prototype.hasOwnProperty.call(result, fullKey)) warn('duplicateKey', fullKey)
    setSafe(result, fullKey, value)
  })

  return result
}

function findSeparator(line: string): number {
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '\\') {
      index += 1
      continue
    }
    if (char === '=' || char === ':') return index
  }
  return -1
}

function readLogicalLines(text: string): Array<{ text: string; line: number }> {
  const physical = text.split(/\r?\n/)
  const logical: Array<{ text: string; line: number }> = []
  let buffer = ''
  let start = 1
  let continued = false
  physical.forEach((raw, index) => {
    if (!buffer) start = index + 1
    // Properties 续行会丢弃下一行开头的空白。
    const part = continued ? raw.trimStart() : raw
    const backslashes = /\\*$/.exec(part)?.[0].length ?? 0
    if (backslashes % 2 === 1) {
      buffer += part.slice(0, -1)
      continued = true
      return
    }
    logical.push({ text: buffer + part, line: start })
    buffer = ''
    continued = false
  })
  if (buffer) logical.push({ text: buffer, line: start })
  return logical
}

function unescapeProperty(value: string): string {
  let out = ''
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (char !== '\\') {
      out += char
      continue
    }
    const next = value[index + 1]
    if (next === undefined) break
    if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(value.slice(index + 2, index + 6))) {
      out += String.fromCharCode(parseInt(value.slice(index + 2, index + 6), 16))
      index += 5
      continue
    }
    const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', f: '\f' }
    out += escapes[next] ?? next
    index += 1
  }
  return out
}

function parsePropertiesText(text: string, warn: Warner): Record<string, unknown> {
  if (hasLineComment(text, ['#', '!'])) warn('commentsDropped')
  const result: Record<string, unknown> = {}
  for (const logical of readLogicalLines(text)) {
    const line = logical.text.trimStart()
    if (!line || line.startsWith('#') || line.startsWith('!')) continue
    const separator = findSeparator(line)
    const rawKey = separator < 0 ? line : line.slice(0, separator)
    const rawValue = separator < 0 ? '' : line.slice(separator + 1)
    const key = unescapeProperty(rawKey.trim())
    if (!key) throw new DataError('syntaxError', line, { line: logical.line, column: 1, lineText: line })
    if (Object.prototype.hasOwnProperty.call(result, key)) warn('duplicateKey', key)
    setSafe(result, key, unescapeProperty(rawValue.trim()))
  }
  return result
}

function parseEnvText(text: string, warn: Warner): Record<string, unknown> {
  if (hasLineComment(text, ['#']) || /(^|\s)#/.test(text)) warn('commentsDropped')
  const result: Record<string, unknown> = {}
  const lines = text.split(/\r?\n/)

  lines.forEach((raw, index) => {
    let line = raw.trim()
    if (!line || line.startsWith('#')) return
    if (/^export\s+/.test(line)) line = line.replace(/^export\s+/, '')
    const separator = line.indexOf('=')
    if (separator < 0) {
      throw new DataError('syntaxError', raw, { line: index + 1, column: 1, lineText: raw })
    }
    const key = line.slice(0, separator).trim()
    if (!key) throw new DataError('syntaxError', raw, { line: index + 1, column: 1, lineText: raw })
    let rest = line.slice(separator + 1).trim()
    let value = ''

    if (rest.startsWith('"') || rest.startsWith("'")) {
      const quote = rest[0]
      let closed = false
      let body = ''
      for (let cursor = 1; cursor < rest.length; cursor += 1) {
        const char = rest[cursor]
        if (quote === '"' && char === '\\') {
          const next = rest[cursor + 1]
          const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\', "'": "'", $: '$' }
          body += escapes[next] ?? next
          cursor += 1
          continue
        }
        if (char === quote) {
          closed = true
          rest = rest.slice(cursor + 1)
          break
        }
        body += char
      }
      if (!closed) {
        throw new DataError('syntaxError', raw, { line: index + 1, column: 1, lineText: raw })
      }
      value = body
    } else {
      const comment = rest.search(/\s#/)
      if (comment >= 0) rest = rest.slice(0, comment)
      value = rest.trim()
    }

    if (Object.prototype.hasOwnProperty.call(result, key)) warn('duplicateKey', key)
    setSafe(result, key, value)
  })

  return result
}

/** 自动识别优先看结构特征；无法判断时返回 null，由调用方报 unsupportedFormat，不猜测。 */
export function detectDataFormat(text: string): DataFormat | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  // `[section]` 也以 [ 开头，只有 JSON 数组形态才直接判为 JSON。
  if (trimmed.startsWith('{') || /^\[\s*(?:[{"\]\d-]|true\b|false\b|null\b)/.test(trimmed)) return 'json'

  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim() && !/^\s*[;#]/.test(line))
  const hasSection = lines.some((line) => /^\s*\[.+\]\s*$/.test(line))
  const hasAssign = lines.some((line) => line.includes('='))

  if (hasSection && hasAssign) {
    const tomlSignals =
      /"""|'''/.test(trimmed) ||
      lines.some((line) => /^\s*\[\[/.test(line)) ||
      lines.some((line) => /^\s*["'][^"']+["']\s*=/.test(line)) ||
      lines.some((line) => /=\s*["'][^"']*["']\s*$/.test(line))
    return tomlSignals ? 'toml' : 'ini'
  }

  if (/^---/m.test(trimmed) || lines.some((line) => /^[^:]+:\s/.test(line))) return 'yaml'

  const assignments = lines.filter((line) => line.includes('='))
  if (assignments.length) {
    const keys = assignments.map((line) => line.slice(0, line.indexOf('=')).replace(/^export\s+/, '').trim())
    if (keys.every((key) => /^[A-Z_][A-Z0-9_]*$/.test(key))) return 'env'
    if (/\\u[0-9a-fA-F]{4}/.test(trimmed)) return 'properties'
    if (keys.every((key) => ENV_KEY_RE.test(key))) return 'env'
    if (keys.some((key) => key.includes('.'))) return 'properties'
  }

  return null
}

async function parseSource(format: DataFormat, text: string, warn: Warner): Promise<unknown> {
  switch (format) {
    case 'json':
      return parseJsonText(text, warn)
    case 'yaml':
      return parseYamlText(text, warn)
    case 'toml':
      return parseTomlText(text, warn)
    case 'ini':
      return parseIniText(text, warn)
    case 'env':
      return parseEnvText(text, warn)
    case 'properties':
      return parsePropertiesText(text, warn)
  }
}

function indentText(value: DataFormatOptions['indent']): string {
  if (value === '4') return '    '
  if (value === 'tab') return '\t'
  return '  '
}

function sortKeysOf(value: Record<string, unknown>): string[] {
  return Object.keys(value).sort()
}

function flattenPairs(
  value: Record<string, unknown>,
  prefix: string,
  out: Array<[string, string]>,
  sortKeys: boolean,
): void {
  const keys = sortKeys ? sortKeysOf(value) : Object.keys(value)
  for (const key of keys) {
    const child = value[key]
    const path = prefix ? `${prefix}.${key}` : key
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      flattenPairs(child as Record<string, unknown>, path, out, sortKeys)
    } else if (isScalar(child)) {
      out.push([path, scalarText(child)])
    } else {
      throw new DataError('nestedNotSupported', path)
    }
  }
}

function serializeIni(value: Record<string, unknown>, flatten: boolean, sortKeys: boolean): string {
  const lines: string[] = []
  const keys = sortKeys ? sortKeysOf(value) : Object.keys(value)

  if (flatten) {
    const pairs: Array<[string, string]> = []
    for (const key of keys) {
      const child = value[key]
      if (child && typeof child === 'object' && !Array.isArray(child)) {
        flattenPairs(child as Record<string, unknown>, key, pairs, sortKeys)
      } else if (isScalar(child)) {
        pairs.push([key, scalarText(child)])
      } else {
        throw new DataError('nestedNotSupported', key)
      }
    }
    for (const [key, text] of pairs) lines.push(`${key}=${text}`)
    return lines.join('\n')
  }

  const globals: string[] = []
  const sections: string[] = []
  for (const key of keys) {
    const child = value[key]
    if (isScalar(child)) {
      globals.push(`${key}=${scalarText(child)}`)
      continue
    }
    if (!child || typeof child !== 'object' || Array.isArray(child)) {
      throw new DataError('nestedNotSupported', key)
    }
    const sectionKeys = sortKeys ? sortKeysOf(child as Record<string, unknown>) : Object.keys(child as Record<string, unknown>)
    const sectionLines: string[] = []
    for (const sectionKey of sectionKeys) {
      const leaf = (child as Record<string, unknown>)[sectionKey]
      if (!isScalar(leaf)) throw new DataError('nestedNotSupported', `${key}.${sectionKey}`)
      sectionLines.push(`${sectionKey}=${scalarText(leaf)}`)
    }
    sections.push(`[${key}]\n${sectionLines.join('\n')}`)
  }

  if (globals.length) lines.push(globals.join('\n'))
  if (sections.length) lines.push(sections.join('\n\n'))
  return lines.join('\n\n')
}

function serializeEnv(value: Record<string, unknown>, sortKeys: boolean): string {
  const keys = sortKeys ? sortKeysOf(value) : Object.keys(value)
  const lines: string[] = []
  for (const key of keys) {
    if (!ENV_KEY_RE.test(key)) throw new DataError('invalidKey', key)
    const child = value[key]
    if (!isScalar(child)) throw new DataError('nestedNotSupported', key)
    lines.push(`${key}=${envValue(child)}`)
  }
  return lines.join('\n')
}

function envValue(value: unknown): string {
  const text = scalarText(value)
  if (text === '') return ''
  if (!/[\s"'\\#=]/.test(text)) return text
  const escaped = text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
  return `"${escaped}"`
}

function escapeProperty(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/=/g, '\\=')
    .replace(/:/g, '\\:')
    .replace(/^ /, '\\ ')
    .replace(/([#!])/g, '\\$1')
}

function serializeProperties(value: Record<string, unknown>): string {
  const pairs: Array<[string, string]> = []
  flattenPairs(value, '', pairs, false)
  return pairs.map(([key, text]) => `${escapeProperty(key)}=${escapeProperty(text)}`).join('\n')
}

function assertTomlSafe(value: unknown, path = ''): void {
  if (value === null || value === undefined) throw new DataError('unsupportedValue', path || 'root')
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertTomlSafe(item, `${path}[${index}]`))
    return
  }
  if (typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      assertTomlSafe((value as Record<string, unknown>)[key], path ? `${path}.${key}` : key)
    }
  }
}

async function serializeTarget(
  target: DataFormat,
  value: unknown,
  options: DataFormatOptions,
): Promise<string> {
  const sortKeys = Boolean(options.sortKeys)
  const indent = indentText(options.indent)

  switch (target) {
    case 'json': {
      const prepared = sortKeys ? sortDeep(value) : value
      return JSON.stringify(prepared, null, indent)
    }
    case 'yaml': {
      const { stringify } = await loadYaml()
      return stringify(value, {
        indent: options.indent === 'tab' ? 2 : indent.length,
        lineWidth: 0,
        sortMapEntries: sortKeys,
      }).replace(/\n$/, '')
    }
    case 'toml': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new DataError('nestedNotSupported', 'root')
      }
      assertTomlSafe(value)
      const prepared = sortKeys ? sortDeep(value) : value
      const { stringify } = await loadToml()
      return stringify(prepared as Record<string, unknown>).replace(/\n$/, '')
    }
    case 'ini': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new DataError('nestedNotSupported', 'root')
      }
      return serializeIni(value as Record<string, unknown>, options.flatten !== false, sortKeys)
    }
    case 'env': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new DataError('nestedNotSupported', 'root')
      }
      return serializeEnv(value as Record<string, unknown>, sortKeys)
    }
    case 'properties': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new DataError('nestedNotSupported', 'root')
      }
      const prepared = sortKeys
        ? (sortDeep(value) as Record<string, unknown>)
        : (value as Record<string, unknown>)
      return serializeProperties(prepared)
    }
  }
}

function isFormat(value: unknown): value is DataFormat {
  return typeof value === 'string' && FORMATS.includes(value as DataFormat)
}

function success(
  output: string,
  data: DataFormatData,
): ToolResult<DataFormatData> {
  const chars = output.length
  const bytes = new TextEncoder().encode(output).length
  return {
    ok: true,
    output,
    data,
    stats: { keys: data.keyCount, chars, bytes, warnings: data.warnings.length },
  }
}

function failure(error: DataError, locale: Locale): ToolResult<DataFormatData> {
  const base = ERROR_TEXT[error.code][locale]
  return {
    ok: false,
    error: {
      code: error.code,
      message: error.detail ? `${base}: ${error.detail}` : base,
      line: error.line,
      column: error.column,
      lineText: error.lineText,
    },
  }
}

export const SAMPLE_JSON = `{
  "name": "bit_pouch",
  "port": 8080,
  "features": ["format", "convert"],
  "database": { "host": "127.0.0.1", "pool": 8 }
}`

export const SAMPLE_YAML = `# service config
name: bit_pouch
port: 8080
features:
  - format
  - convert
database:
  host: 127.0.0.1
  pool: 8
`

export const SAMPLE_TOML = `# service config
name = "bit_pouch"
port = 8080
features = ["format", "convert"]

[database]
host = "127.0.0.1"
pool = 8
`

export const SAMPLE_INI = `; service config
name=bit_pouch

[server]
host=127.0.0.1
port=8080

[database]
pool=8
`

export const SAMPLE_ENV = `# service config
export APP_NAME=bit_pouch
PORT=8080
DEBUG=false
`

export const SAMPLE_PROPERTIES = `# service config
app.name=bit_pouch
app.port=8080
database.pool=8
`

export const run: ToolRun<DataFormatData> = async (
  input,
  options,
  ctx,
): Promise<ToolResult<DataFormatData>> => {
  const text = String(input ?? '')
  if (!text.trim()) return failure(new DataError('empty'), ctx.locale)
  if (text.length > MAX_INPUT) return failure(new DataError('tooLarge'), ctx.locale)

  const opts = options as DataFormatOptions
  const { warn, warnings } = makeWarner(ctx.locale)
  const mode: DataFormatMode = opts.mode === 'fromJson' ? 'fromJson' : 'toJson'

  try {
    if (mode === 'toJson') {
      const requested = opts.format
      const sourceFormat: DataFormat =
        requested === 'auto' || requested === undefined
          ? detectDataFormat(text) ?? (() => {
              throw new DataError('unsupportedFormat')
            })()
          : isFormat(requested)
            ? requested
            : (() => {
                throw new DataError('unsupportedFormat')
              })()

      const parsed = normalizeValue(await parseSource(sourceFormat, text, warn), warn)
      const output = await serializeTarget('json', parsed, {
        indent: opts.indent ?? '2',
        sortKeys: Boolean(opts.sortKeys),
      })

      return success(output, {
        sourceFormat,
        targetFormat: 'json',
        keyCount: countKeys(parsed),
        warnings,
      })
    }

    const parsed = normalizeValue(parseJsonText(text, warn), warn)
    const targetFormat: DataFormat = isFormat(opts.target) ? opts.target : 'yaml'
    const output = await serializeTarget(targetFormat, parsed, opts)

    return success(output, {
      sourceFormat: 'json',
      targetFormat,
      keyCount: countKeys(parsed),
      warnings,
    })
  } catch (error) {
    if (error instanceof DataError) return failure(error, ctx.locale)
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: { code: 'syntaxError', message } }
  }
}
