import type { ToolManifest } from '@/core/types'

export default {
  id: 'format',
  name: { zh: '格式化', en: 'Formatter' },
  description: {
    zh: '格式化、压缩、校验 JSON / XML / HTML / SVG；JSON 可按键名排序',
    en: 'Pretty-print, minify and validate JSON / XML / HTML / SVG, with optional JSON key sorting',
  },
  category: 'text',
  icon: 'braces',
  keywords: [
    'json', 'xml', 'html', 'svg', 'markup', 'format', 'formatter', 'pretty', 'minify', 'sort',
    '格式化', '字符串', '压缩', '排序', '校验',
  ],
  version: '0.1.0',
  runtime: 'worker',
  platforms: ['web', 'desktop', 'mobile'],
  offline: true,
  order: 10,
} satisfies ToolManifest
