// JSON 格式化的纯逻辑：自写 token 解析器，不用 JSON.parse + JSON.stringify。
// 原因：JSON.parse 会把 19 位长整数转成双精度浮点（末尾精度丢失），也会吞掉重复键；
// 这里保留数字与字符串的原始字面量，只重排缩进/换行（可选按键名排序），内容一个字符都不改。
import type { Locale } from '@/core/types'

const WHITESPACE = ' \t\n\r'
const NUMBER_RE = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y
export const JSON_MAX_DEPTH = 200

type PrimitiveNode = { type: 'string' | 'number' | 'boolean' | 'null'; raw: string }
type ObjectNode = { type: 'object'; entries: Array<{ key: string; value: JsonNode }> }
type ArrayNode = { type: 'array'; items: JsonNode[] }
type JsonNode = PrimitiveNode | ObjectNode | ArrayNode

export interface JsonError {
  code: string
  line: number
  column: number
  char: string
  lineText: string
}

export interface JsonStats {
  lines: number
  chars: number
  bytes: number
}

export type FormatJsonResult =
  | { ok: true; text: string; stats: JsonStats }
  | { ok: false; error: JsonError }

class JsonSyntaxError extends Error {
  code: string
  index: number
  char: string

  constructor(code: string, index: number, char = '') {
    super(code)
    this.code = code
    this.index = index
    this.char = char
  }
}

class JsonParser {
  text: string
  i = 0

  constructor(text: string) {
    this.text = text
  }

  get len(): number {
    return this.text.length
  }

  fail(code: string, index = this.i, char = ''): never {
    throw new JsonSyntaxError(code, index, char)
  }

  skipWs(): void {
    while (this.i < this.len && WHITESPACE.includes(this.text[this.i])) this.i++
  }

  parse(): JsonNode {
    this.skipWs()
    if (this.i >= this.len) this.fail('empty')
    const node = this.parseValue(0)
    this.skipWs()
    if (this.i < this.len) this.fail('trailingContent', this.i, this.text[this.i])
    return node
  }

  parseValue(depth: number): JsonNode {
    this.skipWs()
    if (this.i >= this.len) this.fail('unexpectedEnd')
    const ch = this.text[this.i]
    if (ch === '{') return this.parseObject(depth + 1)
    if (ch === '[') return this.parseArray(depth + 1)
    if (ch === '"') return { type: 'string', raw: this.parseString() }
    if (ch === '-' || (ch >= '0' && ch <= '9')) return { type: 'number', raw: this.parseNumber() }
    for (const literal of ['true', 'false', 'null'] as const) {
      if (this.text.startsWith(literal, this.i)) {
        this.i += literal.length
        return { type: literal === 'null' ? 'null' : 'boolean', raw: literal }
      }
    }
    this.fail('unexpectedChar', this.i, ch)
  }

  parseObject(depth: number): ObjectNode {
    if (depth > JSON_MAX_DEPTH) this.fail('tooDeep')
    this.i++ // {
    const entries: Array<{ key: string; value: JsonNode }> = []
    this.skipWs()
    if (this.text[this.i] === '}') {
      this.i++
      return { type: 'object', entries }
    }
    for (;;) {
      this.skipWs()
      if (this.i >= this.len) this.fail('unexpectedEnd')
      if (this.text[this.i] === '}') this.fail('trailingComma', this.i, '}')
      if (this.text[this.i] !== '"') this.fail('expectedKey', this.i, this.text[this.i])
      const key = this.parseString()
      this.skipWs()
      if (this.text[this.i] !== ':') this.fail('expectedColon', this.i, this.text[this.i] || '')
      this.i++
      entries.push({ key, value: this.parseValue(depth) })
      this.skipWs()
      if (this.i >= this.len) this.fail('unexpectedEnd')
      const ch = this.text[this.i]
      if (ch === ',') {
        this.i++
        continue
      }
      if (ch === '}') {
        this.i++
        break
      }
      this.fail('expectedComma', this.i, ch)
    }
    return { type: 'object', entries }
  }

  parseArray(depth: number): ArrayNode {
    if (depth > JSON_MAX_DEPTH) this.fail('tooDeep')
    this.i++ // [
    const items: JsonNode[] = []
    this.skipWs()
    if (this.text[this.i] === ']') {
      this.i++
      return { type: 'array', items }
    }
    for (;;) {
      this.skipWs()
      if (this.i >= this.len) this.fail('unexpectedEnd')
      if (this.text[this.i] === ']') this.fail('trailingComma', this.i, ']')
      items.push(this.parseValue(depth))
      this.skipWs()
      if (this.i >= this.len) this.fail('unexpectedEnd')
      const ch = this.text[this.i]
      if (ch === ',') {
        this.i++
        continue
      }
      if (ch === ']') {
        this.i++
        break
      }
      this.fail('expectedComma', this.i, ch)
    }
    return { type: 'array', items }
  }

  // 返回含首尾引号的原始片段：转义写法和 \uXXXX 原样保留
  parseString(): string {
    const start = this.i
    this.i++ // 开引号
    while (this.i < this.len) {
      const ch = this.text[this.i]
      if (ch === '"') {
        this.i++
        return this.text.slice(start, this.i)
      }
      if (ch === '\\') {
        this.i++
        if (this.i >= this.len) this.fail('unterminatedString', this.i)
        const esc = this.text[this.i]
        if (esc === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(this.text.slice(this.i + 1, this.i + 5))) this.fail('invalidEscape', this.i)
          this.i += 5
        } else if ('"\\/bfnrt'.includes(esc)) {
          this.i++
        } else {
          this.fail('invalidEscape', this.i, esc)
        }
        continue
      }
      if (ch === '\n' || ch === '\r' || ch.charCodeAt(0) < 0x20) this.fail('unterminatedString', this.i)
      this.i++
    }
    this.fail('unterminatedString', this.i)
  }

  parseNumber(): string {
    const start = this.i
    NUMBER_RE.lastIndex = start
    const m = NUMBER_RE.exec(this.text)
    if (!m) this.fail('invalidNumber', start)
    this.i = NUMBER_RE.lastIndex
    return m[0]
  }
}

const decodeKey = (raw: string): string => {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

// 按码位比较（不随运行环境语言变化）；sort 稳定，重复键保持原相对顺序
const compareKeys = (a: { key: string }, b: { key: string }): number => {
  const ka = decodeKey(a.key)
  const kb = decodeKey(b.key)
  return ka < kb ? -1 : ka > kb ? 1 : 0
}

function writeNode(node: JsonNode, indent: string, depth: number, sortKeys: boolean): string {
  const pretty = indent !== ''
  if (node.type === 'object') {
    if (!node.entries.length) return '{}'
    const entries = sortKeys ? [...node.entries].sort(compareKeys) : node.entries
    if (!pretty) {
      return `{${entries.map((e) => `${e.key}:${writeNode(e.value, indent, depth + 1, sortKeys)}`).join(',')}}`
    }
    const inner = indent.repeat(depth + 1)
    const outer = indent.repeat(depth)
    const body = entries.map((e) => `${inner}${e.key}: ${writeNode(e.value, indent, depth + 1, sortKeys)}`).join(',\n')
    return `{\n${body}\n${outer}}`
  }
  if (node.type === 'array') {
    if (!node.items.length) return '[]'
    if (!pretty) return `[${node.items.map((v) => writeNode(v, indent, depth + 1, sortKeys)).join(',')}]`
    const inner = indent.repeat(depth + 1)
    const outer = indent.repeat(depth)
    const body = node.items.map((v) => `${inner}${writeNode(v, indent, depth + 1, sortKeys)}`).join(',\n')
    return `[\n${body}\n${outer}]`
  }
  return node.raw
}

const byteLength = (s: string): number => new TextEncoder().encode(s).length

function describeError(input: string, err: JsonSyntaxError): JsonError {
  const pos = Math.min(Math.max(err.index ?? 0, 0), input.length)
  let line = 1
  let lineStart = 0
  for (let i = 0; i < pos; i++) {
    if (input[i] === '\n') {
      line++
      lineStart = i + 1
    }
  }
  const lineEnd = input.indexOf('\n', lineStart)
  const rawLine = input.slice(lineStart, lineEnd === -1 ? input.length : lineEnd).replace(/\r$/, '')
  return {
    code: err.code,
    line,
    column: pos - lineStart + 1,
    char: err.char || '',
    lineText: rawLine.length > 200 ? `${rawLine.slice(0, 200)}…` : rawLine,
  }
}

/**
 * 格式化/压缩 JSON。
 * indent 传 '' 即压缩为单行；sortKeys 递归按键名排序；失败只返回错误码与行列，不抛异常。
 */
export function formatJson(text: string, { indent = '  ', sortKeys = false } = {}): FormatJsonResult {
  const input = String(text ?? '')
  if (!input.trim()) {
    return { ok: false, error: { code: 'empty', line: 1, column: 1, char: '', lineText: '' } }
  }
  try {
    const node = new JsonParser(input).parse()
    const output = writeNode(node, indent, 0, sortKeys)
    return {
      ok: true,
      text: output,
      stats: { lines: output.split('\n').length, chars: output.length, bytes: byteLength(output) },
    }
  } catch (err) {
    if (!(err instanceof JsonSyntaxError)) throw err
    return { ok: false, error: describeError(input, err) }
  }
}

export interface JsonToken {
  type: 'plain' | 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punct'
  text: string
}

/**
 * 把已格式化好的 JSON 切成着色片段：输出是合法 JSON，按词法扫描即可，不对内容做任何改写。
 * 页面用 v-for 渲染这些片段（不走 v-html）。
 */
export function tokenizeJson(text: string): JsonToken[] {
  const tokens: JsonToken[] = []
  const re = /"(?:[^"\\]|\\.)*"|\b(?:true|false|null)\b|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}[\],:]/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) tokens.push({ type: 'plain', text: text.slice(last, m.index) })
    const raw = m[0]
    let type: JsonToken['type'] = 'punct'
    if (raw[0] === '"') {
      // 紧跟冒号的字符串是键名，与普通字符串区分上色
      type = /^\s*:/.test(text.slice(re.lastIndex)) ? 'key' : 'string'
    } else if (raw === 'true' || raw === 'false') {
      type = 'boolean'
    } else if (raw === 'null') {
      type = 'null'
    } else if (raw[0] === '-' || (raw[0] >= '0' && raw[0] <= '9')) {
      type = 'number'
    }
    tokens.push({ type, text: raw })
    last = re.lastIndex
  }
  if (last < text.length) tokens.push({ type: 'plain', text: text.slice(last) })
  return tokens
}

const MESSAGES: Record<string, { zh: string; en: string }> = {
  empty: { zh: '内容为空', en: 'Input is empty' },
  unexpectedChar: { zh: '意外的字符', en: 'Unexpected character' },
  unexpectedEnd: { zh: '内容意外结束', en: 'Unexpected end of input' },
  unterminatedString: { zh: '字符串没有正常结束', en: 'Unterminated string' },
  invalidEscape: { zh: '非法的转义序列', en: 'Invalid escape sequence' },
  invalidNumber: { zh: '数字格式不合法', en: 'Invalid number' },
  expectedKey: { zh: '这里应当是字符串键名', en: 'Expected a string key' },
  expectedColon: { zh: '缺少冒号', en: 'Expected a colon' },
  expectedComma: { zh: '缺少逗号', en: 'Expected a comma' },
  trailingComma: { zh: '末尾多了逗号', en: 'Trailing comma' },
  trailingContent: { zh: '结束符号后还有内容', en: 'Trailing content after the value' },
  tooDeep: { zh: `嵌套超过 ${JSON_MAX_DEPTH} 层`, en: `Nesting exceeds ${JSON_MAX_DEPTH} levels` },
}

export function jsonErrorMessage(code: string, locale: Locale): string {
  return MESSAGES[code]?.[locale] ?? (locale === 'zh' ? 'JSON 解析失败' : 'Failed to parse JSON')
}

export const SAMPLE_JSON = `{
  "family": "ihomy",
  "members": [
    { "name": "阿岚", "role": "OWNER", "points": 1280, "joinedAt": "2024-03-01" },
    { "name": "小满", "role": "MEMBER", "points": 960, "joinedAt": "2024-05-18" }
  ],
  "modules": { "blog": true, "album": true, "cinema": false },
  "meta": { "id": 12345678901234567890, "version": 10.36, "tags": ["家庭", "共享"] }
}`
