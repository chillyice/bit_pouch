// 字符编码转换的纯逻辑：Unicode 转义 / HTML 实体 / URL / Base64 / UTF-8 字节 / 逐字码位。
// 全部基于浏览器原生 API（TextEncoder/TextDecoder/btoa/atob）与手写循环，不引第三方库。
import type { Locale, ToolResult, ToolRun } from '@/core/types'

export const CODEC_FORMATS = ['unicode', 'html', 'url', 'base64', 'hex'] as const
export type CodecFormat = (typeof CODEC_FORMATS)[number]
export type CodecDirection = 'encode' | 'decode'

export type CodecErrorCode = 'invalidUrl' | 'invalidBase64' | 'invalidHex'

export class CodecError extends Error {
  code: CodecErrorCode

  constructor(code: CodecErrorCode) {
    super(code)
    this.code = code
  }
}

const hex = (n: number, pad = 2): string => n.toString(16).toUpperCase().padStart(pad, '0')

// 控制字符用可见符号显示，否则表格里是一片空白；换行/制表符用更常见的符号
const visibleChar = (cp: number): string => {
  if (cp === 0x0a) return '⏎'
  if (cp === 0x09) return '⇥'
  if (cp === 0x20) return '␠'
  if (cp < 0x20 || cp === 0x7f) return String.fromCodePoint(cp < 0x20 ? 0x2400 + cp : 0x2421)
  return String.fromCodePoint(cp)
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
}

const ESCAPED_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** 文本 → Unicode 转义：非 ASCII 才转，emoji 按 UTF-16 代理对输出 */
export function toUnicodeEscapes(text: string): string {
  let out = ''
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number
    if (cp < 0x80) {
      out += ch
    } else if (cp > 0xffff) {
      const off = cp - 0x10000
      out += `\\u${hex(0xd800 + (off >> 10), 4)}\\u${hex(0xdc00 + (off & 0x3ff), 4)}`
    } else {
      out += `\\u${hex(cp, 4)}`
    }
  }
  return out
}

/** Unicode 转义 → 文本：同时接受 \uXXXX、\u{XXXXX} 与 U+XXXX 三种写法 */
export function fromUnicodeEscapes(text: string): string {
  return text.replace(
    /\\u\{([0-9a-fA-F]{1,6})\}|\\u([0-9a-fA-F]{4})|U\+([0-9a-fA-F]{4,6})(?:\s+(?=U\+))?/g,
    (raw, braced: string, four: string, plus: string) => {
      const cp = parseInt(braced || four || plus, 16)
      return cp <= 0x10ffff ? String.fromCodePoint(cp) : raw
    },
  )
}

/** 文本 → HTML 实体：五个特殊字符用命名实体，其余非 ASCII 用十进制数字实体 */
export function toHtmlEntities(text: string): string {
  let out = ''
  for (const ch of text) {
    if (ESCAPED_ENTITIES[ch]) {
      out += ESCAPED_ENTITIES[ch]
      continue
    }
    const cp = ch.codePointAt(0) as number
    out += cp > 0x7e ? `&#${cp};` : ch
  }
  return out
}

/** HTML 实体 → 文本：支持 &#123;、&#x7B; 与常见命名实体 */
export function fromHtmlEntities(text: string): string {
  return text.replace(/&#x([0-9a-fA-F]+);|&#(\d+);|&([a-zA-Z][a-zA-Z0-9]*);/g, (raw, x: string, dec: string, name: string) => {
    if (x) {
      const cp = parseInt(x, 16)
      return cp <= 0x10ffff ? String.fromCodePoint(cp) : raw
    }
    if (dec) {
      const cp = parseInt(dec, 10)
      return cp <= 0x10ffff ? String.fromCodePoint(cp) : raw
    }
    const value = NAMED_ENTITIES[name.toLowerCase()]
    return value === undefined ? raw : value
  })
}

export const toUrlEncoded = (text: string): string => encodeURIComponent(text)

export function fromUrlEncoded(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    throw new CodecError('invalidUrl')
  }
}

/** 文本 → Base64（按 UTF-8 字节，分块避免大文本触发参数上限） */
export function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

/** Base64 → 文本：忽略空白，允许省略末尾 = */
export function fromBase64(text: string): string {
  const clean = text.replace(/\s+/g, '')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 === 1) throw new CodecError('invalidBase64')
  const padded = clean + '='.repeat((4 - (clean.length % 4)) % 4)
  let bin: string
  try {
    bin = atob(padded)
  } catch {
    throw new CodecError('invalidBase64')
  }
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder('utf-8').decode(bytes)
}

/** 文本 → UTF-8 字节（十六进制，空格分隔） */
export function toUtf8Hex(text: string): string {
  return Array.from(new TextEncoder().encode(text), (b) => hex(b)).join(' ')
}

/** UTF-8 字节 → 文本：接受空格/逗号/换行分隔，也接受 0x41、\x41、4142 这类写法 */
export function fromUtf8Hex(text: string): string {
  const cleaned = text
    .replace(/\\x/gi, '')
    .replace(/0x/gi, '')
    .replace(/[\s,]+/g, '')
  if (!cleaned || !/^[0-9a-fA-F]+$/.test(cleaned) || cleaned.length % 2) throw new CodecError('invalidHex')
  const bytes = new Uint8Array(cleaned.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16)
  return new TextDecoder('utf-8').decode(bytes)
}

export function encodeText(format: CodecFormat, text: string): string {
  switch (format) {
    case 'unicode':
      return toUnicodeEscapes(text)
    case 'html':
      return toHtmlEntities(text)
    case 'url':
      return toUrlEncoded(text)
    case 'base64':
      return toBase64(text)
    case 'hex':
      return toUtf8Hex(text)
    default:
      return text
  }
}

export type DecodeResult = { ok: true; text: string } | { ok: false; error: CodecErrorCode }

/**
 * 按格式解码。Unicode 转义没有「非法」概念（不符合模式的部分原样保留），因此不会失败。
 */
export function decodeText(format: CodecFormat, text: string): DecodeResult {
  try {
    switch (format) {
      case 'unicode':
        return { ok: true, text: fromUnicodeEscapes(text) }
      case 'html':
        return { ok: true, text: fromHtmlEntities(text) }
      case 'url':
        return { ok: true, text: fromUrlEncoded(text) }
      case 'base64':
        return { ok: true, text: fromBase64(text) }
      case 'hex':
        return { ok: true, text: fromUtf8Hex(text) }
      default:
        return { ok: true, text }
    }
  } catch (e) {
    return { ok: false, error: e instanceof CodecError ? e.code : 'invalidUrl' }
  }
}

export interface CharRow {
  char: string
  codePoint: string
  dec: number
  utf8: string
  entity: string
}

export interface CharTable {
  items: CharRow[]
  total: number
  truncated: boolean
}

/** 逐字码位表：字符 / 码位 / 十进制 / UTF-8 字节 / HTML 实体，最多取 limit 个字符 */
export function describeChars(text: string, limit = 500): CharTable {
  const items: CharRow[] = []
  let total = 0
  for (const ch of text) {
    total++
    if (items.length >= limit) continue
    const cp = ch.codePointAt(0) as number
    const entity = ESCAPED_ENTITIES[ch] ? ESCAPED_ENTITIES[ch] : cp < 0x20 || cp === 0x20 || cp > 0x7e ? `&#${cp};` : '—'
    items.push({
      char: visibleChar(cp),
      codePoint: `U+${hex(cp, cp > 0xffff ? 5 : 4)}`,
      dec: cp,
      utf8: toUtf8Hex(ch),
      entity,
    })
  }
  return { items, total, truncated: total > items.length }
}

const MESSAGES: Record<CodecErrorCode, { zh: string; en: string }> = {
  invalidUrl: { zh: 'URL 编码不合法', en: 'Invalid URL encoding' },
  invalidBase64: { zh: 'Base64 内容不合法', en: 'Invalid Base64' },
  invalidHex: { zh: '十六进制字节不合法（需为偶数位）', en: 'Invalid hex bytes (even length required)' },
}

export function codecErrorMessage(code: CodecErrorCode, locale: Locale): string {
  return MESSAGES[code][locale]
}

export interface CodecRunData {
  chars: CharTable
  format: CodecFormat
  direction: CodecDirection
}

export const run: ToolRun<CodecRunData> = (input, options, ctx): ToolResult<CodecRunData> => {
  const format = CODEC_FORMATS.includes(options.format as CodecFormat)
    ? (options.format as CodecFormat)
    : 'unicode'
  const direction: CodecDirection = options.direction === 'decode' ? 'decode' : 'encode'

  let output = ''
  if (direction === 'encode') {
    output = encodeText(format, input)
  } else {
    const decoded = decodeText(format, input)
    if (!decoded.ok) {
      return { ok: false, error: { code: decoded.error, message: codecErrorMessage(decoded.error, ctx.locale) } }
    }
    output = decoded.text
  }

  // 逐字表始终描述「语义文本」：编码时看原输入，解码时看还原结果。
  const semantic = direction === 'encode' ? input : output

  return {
    ok: true,
    output,
    stats: {
      chars: [...output].length,
      bytes: new TextEncoder().encode(output).length,
    },
    data: {
      chars: describeChars(semantic),
      format,
      direction,
    },
  }
}
