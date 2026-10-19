// 时间戳转换：纯数字按单位解释，其他输入交给 Date.parse（ISO 8601 等）。
// 本地时区格式留到视图层，run 只返回与运行环境无关的毫秒数 / ISO / UTC。
import type { Locale, ToolResult, ToolRun } from '@/core/types'

export type TimestampUnit = 'auto' | 's' | 'ms'

export const MAX_INPUT_LENGTH = 200
export const MAX_DATE_MS = 8.64e15

export interface TimestampRunData {
  milliseconds: number
  seconds: number
  iso: string
  utc: string
  numeric: boolean
  unit: 's' | 'ms' | 'date'
}

export type TimestampErrorCode = 'empty' | 'tooLong' | 'invalidInput' | 'outOfRange'

const MESSAGES: Record<TimestampErrorCode, { zh: string; en: string }> = {
  empty: { zh: '请输入时间戳或日期', en: 'Enter a timestamp or date' },
  tooLong: { zh: '输入过长，请只填一个时间', en: 'Input is too long; provide a single time value' },
  invalidInput: { zh: '无法识别为时间戳或日期', en: 'Not a recognizable timestamp or date' },
  outOfRange: { zh: '时间超出可表示范围', en: 'Time is outside the representable range' },
}

function fail(code: TimestampErrorCode, locale: Locale): ToolResult<TimestampRunData> {
  return { ok: false, error: { code, message: MESSAGES[code][locale] } }
}

export function isTimestampUnit(value: unknown): value is TimestampUnit {
  return value === 'auto' || value === 's' || value === 'ms'
}

/** 返回毫秒；解析失败返回 null。 */
export function parseTimestamp(raw: string, unit: TimestampUnit): { ms: number; numeric: boolean; unit: 's' | 'ms' | 'date' } | null {
  const text = raw.trim()
  if (!text) return null

  if (/^[+-]?\d+(\.\d+)?$/.test(text)) {
    const value = Number(text)
    if (!Number.isFinite(value)) return null
    let ms: number
    let used: 's' | 'ms'
    if (unit === 's') {
      ms = value * 1000
      used = 's'
    } else if (unit === 'ms') {
      ms = value
      used = 'ms'
    } else {
      // 10 位左右为秒，13 位左右为毫秒；用 1e12 作为分界。
      used = Math.abs(value) >= 1e12 ? 'ms' : 's'
      ms = used === 'ms' ? value : value * 1000
    }
    return { ms, numeric: true, unit: used }
  }

  const parsed = Date.parse(text)
  if (Number.isNaN(parsed)) return null
  return { ms: parsed, numeric: false, unit: 'date' }
}

export const run: ToolRun<TimestampRunData> = (input, options, ctx) => {
  const raw = String(input ?? '')
  if (!raw.trim()) return fail('empty', ctx.locale)
  if (raw.length > MAX_INPUT_LENGTH) return fail('tooLong', ctx.locale)

  const unit: TimestampUnit = isTimestampUnit(options.unit) ? options.unit : 'auto'
  const parsed = parseTimestamp(raw, unit)
  if (!parsed) return fail('invalidInput', ctx.locale)

  const date = new Date(parsed.ms)
  if (Number.isNaN(date.getTime()) || Math.abs(parsed.ms) > MAX_DATE_MS) return fail('outOfRange', ctx.locale)

  return {
    ok: true,
    output: date.toISOString(),
    stats: { seconds: Math.floor(parsed.ms / 1000), unit: parsed.unit },
    data: {
      milliseconds: parsed.ms,
      seconds: parsed.ms / 1000,
      iso: date.toISOString(),
      utc: date.toUTCString(),
      numeric: parsed.numeric,
      unit: parsed.unit,
    },
  }
}
