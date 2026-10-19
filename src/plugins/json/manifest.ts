import type { ToolManifest } from '@/core/types'

export default {
  id: 'json',
  name: { zh: 'JSON 格式化', en: 'JSON Formatter' },
  description: {
    zh: '格式化、压缩、键名排序；保留长整数与重复键',
    en: 'Pretty-print, minify and sort keys while preserving long numbers',
  },
  category: 'text',
  icon: 'braces',
  keywords: ['json', 'format', 'pretty', 'minify', 'sort', '格式化', '压缩', '排序', '校验'],
  version: '0.1.0',
  runtime: 'worker',
  platforms: ['web', 'desktop', 'mobile'],
  offline: true,
  order: 10,
} satisfies ToolManifest
