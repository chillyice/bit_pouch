// 正则测试：pattern / flags 从选项传入，input 是待匹配文本。
// 输入上限用于降低灾难性回溯的影响；正则本身无法中断，只做规模约束。
import type { Locale, ToolResult, ToolRun } from '@/core/types'

export const MAX_INPUT_LENGTH = 20_000
export const MAX_MATCHES = 500
const ALLOWED_FLAGS = 'dgimsuy'

export interface RegexMatch {
  index: number
  value: string
  groups: (string | null)[]
  named: Record<string, string> | null
}

export interface RegexRunData {
  matches: RegexMatch[]
  count: number
  truncated: boolean
  replaced: string | null
  flags: string
}

export type RegexErrorCode = 'emptyPattern' | 'invalidPattern' | 'invalidFlags' | 'tooLong' | 'invalidReplacement'

const MESSAGES: Record<RegexErrorCode, { zh: string; en: string }> = {
  emptyPattern: { zh: '请输入正则表达式', en: 'Enter a regular expression' },
  invalidPattern: { zh: '正则表达式不合法', en: 'Invalid regular expression' },
  invalidFlags: { zh: `标志只能包含 ${ALLOWED_FLAGS}`, en: `Flags may only contain ${ALLOWED_FLAGS}` },
  tooLong: { zh: `测试文本超过 ${MAX_INPUT_LENGTH} 个字符`, en: `Test text exceeds ${MAX_INPUT_LENGTH} characters` },
  invalidReplacement: { zh: '替换表达式不合法', en: 'Invalid replacement pattern' },
}

function fail(code: RegexErrorCode, locale: Locale, detail?: string): ToolResult<RegexRunData> {
  const base = MESSAGES[code][locale]
  return { ok: false, error: { code, message: detail ? `${base}: ${detail}` : base } }
}

export function normalizeFlags(raw: string): string | null {
  const seen = new Set<string>()
  for (const flag of raw) {
    if (!ALLOWED_FLAGS.includes(flag)) return null
    seen.add(flag)
  }
  return [...seen].join('')
}

export const run: ToolRun<RegexRunData> = (input, options, ctx) => {
  const pattern = typeof options.pattern === 'string' ? options.pattern : ''
  if (!pattern) return fail('emptyPattern', ctx.locale)

  const rawFlags = typeof options.flags === 'string' ? options.flags : 'g'
  const normalizedFlags = normalizeFlags(rawFlags)
  if (normalizedFlags === null) return fail('invalidFlags', ctx.locale)

  const text = String(input ?? '')
  if (text.length > MAX_INPUT_LENGTH) return fail('tooLong', ctx.locale)

  // matchAll / replace 需要全局标志；用户没写 g 时内部补上，语义是“测试全部匹配”。
  const flags = normalizedFlags.includes('g') ? normalizedFlags : `${normalizedFlags}g`

  let regex: RegExp
  try {
    regex = new RegExp(pattern, flags)
  } catch (error) {
    return fail('invalidPattern', ctx.locale, error instanceof Error ? error.message : undefined)
  }

  const matches: RegexMatch[] = []
  let truncated = false
  try {
    for (const match of text.matchAll(regex)) {
      if (matches.length >= MAX_MATCHES) {
        truncated = true
        break
      }
      matches.push({
        index: match.index ?? 0,
        value: match[0],
        groups: match.slice(1).map((group) => group ?? null),
        named: match.groups ? { ...match.groups } : null,
      })
    }
  } catch (error) {
    return fail('invalidPattern', ctx.locale, error instanceof Error ? error.message : undefined)
  }

  const replacement = typeof options.replacement === 'string' ? options.replacement : ''
  let replaced: string | null = null
  if (replacement.length > 0) {
    try {
      replaced = text.replace(regex, replacement)
    } catch {
      return fail('invalidReplacement', ctx.locale)
    }
  }

  return {
    ok: true,
    output: replaced ?? matches.map((match) => `${match.index}: ${match.value}`).join('\n'),
    stats: { matches: matches.length, flags, chars: text.length },
    data: { matches, count: matches.length, truncated, replaced, flags },
  }
}
