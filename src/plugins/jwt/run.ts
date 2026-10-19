// JWT 只读解析：拆出 header / payload / signature，判断 exp。
// 明确不验签：签名段按原始 Base64URL 文本展示，不调用任何加密库。
import type { Locale, ToolResult, ToolRun } from '@/core/types'

export const MAX_INPUT_LENGTH = 200_000

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Base64URL → 字节；不依赖 atob，主线程 / Worker / Node 测试行为一致。 */
export function base64UrlToBytes(segment: string): Uint8Array {
  const source = segment.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')
  const bytes: number[] = []
  let buffer = 0
  let bits = 0
  for (const char of source) {
    const value = B64_ALPHABET.indexOf(char)
    if (value < 0) throw new Error('invalid base64url')
    buffer = (buffer << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
      buffer &= (1 << bits) - 1
    }
  }
  return Uint8Array.from(bytes)
}

function decodeJsonObject(segment: string): Record<string, unknown> {
  const text = new TextDecoder().decode(base64UrlToBytes(segment))
  const value: unknown = JSON.parse(text)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object')
  return value as Record<string, unknown>
}

export type JwtErrorCode = 'empty' | 'tooLong' | 'invalidJwt' | 'invalidHeader' | 'invalidPayload'

export interface JwtRunData {
  header: Record<string, unknown>
  payload: Record<string, unknown>
  signature: { present: boolean; length: number }
  algorithm: string | null
  issuedAt: number | null
  expiresAt: number | null
  notBefore: number | null
  expired: boolean | null
  secondsLeft: number | null
}

const MESSAGES: Record<JwtErrorCode, { zh: string; en: string }> = {
  empty: { zh: '请粘贴 JWT', en: 'Paste a JWT' },
  tooLong: { zh: `输入超过 ${MAX_INPUT_LENGTH} 个字符`, en: `Input exceeds ${MAX_INPUT_LENGTH} characters` },
  invalidJwt: { zh: 'JWT 应为 2–3 段，以点号分隔', en: 'A JWT should have 2–3 dot-separated segments' },
  invalidHeader: { zh: '头部不是合法的 Base64URL JSON', en: 'Header is not valid Base64URL JSON' },
  invalidPayload: { zh: '载荷不是合法的 Base64URL JSON', en: 'Payload is not valid Base64URL JSON' },
}

function fail(code: JwtErrorCode, locale: Locale): ToolResult<JwtRunData> {
  return { ok: false, error: { code, message: MESSAGES[code][locale] } }
}

function secondsOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export const run: ToolRun<JwtRunData> = (input, _options, ctx) => {
  const token = String(input ?? '')
    .trim()
    .replace(/^Bearer\s+/i, '')
  if (!token) return fail('empty', ctx.locale)
  if (token.length > MAX_INPUT_LENGTH) return fail('tooLong', ctx.locale)

  const parts = token.split('.')
  if (parts.length < 2 || parts.length > 3) return fail('invalidJwt', ctx.locale)

  let header: Record<string, unknown>
  let payload: Record<string, unknown>
  try {
    header = decodeJsonObject(parts[0])
  } catch {
    return fail('invalidHeader', ctx.locale)
  }
  try {
    payload = decodeJsonObject(parts[1])
  } catch {
    return fail('invalidPayload', ctx.locale)
  }

  const nowSeconds = Date.now() / 1000
  const expiresAt = secondsOrNull(payload.exp)
  const issuedAt = secondsOrNull(payload.iat)
  const notBefore = secondsOrNull(payload.nbf)
  const expired = expiresAt === null ? null : expiresAt <= nowSeconds
  const secondsLeft = expiresAt === null ? null : Math.round(expiresAt - nowSeconds)
  const signatureRaw = parts[2] ?? ''
  const algorithm = typeof header.alg === 'string' ? header.alg : null

  return {
    ok: true,
    output: JSON.stringify(payload, null, 2),
    stats: {
      algorithm: algorithm ?? 'unknown',
      expired: expired === null ? 'n/a' : expired ? 'yes' : 'no',
      signature: signatureRaw ? `${signatureRaw.length} chars` : 'none',
    },
    data: {
      header,
      payload,
      signature: { present: signatureRaw.length > 0, length: signatureRaw.length },
      algorithm,
      issuedAt,
      expiresAt,
      notBefore,
      expired,
      secondsLeft,
    },
  }
}
