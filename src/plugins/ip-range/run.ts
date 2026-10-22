// IP 段计算：合并、范围互转、包含判断、排除。
// 纯函数；IPv4 与 IPv6 统一用 BigInt 做 32/128 位运算，输出规范化文本。
import type { Locale, ToolResult, ToolRun } from '@/core/types'

export type IpRangeMode = 'merge' | 'range' | 'contains' | 'exclude'
export type IpFamily = 'ipv4' | 'ipv6'

export interface IpRangeOptions {
  mode?: IpRangeMode
}

export interface IpRangeRow {
  input: string
  start?: string
  end?: string
  cidrs?: string[]
  contained?: boolean
}

export interface IpRangeData {
  mode: IpRangeMode
  family: IpFamily
  base?: { start: string; end: string; cidrs: string[] }
  rows: IpRangeRow[]
  warnings: string[]
}

interface Address {
  value: bigint
  family: IpFamily
  bits: 32 | 128
}

interface Span {
  start: bigint
  end: bigint
  family: IpFamily
}

const MAX_LINES = 10_000

type ErrorCode = 'empty' | 'invalidAddress' | 'invalidPrefix' | 'invalidRange' | 'mixedFamily' | 'tooMany'

const ERROR_TEXT: Record<ErrorCode, { zh: string; en: string }> = {
  empty: { zh: '没有有效输入', en: 'No valid input' },
  invalidAddress: { zh: '地址不合法', en: 'Invalid address' },
  invalidPrefix: { zh: '前缀长度不合法', en: 'Invalid prefix length' },
  invalidRange: { zh: '起止地址顺序不合法', en: 'Invalid address range' },
  mixedFamily: { zh: '不能混合 IPv4 与 IPv6', en: 'IPv4 and IPv6 cannot be mixed' },
  tooMany: { zh: '输入超过 10,000 行', en: 'More than 10,000 lines' },
}

class IpError extends Error {
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

function toInt(text: string, base: number, line?: number): number {
  const value = Number.parseInt(text, base)
  if (!Number.isFinite(value)) throw new IpError('invalidAddress', text, line)
  return value
}

function parseIpv4(text: string, line?: number): Address {
  const parts = text.split('.')
  if (parts.length !== 4) throw new IpError('invalidAddress', text, line)
  let value = 0n
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) throw new IpError('invalidAddress', text, line)
    const octet = toInt(part, 10, line)
    if (octet > 255) throw new IpError('invalidAddress', text, line)
    value = (value << 8n) | BigInt(octet)
  }
  return { value, family: 'ipv4', bits: 32 }
}

function parseIpv6Groups(text: string, original: string, line?: number): bigint {
  let left: string[] = []
  let right: string[] = []
  if (text.includes('::')) {
    const halves = text.split('::')
    if (halves.length > 2) throw new IpError('invalidAddress', original, line)
    left = halves[0] ? halves[0].split(':') : []
    right = halves[1] ? halves[1].split(':') : []
    if (left.length + right.length >= 8) throw new IpError('invalidAddress', original, line)
  } else {
    left = text.split(':')
    if (left.length !== 8) throw new IpError('invalidAddress', original, line)
  }
  const zeros = Array.from({ length: 8 - left.length - right.length }, () => '0')
  const groups = [...left, ...zeros, ...right]
  if (groups.some((group) => !/^[0-9a-fA-F]{1,4}$/.test(group))) throw new IpError('invalidAddress', original, line)
  let value = 0n
  for (const group of groups) value = (value << 16n) | BigInt(toInt(group, 16, line))
  return value
}

function parseAddress(raw: string, line?: number): Address {
  const text = raw.trim().replace(/%.*$/, '')
  if (!text) throw new IpError('invalidAddress', raw, line)

  if (text.includes('.')) {
    if (!text.includes(':')) return parseIpv4(text, line)
    const lastColon = text.lastIndexOf(':')
    const ipv4 = parseIpv4(text.slice(lastColon + 1), line)
    const high = (ipv4.value >> 16n) & 0xffffn
    const low = ipv4.value & 0xffffn
    const prefix = text.slice(0, lastColon + 1)
    const value = parseIpv6Groups(`${prefix}${high.toString(16)}:${low.toString(16)}`, raw, line)
    return { value, family: 'ipv6', bits: 128 }
  }

  if (text.includes(':')) {
    return { value: parseIpv6Groups(text, raw, line), family: 'ipv6', bits: 128 }
  }

  return parseIpv4(text, line)
}

function parseEntry(text: string, line?: number): Span {
  const trimmed = text.trim()
  const slash = trimmed.indexOf('/')
  if (slash >= 0) {
    const address = parseAddress(trimmed.slice(0, slash), line)
    const prefixText = trimmed.slice(slash + 1).trim()
    if (!/^\d+$/.test(prefixText)) throw new IpError('invalidPrefix', prefixText, line)
    const prefix = Number(prefixText)
    if (prefix < 0 || prefix > address.bits) throw new IpError('invalidPrefix', prefixText, line)
    const hostBits = BigInt(address.bits - prefix)
    const hostMask = (1n << hostBits) - 1n
    const start = address.value & ~hostMask
    return { start, end: start | hostMask, family: address.family }
  }

  const dash = trimmed.indexOf('-')
  if (dash >= 0) {
    const start = parseAddress(trimmed.slice(0, dash), line)
    const end = parseAddress(trimmed.slice(dash + 1), line)
    if (start.family !== end.family) throw new IpError('mixedFamily', trimmed, line)
    if (start.value > end.value) throw new IpError('invalidRange', trimmed, line)
    return { start: start.value, end: end.value, family: start.family }
  }

  const address = parseAddress(trimmed, line)
  return { start: address.value, end: address.value, family: address.family }
}

function familyBits(family: IpFamily): 32 | 128 {
  return family === 'ipv4' ? 32 : 128
}

function formatAddress(value: bigint, family: IpFamily): string {
  if (family === 'ipv4') {
    const parts: number[] = []
    for (let shift = 24n; shift >= 0n; shift -= 8n) parts.push(Number((value >> shift) & 0xffn))
    return parts.join('.')
  }

  const groups: number[] = []
  for (let index = 0; index < 8; index += 1) groups.push(Number((value >> BigInt(112 - index * 16)) & 0xffffn))
  let bestStart = -1
  let bestLength = 0
  for (let index = 0; index < 8; index += 1) {
    if (groups[index] !== 0) continue
    let length = 0
    while (index + length < 8 && groups[index + length] === 0) length += 1
    if (length > bestLength) {
      bestStart = index
      bestLength = length
    }
  }
  const hex = (group: number): string => group.toString(16)
  if (bestLength >= 2) {
    const left = groups.slice(0, bestStart).map(hex).join(':')
    const right = groups.slice(bestStart + bestLength).map(hex).join(':')
    return `${left}::${right}`
  }
  return groups.map(hex).join(':')
}

function spanToCidrs(span: Span): string[] {
  const bits = BigInt(familyBits(span.family))
  const cidrs: string[] = []
  let cursor = span.start
  while (cursor <= span.end) {
    let hostBits = 0n
    while (hostBits < bits) {
      const block = 1n << (hostBits + 1n)
      if (cursor % block !== 0n) break
      if (cursor + block - 1n > span.end) break
      hostBits += 1n
    }
    const prefix = Number(bits - hostBits)
    cidrs.push(`${formatAddress(cursor, span.family)}/${prefix}`)
    cursor += 1n << hostBits
  }
  return cidrs
}

function mergeSpans(spans: Span[]): Span[] {
  if (!spans.length) return []
  const sorted = [...spans].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
  const merged: Span[] = [{ ...sorted[0] }]
  for (const span of sorted.slice(1)) {
    const last = merged[merged.length - 1]
    if (span.start <= last.end + 1n) {
      if (span.end > last.end) last.end = span.end
    } else {
      merged.push({ ...span })
    }
  }
  return merged
}

function subtractSpans(base: Span, exclusions: Span[]): Span[] {
  const clipped = exclusions
    .filter((span) => span.end >= base.start && span.start <= base.end)
    .map((span) => ({ start: span.start < base.start ? base.start : span.start, end: span.end > base.end ? base.end : span.end, family: base.family }))
  const merged = mergeSpans(clipped)
  const result: Span[] = []
  let cursor = base.start
  for (const span of merged) {
    if (span.end < cursor) continue
    if (span.start > cursor) result.push({ start: cursor, end: span.start - 1n, family: base.family })
    cursor = span.end + 1n
    if (cursor > base.end) break
  }
  if (cursor <= base.end) result.push({ start: cursor, end: base.end, family: base.family })
  return result
}

function meaningfulLines(text: string): Array<{ text: string; line: number }> {
  return text
    .split(/\r?\n/)
    .map((raw, index) => ({ text: raw.trim(), line: index + 1 }))
    .filter((entry) => entry.text && !entry.text.startsWith('#'))
}

function ensureSingleFamily(entries: Array<{ span: Span; text: string; line: number }>): IpFamily {
  let family: IpFamily | null = null
  for (const entry of entries) {
    if (family && entry.span.family !== family) throw new IpError('mixedFamily', entry.text, entry.line)
    family = entry.span.family
  }
  return family ?? 'ipv4'
}

function failure(error: IpError, locale: Locale): ToolResult<IpRangeData> {
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

export const SAMPLE_MERGE = `10.0.0.0/25
10.0.0.128/25
192.168.1.5
192.168.1.6
# IPv6 单独计算（不能与 IPv4 混合）
# 2001:db8::/64
# 2001:db8:0:1::/64`

export const SAMPLE_RANGE = `192.168.1.0/24
10.0.0.1-10.0.0.6`

export const SAMPLE_EXCLUDE = `10.0.0.0/24
10.0.0.64/26
10.0.0.128/26`

export const SAMPLE_CONTAINS = `10.0.0.0/24
10.0.0.1
10.0.0.255
10.0.1.1`

export const run: ToolRun<IpRangeData> = (input, options, ctx): ToolResult<IpRangeData> => {
  const text = String(input ?? '')
  const lines = meaningfulLines(text)
  if (!lines.length) return failure(new IpError('empty'), ctx.locale)
  if (lines.length > MAX_LINES) return failure(new IpError('tooMany'), ctx.locale)

  const mode: IpRangeMode =
    options.mode === 'range' || options.mode === 'contains' || options.mode === 'exclude' ? options.mode : 'merge'

  try {
    const entries = lines.map((entry) => ({
      text: entry.text,
      line: entry.line,
      span: parseEntry(entry.text, entry.line),
    }))
    const family = ensureSingleFamily(entries)
    const warnings: string[] = []

    if (mode === 'merge') {
      const merged = mergeSpans(entries.map((entry) => entry.span))
      const rows: IpRangeRow[] = merged.map((span) => ({
        input: `${formatAddress(span.start, family)} - ${formatAddress(span.end, family)}`,
        start: formatAddress(span.start, family),
        end: formatAddress(span.end, family),
        cidrs: spanToCidrs(span),
      }))
      const output = rows.flatMap((row) => row.cidrs ?? []).join('\n')
      return {
        ok: true,
        output,
        data: { mode, family, rows, warnings },
        stats: { family, cidrs: rows.reduce((sum, row) => sum + (row.cidrs?.length ?? 0), 0), ranges: rows.length },
      }
    }

    if (mode === 'range') {
      const rows: IpRangeRow[] = entries.map((entry) => {
        if (entry.text.includes('/')) {
          return {
            input: entry.text,
            start: formatAddress(entry.span.start, family),
            end: formatAddress(entry.span.end, family),
          }
        }
        return { input: entry.text, cidrs: spanToCidrs(entry.span) }
      })
      const output = rows.map((row) => (row.cidrs ? row.cidrs.join('\n') : `${row.start} - ${row.end}`)).join('\n')
      return {
        ok: true,
        output,
        data: { mode, family, rows, warnings },
        stats: { family, rows: rows.length },
      }
    }

    const baseSpan = entries[0].span
    const base = {
      start: formatAddress(baseSpan.start, family),
      end: formatAddress(baseSpan.end, family),
      cidrs: spanToCidrs(baseSpan),
    }

    if (mode === 'contains') {
      const rows: IpRangeRow[] = entries.slice(1).map((entry) => ({
        input: entry.text,
        contained: entry.span.start >= baseSpan.start && entry.span.end <= baseSpan.end,
      }))
      const output = rows.map((row) => `${row.input}: ${row.contained ? 'true' : 'false'}`).join('\n')
      return {
        ok: true,
        output,
        data: { mode, family, base, rows, warnings },
        stats: { family, contained: rows.filter((row) => row.contained).length, tested: rows.length },
      }
    }

    const remaining = subtractSpans(baseSpan, entries.slice(1).map((entry) => entry.span))
    const rows: IpRangeRow[] = remaining.map((span) => ({
      input: `${formatAddress(span.start, family)} - ${formatAddress(span.end, family)}`,
      start: formatAddress(span.start, family),
      end: formatAddress(span.end, family),
      cidrs: spanToCidrs(span),
    }))
    const output = rows.flatMap((row) => row.cidrs ?? []).join('\n')
    return {
      ok: true,
      output,
      data: { mode, family, base, rows, warnings },
      stats: { family, cidrs: rows.reduce((sum, row) => sum + (row.cidrs?.length ?? 0), 0) },
    }
  } catch (error) {
    if (error instanceof IpError) return failure(error, ctx.locale)
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: { code: 'PLUGIN_ERROR', message } }
  }
}
