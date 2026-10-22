// 统一格式化入口：JSON / XML / HTML / SVG / SQL 共用模式、缩进、压缩与错误文案。
// 具体解析逻辑分别在 json.ts / markup.ts / sql.ts，都是纯函数，可安全跑在 Worker 里。
import type { ToolResult, ToolRun } from '@/core/types'
import { formatJson, jsonErrorMessage, tokenizeJson, type JsonToken } from './json'
import {
  detectMarkupMode,
  formatMarkup,
  markupErrorMessage,
  tokenizeMarkup,
  type MarkupToken,
} from './markup'
import { formatSql, tokenizeSqlHighlight, type SqlHighlightToken } from './sql'

export * from './json'
export * from './markup'
export * from './sql'

export type FormatMode = 'json' | 'xml' | 'html' | 'sql'
export type FormatModeOption = 'auto' | FormatMode
export type FormatToken = JsonToken | MarkupToken | SqlHighlightToken

export interface FormatRunData {
  mode: FormatMode
  tags?: number
  depth?: number
}

const EMPTY_MESSAGE = { zh: '内容为空', en: 'Input is empty' } as const

/**
 * 自动模式只看输入开头：{ 或 [ 视为 JSON，其余交给标记语言推断。
 * JSON 标量（字符串 / 数字）不在自动识别范围内，可显式选 JSON。
 */
export function detectFormat(text: string): FormatMode {
  const head = text.trimStart()
  if (head.startsWith('{') || head.startsWith('[')) return 'json'
  if (/^(select|insert|update|delete|with|create|alter|drop|truncate|replace|merge|explain)\b/i.test(head)) return 'sql'
  return detectMarkupMode(text)
}

/** 按识别出的模式选择着色器；输出已格式化，词法扫描不会改写内容。 */
export function tokenizeFormat(text: string, mode: FormatMode): FormatToken[] {
  if (mode === 'json') return tokenizeJson(text)
  if (mode === 'sql') return tokenizeSqlHighlight(text)
  return tokenizeMarkup(text)
}

export const run: ToolRun<FormatRunData> = (input, options, ctx): ToolResult<FormatRunData> => {
  const text = String(input ?? '')
  if (!text.trim()) {
    return { ok: false, error: { code: 'empty', message: EMPTY_MESSAGE[ctx.locale] } }
  }

  const requested: FormatModeOption =
    options.mode === 'json' || options.mode === 'xml' || options.mode === 'html' || options.mode === 'sql'
      ? options.mode
      : 'auto'
  const mode = requested === 'auto' ? detectFormat(text) : requested
  const minify = Boolean(options.minify)
  const indent = typeof options.indent === 'string' ? options.indent : '  '

  if (mode === 'sql') {
    const output = formatSql(text, { indent: minify ? '' : indent, minify })
    return {
      ok: true,
      output,
      stats: { lines: output.split('\n').length, chars: output.length, bytes: new TextEncoder().encode(output).length },
      data: { mode },
    }
  }

  if (mode === 'json') {
    const result = formatJson(text, { indent: minify ? '' : indent, sortKeys: Boolean(options.sortKeys) })
    if (!result.ok) {
      return {
        ok: false,
        error: { ...result.error, message: jsonErrorMessage(result.error.code, ctx.locale) },
      }
    }
    return {
      ok: true,
      output: result.text,
      stats: { ...result.stats },
      data: { mode },
    }
  }

  const result = formatMarkup(text, { mode, indent, minify })
  if (!result.ok) {
    return {
      ok: false,
      error: {
        ...result.error,
        message: markupErrorMessage(result.error.code, ctx.locale, result.error.detail),
      },
    }
  }
  return {
    ok: true,
    output: result.text,
    stats: { ...result.stats },
    data: { mode: result.mode, tags: result.stats.tags, depth: result.stats.depth },
  }
}
