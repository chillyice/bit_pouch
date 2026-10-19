import type { ToolManifest } from '@/core/types'

export default {
  id: 'regex',
  name: { zh: '正则测试', en: 'Regex Tester' },
  description: {
    zh: '实时查看匹配、分组与替换结果',
    en: 'Inspect matches, capture groups and replacement output',
  },
  category: 'text',
  icon: 'regex',
  keywords: ['regex', 'regexp', 'pattern', 'match', 'replace', 'group', '正则', '匹配', '替换'],
  version: '0.1.0',
  runtime: 'main',
  platforms: ['web', 'desktop', 'mobile'],
  offline: true,
  order: 110,
} satisfies ToolManifest
