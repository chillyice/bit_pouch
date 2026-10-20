import type { Locale, ToolResult, ToolRun } from '@/core/types'
import { parsePageRange } from './core'

export interface PdfRunData {
  pages: number[]
  total: number
}

const MESSAGES = {
  invalidRange: { zh: '页码范围不合法', en: 'Invalid page range' },
  noPages: { zh: 'PDF 还没有加载页码', en: 'The PDF has no page count yet' },
}

function fail(code: keyof typeof MESSAGES, locale: Locale): ToolResult<PdfRunData> {
  return { ok: false, error: { code, message: MESSAGES[code][locale] } }
}

export const run: ToolRun<PdfRunData> = (input, options, ctx) => {
  const total = Number(options.total ?? 0)
  if (!Number.isInteger(total) || total <= 0) return fail('noPages', ctx.locale)
  const pages = parsePageRange(input, total) as number[] | null
  if (!pages) return fail('invalidRange', ctx.locale)
  return {
    ok: true,
    output: pages.join(','),
    data: { pages, total },
    stats: { pages: pages.length },
  }
}
