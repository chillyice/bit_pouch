// Hash 计算：SHA 系列走 Web Crypto，MD5 自带实现（Web Crypto 不提供 MD5）。
// MD5 只用于校验/兼容旧系统，不应用于安全场景；界面需保留该提示。
import type { Locale, ToolResult, ToolRun } from '@/core/types'

export const HASH_ALGORITHMS = ['md5', 'sha1', 'sha256', 'sha384', 'sha512'] as const
export type HashAlgorithm = (typeof HASH_ALGORITHMS)[number]
export type HashFormat = 'hex' | 'base64'

export const MAX_INPUT_LENGTH = 1_000_000

const WEB_CRYPTO_NAMES: Record<Exclude<HashAlgorithm, 'md5'>, string> = {
  sha1: 'SHA-1',
  sha256: 'SHA-256',
  sha384: 'SHA-384',
  sha512: 'SHA-512',
}

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const MD5_SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
]

const MD5_K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x1_0000_0000) >>> 0)

/** RFC 1321 MD5；输入输出均为字节，避免把二进制先转成字符串。 */
export function md5(input: Uint8Array): Uint8Array {
  const bitLength = input.length * 8
  const paddedLength = (((input.length + 8) >> 6) + 1) << 6
  const buffer = new Uint8Array(paddedLength)
  buffer.set(input)
  buffer[input.length] = 0x80

  const view = new DataView(buffer.buffer)
  view.setUint32(paddedLength - 8, bitLength >>> 0, true)
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x1_0000_0000), true)

  let a0 = 0x67452301
  let b0 = 0xefcdab89
  let c0 = 0x98badcfe
  let d0 = 0x10325476
  const words = new Uint32Array(16)

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) words[i] = view.getUint32(offset + i * 4, true)

    let a = a0
    let b = b0
    let c = c0
    let d = d0

    for (let i = 0; i < 64; i += 1) {
      let f: number
      let g: number
      if (i < 16) {
        f = (b & c) | (~b & d)
        g = i
      } else if (i < 32) {
        f = (d & b) | (~d & c)
        g = (5 * i + 1) % 16
      } else if (i < 48) {
        f = b ^ c ^ d
        g = (3 * i + 5) % 16
      } else {
        f = c ^ (b | ~d)
        g = (7 * i) % 16
      }

      const previousD = d
      d = c
      c = b
      const sum = (a + f + MD5_K[i] + words[g]) >>> 0
      const shift = MD5_SHIFTS[i]
      b = (b + ((sum << shift) | (sum >>> (32 - shift)))) >>> 0
      a = previousD
    }

    a0 = (a0 + a) >>> 0
    b0 = (b0 + b) >>> 0
    c0 = (c0 + c) >>> 0
    d0 = (d0 + d) >>> 0
  }

  const output = new Uint8Array(16)
  const outputView = new DataView(output.buffer)
  outputView.setUint32(0, a0, true)
  outputView.setUint32(4, b0, true)
  outputView.setUint32(8, c0, true)
  outputView.setUint32(12, d0, true)
  return output
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return out
}

export function bytesToBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = bytes[i + 1] ?? 0
    const b2 = bytes[i + 2] ?? 0
    const triplet = (b0 << 16) | (b1 << 8) | b2
    out += B64_ALPHABET[(triplet >> 18) & 63]
    out += B64_ALPHABET[(triplet >> 12) & 63]
    out += i + 1 < bytes.length ? B64_ALPHABET[(triplet >> 6) & 63] : '='
    out += i + 2 < bytes.length ? B64_ALPHABET[triplet & 63] : '='
  }
  return out
}

export type HashErrorCode = 'invalidAlgorithm' | 'tooLong' | 'cryptoUnavailable'

export interface HashRunData {
  algorithm: HashAlgorithm
  hex: string
  base64: string
  hexLength: number
  byteLength: number
  format: HashFormat
}

const MESSAGES: Record<HashErrorCode, { zh: string; en: string }> = {
  invalidAlgorithm: { zh: '不支持的 Hash 算法', en: 'Unsupported hash algorithm' },
  tooLong: { zh: `输入超过 ${MAX_INPUT_LENGTH} 个字符`, en: `Input exceeds ${MAX_INPUT_LENGTH} characters` },
  cryptoUnavailable: {
    zh: '当前环境不支持 Web Crypto，请改用桌面端或安全上下文',
    en: 'Web Crypto is unavailable; use the desktop app or a secure context',
  },
}

function fail(code: HashErrorCode, locale: Locale): ToolResult<HashRunData> {
  return { ok: false, error: { code, message: MESSAGES[code][locale] } }
}

export function isHashAlgorithm(value: unknown): value is HashAlgorithm {
  return typeof value === 'string' && (HASH_ALGORITHMS as readonly string[]).includes(value)
}

export const run: ToolRun<HashRunData> = async (input, options, ctx) => {
  const algorithm = options.algorithm ?? 'sha256'
  if (!isHashAlgorithm(algorithm)) return fail('invalidAlgorithm', ctx.locale)
  const format: HashFormat = options.format === 'base64' ? 'base64' : 'hex'

  const text = String(input ?? '')
  if (text.length > MAX_INPUT_LENGTH) return fail('tooLong', ctx.locale)

  const bytes = new TextEncoder().encode(text)
  let digest: Uint8Array

  if (algorithm === 'md5') {
    digest = md5(bytes)
  } else {
    const subtle = globalThis.crypto?.subtle
    if (!subtle) return fail('cryptoUnavailable', ctx.locale)
    const result = await subtle.digest(WEB_CRYPTO_NAMES[algorithm], bytes)
    digest = new Uint8Array(result)
  }

  const hex = bytesToHex(digest)
  const base64 = bytesToBase64(digest)

  return {
    ok: true,
    output: format === 'base64' ? base64 : hex,
    stats: { algorithm, bytes: bytes.length, hexLength: hex.length },
    data: { algorithm, hex, base64, hexLength: hex.length, byteLength: bytes.length, format },
  }
}
