// cURL 命令 → 代码。只做词法切分与参数解释，绝不执行 shell 或发起网络请求。
// 输入（含 URL、Cookie、Authorization）只参与本次转换，不写入持久化存储。
import type { Locale, ToolResult, ToolRun } from '@/core/types'

export type CurlTarget = 'fetch' | 'axios' | 'python' | 'go' | 'powershell'

export interface CurlOptions {
  target?: CurlTarget
}

export interface CurlFormField {
  name: string
  value?: string
  file?: string
  contentType?: string
}

export interface CurlRequest {
  method: string
  url: string
  headers: Array<[string, string]>
  body?: string
  form?: CurlFormField[]
  auth?: { user: string; password: string }
  insecure: boolean
  followRedirects: boolean
  compressed: boolean
  cookies?: string
}

export interface CurlConvertData {
  request: CurlRequest
  warnings: string[]
}

const MAX_INPUT = 100_000
const TARGETS: CurlTarget[] = ['fetch', 'axios', 'python', 'go', 'powershell']

type ErrorCode = 'empty' | 'notCurl' | 'unterminatedQuote' | 'missingValue' | 'invalidUrl' | 'invalidHeader' | 'tooLong'

type WarningCode =
  | 'unexpandedVariable'
  | 'multipleUrls'
  | 'unsupportedScheme'
  | 'unsupportedOption'
  | 'cookieFileUnsupported'
  | 'ignoredOption'
  | 'ignoredBody'

const ERROR_TEXT: Record<ErrorCode, { zh: string; en: string }> = {
  empty: { zh: '内容为空', en: 'Input is empty' },
  notCurl: { zh: '命令必须以 curl 开头', en: 'The command must start with curl' },
  unterminatedQuote: { zh: '引号未闭合', en: 'Unterminated quote' },
  missingValue: { zh: '选项缺少参数', en: 'Option is missing a value' },
  invalidUrl: {
    zh: '没有找到 URL（若命令含未知选项，可能把 URL 吞掉了）',
    en: 'No URL found (an unknown option may have swallowed it)',
  },
  invalidHeader: { zh: '头部缺少冒号', en: 'Header is missing a colon' },
  tooLong: { zh: '输入超过 100,000 字符', en: 'Input exceeds 100,000 characters' },
}

const WARNING_TEXT: Record<WarningCode, { zh: string; en: string }> = {
  unexpandedVariable: {
    zh: '变量未展开，保留为字面量',
    en: 'Variable left unexpanded as a literal',
  },
  multipleUrls: { zh: '存在多个 URL，只使用第一个', en: 'Multiple URLs found; only the first is used' },
  unsupportedScheme: { zh: '非 http/https 协议', en: 'Non-http(s) scheme' },
  unsupportedOption: { zh: '选项未支持，已忽略', en: 'Unsupported option ignored' },
  cookieFileUnsupported: {
    zh: 'Cookie 文件形式未支持，仅解析 Cookie 字符串',
    en: 'Cookie file is not supported; only cookie strings are parsed',
  },
  ignoredOption: { zh: '选项对生成的代码无影响', en: 'Option has no effect on generated code' },
  ignoredBody: { zh: '同时存在 -d 与 -F，以表单为准', en: 'Both -d and -F present; form wins' },
}

class CurlError extends Error {
  code: ErrorCode
  line?: number
  column?: number
  detail?: string

  constructor(code: ErrorCode, detail?: string, pos?: { line: number; column: number }) {
    super(code)
    this.code = code
    this.detail = detail
    this.line = pos?.line
    this.column = pos?.column
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

interface Token {
  value: string
  start: number
}

function positionOf(text: string, index: number): { line: number; column: number } {
  const before = text.slice(0, index)
  const line = before.split(/\r?\n/).length
  const column = index - before.lastIndexOf('\n')
  return { line, column }
}

const DOUBLE_ESCAPES: Record<string, string> = {
  '"': '"',
  '\\': '\\',
  $: '$',
  '`': '`',
  n: '\n',
  t: '\t',
}

function readAnsiC(text: string, start: number): { value: string; next: number } {
  // 调用时 text[start] === '$'，text[start + 1] === "'"
  let index = start + 2
  let value = ''
  while (index < text.length) {
    const char = text[index]
    if (char === "'") return { value, next: index + 1 }
    if (char !== '\\') {
      value += char
      index += 1
      continue
    }
    const next = text[index + 1]
    if (next === undefined) break
    if (next === 'x' && /^[0-9a-fA-F]{2}$/.test(text.slice(index + 2, index + 4))) {
      value += String.fromCharCode(parseInt(text.slice(index + 2, index + 4), 16))
      index += 4
      continue
    }
    if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(text.slice(index + 2, index + 6))) {
      value += String.fromCharCode(parseInt(text.slice(index + 2, index + 6), 16))
      index += 6
      continue
    }
    if (next >= '0' && next <= '7') {
      const octal = /^[0-7]{1,3}/.exec(text.slice(index + 1))
      if (octal) {
        value += String.fromCharCode(parseInt(octal[0], 8))
        index += 1 + octal[0].length
        continue
      }
    }
    const escapes: Record<string, string> = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', f: '\f', v: '\v', '\\': '\\', "'": "'", '"': '"' }
    value += escapes[next] ?? next
    index += 2
  }
  throw new CurlError('unterminatedQuote', "'", positionOf(text, start))
}

/** shell 词法切分：不展开变量、不执行命令；引号内按 shell 规则处理转义。 */
function tokenize(input: string): Token[] {
  // 行尾反斜杠续行先合并（与计划约定一致）。
  const text = input.replace(/\\\r?\n/g, '')
  const tokens: Token[] = []
  let current = ''
  let tokenStart = -1
  let inToken = false
  let index = 0

  const flush = () => {
    if (inToken) tokens.push({ value: current, start: tokenStart })
    current = ''
    inToken = false
    tokenStart = -1
  }

  while (index < text.length) {
    const char = text[index]
    if (!inToken && /\s/.test(char)) {
      index += 1
      continue
    }
    if (!inToken) {
      inToken = true
      tokenStart = index
    }

    if (char === "'") {
      index += 1
      while (index < text.length && text[index] !== "'") {
        current += text[index]
        index += 1
      }
      if (index >= text.length) throw new CurlError('unterminatedQuote', "'", positionOf(text, tokenStart))
      index += 1
      continue
    }

    if (char === '"') {
      index += 1
      let closed = false
      while (index < text.length) {
        const inner = text[index]
        if (inner === '"') {
          closed = true
          index += 1
          break
        }
        if (inner === '\\') {
          const next = text[index + 1]
          if (next === undefined) break
          if (next === '\n') {
            index += 2
            continue
          }
          if (Object.prototype.hasOwnProperty.call(DOUBLE_ESCAPES, next)) {
            current += DOUBLE_ESCAPES[next]
          } else {
            current += `\\${next}`
          }
          index += 2
          continue
        }
        current += inner
        index += 1
      }
      if (!closed) throw new CurlError('unterminatedQuote', '"', positionOf(text, tokenStart))
      continue
    }

    if (char === '$' && text[index + 1] === "'") {
      const ansi = readAnsiC(text, index)
      current += ansi.value
      index = ansi.next
      continue
    }

    if (char === '\\') {
      const next = text[index + 1]
      if (next !== undefined) {
        current += next
        index += 2
        continue
      }
      current += char
      index += 1
      continue
    }

    if (/\s/.test(char)) {
      flush()
      index += 1
      continue
    }

    current += char
    index += 1
  }

  flush()
  return tokens
}

function hasHeader(headers: Array<[string, string]>, name: string): boolean {
  return headers.some(([headerName]) => headerName.toLowerCase() === name.toLowerCase())
}

function addHeader(headers: Array<[string, string]>, name: string, value: string): void {
  headers.push([name, value])
}

function encodeDataUrl(value: string): string {
  const equals = value.indexOf('=')
  if (equals >= 0) return `${value.slice(0, equals)}=${encodeURIComponent(value.slice(equals + 1))}`
  return encodeURIComponent(value)
}

function parseFormField(value: string): CurlFormField {
  const equals = value.indexOf('=')
  const name = equals < 0 ? value : value.slice(0, equals)
  let rest = equals < 0 ? '' : value.slice(equals + 1)
  let contentType: string | undefined
  const typeIndex = rest.indexOf(';type=')
  if (typeIndex >= 0) {
    contentType = rest.slice(typeIndex + 6)
    rest = rest.slice(0, typeIndex)
  }
  if (rest.startsWith('@')) return { name, file: rest.slice(1), contentType }
  if (rest.startsWith('<')) return { name, file: rest.slice(1), contentType }
  return { name, value: rest, contentType }
}

const SHORT_FLAGS = new Set(['s', 'v', 'i', 'k', 'L', 'G', 'S'])
const SHORT_VALUES = new Set(['X', 'H', 'd', 'F', 'u', 'b', 'A', 'e', 'o', 'm'])

interface ParseState {
  request: CurlRequest
  dataParts: string[]
  getMode: boolean
  explicitMethod?: string
  urls: string[]
  form: CurlFormField[]
}

function parseCurl(text: string, warn: Warner): CurlRequest {
  const tokens = tokenize(text)
  if (!tokens.length) throw new CurlError('empty')
  if (!['curl', 'curl.exe'].includes(tokens[0].value.toLowerCase())) throw new CurlError('notCurl', tokens[0].value)

  const state: ParseState = {
    request: {
      method: 'GET',
      url: '',
      headers: [],
      insecure: false,
      followRedirects: false,
      compressed: false,
    },
    dataParts: [],
    getMode: false,
    urls: [],
    form: [],
  }

  for (const token of tokens) {
    if (token.value.includes('$')) {
      const variables = token.value.match(/\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g)
      for (const variable of variables ?? []) warn('unexpandedVariable', variable)
    }
  }

  let index = 1
  let endOptions = false

  const takeValue = (option: string): string => {
    index += 1
    const next = tokens[index]
    if (!next) throw new CurlError('missingValue', option)
    return next.value
  }

  const applyLong = (name: string, inlineValue: string | undefined): void => {
    const valueOf = (): string => (inlineValue !== undefined ? inlineValue : takeValue(`--${name}`))
    switch (name) {
      case 'url':
        state.urls.push(valueOf())
        break
      case 'request':
        state.explicitMethod = valueOf()
        break
      case 'header': {
        const header = valueOf()
        const colon = header.indexOf(':')
        if (colon < 0) throw new CurlError('invalidHeader', header)
        addHeader(state.request.headers, header.slice(0, colon).trim(), header.slice(colon + 1).trim())
        break
      }
      case 'data':
      case 'data-raw':
      case 'data-binary':
        state.dataParts.push(valueOf())
        break
      case 'data-urlencode':
        state.dataParts.push(encodeDataUrl(valueOf()))
        break
      case 'form':
        state.form.push(parseFormField(valueOf()))
        break
      case 'get':
        state.getMode = true
        break
      case 'user': {
        const user = valueOf()
        const colon = user.indexOf(':')
        state.request.auth =
          colon < 0 ? { user, password: '' } : { user: user.slice(0, colon), password: user.slice(colon + 1) }
        break
      }
      case 'cookie': {
        const cookie = valueOf()
        if (cookie.includes('=')) state.request.cookies = cookie
        else warn('cookieFileUnsupported', cookie)
        break
      }
      case 'user-agent':
        addHeader(state.request.headers, 'User-Agent', valueOf())
        break
      case 'referer':
        addHeader(state.request.headers, 'Referer', valueOf())
        break
      case 'compressed':
        state.request.compressed = true
        break
      case 'insecure':
        state.request.insecure = true
        break
      case 'location':
        state.request.followRedirects = true
        break
      case 'max-redirs': {
        const maxRedirects = Number(valueOf())
        if (maxRedirects === 0) state.request.followRedirects = false
        break
      }
      case 'connect-timeout':
      case 'max-time':
      case 'retry':
        valueOf()
        break
      case 'proxy':
      case 'cert':
      case 'key':
        valueOf()
        warn('unsupportedOption', `--${name}`)
        break
      case 'output':
        valueOf()
        warn('ignoredOption', '--output')
        break
      case 'include':
        warn('ignoredOption', '--include')
        break
      case 'silent':
      case 'verbose':
        break
      default:
        warn('unsupportedOption', `--${name}`)
    }
  }

  const applyShortValue = (flag: string, value: string): void => {
    switch (flag) {
      case 'X':
        state.explicitMethod = value
        break
      case 'H': {
        const colon = value.indexOf(':')
        if (colon < 0) throw new CurlError('invalidHeader', value)
        addHeader(state.request.headers, value.slice(0, colon).trim(), value.slice(colon + 1).trim())
        break
      }
      case 'd':
        state.dataParts.push(value)
        break
      case 'F':
        state.form.push(parseFormField(value))
        break
      case 'u': {
        const colon = value.indexOf(':')
        state.request.auth =
          colon < 0 ? { user: value, password: '' } : { user: value.slice(0, colon), password: value.slice(colon + 1) }
        break
      }
      case 'b':
        if (value.includes('=')) state.request.cookies = value
        else warn('cookieFileUnsupported', value)
        break
      case 'A':
        addHeader(state.request.headers, 'User-Agent', value)
        break
      case 'e':
        addHeader(state.request.headers, 'Referer', value)
        break
      case 'o':
        warn('ignoredOption', '-o')
        break
      case 'm':
        break
    }
  }

  const applyShortFlag = (flag: string): void => {
    switch (flag) {
      case 'G':
        state.getMode = true
        break
      case 'k':
        state.request.insecure = true
        break
      case 'L':
        state.request.followRedirects = true
        break
      case 'i':
        warn('ignoredOption', '-i')
        break
      case 's':
      case 'v':
      case 'S':
        break
    }
  }

  for (index = 1; index < tokens.length; index += 1) {
    const token = tokens[index].value
    if (!token) continue
    if (endOptions || !token.startsWith('-') || token === '-') {
      state.urls.push(token)
      continue
    }
    if (token === '--') {
      endOptions = true
      continue
    }

    if (token.startsWith('--')) {
      const equals = token.indexOf('=')
      const name = (equals < 0 ? token.slice(2) : token.slice(2, equals)).toLowerCase()
      applyLong(name, equals < 0 ? undefined : token.slice(equals + 1))
      continue
    }

    const chars = token.slice(1)
    for (let cursor = 0; cursor < chars.length; cursor += 1) {
      const flag = chars[cursor]
      if (SHORT_VALUES.has(flag)) {
        const inline = chars.slice(cursor + 1)
        applyShortValue(flag, inline || takeValue(`-${flag}`))
        break
      }
      if (SHORT_FLAGS.has(flag)) {
        applyShortFlag(flag)
        continue
      }
      warn('unsupportedOption', `-${flag}`)
    }
  }

  if (!state.urls.length) throw new CurlError('invalidUrl')
  if (state.urls.length > 1) warn('multipleUrls', state.urls.slice(1).join(', '))
  state.request.url = state.urls[0]

  if (!/^https?:\/\//i.test(state.request.url)) warn('unsupportedScheme', state.request.url.split(':')[0])

  if (state.dataParts.length && state.form.length) warn('ignoredBody')

  if (state.form.length) {
    state.request.form = state.form
  } else if (state.dataParts.length && state.getMode) {
    const separator = state.request.url.includes('?') ? '&' : '?'
    state.request.url += separator + state.dataParts.join('&')
  } else if (state.dataParts.length) {
    state.request.body = state.dataParts.join('&')
  }

  state.request.method = (
    state.explicitMethod ?? (state.getMode ? 'GET' : (state.request.body || state.request.form) ? 'POST' : 'GET')
  ).toUpperCase()
  if (state.request.compressed && !hasHeader(state.request.headers, 'accept-encoding')) {
    addHeader(state.request.headers, 'Accept-Encoding', 'gzip, deflate, br')
  }
  if (state.request.cookies && !hasHeader(state.request.headers, 'cookie')) {
    addHeader(state.request.headers, 'Cookie', state.request.cookies)
  }

  return state.request
}

function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text)
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]
    const second = bytes[index + 1] ?? 0
    const third = bytes[index + 2] ?? 0
    out += alphabet[first >> 2]
    out += alphabet[((first & 3) << 4) | (second >> 4)]
    out += index + 1 < bytes.length ? alphabet[((second & 15) << 2) | (third >> 6)] : '='
    out += index + 2 < bytes.length ? alphabet[third & 63] : '='
  }
  return out
}

function authHeader(request: CurlRequest): string | undefined {
  if (!request.auth) return undefined
  return `Basic ${base64Utf8(`${request.auth.user}:${request.auth.password}`)}`
}

function mergeDuplicateHeaders(headers: Array<[string, string]>): Array<[string, string]> {
  const merged: Array<[string, string]> = []
  for (const [name, value] of headers) {
    const existing = merged.find(([entryName]) => entryName.toLowerCase() === name.toLowerCase())
    if (existing) existing[1] = `${existing[1]}, ${value}`
    else merged.push([name, value])
  }
  return merged
}

function hasDuplicateHeaders(headers: Array<[string, string]>): boolean {
  const seen = new Set<string>()
  for (const [name] of headers) {
    const lower = name.toLowerCase()
    if (seen.has(lower)) return true
    seen.add(lower)
  }
  return false
}

function jsString(value: string): string {
  return JSON.stringify(value)
}

function jsBody(value: string): string {
  if (!value.includes('\n')) return JSON.stringify(value)
  return `\`${value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')}\``
}

function pyString(value: string): string {
  if (!value.includes('\n')) return JSON.stringify(value)
  return `"""${value.replace(/\\/g, '\\\\').replace(/"""/g, '\\"\\"\\"')}"""`
}

function psString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function jsHeaders(headers: Array<[string, string]>): string {
  if (!headers.length) return '{}'
  if (hasDuplicateHeaders(headers)) {
    return `[\n${headers.map(([name, value]) => `    [${jsString(name)}, ${jsString(value)}],`).join('\n')}\n  ]`
  }
  return `{\n${headers.map(([name, value]) => `    ${jsString(name)}: ${jsString(value)},`).join('\n')}\n  }`
}

function pyHeaders(headers: Array<[string, string]>): string {
  const merged = mergeDuplicateHeaders(headers)
  if (!merged.length) return '{}'
  return `{\n${merged.map(([name, value]) => `    ${pyString(name)}: ${pyString(value)},`).join('\n')}\n}`
}

function psHeaders(headers: Array<[string, string]>): string {
  const merged = mergeDuplicateHeaders(headers)
  if (!merged.length) return ''
  return `@{\n${merged.map(([name, value]) => `    ${psString(name)} = ${psString(value)}`).join('\n')}\n}`
}

function requestHeaders(request: CurlRequest): Array<[string, string]> {
  const headers = [...request.headers]
  const authorization = authHeader(request)
  if (authorization && !hasHeader(headers, 'authorization')) headers.push(['Authorization', authorization])
  return headers
}

function generateFetch(request: CurlRequest, warn: Warner): string {
  const headers = requestHeaders(request)
  const lines: string[] = []
  if (request.insecure) {
    warn('unsupportedOption', '-k (fetch)')
    lines.push('// curl -k 在浏览器中不可用：fetch 无法关闭 TLS 校验。')
  }
  if (request.compressed) lines.push('// --compressed：浏览器会自动协商并解压。')

  let prelude = ''
  let bodyExpression = ''
  if (request.form?.length) {
    prelude = 'const form = new FormData()\n' + request.form
      .map((field) => {
        if (field.file) return `// 文件字段：在浏览器中从 <input type="file"> 或 File 对象获取\nform.append(${jsString(field.name)}, file, ${jsString(field.file)})`
        return `form.append(${jsString(field.name)}, ${jsString(field.value ?? '')})`
      })
      .join('\n')
    bodyExpression = 'form'
  } else if (request.body !== undefined && !['GET', 'HEAD'].includes(request.method)) {
    bodyExpression = jsBody(request.body)
  }

  lines.push(`const response = await fetch(${jsString(request.url)}, {`)
  lines.push(`  method: ${jsString(request.method)},`)
  if (headers.length) lines.push(`  headers: ${jsHeaders(headers)},`)
  if (bodyExpression) lines.push(`  body: ${bodyExpression},`)
  lines.push(`  redirect: ${request.followRedirects ? "'follow'" : "'manual'"},`)
  lines.push('})')
  lines.push('const data = await response.text()')
  return (prelude ? `${prelude}\n\n` : '') + lines.join('\n')
}

function generateAxios(request: CurlRequest, warn: Warner): string {
  const headers = [...request.headers]
  const lines: string[] = []
  const imports: string[] = []
  if (request.form?.length) {
    if (request.form.some((field) => field.file)) imports.push("import fs from 'node:fs'")
    imports.push("import FormData from 'form-data'")
  }

  if (request.insecure) {
    warn('unsupportedOption', '-k (axios)')
    lines.push('// curl -k：Node 中可用 httpsAgent: new https.Agent({ rejectUnauthorized: false }) 关闭校验（有风险）。')
  }

  let dataExpression = 'undefined'
  if (request.form?.length) {
    dataExpression = 'form'
    lines.push('const form = new FormData()')
    for (const field of request.form) {
      if (field.file) {
        lines.push(`form.append(${jsString(field.name)}, fs.createReadStream(${jsString(field.file)}))`)
      } else {
        lines.push(`form.append(${jsString(field.name)}, ${jsString(field.value ?? '')})`)
      }
    }
  } else if (request.body !== undefined) {
    dataExpression = jsBody(request.body)
  }

  lines.push('const response = await axios.request({')
  lines.push(`  method: ${jsString(request.method.toLowerCase())},`)
  lines.push(`  url: ${jsString(request.url)},`)
  if (headers.length) lines.push(`  headers: ${jsHeaders(headers)},`)
  if (dataExpression !== 'undefined') lines.push(`  data: ${dataExpression},`)
  if (request.auth) {
    lines.push(`  auth: { username: ${jsString(request.auth.user)}, password: ${jsString(request.auth.password)} },`)
  }
  if (!request.followRedirects) lines.push('  maxRedirects: 0,')
  lines.push('})')
  lines.push('const data = response.data')

  return `${imports.length ? `${imports.join('\n')}\n\n` : ''}${lines.join('\n')}`
}

function generatePython(request: CurlRequest, warn: Warner): string {
  const headers = [...request.headers]
  const lines: string[] = ['import requests', '']
  if (request.insecure) {
    warn('unsupportedOption', '-k (python)')
    lines.push('# curl -k：verify=False 关闭证书校验，存在中间人风险。')
  }

  if (headers.length) lines.push(`headers = ${pyHeaders(headers)}`, '')

  let dataArgument = ''
  let filesArgument = ''
  if (request.form?.length) {
    const plain = request.form.filter((field) => !field.file)
    const files = request.form.filter((field) => field.file)
    if (plain.length) {
      lines.push(`data = {\n${plain.map((field) => `    ${pyString(field.name)}: ${pyString(field.value ?? '')},`).join('\n')}\n}`, '')
      dataArgument = 'data=data,'
    }
    if (files.length) {
      lines.push(`files = {\n${files.map((field) => `    ${pyString(field.name)}: open(${pyString(field.file ?? '')}, "rb"),`).join('\n')}\n}`, '')
      filesArgument = 'files=files,'
    }
  } else if (request.body !== undefined) {
    lines.push(`data = ${pyString(request.body)}`, '')
    dataArgument = 'data=data,'
  }

  lines.push('response = requests.request(')
  lines.push(`    ${pyString(request.method)},`)
  lines.push(`    ${pyString(request.url)},`)
  if (headers.length) lines.push('    headers=headers,')
  if (dataArgument) lines.push(`    ${dataArgument}`)
  if (filesArgument) lines.push(`    ${filesArgument}`)
  if (request.auth) lines.push(`    auth=(${pyString(request.auth.user)}, ${pyString(request.auth.password)}),`)
  if (request.insecure) lines.push('    verify=False,')
  if (!request.followRedirects) lines.push('    allow_redirects=False,')
  lines.push(')')
  lines.push('print(response.text)')
  return lines.join('\n')
}

function generateGo(request: CurlRequest, warn: Warner): string {
  const headers = [...request.headers]
  const imports = new Set<string>(['fmt', 'io', 'net/http'])
  const lines: string[] = []
  const usesForm = Boolean(request.form?.length)
  const usesBody = !usesForm && request.body !== undefined

  if (usesForm) {
    imports.add('bytes')
    imports.add('mime/multipart')
    if (request.form?.some((field) => field.file)) imports.add('os')
  } else if (usesBody) {
    imports.add('strings')
  }
  if (request.insecure) imports.add('crypto/tls')

  if (request.insecure) {
    warn('unsupportedOption', '-k (go)')
    lines.push('\t// curl -k：InsecureSkipVerify 关闭证书校验，存在中间人风险。')
  }

  if (usesForm) {
    lines.push('\tvar buf bytes.Buffer')
    lines.push('\twriter := multipart.NewWriter(&buf)')
    for (const field of request.form ?? []) {
      if (field.file) {
        lines.push(`\tfile, err := os.Open(${jsString(field.file)})`)
        lines.push('\tif err != nil {\n\t\tpanic(err)\n\t}')
        lines.push(`\tpart, err := writer.CreateFormFile(${jsString(field.name)}, ${jsString(field.file)})`)
        lines.push('\tif err != nil {\n\t\tpanic(err)\n\t}')
        lines.push('\tio.Copy(part, file)')
        lines.push('\tfile.Close()')
      } else {
        lines.push(`\twriter.WriteField(${jsString(field.name)}, ${jsString(field.value ?? '')})`)
      }
    }
    lines.push('\twriter.Close()')
    lines.push(`\treq, err := http.NewRequest(${jsString(request.method)}, ${jsString(request.url)}, &buf)`)
  } else {
    const bodyExpression = usesBody ? `strings.NewReader(${jsString(request.body ?? '')})` : 'nil'
    lines.push(`\treq, err := http.NewRequest(${jsString(request.method)}, ${jsString(request.url)}, ${bodyExpression})`)
  }
  lines.push('\tif err != nil {\n\t\tpanic(err)\n\t}')
  for (const [name, value] of headers) lines.push(`\treq.Header.Add(${jsString(name)}, ${jsString(value)})`)
  if (request.auth) {
    lines.push(`\treq.SetBasicAuth(${jsString(request.auth.user)}, ${jsString(request.auth.password)})`)
  }
  if (usesForm) lines.push('\treq.Header.Set("Content-Type", writer.FormDataContentType())')

  lines.push('\tclient := &http.Client{}')
  if (request.insecure) {
    lines.push('\tclient.Transport = &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}')
  }
  if (!request.followRedirects) {
    lines.push('\tclient.CheckRedirect = func(req *http.Request, via []*http.Request) error {\n\t\treturn http.ErrUseLastResponse\n\t}')
  }
  lines.push('\tresp, err := client.Do(req)')
  lines.push('\tif err != nil {\n\t\tpanic(err)\n\t}')
  lines.push('\tdefer resp.Body.Close()')
  lines.push('\tbody, _ := io.ReadAll(resp.Body)')
  lines.push('\tfmt.Println(string(body))')

  const importLines = [...imports].sort().map((name) => `\t"${name}"`).join('\n')
  return `package main\n\nimport (\n${importLines}\n)\n\nfunc main() {\n${lines.join('\n')}\n}`
}

function generatePowerShell(request: CurlRequest, warn: Warner): string {
  const headers = requestHeaders(request)
  const lines: string[] = []
  if (request.insecure) {
    warn('unsupportedOption', '-k (powershell)')
    lines.push('# -SkipCertificateCheck 需要 PowerShell 7+。')
  }

  if (headers.length) lines.push(`$headers = ${psHeaders(headers)}`, '')
  const arguments_: string[] = [`-Uri ${psString(request.url)}`, `-Method ${psString(request.method)}`]
  if (headers.length) arguments_.push('-Headers $headers')

  if (request.form?.length) {
    const entries = request.form.map((field) =>
      field.file
        ? `    ${psString(field.name)} = Get-Item ${psString(field.file ?? '')}`
        : `    ${psString(field.name)} = ${psString(field.value ?? '')}`,
    )
    lines.push(`$form = @{\n${entries.join('\n')}\n}`, '')
    arguments_.push('-Form $form')
  } else if (request.body !== undefined) {
    arguments_.push(`-Body ${psString(request.body)}`)
  }

  if (request.insecure) arguments_.push('-SkipCertificateCheck')
  if (!request.followRedirects) arguments_.push('-MaximumRedirection 0')

  lines.push(`$response = Invoke-WebRequest ${arguments_.join(' ')}`)
  lines.push('$response.Content')
  return lines.join('\n')
}

const GENERATORS: Record<CurlTarget, (request: CurlRequest, warn: Warner) => string> = {
  fetch: generateFetch,
  axios: generateAxios,
  python: generatePython,
  go: generateGo,
  powershell: generatePowerShell,
}

function failure(error: CurlError, locale: Locale): ToolResult<CurlConvertData> {
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

export const SAMPLE_JSON = `curl 'https://api.example.com/v1/login?next=%2Fhome' \\
  -H 'Content-Type: application/json' \\
  -H 'Accept: application/json' \\
  -u 'demo:secret' \\
  --data-raw '{"name":"demo","remember":true}'`

export const SAMPLE_FORM = `curl -X POST 'https://api.example.com/v1/upload' \\
  -F 'name=demo' \\
  -F 'file=@./avatar.png' \\
  -b 'sid=abc123'`

export const run: ToolRun<CurlConvertData> = (input, options, ctx): ToolResult<CurlConvertData> => {
  const text = String(input ?? '')
  if (!text.trim()) return failure(new CurlError('empty'), ctx.locale)
  if (text.length > MAX_INPUT) return failure(new CurlError('tooLong'), ctx.locale)

  const { warn, warnings } = makeWarner(ctx.locale)
  try {
    const request = parseCurl(text, warn)
    const target: CurlTarget = TARGETS.includes(options.target as CurlTarget)
      ? (options.target as CurlTarget)
      : 'fetch'
    const output = GENERATORS[target](request, warn)

    return {
      ok: true,
      output,
      data: { request, warnings },
      stats: {
        target,
        method: request.method,
        headers: request.headers.length,
        chars: output.length,
      },
    }
  } catch (error) {
    if (error instanceof CurlError) return failure(error, ctx.locale)
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: { code: 'PLUGIN_ERROR', message } }
  }
}
