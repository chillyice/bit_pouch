import type { ToolManifest } from '@/core/types'

export default {
  id: 'markup',
  name: { zh: 'XML / HTML 格式化', en: 'XML & HTML Formatter' },
  description: {
    zh: '格式化、压缩、校验 XML / HTML / SVG',
    en: 'Pretty-print, minify and validate XML / HTML / SVG',
  },
  category: 'text',
  icon: 'code',
  keywords: ['xml', 'html', 'svg', 'markup', 'format', 'pretty', 'minify', 'doctype', '格式化', '压缩', '校验'],
  version: '0.1.0',
  runtime: 'worker',
  platforms: ['web', 'desktop', 'mobile'],
  offline: true,
  order: 15,
} satisfies ToolManifest
