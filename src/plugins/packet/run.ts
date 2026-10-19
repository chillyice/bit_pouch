// 报文解析的纯逻辑：十六进制/文本转字节、按字段模板切分、逐字节描述与常见校验值。
// 全部基于浏览器原生 API，不引第三方库；失败只抛带 code 的 PacketError。
import type { Locale, ToolResult, ToolRun } from '@/core/types'

export const PACKET_MAX_BYTES = 65536
export const BYTE_ROW_LIMIT = 512

export type PacketErrorCode = 'invalidHex' | 'oddHex' | 'tooLong'

export class PacketError extends Error {
  code: PacketErrorCode
  limit?: number

  constructor(code: PacketErrorCode, extra: { limit?: number } = {}) {
    super(code)
    this.name = 'PacketError'
    this.code = code
    this.limit = extra.limit
  }
}

/** 十六进制报文 → 字节：接受空格/逗号/冒号/换行分隔，也接受连续写法与 0xAA、\xAA 前缀 */
export function parseHexBytes(text: string, maxBytes = PACKET_MAX_BYTES): Uint8Array {
  const cleaned = String(text)
    .replace(/0x/gi, '')
    .replace(/\\x/gi, '')
    .replace(/[\s,;:，、]+/g, '')
  if (!cleaned) return new Uint8Array(0)
  if (!/^[0-9a-fA-F]+$/.test(cleaned)) throw new PacketError('invalidHex')
  if (cleaned.length % 2) throw new PacketError('oddHex')
  if (cleaned.length / 2 > maxBytes) throw new PacketError('tooLong', { limit: maxBytes })
  const bytes = new Uint8Array(cleaned.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

/** 文本 → UTF-8 字节 */
export const encodeUtf8 = (text: string): Uint8Array => new TextEncoder().encode(String(text))

export interface FieldDef {
  name: string
  length: number
}

export interface InvalidTemplateLine {
  line: number
  text: string
}

export interface ParsedTemplate {
  fields: FieldDef[]
  invalid: InvalidTemplateLine[]
  total: number
}

/**
 * 字段模板 → 字段定义：每行「名称 + 分隔符 + 字节数」，例如 帧头 2 / 长度:2 / 数据,4。
 * 支持 # 注释、行尾注释与可选单位（字节/B/bytes）；无法识别的行按行号回报。
 */
export function parseFieldTemplate(text: string): ParsedTemplate {
  const fields: FieldDef[] = []
  const invalid: InvalidTemplateLine[] = []
  String(text)
    .split(/\r?\n/)
    .forEach((raw, i) => {
      const line = raw.trim()
      if (!line || line.startsWith('#')) return
      const m = line.match(/^(.+?)\s*(?::|：|,|，|\s)\s*(\d+)\s*(?:字节|bytes?|B)?\s*(?:#.*)?$/i)
      const name = m ? m[1].trim() : ''
      const length = m ? Number(m[2]) : NaN
      if (!m || !name || !Number.isSafeInteger(length) || length < 0) {
        invalid.push({ line: i + 1, text: line })
        return
      }
      fields.push({ name, length })
    })
  return { fields, invalid, total: fields.reduce((sum, f) => sum + f.length, 0) }
}

export interface FieldRow {
  name: string
  offset: number
  declared: number
  length: number
  truncated: boolean
  bytes: Uint8Array
}

export interface SplitResult {
  rows: FieldRow[]
  rest: { offset: number; bytes: Uint8Array }
}

/**
 * 按字段模板顺序切分字节。报文不足时字段标 truncated（只取到现有字节），
 * 模板未覆盖的尾部放在 rest；模板为空时全部字节都是 rest。
 */
export function splitFields(bytes: Uint8Array, fields: FieldDef[]): SplitResult {
  const rows: FieldRow[] = []
  let offset = 0
  for (const field of fields) {
    const available = Math.max(0, bytes.length - offset)
    const take = Math.min(field.length, available)
    rows.push({
      name: field.name,
      offset,
      declared: field.length,
      length: take,
      truncated: take < field.length,
      bytes: bytes.subarray(offset, offset + take),
    })
    offset += take
  }
  return { rows, rest: { offset, bytes: bytes.subarray(Math.min(offset, bytes.length)) } }
}

const asciiChar = (byte: number): string => {
  if (byte === 0x20) return '␠'
  return byte > 0x20 && byte < 0x7f ? String.fromCharCode(byte) : '·'
}

export const hexOf = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')

export const asciiOf = (bytes: Uint8Array): string => Array.from(bytes, asciiChar).join('')

export interface ByteRow {
  offset: number
  hex: string
  dec: number
  bin: string
  ascii: string
}

export interface ByteTable {
  rows: ByteRow[]
  total: number
  truncated: boolean
}

/** 逐字节拆解：偏移 / HEX / 十进制 / 二进制 / 可见 ASCII，最多 limit 行 */
export function describeBytes(bytes: Uint8Array, limit = BYTE_ROW_LIMIT): ByteTable {
  const count = Math.min(bytes.length, limit)
  const rows: ByteRow[] = []
  for (let i = 0; i < count; i++) {
    const b = bytes[i]
    rows.push({
      offset: i,
      hex: b.toString(16).toUpperCase().padStart(2, '0'),
      dec: b,
      bin: b.toString(2).padStart(8, '0'),
      ascii: asciiChar(b),
    })
  }
  return { rows, total: bytes.length, truncated: bytes.length > count }
}

/** 字段数值按大端解释（网络序）；超过 maxBytes 或为空时返回 null，避免误读长数据段 */
export function bigEndianValue(bytes: Uint8Array, maxBytes = 8): bigint | null {
  if (!bytes.length || bytes.length > maxBytes) return null
  let value = 0n
  for (const b of bytes) value = (value << 8n) | BigInt(b)
  return value
}

export interface Checksums {
  sum8: string
  xor8: string
  sum16: string
  crc16: string
}

function computeChecksums(bytes: Uint8Array): Checksums {
  let sum8 = 0
  let xor8 = 0
  let sum16 = 0
  let crc16 = 0xffff
  for (const b of bytes) {
    sum8 = (sum8 + b) & 0xff
    xor8 ^= b
    sum16 = (sum16 + b) & 0xffff
    crc16 ^= b
    for (let i = 0; i < 8; i++) crc16 = crc16 & 1 ? (crc16 >>> 1) ^ 0xa001 : crc16 >>> 1
  }
  const pad = (v: number, n: number): string => v.toString(16).toUpperCase().padStart(n, '0')
  return { sum8: pad(sum8, 2), xor8: pad(xor8, 2), sum16: pad(sum16, 4), crc16: pad(crc16, 4) }
}

/** 校验值参考：整包与「除末尾 2 字节」两种口径，便于和报文尾部校验位对照 */
export function checksumSet(bytes: Uint8Array): { full: Checksums; body: Checksums } {
  return {
    full: computeChecksums(bytes),
    body: computeChecksums(bytes.subarray(0, Math.max(0, bytes.length - 2))),
  }
}

export const CHECKSUM_ALGORITHMS = ['sum8', 'xor8', 'sum16', 'crc16'] as const

const MESSAGES: Record<PacketErrorCode, { zh: string; en: string }> = {
  invalidHex: { zh: '包含非十六进制字符', en: 'Contains non-hex characters' },
  oddHex: { zh: '十六进制位数必须为偶数', en: 'Hex length must be even' },
  tooLong: { zh: `报文超过 ${PACKET_MAX_BYTES} 字节上限`, en: `Packet exceeds the ${PACKET_MAX_BYTES} byte limit` },
}

export function packetErrorMessage(code: PacketErrorCode, locale: Locale): string {
  return MESSAGES[code][locale]
}

export interface PacketFieldView extends Omit<FieldRow, 'bytes'> {
  bytes: number[]
  hex: string
  ascii: string
  int: string | null
}

export interface PacketRunData {
  byteCount: number
  hex: string
  ascii: string
  fields: FieldDef[]
  invalid: InvalidTemplateLine[]
  split: {
    rows: PacketFieldView[]
    rest: { offset: number; bytes: number[]; hex: string; ascii: string }
  }
  rows: ByteRow[]
  truncated: boolean
  checksums: { full: Checksums; body: Checksums }
}

export const run: ToolRun<PacketRunData> = (input, options, ctx): ToolResult<PacketRunData> => {
  const mode = options.mode === 'text' ? 'text' : 'hex'
  const template = typeof options.template === 'string' ? options.template : ''

  let bytes: Uint8Array
  try {
    bytes = mode === 'hex' ? parseHexBytes(input) : encodeUtf8(input)
  } catch (error) {
    if (!(error instanceof PacketError)) throw error
    return { ok: false, error: { code: error.code, message: packetErrorMessage(error.code, ctx.locale) } }
  }

  const parsed = parseFieldTemplate(template)
  const split = splitFields(bytes, parsed.fields)
  const byteTable = describeBytes(bytes)

  const rows: PacketFieldView[] = split.rows.map((row) => {
    const value = bigEndianValue(row.bytes)
    return {
      ...row,
      bytes: Array.from(row.bytes),
      hex: hexOf(row.bytes),
      ascii: asciiOf(row.bytes),
      int: value === null ? null : value.toString(10),
    }
  })

  return {
    ok: true,
    output: hexOf(bytes),
    stats: {
      bytes: bytes.length,
      fields: parsed.fields.length,
      rows: byteTable.rows.length,
    },
    data: {
      byteCount: bytes.length,
      hex: hexOf(bytes),
      ascii: asciiOf(bytes),
      fields: parsed.fields,
      invalid: parsed.invalid,
      split: {
        rows,
        rest: {
          offset: split.rest.offset,
          bytes: Array.from(split.rest.bytes),
          hex: hexOf(split.rest.bytes),
          ascii: asciiOf(split.rest.bytes),
        },
      },
      rows: byteTable.rows,
      truncated: byteTable.truncated,
      checksums: checksumSet(bytes),
    },
  }
}
