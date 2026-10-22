import type { ToolManifest } from '@/core/types'

export default {
  id: 'format',
  name: { zh: '格式美化', en: 'Format & Beautify' },
  description: {
    zh: '格式化、压缩、校验 JSON / XML / HTML / SVG / SQL；结果可切换树形视图与 hover 联动',
    en: 'Pretty-print, minify and validate JSON / XML / HTML / SVG / SQL, with a collapsible tree and hover linking',
  },
  category: 'text',
  icon: 'braces',
  keywords: [
    'json', 'xml', 'html', 'svg', 'sql', 'markup', 'format', 'formatter', 'pretty', 'minify', 'sort', 'tree',
    '格式美化', '格式化', '字符', '压缩', '排序', '校验', '树形',
  ],
  version: '0.1.0',
  runtime: 'worker',
  platforms: ['web', 'desktop', 'mobile'],
  offline: true,
  order: 10,
} satisfies ToolManifest
