// 进制转换的纯逻辑：2–36 进制互转，整数部分用 BigInt 精确计算，小数部分按目标进制逐步乘取整。
// 不用 Number 解析：超过 2^53 的长整数会静默丢精度，而进制换算经常用来核对 id / 哈希片段。
import type { Locale, ToolResult, ToolRun } from '@/core/types'

export const BASE_MIN = 2
export const BASE_MAX = 36
export const COMMON_BASES = [2, 8, 10, 16, 36] as const
export const MAX_INPUT_LENGTH = 2000
export const MAX_FRACTION_DIGITS = 16

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

export type BaseErrorCode = 'invalidBase' | 'empty' | 'tooLong' | 'invalidNumber' | 'invalidDigit'

export class BaseConvertError extends Error {
  code: BaseErrorCode
  char?: string
  base?: number

  constructor(code: BaseErrorCode, extra: { char?: string; base?: number } = {}) {
    super(code)
    this.code = code
    this.char = extra.char
    this.base = extra.base
  }
}

const digitValue = (ch: string): number => DIGITS.indexOf(ch.toUpperCase())

export function assertBase(base: number): void {
  if (!Number.isInteger(base) || base < BASE_MIN || base > BASE_MAX) throw new BaseConvertError('invalidBase')
}

export interface ParsedValue {
  sign: number
  intValue: bigint
  fracNumerator: bigint
  fracDenominator: bigint
}

/** 解析输入：返回符号、整数 BigInt 与小数分数（分子/分母），非法输入抛 BaseConvertError */
export function parseValue(raw: string, base: number): ParsedValue {
  assertBase(base)
  let input = String(raw ?? '').trim()
  if (!input) throw new BaseConvertError('empty')
  if (input.length > MAX_INPUT_LENGTH) throw new BaseConvertError('tooLong')

  input = input.replace(/[\s_]/g, '')
  let sign = 1
  if (input[0] === '+' || input[0] === '-') {
    sign = input[0] === '-' ? -1 : 1
    input = input.slice(1)
  }
  // 常见前缀只在进制对得上时才剥掉：0b 在 16 进制里是合法数字 B，不能无条件删
  if (base === 16 && /^0[xX]/.test(input)) input = input.slice(2)
  else if (base === 2 && /^0[bB]/.test(input)) input = input.slice(2)
  else if (base === 8 && /^0[oO]/.test(input)) input = input.slice(2)

  if (input.indexOf('.') !== input.lastIndexOf('.')) throw new BaseConvertError('invalidNumber')

  const dot = input.indexOf('.')
  let intPart = dot === -1 ? input : input.slice(0, dot)
  const fracPart = dot === -1 ? '' : input.slice(dot + 1)
  if (!intPart && !fracPart) throw new BaseConvertError('empty')
  if (!intPart) intPart = '0'

  for (const ch of intPart + fracPart) {
    const value = digitValue(ch)
    if (value < 0 || value >= base) throw new BaseConvertError('invalidDigit', { char: ch, base })
  }

  const bigBase = BigInt(base)
  let intValue = 0n
  for (const ch of intPart) intValue = intValue * bigBase + BigInt(digitValue(ch))
  let fracNumerator = 0n
  for (const ch of fracPart) fracNumerator = fracNumerator * bigBase + BigInt(digitValue(ch))
  const fracDenominator = bigBase ** BigInt(fracPart.length)

  return { sign, intValue, fracNumerator, fracDenominator }
}

/** 整数 BigInt → 指定进制字符串（不含符号） */
export function toBaseString(value: bigint, base: number, { uppercase = true } = {}): string {
  assertBase(base)
  let rest = value < 0n ? -value : value
  if (rest === 0n) return '0'
  const bigBase = BigInt(base)
  let out = ''
  while (rest > 0n) {
    out = DIGITS[Number(rest % bigBase)] + out
    rest /= bigBase
  }
  return uppercase ? out : out.toLowerCase()
}

export interface ConvertedValue {
  text: string
  approximate: boolean
}

function formatParsed(
  parsed: ParsedValue,
  toBase: number,
  { uppercase = true, maxFractionDigits = MAX_FRACTION_DIGITS } = {},
): ConvertedValue {
  assertBase(toBase)
  const { sign, intValue, fracNumerator, fracDenominator } = parsed
  const negative = sign < 0 && (intValue > 0n || fracNumerator > 0n)
  let out = (negative ? '-' : '') + toBaseString(intValue, toBase, { uppercase })
  let approximate = false

  if (fracNumerator > 0n) {
    const bigBase = BigInt(toBase)
    let numerator = fracNumerator
    let digits = ''
    let exact = false
    while (digits.length < maxFractionDigits) {
      numerator *= bigBase
      const digit = numerator / fracDenominator
      numerator %= fracDenominator
      digits += DIGITS[Number(digit)]
      if (numerator === 0n) {
        exact = true
        break
      }
    }
    // 近似截断时末尾的 0 不再提供信息，统一去掉；能整除的也一并去掉
    digits = digits.replace(/0+$/, '')
    if (digits) out += `.${uppercase ? digits : digits.toLowerCase()}`
    approximate = !exact
  }

  return { text: out, approximate }
}

/** 单次换算：返回 {ok, text, approximate} 或抛 BaseConvertError */
export function convert(raw: string, fromBase: number, toBase: number, options?: { uppercase?: boolean }): ConvertedValue {
  const parsed = parseValue(raw, fromBase)
  return formatParsed(parsed, toBase, options)
}

export interface ConversionRow {
  base: number
  text: string
  approximate: boolean
}

export type ConvertAllResult =
  | { ok: true; results: ConversionRow[] }
  | { ok: false; error: BaseErrorCode; char?: string }

/**
 * 一次换算到多个目标进制（解析只做一次）。
 */
export function convertAll(
  raw: string,
  fromBase: number,
  bases: readonly number[] = COMMON_BASES,
  options?: { uppercase?: boolean },
): ConvertAllResult {
  let parsed: ParsedValue
  try {
    parsed = parseValue(raw, fromBase)
  } catch (e) {
    if (!(e instanceof BaseConvertError)) throw e
    return { ok: false, error: e.code, char: e.char }
  }
  const targets = [...new Set(bases)].filter((b) => Number.isInteger(b) && b >= BASE_MIN && b <= BASE_MAX)
  return { ok: true, results: targets.map((base) => ({ base, ...formatParsed(parsed, base, options) })) }
}

const MESSAGES: Record<BaseErrorCode, { zh: string; en: string }> = {
  invalidBase: { zh: '进制必须在 2–36 之间', en: 'Base must be between 2 and 36' },
  empty: { zh: '请输入要转换的数值', en: 'Enter a value to convert' },
  tooLong: { zh: `输入超过 ${MAX_INPUT_LENGTH} 个字符`, en: `Input exceeds ${MAX_INPUT_LENGTH} characters` },
  invalidNumber: { zh: '小数点数量不合法', en: 'Invalid number of decimal points' },
  invalidDigit: { zh: '包含当前进制不允许的数字', en: 'Digit not allowed in this base' },
}

export function baseErrorMessage(code: BaseErrorCode, locale: Locale, detail?: { char?: string; base?: number }): string {
  const base = MESSAGES[code][locale]
  if (code === 'invalidDigit' && detail?.char) {
    return locale === 'zh'
      ? `${base}：「${detail.char}」不属于 ${detail.base} 进制`
      : `${base}: "${detail.char}" is not valid in base ${detail.base}`
  }
  return base
}

export interface BaseRunData {
  results: ConversionRow[]
  fromBase: number
  targetBase: number
  bitLength: number
  negative: boolean
}

export const run: ToolRun<BaseRunData> = (input, options, ctx): ToolResult<BaseRunData> => {
  const fromBase = Number(options.fromBase ?? 10)
  const targetBase = Number(options.targetBase ?? 16)

  if (!Number.isInteger(fromBase) || fromBase < BASE_MIN || fromBase > BASE_MAX) {
    return { ok: false, error: { code: 'invalidBase', message: baseErrorMessage('invalidBase', ctx.locale) } }
  }
  if (!Number.isInteger(targetBase) || targetBase < BASE_MIN || targetBase > BASE_MAX) {
    return { ok: false, error: { code: 'invalidBase', message: baseErrorMessage('invalidBase', ctx.locale) } }
  }

  const all = convertAll(input, fromBase, [...COMMON_BASES, targetBase])
  if (!all.ok) {
    return {
      ok: false,
      error: {
        code: all.error,
        message: baseErrorMessage(all.error, ctx.locale, { char: all.char, base: fromBase }),
        char: all.char,
      },
    }
  }

  const parsed = parseValue(input, fromBase)
  const target = all.results.find((row) => row.base === targetBase) ?? convert(input, fromBase, targetBase)
  const negative = parsed.sign < 0

  return {
    ok: true,
    output: target.text,
    stats: {
      fromBase,
      targetBase,
      bits: parsed.intValue === 0n ? 0 : parsed.intValue.toString(2).length,
    },
    data: {
      results: all.results,
      fromBase,
      targetBase,
      bitLength: parsed.intValue === 0n ? 0 : parsed.intValue.toString(2).length,
      negative,
    },
  }
}
