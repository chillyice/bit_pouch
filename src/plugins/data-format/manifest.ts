import type { ToolManifest } from '@/core/types'

export default {
  id: 'data-format',
  name: { zh: '数据格式转换', en: 'Data Format Converter' },
  description: {
    zh: 'YAML / TOML / INI / .env / Properties 与 JSON 互转',
    en: 'Convert between YAML, TOML, INI, .env, Properties and JSON',
  },
  category: 'convert',
  icon: 'braces',
  keywords: ['yaml', 'toml', 'ini', 'env', 'properties', 'json', 'convert', '配置', '转换'],
  version: '0.1.0',
  runtime: 'worker',
  platforms: ['web', 'desktop', 'mobile'],
  offline: true,
  order: 35,
} satisfies ToolManifest
