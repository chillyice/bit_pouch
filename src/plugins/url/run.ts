// URL 解析：使用平台自带 URL 解析器，再单独展开查询参数。
// 查询串手动按 & 切分：URLSearchParams 会合并重复键，而参数表需要保留原始顺序与重复项。
import type { Locale, ToolResult, ToolRun } from '@/core/types'

export const MAX_INPUT_LENGTH = 100_000

export interface UrlParam {
  key: string
  value: string
  rawKey: string
  rawValue: string
}

export interface UrlRunData {
  href: string
  protocol: string
  username: string
  password: string
  host: string
  hostname: string
  port: string
  pathname: string
  search: string
  hash: string
  origin: string
  params: UrlParam[]
}

export type UrlErrorCode = 'empty' | 'tooLong' | 'invalidUrl'

const MESSAGES: Record<UrlErrorCode, { zh: string; en: string }> = {
  empty: { zh: '请输入 URL', en: 'Enter a URL' },
  tooLong: { zh: `输入超过 ${MAX_INPUT_LENGTH} 个字符`, en: `Input exceeds ${MAX_INPUT_LENGTH} characters` },
  invalidUrl: { zh: '不是合法的绝对 URL（需要包含协议，如 https://）', en: 'Not a valid absolute URL (include a scheme such as https://)' },
}

function fail(code: UrlErrorCode, locale: Locale): ToolResult<UrlRunData> {
  return { ok: false, error: { code, message: MESSAGES[code][locale] } }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '))
  } catch {
    return value
  }
}

export function parseQuery(search: string): UrlParam[] {
  const source = search.replace(/^\?/, '')
  if (!source) return []
  return source
    .split('&')
    .filter((pair) => pair.length > 0)
    .map((pair) => {
      const separator = pair.indexOf('=')
      const rawKey = separator === -1 ? pair : pair.slice(0, separator)
      const rawValue = separator === -1 ? '' : pair.slice(separator + 1)
      return { key: safeDecode(rawKey), value: safeDecode(rawValue), rawKey, rawValue }
    })
}

export const run: ToolRun<UrlRunData> = (input, _options, ctx) => {
  const text = String(input ?? '').trim()
  if (!text) return fail('empty', ctx.locale)
  if (text.length > MAX_INPUT_LENGTH) return fail('tooLong', ctx.locale)

  let url: URL
  try {
    url = new URL(text)
  } catch {
    return fail('invalidUrl', ctx.locale)
  }

  const data: UrlRunData = {
    href: url.href,
    protocol: url.protocol,
    username: url.username,
    password: url.password,
    host: url.host,
    hostname: url.hostname,
    port: url.port,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
    origin: url.origin,
    params: parseQuery(url.search),
  }

  return {
    ok: true,
    output: JSON.stringify(data, null, 2),
    stats: { protocol: url.protocol, host: url.host || '—', params: data.params.length },
    data,
  }
}
