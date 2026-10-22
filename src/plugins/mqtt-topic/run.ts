// MQTT 主题与过滤器解析、校验与通配匹配（MQTT 3.1.1 / 5.0 规则）。
// 纯函数，不联网；只处理用户输入的主题字符串。
import type { Locale, ToolResult, ToolRun } from '@/core/types'

export type MqttMode = 'parse' | 'match' | 'validate'

export interface MqttOptions {
  mode?: MqttMode
}

export interface MqttWildcard {
  level: number
  kind: '+' | '#'
}

export interface MqttRow {
  input: string
  levels?: string[]
  wildcards?: MqttWildcard[]
  shared?: { group: string; filter: string }
  system?: boolean
  matched?: boolean
  validFilter?: boolean
  validTopic?: boolean
  errors?: string[]
}

export interface MqttData {
  mode: MqttMode
  rows: MqttRow[]
  warnings: string[]
}

const MAX_LINES = 10_000
const MAX_TOPIC_BYTES = 65_535

type ErrorCode = 'emptyTopic' | 'emptyFilter' | 'invalidWildcard' | 'invalidShared' | 'publishWildcard' | 'tooLong'

const ERROR_TEXT: Record<ErrorCode, { zh: string; en: string }> = {
  emptyTopic: { zh: '主题不能为空', en: 'Topic cannot be empty' },
  emptyFilter: { zh: '过滤器不能为空', en: 'Filter cannot be empty' },
  invalidWildcard: {
    zh: '+ 必须独占一层，# 必须独占最后一层',
    en: '+ must occupy a whole level; # must be the last level',
  },
  invalidShared: {
    zh: '共享订阅格式必须是 $share/{group}/{filter}，group 不能含 / + #',
    en: 'Shared subscription must be $share/{group}/{filter}; group cannot contain / + #',
  },
  publishWildcard: { zh: '发布主题不能包含通配符', en: 'Publish topics cannot contain wildcards' },
  tooLong: { zh: '主题超过 65,535 字节', en: 'Topic exceeds 65,535 bytes' },
}

class MqttError extends Error {
  code: ErrorCode
  line?: number
  detail?: string

  constructor(code: ErrorCode, detail?: string, line?: number) {
    super(code)
    this.code = code
    this.detail = detail
    this.line = line
  }
}

interface ParsedFilter {
  levels: string[]
  wildcards: MqttWildcard[]
  shared?: { group: string; filter: string }
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

function checkLength(topic: string, line?: number): void {
  if (byteLength(topic) > MAX_TOPIC_BYTES) throw new MqttError('tooLong', undefined, line)
}

function parseFilter(text: string, line?: number): ParsedFilter {
  const trimmed = text.trim()
  if (!trimmed) throw new MqttError('emptyFilter', undefined, line)
  checkLength(trimmed, line)

  let shared: ParsedFilter['shared']
  let filter = trimmed
  if (trimmed.startsWith('$share/')) {
    const segments = trimmed.split('/')
    const group = segments[1] ?? ''
    const inner = segments.slice(2).join('/')
    if (!group || /[/+#]/.test(group) || !inner) throw new MqttError('invalidShared', trimmed, line)
    shared = { group, filter: inner }
    filter = inner
  }

  const levels = filter.split('/')
  const wildcards: MqttWildcard[] = []
  levels.forEach((level, index) => {
    if (level === '#') {
      if (index !== levels.length - 1) throw new MqttError('invalidWildcard', filter, line)
      wildcards.push({ level: index, kind: '#' })
      return
    }
    if (level.includes('#')) throw new MqttError('invalidWildcard', filter, line)
    if (level === '+') {
      wildcards.push({ level: index, kind: '+' })
      return
    }
    if (level.includes('+')) throw new MqttError('invalidWildcard', filter, line)
  })

  return { levels, wildcards, shared }
}

function parseTopic(text: string, line?: number): string[] {
  const trimmed = text.trim()
  if (!trimmed) throw new MqttError('emptyTopic', undefined, line)
  checkLength(trimmed, line)
  if (trimmed.includes('+') || trimmed.includes('#')) throw new MqttError('publishWildcard', trimmed, line)
  return trimmed.split('/')
}

/** 通配匹配；首层通配符不匹配 $ 开头的系统主题。 */
function matches(filter: ParsedFilter, topic: string[]): boolean {
  if (topic[0]?.startsWith('$') && (filter.levels[0] === '#' || filter.levels[0] === '+')) return false

  let topicIndex = 0
  for (let filterIndex = 0; filterIndex < filter.levels.length; filterIndex += 1) {
    const level = filter.levels[filterIndex]
    if (level === '#') return true
    if (level === '+') {
      if (topicIndex >= topic.length) return false
      topicIndex += 1
      continue
    }
    if (topicIndex >= topic.length || level !== topic[topicIndex]) return false
    topicIndex += 1
  }
  return topicIndex === topic.length
}

function meaningfulLines(text: string): Array<{ text: string; line: number }> {
  // 不能把 # 当注释：它是合法的多级通配符。
  return text
    .split(/\r?\n/)
    .map((raw, index) => ({ text: raw.trim(), line: index + 1 }))
    .filter((entry) => entry.text)
}

function failure(error: MqttError, locale: Locale): ToolResult<MqttData> {
  const base = ERROR_TEXT[error.code][locale]
  return {
    ok: false,
    error: {
      code: error.code,
      message: error.detail ? `${base}: ${error.detail}` : base,
      line: error.line,
      column: error.line ? 1 : undefined,
    },
  }
}

function rowFromFilter(entry: { text: string; line: number }): MqttRow {
  const filter = parseFilter(entry.text, entry.line)
  return {
    input: entry.text,
    levels: filter.levels,
    wildcards: filter.wildcards,
    shared: filter.shared,
    system: !filter.shared && entry.text.startsWith('$'),
  }
}

function describeError(error: unknown, locale: Locale): string {
  if (error instanceof MqttError) return ERROR_TEXT[error.code][locale]
  return error instanceof Error ? error.message : String(error)
}

export const SAMPLE_PARSE = `sensors/room1/temperature
sensors/+/temperature
sensors/#
$SYS/broker/uptime
$share/workers/sensors/+/temperature`

export const SAMPLE_MATCH = `sensors/+/temperature
sensors/room1/temperature
sensors/room2/humidity
$SYS/broker/uptime
$share/workers/sensors/+/temperature`

export const SAMPLE_VALIDATE = `sensors/room1/temperature
sensors/+/temperature
sensors/room1#
bad/level+/x
$share//sensors/#
$share/workers/sensors/+/temperature`

export const run: ToolRun<MqttData> = (input, options, ctx): ToolResult<MqttData> => {
  const lines = meaningfulLines(String(input ?? ''))
  if (!lines.length) return failure(new MqttError('emptyFilter'), ctx.locale)
  if (lines.length > MAX_LINES) {
    return { ok: false, error: { code: 'tooLong', message: ctx.locale === 'zh' ? '输入行数超过 10,000' : 'More than 10,000 lines' } }
  }

  const mode: MqttMode = options.mode === 'match' || options.mode === 'validate' ? options.mode : 'parse'

  try {
    if (mode === 'parse') {
      const rows = lines.map(rowFromFilter)
      const output = rows
        .map((row) => {
          const parts = [`${row.input} → levels=${row.levels?.length ?? 0}`]
          if (row.wildcards?.length) {
            parts.push(`wildcards=${row.wildcards.map((wildcard) => `${wildcard.kind}@${wildcard.level}`).join(',')}`)
          }
          if (row.shared) parts.push(`shared=${row.shared.group}`)
          if (row.system) parts.push('system')
          return parts.join('  ')
        })
        .join('\n')
      return {
        ok: true,
        output,
        data: { mode, rows, warnings: [] },
        stats: {
          topics: rows.length,
          wildcards: rows.reduce((sum, row) => sum + (row.wildcards?.length ?? 0), 0),
          shared: rows.filter((row) => row.shared).length,
        },
      }
    }

    if (mode === 'match') {
      const filter = parseFilter(lines[0].text, lines[0].line)
      const rows: MqttRow[] = lines.slice(1).map((entry) => ({
        input: entry.text,
        matched: matches(filter, parseTopic(entry.text, entry.line)),
      }))
      const output = rows.map((row) => `${row.input}: ${row.matched ? 'true' : 'false'}`).join('\n')
      return {
        ok: true,
        output,
        data: { mode, rows, warnings: [] },
        stats: { matched: rows.filter((row) => row.matched).length, tested: rows.length },
      }
    }

    const rows: MqttRow[] = lines.map((entry) => {
      const errors: string[] = []
      let validFilter = true
      let validTopic = true
      try {
        parseFilter(entry.text, entry.line)
      } catch (error) {
        validFilter = false
        errors.push(describeError(error, ctx.locale))
      }
      try {
        parseTopic(entry.text, entry.line)
      } catch (error) {
        validTopic = false
        const message = describeError(error, ctx.locale)
        if (!errors.includes(message)) errors.push(message)
      }
      return { input: entry.text, validFilter, validTopic, errors }
    })
    const output = rows
      .map((row) => `${row.input}: filter=${row.validFilter ? 'true' : 'false'} topic=${row.validTopic ? 'true' : 'false'}`)
      .join('\n')
    return {
      ok: true,
      output,
      data: { mode, rows, warnings: [] },
      stats: {
        rows: rows.length,
        validFilters: rows.filter((row) => row.validFilter).length,
        validTopics: rows.filter((row) => row.validTopic).length,
      },
    }
  } catch (error) {
    if (error instanceof MqttError) return failure(error, ctx.locale)
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: { code: 'PLUGIN_ERROR', message } }
  }
}
