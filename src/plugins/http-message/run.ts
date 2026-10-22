// 原始 HTTP/1.x 报文解析与生成。纯函数，运行在 Worker。
// 不发起任何网络请求；Cookie / Authorization 只在本次调用内存在。
import type { Locale, ToolResult, ToolRun } from '@/core/types'

export interface HttpMessageOptions {
  mode?: 'parse' | 'build'
  kind?: 'auto' | 'request' | 'response'
  lineEnding?: 'crlf' | 'lf'
  autoContentLength?: boolean
}

export interface HeaderEntry {
  name: string
  value: string
  rawName: string
}

export interface CookieEntry {
  name: string
  value: string
  attributes: Record<string, string>
}

export interface QueryEntry {
  key: string
  value: string
}

export interface MultipartPart {
  name: string
  filename?: string
  contentType?: string
  bytes: number
  preview: string
}

export interface ChunkInfo {
  size: number
  bytes: number
}

export interface BodyInfo {
  raw: string
  bytes: number
  encoding: 'utf8' | 'binary' | 'empty'
  contentType: string
  json?: unknown
  form?: QueryEntry[]
  multipart?: MultipartPart[]
  chunks?: ChunkInfo[]
}

export interface HttpMessageData {
  kind: 'request' | 'response'
  request?: { method: string; target: string; version: string }
  response?: { version: string; status: number; reason: string }
  headers: HeaderEntry[]
  cookies: CookieEntry[]
  query: QueryEntry[]
  body: BodyInfo
  warnings: string[]
}

const MAX_INPUT = 1_000_000
const MAX_HEADERS = 500
const TOKEN_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
const VERSION_RE = /^HTTP\/\d(?:\.\d)?$/

type ErrorCode =
  | 'empty'
  | 'tooLarge'
  | 'invalidStartLine'
  | 'unsupportedVersion'
  | 'invalidHeader'
  | 'tooManyHeaders'
  | 'invalidContentLength'
  | 'truncatedBody'
  | 'invalidChunk'
  | 'unsupportedTransferEncoding'
  | 'invalidBuildInput'

type WarningCode =
  | 'mixedLineEndings'
  | 'obsoleteLineFolding'
  | 'conflictingLength'
  | 'lengthMissing'
  | 'contentEncodingNotDecoded'
  | 'invalidJsonBody'
  | 'invalidMultipart'
  | 'binaryBody'
  | 'invalidPercentEncoding'

const ERROR_TEXT: Record<ErrorCode, { zh: string; en: string }> = {
  empty: { zh: '内容为空', en: 'Input is empty' },
  tooLarge: { zh: '输入超过 1,000,000 字符', en: 'Input exceeds 1,000,000 characters' },
  invalidStartLine: { zh: '起始行无法识别', en: 'Unrecognized start line' },
  unsupportedVersion: {
    zh: '只支持 HTTP/1.0 与 HTTP/1.1 明文报文',
    en: 'Only HTTP/1.0 and HTTP/1.1 plain-text messages are supported',
  },
  invalidHeader: { zh: '头部不合法', en: 'Invalid header' },
  tooManyHeaders: { zh: '头部数量超过 500', en: 'More than 500 headers' },
  invalidContentLength: { zh: 'Content-Length 不合法', en: 'Invalid Content-Length' },
  truncatedBody: { zh: '正文长度不足', en: 'Body is shorter than declared' },
  invalidChunk: { zh: 'chunked 块格式错误', en: 'Malformed chunked encoding' },
  unsupportedTransferEncoding: {
    zh: '不支持的 Transfer-Encoding',
    en: 'Unsupported Transfer-Encoding',
  },
  invalidBuildInput: { zh: '生成输入不合法', en: 'Invalid build input' },
}

const WARNING_TEXT: Record<WarningCode, { zh: string; en: string }> = {
  mixedLineEndings: { zh: '输入同时包含 CRLF 与 LF', en: 'Input mixes CRLF and LF' },
  obsoleteLineFolding: { zh: '头部折行已按规范废弃', en: 'Obsolete header line folding' },
  conflictingLength: {
    zh: '同时存在 Transfer-Encoding 与 Content-Length，以 chunked 为准',
    en: 'Both Transfer-Encoding and Content-Length present; chunked wins',
  },
  lengthMissing: {
    zh: '正文没有长度声明，按剩余内容读取',
    en: 'No body length declared; reading the remaining content',
  },
  contentEncodingNotDecoded: {
    zh: '正文经内容编码压缩，未解压，仅提供十六进制预览',
    en: 'Body is content-encoded and was not decoded; hex preview only',
  },
  invalidJsonBody: { zh: 'Content-Type 声明 JSON，但正文解析失败', en: 'JSON body could not be parsed' },
  invalidMultipart: { zh: 'multipart 分段不完整', en: 'Incomplete multipart section' },
  binaryBody: { zh: '正文包含二进制数据，仅提供十六进制预览', en: 'Binary body; hex preview only' },
  invalidPercentEncoding: { zh: '百分号编码不合法，按原文保留', en: 'Malformed percent-encoding kept as-is' },
}

const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  301: 'Moved Permanently',
  302: 'Found',
  304: 'Not Modified',
  307: 'Temporary Redirect',
  308: 'Permanent Redirect',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  418: "I'm a teapot",
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
}

class HttpError extends Error {
  code: ErrorCode
  line?: number
  column?: number
  detail?: string

  constructor(code: ErrorCode, detail?: string, line?: number, column?: number) {
    super(code)
    this.code = code
    this.detail = detail
    this.line = line
    this.column = column
  }
}

type Warner = (code: WarningCode, detail?: string) => void

function makeWarner(locale: Locale): { warn: Warner; warnings: string[] } {
  const warnings: string[] = []
  const seen = new Set<string>()
  const warn: Warner = (code, detail) => {
    const key = `${code}:${detail ?? ''}`
    if (seen.has(key)) return
    seen.add(key)
    const text = WARNING_TEXT[code][locale]
    warnings.push(detail ? `${code}: ${text} (${detail})` : `${code}: ${text}`)
  }
  return { warn, warnings }
}

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8')

function byteLength(text: string): number {
  return encoder.encode(text).length
}

function hexPreview(bytes: Uint8Array, limit = 2048): string {
  const slice = bytes.subarray(0, limit)
  const parts: string[] = []
  for (const byte of slice) parts.push(byte.toString(16).padStart(2, '0'))
  return parts.join(' ') + (bytes.length > limit ? ' …' : '')
}

function decodePercent(text: string, warn: Warner): string {
  try {
    return decodeURIComponent(text.replace(/\+/g, ' '))
  } catch {
    warn('invalidPercentEncoding', text.slice(0, 64))
    return text
  }
}

function splitHeadBody(text: string): { head: string; body: string } {
  const match = /\r?\n\r?\n/.exec(text)
  if (!match) return { head: text, body: '' }
  return { head: text.slice(0, match.index), body: text.slice(match.index + match[0].length) }
}

function parseHeaderBlock(lines: string[], startLine: number, warn: Warner): HeaderEntry[] {
  const headers: HeaderEntry[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line) continue

    if (/^[ \t]/.test(line)) {
      const previous = headers[headers.length - 1]
      if (!previous) throw new HttpError('invalidHeader', line, startLine + index, 1)
      warn('obsoleteLineFolding')
      previous.value = `${previous.value} ${line.trim()}`
      continue
    }

    const colon = line.indexOf(':')
    if (colon <= 0) throw new HttpError('invalidHeader', line, startLine + index, 1)
    const name = line.slice(0, colon)
    if (!TOKEN_RE.test(name)) throw new HttpError('invalidHeader', name, startLine + index, 1)
    headers.push({ name: name.toLowerCase(), rawName: name, value: line.slice(colon + 1).replace(/^[ \t]+|[ \t]+$/g, '') })
    if (headers.length > MAX_HEADERS) throw new HttpError('tooManyHeaders')
  }
  return headers
}

function headerValues(headers: HeaderEntry[], name: string): string[] {
  const lower = name.toLowerCase()
  return headers.filter((header) => header.name.toLowerCase() === lower).map((header) => header.value)
}

function firstHeader(headers: HeaderEntry[], name: string): string | undefined {
  return headerValues(headers, name)[0]
}

function parseStartLine(line: string, kindOption: 'auto' | 'request' | 'response'): HttpMessageData['kind'] {
  const looksResponse = line.startsWith('HTTP/')
  if (kindOption === 'request' && looksResponse) throw new HttpError('invalidStartLine', line, 1, 1)
  if (kindOption === 'response' && !looksResponse) throw new HttpError('invalidStartLine', line, 1, 1)

  if (looksResponse || kindOption === 'response') {
    const match = /^(HTTP\/\d(?:\.\d)?)\s+(\d{3})(?:\s+(.*))?$/.exec(line)
    if (!match) throw new HttpError('invalidStartLine', line, 1, 1)
    if (!/^HTTP\/1\.[01]$/.test(match[1])) throw new HttpError('unsupportedVersion', match[1], 1, 1)
    return 'response'
  }

  const match = /^([!#$%&'*+\-.^_`|~0-9A-Za-z]+)\s+(\S+)\s+(HTTP\/\d(?:\.\d)?)$/.exec(line)
  if (!match) throw new HttpError('invalidStartLine', line, 1, 1)
  if (!/^HTTP\/1\.[01]$/.test(match[3])) throw new HttpError('unsupportedVersion', match[3], 1, 1)
  return 'request'
}

function parseBody(bodyText: string, headers: HeaderEntry[], warn: Warner): BodyInfo {
  const transferEncoding = firstHeader(headers, 'transfer-encoding')
  const contentLength = firstHeader(headers, 'content-length')
  const contentEncoding = (firstHeader(headers, 'content-encoding') ?? '').toLowerCase()
  const contentType = firstHeader(headers, 'content-type') ?? ''

  let bytes: Uint8Array
  let chunks: ChunkInfo[] | undefined

  if (transferEncoding && contentLength) warn('conflictingLength')

  if (transferEncoding) {
    const tokens = transferEncoding.split(',').map((token) => token.trim().toLowerCase())
    if (!tokens.length || tokens[tokens.length - 1] !== 'chunked') {
      throw new HttpError('unsupportedTransferEncoding', transferEncoding)
    }
    const parsed = parseChunkedText(bodyText, headers)
    bytes = parsed.bytes
    chunks = parsed.chunks
  } else if (contentLength !== undefined) {
    if (!/^\d+$/.test(contentLength.trim())) throw new HttpError('invalidContentLength', contentLength)
    const declared = Number(contentLength.trim())
    const encoded = encoder.encode(bodyText)
    if (encoded.length < declared) throw new HttpError('truncatedBody', `${encoded.length} < ${declared}`)
    bytes = encoded.slice(0, declared)
  } else {
    bytes = encoder.encode(bodyText)
    if (bytes.length > 0) warn('lengthMissing')
  }

  const raw = decoder.decode(bytes)
  let encoding: BodyInfo['encoding'] = bytes.length === 0 ? 'empty' : 'utf8'
  let preview = raw

  if (/gzip|br|deflate/.test(contentEncoding)) {
    warn('contentEncodingNotDecoded')
    encoding = 'binary'
    preview = hexPreview(bytes)
  } else if (raw.includes('\uFFFD')) {
    warn('binaryBody')
    encoding = 'binary'
    preview = hexPreview(bytes)
  }

  const info: BodyInfo = { raw: preview, bytes: bytes.length, encoding, contentType, chunks }

  if (encoding === 'utf8') {
    const mediaType = contentType.split(';')[0].trim().toLowerCase()
    if (mediaType === 'application/json' || mediaType.endsWith('+json')) {
      try {
        info.json = JSON.parse(raw)
      } catch {
        warn('invalidJsonBody')
      }
    } else if (mediaType === 'application/x-www-form-urlencoded') {
      info.form = parseForm(raw, warn)
    } else if (mediaType === 'multipart/form-data') {
      const boundary = /boundary="?([^";]+)"?/i.exec(contentType)?.[1]
      if (!boundary) warn('invalidMultipart', 'missing boundary')
      else info.multipart = parseMultipart(raw, boundary, warn)
    }
  }

  return info
}

function parseChunkedText(bodyText: string, headers: HeaderEntry[]): { bytes: Uint8Array; chunks: ChunkInfo[] } {
  const source = encoder.encode(bodyText)
  const chunks: ChunkInfo[] = []
  const collected: Uint8Array[] = []
  let position = 0
  let terminated = false

  while (position < source.length) {
    const line = readLine(source, position)
    if (!line) throw new HttpError('truncatedBody')
    const sizeText = line.text.split(';')[0].trim()
    if (!/^[0-9a-fA-F]+$/.test(sizeText)) throw new HttpError('invalidChunk', line.text.slice(0, 80))
    const size = parseInt(sizeText, 16)
    position = line.next

    if (size === 0) {
      terminated = true
      // trailer 一直读到空行
      while (position < source.length) {
        const trailer = readLine(source, position)
        if (!trailer) break
        position = trailer.next
        if (!trailer.text) break
        const colon = trailer.text.indexOf(':')
        if (colon > 0) {
          const name = trailer.text.slice(0, colon)
          if (TOKEN_RE.test(name)) {
            headers.push({
              name: name.toLowerCase(),
              rawName: name,
              value: trailer.text.slice(colon + 1).replace(/^[ \t]+|[ \t]+$/g, ''),
            })
          }
        }
      }
      break
    }

    if (position + size > source.length) throw new HttpError('truncatedBody')
    collected.push(source.slice(position, position + size))
    chunks.push({ size, bytes: size })
    position += size
    if (source[position] === 13 && source[position + 1] === 10) position += 2
    else if (source[position] === 10) position += 1
    else throw new HttpError('invalidChunk', 'missing CRLF after chunk')
  }

  if (!terminated) throw new HttpError('truncatedBody')
  const total = collected.reduce((sum, chunk) => sum + chunk.length, 0)
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of collected) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return { bytes, chunks }
}

function readLine(bytes: Uint8Array, start: number): { text: string; next: number } | null {
  for (let index = start; index < bytes.length; index += 1) {
    if (bytes[index] !== 10) continue
    let end = index
    if (end > start && bytes[end - 1] === 13) end -= 1
    return { text: decoder.decode(bytes.subarray(start, end)), next: index + 1 }
  }
  return null
}

function parseForm(body: string, warn: Warner): QueryEntry[] {
  if (!body.trim()) return []
  return body.split('&').map((pair) => {
    const index = pair.indexOf('=')
    const rawKey = index < 0 ? pair : pair.slice(0, index)
    const rawValue = index < 0 ? '' : pair.slice(index + 1)
    return { key: decodePercent(rawKey, warn), value: decodePercent(rawValue, warn) }
  })
}

function parseMultipart(body: string, boundary: string, warn: Warner): MultipartPart[] {
  const delimiter = `--${boundary}`
  const segments = body.split(delimiter)
  const parts: MultipartPart[] = []

  for (let index = 1; index < segments.length; index += 1) {
    let segment = segments[index]
    if (segment.startsWith('--')) break
    segment = segment.replace(/^\r?\n/, '').replace(/\r?\n$/, '')
    const separator = /\r?\n\r?\n/.exec(segment)
    if (!separator) {
      warn('invalidMultipart', 'missing header separator')
      continue
    }
    const headText = segment.slice(0, separator.index)
    const content = segment.slice(separator.index + separator[0].length)
    const partHeaders = new Map<string, string>()
    for (const line of headText.split(/\r?\n/)) {
      const colon = line.indexOf(':')
      if (colon <= 0) {
        warn('invalidMultipart', line.slice(0, 60))
        continue
      }
      partHeaders.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim())
    }
    const disposition = partHeaders.get('content-disposition') ?? ''
    const name = /(?:^|;)\s*name="([^"]*)"/i.exec(disposition)?.[1]
    if (name === undefined) warn('invalidMultipart', 'missing name')
    parts.push({
      name: name ?? '',
      filename: /(?:^|;)\s*filename="([^"]*)"/i.exec(disposition)?.[1],
      contentType: partHeaders.get('content-type'),
      bytes: byteLength(content),
      preview: content.slice(0, 2048),
    })
  }

  return parts
}

function parseCookies(headers: HeaderEntry[]): CookieEntry[] {
  const cookies: CookieEntry[] = []
  for (const header of headers) {
    const name = header.name.toLowerCase()
    if (name === 'cookie') {
      for (const part of header.value.split(';')) {
        const index = part.indexOf('=')
        if (index < 0) continue
        cookies.push({
          name: part.slice(0, index).trim(),
          value: part.slice(index + 1).trim(),
          attributes: {},
        })
      }
    } else if (name === 'set-cookie') {
      const segments = header.value.split(';')
      const first = segments.shift() ?? ''
      const index = first.indexOf('=')
      const cookie: CookieEntry = {
        name: index < 0 ? first.trim() : first.slice(0, index).trim(),
        value: index < 0 ? '' : first.slice(index + 1).trim(),
        attributes: {},
      }
      for (const segment of segments) {
        const eq = segment.indexOf('=')
        const key = (eq < 0 ? segment : segment.slice(0, eq)).trim().toLowerCase()
        if (!key) continue
        cookie.attributes[key] = eq < 0 ? '' : segment.slice(eq + 1).trim()
      }
      cookies.push(cookie)
    }
  }
  return cookies
}

function parseQuery(target: string, warn: Warner): QueryEntry[] {
  const question = target.indexOf('?')
  if (question < 0) return []
  let query = target.slice(question + 1)
  const hash = query.indexOf('#')
  if (hash >= 0) query = query.slice(0, hash)
  if (!query) return []
  return query.split('&').map((pair) => {
    const index = pair.indexOf('=')
    const rawKey = index < 0 ? pair : pair.slice(0, index)
    const rawValue = index < 0 ? '' : pair.slice(index + 1)
    return { key: decodePercent(rawKey, warn), value: decodePercent(rawValue, warn) }
  })
}

function parseMessage(text: string, options: HttpMessageOptions, locale: Locale): ToolResult<HttpMessageData> {
  const { warn, warnings } = makeWarner(locale)

  if (/^PRI \* HTTP\/2\.0/.test(text.trimStart())) throw new HttpError('unsupportedVersion', 'HTTP/2 preface')
  if (/\r\n/.test(text) && /(^|[^\r])\n/.test(text)) warn('mixedLineEndings')

  const trimmed = text.replace(/^(?:\r?\n)+/, '')
  const { head, body } = splitHeadBody(trimmed)
  const lines = head.split(/\r?\n/)
  if (!lines.length || !lines[0].trim()) throw new HttpError('invalidStartLine', '', 1, 1)

  const kindOption = options.kind ?? 'auto'
  const kind = parseStartLine(lines[0], kindOption)

  const headers = parseHeaderBlock(lines.slice(1), 2, warn)
  const cookies = parseCookies(headers)
  let request: HttpMessageData['request']
  let response: HttpMessageData['response']

  if (kind === 'response') {
    const match = /^(HTTP\/\d(?:\.\d)?)\s+(\d{3})(?:\s+(.*))?$/.exec(lines[0])
    if (!match) throw new HttpError('invalidStartLine', lines[0], 1, 1)
    response = { version: match[1], status: Number(match[2]), reason: match[3] ?? '' }
  } else {
    const match = /^([!#$%&'*+\-.^_`|~0-9A-Za-z]+)\s+(\S+)\s+(HTTP\/\d(?:\.\d)?)$/.exec(lines[0])
    if (!match) throw new HttpError('invalidStartLine', lines[0], 1, 1)
    request = { method: match[1], target: match[2], version: match[3] }
  }

  const bodyInfo = parseBody(body, headers, warn)
  const query = request ? parseQuery(request.target, warn) : []

  const data: HttpMessageData = {
    kind,
    request,
    response,
    headers,
    cookies,
    query,
    body: bodyInfo,
    warnings,
  }

  return {
    ok: true,
    output: JSON.stringify(data, null, 2),
    data,
    stats: {
      kind,
      headers: headers.length,
      cookies: cookies.length,
      bytes: bodyInfo.bytes,
    },
  }
}

function readBuildHeaders(raw: unknown): Array<[string, string]> {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new HttpError('invalidBuildInput', 'headers must be an array')
  return raw.map((item) => {
    if (Array.isArray(item) && item.length >= 2) return [String(item[0]), String(item[1])]
    if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>
      if (record.name !== undefined) return [String(record.name), String(record.value ?? '')]
    }
    throw new HttpError('invalidBuildInput', 'header entry must be [name, value]')
  })
}

function validateBuildHeader(name: string, value: string): void {
  if (!TOKEN_RE.test(name)) throw new HttpError('invalidHeader', name)
  if (/[\r\n]/.test(value)) throw new HttpError('invalidHeader', `${name}: CR/LF not allowed`)
}

function buildMessage(text: string, options: HttpMessageOptions): ToolResult<HttpMessageData> {
  let input: Record<string, unknown>
  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new HttpError('invalidBuildInput', 'root must be an object')
    }
    input = parsed as Record<string, unknown>
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError('invalidBuildInput', error instanceof Error ? error.message : String(error))
  }

  const requestedKind = input.kind === 'response' ? 'response' : input.kind === 'request' ? 'request' : undefined
  const kind = requestedKind ?? (options.kind === 'response' ? 'response' : 'request')
  const version = typeof input.version === 'string' ? input.version : 'HTTP/1.1'
  if (!VERSION_RE.test(version)) throw new HttpError('unsupportedVersion', version)
  if (kind === 'response' && !/^HTTP\/1\.[01]$/.test(version)) throw new HttpError('unsupportedVersion', version)
  if (kind === 'request' && !/^HTTP\/1\.[01]$/.test(version)) throw new HttpError('unsupportedVersion', version)

  let startLine: string
  if (kind === 'request') {
    const method = typeof input.method === 'string' ? input.method : ''
    const target = typeof input.target === 'string' ? input.target : ''
    if (!TOKEN_RE.test(method)) throw new HttpError('invalidBuildInput', 'method')
    if (!target || /[\s\r\n]/.test(target)) throw new HttpError('invalidBuildInput', 'target')
    startLine = `${method.toUpperCase()} ${target} ${version}`
  } else {
    const status = Number(input.status)
    if (!Number.isInteger(status) || status < 100 || status > 999) {
      throw new HttpError('invalidBuildInput', 'status must be a 3-digit number')
    }
    const reason =
      typeof input.reason === 'string' ? input.reason.replace(/[\r\n]/g, ' ') : (STATUS_TEXT[status] ?? '')
    startLine = `${version} ${status}${reason ? ` ${reason}` : ''}`
  }

  const headers = readBuildHeaders(input.headers)
  let body = ''
  if (typeof input.body === 'string') body = input.body
  else if (input.body === undefined || input.body === null) body = ''
  else if (typeof input.body === 'object') body = JSON.stringify(input.body)
  else body = String(input.body)

  const chunked = Boolean(input.chunked)
  const filtered = headers.filter(([name]) => !(chunked && name.toLowerCase() === 'content-length'))
  for (const [name, value] of filtered) validateBuildHeader(name, value)

  if (chunked && !filtered.some(([name]) => name.toLowerCase() === 'transfer-encoding')) {
    filtered.push(['Transfer-Encoding', 'chunked'])
  }

  if (
    options.autoContentLength !== false &&
    body.length > 0 &&
    !chunked &&
    !filtered.some(([name]) => name.toLowerCase() === 'content-length')
  ) {
    filtered.push(['Content-Length', String(byteLength(body))])
  }

  const eol = options.lineEnding === 'lf' ? '\n' : '\r\n'
  const headLines = [startLine, ...filtered.map(([name, value]) => `${name}: ${value}`)]
  let output = headLines.join(eol) + eol + eol

  if (chunked) {
    const size = byteLength(body).toString(16)
    output += `${size}${eol}${body}${eol}0${eol}${eol}`
  } else if (body) {
    output += body
  }

  return {
    ok: true,
    output,
    stats: { kind, headers: filtered.length, bytes: byteLength(output) },
  }
}

function failure(error: HttpError, locale: Locale): ToolResult<HttpMessageData> {
  const base = ERROR_TEXT[error.code][locale]
  return {
    ok: false,
    error: {
      code: error.code,
      message: error.detail ? `${base}: ${error.detail}` : base,
      line: error.line,
      column: error.column,
    },
  }
}

export const SAMPLE_PARSE = `POST /api/login?next=%2Fhome HTTP/1.1
Host: example.com
User-Agent: bit_pouch/0.4
Content-Type: application/json; charset=utf-8
Content-Length: 27
Cookie: sid=abc123; theme=dark

{"name":"demo","remember":true}`

export const SAMPLE_BUILD = `{
  "kind": "request",
  "method": "POST",
  "target": "/api/login?next=%2Fhome",
  "version": "HTTP/1.1",
  "headers": [
    ["Host", "example.com"],
    ["Content-Type", "application/json"]
  ],
  "body": "{\\"name\\":\\"demo\\"}"
}`

export const run: ToolRun<HttpMessageData> = (input, options, ctx): ToolResult<HttpMessageData> => {
  const text = String(input ?? '')
  if (!text.trim()) return failure(new HttpError('empty'), ctx.locale)
  if (text.length > MAX_INPUT) return failure(new HttpError('tooLarge'), ctx.locale)

  const opts = options as HttpMessageOptions
  try {
    return opts.mode === 'build' ? buildMessage(text, opts) : parseMessage(text, opts, ctx.locale)
  } catch (error) {
    if (error instanceof HttpError) return failure(error, ctx.locale)
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: { code: 'PLUGIN_ERROR', message } }
  }
}
