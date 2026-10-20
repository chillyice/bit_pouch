// XML / HTML 格式化的纯逻辑。
// 解析器只做词法级处理：标签、属性、注释、CDATA、DOCTYPE、处理指令都按原样保留，
// 只重排缩进与换行；HTML 模式下按 HTML 的空元素 / 可省略闭合标签规则容错。
// 不依赖 DOM，因此可以安全地跑在 Worker 里。
import type { Locale, ToolResult, ToolRun } from '@/core/types'

export const MARKUP_MAX_INPUT = 2_000_000
export const MARKUP_MAX_DEPTH = 500
const INLINE_LIMIT = 200_000

export type MarkupMode = 'xml' | 'html'
export type MarkupModeOption = 'auto' | MarkupMode

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
])

// 内容按原样保留，不参与缩进重排
const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'textarea', 'pre'])

// HTML 中可省略闭合标签的元素：打开新元素时自动闭合同级的旧元素
const IMPLICIT_CLOSE: Record<string, string[]> = {
  li: ['li'],
  dt: ['dt', 'dd'],
  dd: ['dt', 'dd'],
  tr: ['tr', 'td', 'th'],
  td: ['td', 'th'],
  th: ['td', 'th'],
  option: ['option'],
  optgroup: ['option', 'optgroup'],
  thead: ['thead', 'tbody', 'tfoot', 'tr', 'td', 'th'],
  tbody: ['thead', 'tbody', 'tfoot', 'tr', 'td', 'th'],
  tfoot: ['thead', 'tbody', 'tfoot', 'tr', 'td', 'th'],
  p: ['p'],
}

const INLINE_ELEMENTS = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'data', 'del', 'dfn',
  'em', 'i', 'img', 'input', 'ins', 'kbd', 'label', 'mark', 'meter', 'output',
  'picture', 'progress', 'q', 's', 'samp', 'select', 'small', 'span', 'strong',
  'sub', 'sup', 'svg', 'time', 'u', 'var', 'wbr',
])

// 这些块级元素开始时会隐式结束尚未闭合的 <p>
const CLOSES_PARAGRAPH = new Set([
  'address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'fieldset',
  'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'hgroup', 'hr', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul',
])

interface ElementNode {
  type: 'element'
  name: string
  attrs: string
  selfClosing: boolean
  children: MarkupNode[]
  start: number
}

interface TextNode {
  type: 'text'
  text: string
}

interface RawTextNode {
  type: 'rawtext'
  text: string
}

type VerbatimNode =
  | { type: 'comment'; text: string }
  | { type: 'cdata'; text: string }
  | { type: 'decl'; text: string }

type MarkupNode = ElementNode | TextNode | RawTextNode | VerbatimNode

interface ParseResult {
  root: ElementNode
  mode: MarkupMode
  tags: number
  depth: number
}

export interface MarkupError {
  code: string
  line: number
  column: number
  char: string
  lineText: string
  detail?: string
}

export interface MarkupStats {
  lines: number
  chars: number
  bytes: number
  tags: number
  depth: number
}

export type FormatMarkupResult =
  | { ok: true; text: string; stats: MarkupStats; mode: MarkupMode }
  | { ok: false; error: MarkupError }

class MarkupSyntaxError extends Error {
  code: string
  index: number
  char: string
  detail: string

  constructor(code: string, index: number, char = '', detail = '') {
    super(code)
    this.code = code
    this.index = index
    this.char = char
    this.detail = detail
  }
}

const isNameStart = (ch: string | undefined): boolean => !!ch && /[A-Za-z_:]/.test(ch)
const isTagName = (value: string): boolean => /^[A-Za-z_:][-A-Za-z0-9_:.]*$/.test(value)
const isBlank = (value: string): boolean => !value.trim()

function findTagEnd(input: string, start: number): number {
  let quote = ''
  for (let i = start + 1; i < input.length; i++) {
    const ch = input[i]
    if (quote) {
      if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === '>') return i
  }
  return -1
}

function findDeclarationEnd(input: string, start: number): number {
  let quote = ''
  let brackets = 0
  for (let i = start + 2; i < input.length; i++) {
    const ch = input[i]
    if (quote) {
      if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === '[') brackets++
    else if (ch === ']') brackets = Math.max(0, brackets - 1)
    else if (ch === '>' && brackets === 0) return i
  }
  return -1
}

function findRawClose(input: string, from: number, name: string): { start: number; end: number } | null {
  const lower = input.toLowerCase()
  const needle = `</${name.toLowerCase()}`
  let index = lower.indexOf(needle, from)
  while (index !== -1) {
    const after = lower[index + needle.length]
    if (after === undefined || after === '>' || /\s/.test(after)) {
      const end = findTagEnd(input, index)
      if (end !== -1) return { start: index, end: end + 1 }
    }
    index = lower.indexOf(needle, index + 2)
  }
  return null
}

function parseMarkup(input: string, requested: MarkupMode): ParseResult {
  const mode = requested
  const root: ElementNode = { type: 'element', name: '#root', attrs: '', selfClosing: false, children: [], start: 0 }
  const stack: ElementNode[] = [root]
  const top = (): ElementNode => stack[stack.length - 1]
  let tags = 0
  let depth = 0
  let i = 0
  let textStart = 0

  const fail = (code: string, index: number, char = '', detail = ''): never => {
    throw new MarkupSyntaxError(code, index, char, detail)
  }

  const pushText = (end: number): void => {
    if (end <= textStart) return
    const text = input.slice(textStart, end)
    if (text) top().children.push({ type: 'text', text })
  }

  const matches = (element: ElementNode, name: string): boolean =>
    mode === 'html' ? element.name.toLowerCase() === name.toLowerCase() : element.name === name

  const handleClose = (name: string, position: number): void => {
    if (!name) fail('invalidTag', position)
    if (mode === 'xml') {
      if (stack.length <= 1) fail('strayCloseTag', position, name)
      const current = top()
      if (!matches(current, name)) fail('mismatchedTag', position, name, current.name)
      stack.pop()
      return
    }

    let found = -1
    for (let k = stack.length - 1; k >= 1; k--) {
      if (matches(stack[k], name)) {
        found = k
        break
      }
    }
    if (found < 0) fail('strayCloseTag', position, name)
    // HTML：允许缺失中间闭合标签，直接闭合到匹配层
    stack.length = found
  }

  const autoCloseForOpen = (name: string): void => {
    if (mode !== 'html') return
    const lower = name.toLowerCase()
    if (CLOSES_PARAGRAPH.has(lower)) {
      while (stack.length > 1 && top().name.toLowerCase() === 'p') stack.pop()
    }
    const closers = IMPLICIT_CLOSE[lower]
    if (!closers) return
    while (stack.length > 1 && closers.includes(top().name.toLowerCase())) stack.pop()
  }

  while (i < input.length) {
    if (input[i] !== '<') {
      i++
      continue
    }

    const next = input[i + 1]
    if (next !== '!' && next !== '?' && next !== '/' && !isNameStart(next)) {
      i++
      continue
    }

    pushText(i)

    if (input.startsWith('<!--', i)) {
      const end = input.indexOf('-->', i + 4)
      if (end === -1) fail('unterminatedComment', i)
      top().children.push({ type: 'comment', text: input.slice(i, end + 3) })
      i = end + 3
      textStart = i
      continue
    }

    if (input.startsWith('<![CDATA[', i)) {
      const end = input.indexOf(']]>', i + 9)
      if (end === -1) fail('unterminatedCdata', i)
      top().children.push({ type: 'cdata', text: input.slice(i, end + 3) })
      i = end + 3
      textStart = i
      continue
    }

    if (next === '!') {
      const end = findDeclarationEnd(input, i)
      if (end === -1) fail('unterminatedDeclaration', i)
      top().children.push({ type: 'decl', text: input.slice(i, end + 1) })
      i = end + 1
      textStart = i
      continue
    }

    if (next === '?') {
      const end = input.indexOf('?>', i + 2)
      if (end === -1) fail('unterminatedDeclaration', i)
      top().children.push({ type: 'decl', text: input.slice(i, end + 2) })
      i = end + 2
      textStart = i
      continue
    }

    if (next === '/') {
      const end = findTagEnd(input, i + 1)
      if (end === -1) fail('unterminatedTag', i)
      const inner = input.slice(i + 2, end).trim()
      const name = /^[^\s>]*/.exec(inner)?.[0] ?? ''
      if (!isTagName(name)) fail('invalidTag', i)
      handleClose(name, i)
      i = end + 1
      textStart = i
      continue
    }

    const end = findTagEnd(input, i)
    if (end === -1) fail('unterminatedTag', i)
    const rawInner = input.slice(i + 1, end)
    const selfClosing = /\/\s*$/.test(rawInner)
    const inner = (selfClosing ? rawInner.replace(/\/\s*$/, '') : rawInner).trim()
    const name = /^[^\s/>]*/.exec(inner)?.[0] ?? ''
    if (!isTagName(name)) fail('invalidTag', i)
    if (stack.length > MARKUP_MAX_DEPTH) fail('tooDeep', i)

    autoCloseForOpen(name)
    const element: ElementNode = {
      type: 'element',
      name,
      attrs: inner.slice(name.length).trim(),
      selfClosing,
      children: [],
      start: i,
    }
    top().children.push(element)
    tags++
    depth = Math.max(depth, stack.length)

    i = end + 1
    textStart = i

    const lower = name.toLowerCase()
    const isVoid = mode === 'html' && VOID_ELEMENTS.has(lower)
    if (selfClosing || isVoid) continue

    if (mode === 'html' && RAW_TEXT_ELEMENTS.has(lower)) {
      const close = findRawClose(input, i, name)
      if (!close) throw new MarkupSyntaxError('unclosedTag', element.start, name, name)
      if (close.start > i) element.children.push({ type: 'rawtext', text: input.slice(i, close.start) })
      i = close.end
      textStart = i
      continue
    }

    stack.push(element)
  }

  pushText(input.length)

  if (mode === 'xml' && stack.length > 1) {
    const unclosed = top()
    fail('unclosedTag', unclosed.start, unclosed.name, unclosed.name)
  }

  return { root, mode, tags, depth }
}

function detectMode(input: string): MarkupMode {
  if (/^\s*<\?xml\b/i.test(input)) return 'xml'
  if (/^\s*<!doctype\s+html/i.test(input)) return 'html'
  const doctype = /^\s*<!doctype\s+([^\s>]+)/i.exec(input)
  if (doctype && doctype[1].toLowerCase() !== 'html') return 'xml'

  const rootName = /^\s*<([A-Za-z_][-A-Za-z0-9_:.]*)/.exec(input)?.[1] ?? ''
  const lower = rootName.toLowerCase()
  if (!rootName) return 'html'
  if (rootName.includes(':') || /^(svg|rss|feed|rdf|sitemap|urlset|project|pom|manifest)$/.test(lower)) return 'xml'
  return 'html'
}

const collapseHtmlText = (text: string): string => text.replace(/[ \t\r\n\f]+/g, ' ')

const openTag = (element: ElementNode, mode: MarkupMode): string => {
  const attrs = element.attrs ? ` ${element.attrs}` : ''
  const lower = element.name.toLowerCase()
  if (mode === 'html' && VOID_ELEMENTS.has(lower)) return `<${element.name}${attrs}>`
  if (element.selfClosing) return `<${element.name}${attrs} />`
  return `<${element.name}${attrs}>`
}

const closeTag = (element: ElementNode): string => `</${element.name}>`

const isVoidOrSelfClosing = (element: ElementNode, mode: MarkupMode): boolean =>
  element.selfClosing || (mode === 'html' && VOID_ELEMENTS.has(element.name.toLowerCase()))

function canInline(node: MarkupNode, mode: MarkupMode): boolean {
  if (node.type === 'text' || node.type === 'rawtext') return true
  if (node.type === 'comment' || node.type === 'cdata' || node.type === 'decl') return false
  if (isVoidOrSelfClosing(node, mode)) return true
  if (mode === 'html' && node.name.toLowerCase() === 'br') return true

  // XML 里只有子元素（没有文本）的容器按块展开；带文本的混合内容保持原样，
  // 避免格式化把元素之间的空格改掉。
  if (mode === 'xml') {
    const hasElement = node.children.some((child) => child.type === 'element')
    const hasText = node.children.some((child) => child.type === 'text' && child.text.trim() !== '')
    if (hasElement && !hasText) return false
  }

  for (const child of node.children) {
    if (child.type === 'element' && mode === 'html' && !INLINE_ELEMENTS.has(child.name.toLowerCase())) {
      return false
    }
    if (!canInline(child, mode)) return false
  }
  return true
}

function renderInline(node: MarkupNode, mode: MarkupMode): string {
  if (node.type === 'text') return mode === 'html' ? collapseHtmlText(node.text) : node.text
  if (node.type === 'rawtext') return node.text
  if (node.type === 'comment' || node.type === 'cdata' || node.type === 'decl') return node.text
  if (isVoidOrSelfClosing(node, mode)) return openTag(node, mode)
  const inner = node.children.map((child) => renderInline(child, mode)).join('')
  if (isBlank(inner)) return `${openTag(node, mode)}${closeTag(node)}`
  const body = mode === 'html' ? inner.trim() : inner
  return `${openTag(node, mode)}${body}${closeTag(node)}`
}

function renderPretty(node: MarkupNode, mode: MarkupMode, indent: string, depth: number): string {
  const pad = indent.repeat(depth)

  if (node.type === 'text') {
    const text = mode === 'html' ? collapseHtmlText(node.text) : node.text
    return text.trim() ? `${pad}${text.trim()}` : ''
  }
  if (node.type === 'rawtext') return node.text
  if (node.type === 'comment' || node.type === 'cdata' || node.type === 'decl') return `${pad}${node.text}`
  if (isVoidOrSelfClosing(node, mode)) return `${pad}${openTag(node, mode)}`

  const lower = node.name.toLowerCase()
  if (mode === 'html' && RAW_TEXT_ELEMENTS.has(lower)) {
    const raw = node.children.map((child) => renderInline(child, mode)).join('')
    return `${pad}${openTag(node, mode)}${raw}${closeTag(node)}`
  }

  if (canInline(node, mode)) return `${pad}${renderInline(node, mode)}`

  const inner: string[] = []
  for (const child of node.children) {
    const rendered = renderPretty(child, mode, indent, depth + 1)
    if (rendered) inner.push(rendered)
  }
  if (!inner.length) return `${pad}${openTag(node, mode)}${closeTag(node)}`
  return `${pad}${openTag(node, mode)}\n${inner.join('\n')}\n${pad}${closeTag(node)}`
}

function isInlineish(node: MarkupNode, mode: MarkupMode): boolean {
  if (node.type === 'text') return node.text.trim() !== ''
  if (node.type === 'element') {
    return mode === 'html' ? INLINE_ELEMENTS.has(node.name.toLowerCase()) : true
  }
  return false
}

function renderMinifiedChildren(parent: ElementNode, mode: MarkupMode): string {
  let out = ''
  parent.children.forEach((child, index) => {
    if (child.type === 'text' && !child.text.trim()) {
      // 两个行内元素之间的空白有渲染意义，压缩时保留一个空格
      if (mode === 'html') {
        const prev = parent.children[index - 1]
        const next = parent.children[index + 1]
        if (prev && next && isInlineish(prev, mode) && isInlineish(next, mode)) out += ' '
      }
      return
    }
    out += renderMinified(child, mode)
  })
  return out
}

function renderMinified(node: MarkupNode, mode: MarkupMode): string {
  if (node.type === 'text') {
    const text = mode === 'html' ? collapseHtmlText(node.text) : node.text
    return text.trim() ? text : ''
  }
  if (node.type === 'rawtext') return node.text
  if (node.type === 'comment' || node.type === 'cdata' || node.type === 'decl') return node.text
  if (isVoidOrSelfClosing(node, mode)) return openTag(node, mode)
  const inner = renderMinifiedChildren(node, mode)
  return `${openTag(node, mode)}${inner}${closeTag(node)}`
}

const byteLength = (value: string): number => new TextEncoder().encode(value).length

function describeError(input: string, error: MarkupSyntaxError): MarkupError {
  const position = Math.min(Math.max(error.index, 0), input.length)
  let line = 1
  let lineStart = 0
  for (let i = 0; i < position; i++) {
    if (input[i] === '\n') {
      line++
      lineStart = i + 1
    }
  }
  const lineEnd = input.indexOf('\n', lineStart)
  const rawLine = input.slice(lineStart, lineEnd === -1 ? input.length : lineEnd).replace(/\r$/, '')
  return {
    code: error.code,
    line,
    column: position - lineStart + 1,
    char: error.char,
    lineText: rawLine.length > 200 ? `${rawLine.slice(0, 200)}…` : rawLine,
    detail: error.detail,
  }
}

export interface FormatMarkupOptions {
  mode?: MarkupModeOption
  indent?: string
  minify?: boolean
}

/**
 * 格式化 / 压缩 XML 或 HTML。
 * mode 为 auto 时按 XML 声明、DOCTYPE 与根元素推断；XML 严格校验闭合，
 * HTML 按空元素和可省略闭合标签规则容错。失败只返回错误码与行列，不抛异常。
 */
export function formatMarkup(text: string, options: FormatMarkupOptions = {}): FormatMarkupResult {
  const input = String(text ?? '')
  if (!input.trim()) {
    return { ok: false, error: { code: 'empty', line: 1, column: 1, char: '', lineText: '' } }
  }
  if (input.length > MARKUP_MAX_INPUT) {
    return {
      ok: false,
      error: {
        code: 'tooLarge',
        line: 1,
        column: 1,
        char: '',
        lineText: '',
        detail: String(MARKUP_MAX_INPUT),
      },
    }
  }

  const requested: MarkupModeOption = options.mode === 'xml' || options.mode === 'html' ? options.mode : 'auto'
  try {
    const mode = requested === 'auto' ? detectMode(input) : requested
    const parsed = parseMarkup(input, mode)
    const indent = typeof options.indent === 'string' ? options.indent : '  '

    let output: string
    if (options.minify) {
      output = parsed.root.children.map((child) => renderMinified(child, mode)).join('')
      if (mode === 'html') output = output.trim()
    } else {
      output = parsed.root.children
        .map((child) => renderPretty(child, mode, indent, 0))
        .filter(Boolean)
        .join('\n')
    }

    return {
      ok: true,
      text: output,
      mode,
      stats: {
        lines: output ? output.split('\n').length : 0,
        chars: output.length,
        bytes: byteLength(output),
        tags: parsed.tags,
        depth: parsed.depth,
      },
    }
  } catch (error) {
    if (!(error instanceof MarkupSyntaxError)) throw error
    return { ok: false, error: describeError(input, error) }
  }
}

export interface MarkupToken {
  type: 'tag' | 'attr' | 'string' | 'comment' | 'doctype' | 'plain' | 'punct'
  text: string
}

/**
 * 把已格式化好的标记切成着色片段。输出已经是规整的标记，按字符扫描即可；
 * 页面用 v-for 渲染片段，不走 v-html。
 */
export function tokenizeMarkup(text: string): MarkupToken[] {
  const tokens: MarkupToken[] = []
  if (text.length > INLINE_LIMIT) return [{ type: 'plain', text }]

  let last = 0
  const push = (type: MarkupToken['type'], value: string): void => {
    if (value) tokens.push({ type, text: value })
  }

  const tokenizeTag = (raw: string): void => {
    let i = 0
    push('punct', '<')
    i = 1
    if (raw[i] === '/') {
      push('punct', '/')
      i++
    }
    if (raw[i] === '!' || raw[i] === '?') {
      push('doctype', raw.slice(i))
      return
    }
    const nameMatch = /^[^\s/>]+/.exec(raw.slice(i))
    if (nameMatch) {
      push('tag', nameMatch[0])
      i += nameMatch[0].length
    }
    while (i < raw.length) {
      const rest = raw.slice(i)
      const punct = /^[=/>]+/.exec(rest)
      if (punct) {
        push('punct', punct[0])
        i += punct[0].length
        continue
      }
      const space = /^\s+/.exec(rest)
      if (space) {
        push('plain', space[0])
        i += space[0].length
        continue
      }
      if (raw[i] === '"' || raw[i] === "'") {
        const quote = raw[i]
        let end = i + 1
        while (end < raw.length && raw[end] !== quote) end++
        push('string', raw.slice(i, Math.min(end + 1, raw.length)))
        i = Math.min(end + 1, raw.length)
        continue
      }
      const attr = /^[^\s=/>]+/.exec(rest)
      if (attr) {
        push('attr', attr[0])
        i += attr[0].length
        continue
      }
      push('plain', raw[i])
      i++
    }
  }

  let i = 0
  while (i < text.length) {
    if (text.startsWith('<!--', i)) {
      push('plain', text.slice(last, i))
      const end = text.indexOf('-->', i + 4)
      const stop = end === -1 ? text.length : end + 3
      push('comment', text.slice(i, stop))
      i = stop
      last = i
      continue
    }
    if (text[i] === '<') {
      const next = text[i + 1]
      if (next !== undefined && (next === '!' || next === '?' || next === '/' || /[A-Za-z_:]/.test(next))) {
        const end = findTagEnd(text, i)
        if (end !== -1) {
          push('plain', text.slice(last, i))
          tokenizeTag(text.slice(i, end + 1))
          i = end + 1
          last = i
          continue
        }
      }
    }
    i++
  }
  push('plain', text.slice(last))
  return tokens
}

const MESSAGES: Record<string, { zh: string; en: string }> = {
  empty: { zh: '内容为空', en: 'Input is empty' },
  tooLarge: { zh: '内容超过 2,000,000 字符上限', en: 'Input exceeds the 2,000,000 character limit' },
  tooDeep: { zh: `嵌套超过 ${MARKUP_MAX_DEPTH} 层`, en: `Nesting exceeds ${MARKUP_MAX_DEPTH} levels` },
  unterminatedComment: { zh: '注释没有正常结束', en: 'Unterminated comment' },
  unterminatedCdata: { zh: 'CDATA 没有正常结束', en: 'Unterminated CDATA section' },
  unterminatedTag: { zh: '标签没有正常结束', en: 'Unterminated tag' },
  unterminatedDeclaration: { zh: '声明没有正常结束', en: 'Unterminated declaration' },
  invalidTag: { zh: '非法的标签名', en: 'Invalid tag name' },
  unclosedTag: { zh: '标签未闭合', en: 'Unclosed tag' },
  mismatchedTag: { zh: '闭合标签与开始标签不匹配', en: 'Mismatched closing tag' },
  strayCloseTag: { zh: '多余的闭合标签', en: 'Stray closing tag' },
}

export function markupErrorMessage(code: string, locale: Locale, detail = ''): string {
  const message = MESSAGES[code]?.[locale] ?? (locale === 'zh' ? '标记解析失败' : 'Failed to parse markup')
  return detail ? `${message}: ${detail}` : message
}

export interface MarkupRunData {
  mode: MarkupMode
  tags: number
  depth: number
}

export const run: ToolRun<MarkupRunData> = (input, options, ctx): ToolResult<MarkupRunData> => {
  const result = formatMarkup(input, {
    mode: options.mode === 'xml' || options.mode === 'html' ? options.mode : 'auto',
    indent: typeof options.indent === 'string' ? options.indent : '  ',
    minify: Boolean(options.minify),
  })

  if (!result.ok) {
    return {
      ok: false,
      error: {
        ...result.error,
        message: markupErrorMessage(result.error.code, ctx.locale, result.error.detail),
      },
    }
  }

  return {
    ok: true,
    output: result.text,
    stats: { ...result.stats },
    data: { mode: result.mode, tags: result.stats.tags, depth: result.stats.depth },
  }
}

export const SAMPLE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>bit_pouch</title>
</head>
<body>
<!-- 工具入口 -->
<main class="shell">
<h1>开发者的随身工具袋</h1>
<p>本地优先，<strong>即开即用</strong>，支持 <code>JSON</code> 与 XML。</p>
<ul>
<li>格式化
<li>压缩
<li>语法校验
</ul>
<img src="/logo.svg" alt="bit_pouch">
</main>
</body>
</html>`

export const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<project name="bit_pouch" version="0.4.0">
  <!-- 纯本地工具集 -->
  <modules>
    <module id="json" runtime="worker">JSON 格式化</module>
    <module id="markup" runtime="worker">XML / HTML 格式化</module>
  </modules>
  <platforms>
    <platform>web</platform>
    <platform>desktop</platform>
    <platform>mobile</platform>
  </platforms>
  <meta enabled="true" offline="true" />
</project>`
