// UUID 工具：输入为空时批量生成 v4；输入非空时按 UUID 解析版本与变体。
// 随机源优先 Web Crypto，缺失时才退回 Math.random（仅影响生成质量，不影响解析）。
import type { Locale, ToolResult, ToolRun } from '@/core/types'

export const MAX_COUNT = 100

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface UuidParseResult {
  version: number
  variant: string
  normalized: string
}

export interface UuidRunData {
  mode: 'generate' | 'parse'
  uuids: string[]
  parsed: UuidParseResult | null
  uppercase: boolean
  hyphens: boolean
}

export type UuidErrorCode = 'invalidCount' | 'invalidUuid'

const MESSAGES: Record<UuidErrorCode, { zh: string; en: string }> = {
  invalidCount: { zh: `生成数量必须是 1–${MAX_COUNT} 的整数`, en: `Count must be an integer between 1 and ${MAX_COUNT}` },
  invalidUuid: { zh: '不是合法的 UUID（8-4-4-4-12 十六进制）', en: 'Not a valid UUID (8-4-4-4-12 hex)' },
}

function fail(code: UuidErrorCode, locale: Locale): ToolResult<UuidRunData> {
  return { ok: false, error: { code, message: MESSAGES[code][locale] } }
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  const cryptoObject = globalThis.crypto
  if (cryptoObject?.getRandomValues) {
    cryptoObject.getRandomValues(bytes)
    return bytes
  }
  for (let i = 0; i < length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  return bytes
}

export function uuidV4(): string {
  const bytes = randomBytes(16)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function parseUuid(raw: string): UuidParseResult | null {
  const value = raw.trim()
  if (!UUID_RE.test(value)) return null

  const version = Number.parseInt(value[14], 16)
  const variantBits = Number.parseInt(value[19], 16)
  let variant = 'Future'
  if ((variantBits & 0x8) === 0) variant = 'NCS'
  else if ((variantBits & 0xc) === 0x8) variant = 'RFC 4122'
  else if ((variantBits & 0xe) === 0xc) variant = 'Microsoft'

  return { version, variant, normalized: value.toLowerCase() }
}

function formatUuid(uuid: string, uppercase: boolean, hyphens: boolean): string {
  const value = hyphens ? uuid : uuid.replace(/-/g, '')
  return uppercase ? value.toUpperCase() : value.toLowerCase()
}

export const run: ToolRun<UuidRunData> = (input, options, ctx) => {
  const raw = String(input ?? '').trim()
  const uppercase = options.uppercase === true
  const hyphens = options.hyphens !== false

  if (raw) {
    const parsed = parseUuid(raw)
    if (!parsed) return fail('invalidUuid', ctx.locale)
    return {
      ok: true,
      output: parsed.normalized,
      stats: { version: parsed.version, variant: parsed.variant },
      data: { mode: 'parse', uuids: [parsed.normalized], parsed, uppercase, hyphens },
    }
  }

  const requested = Number(options.count ?? 1)
  if (!Number.isInteger(requested) || requested < 1 || requested > MAX_COUNT) return fail('invalidCount', ctx.locale)

  const uuids = Array.from({ length: requested }, () => formatUuid(uuidV4(), uppercase, hyphens))
  return {
    ok: true,
    output: uuids.join('\n'),
    stats: { count: uuids.length, version: 4, variant: 'RFC 4122' },
    data: { mode: 'generate', uuids, parsed: null, uppercase, hyphens },
  }
}
