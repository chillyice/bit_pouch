import type { ToolManifest } from '@/core/types'

export default {
  id: 'uuid',
  name: { zh: 'UUID 生成', en: 'UUID Generator' },
  description: {
    zh: '批量生成 UUID v4，或解析现有 UUID 的版本与变体',
    en: 'Generate UUID v4 in batches, or inspect the version and variant of an existing UUID',
  },
  category: 'text',
  icon: 'fingerprint',
  keywords: ['uuid', 'guid', 'v4', 'random', 'id', '标识', '唯一', '生成'],
  version: '0.1.0',
  runtime: 'main',
  platforms: ['web', 'desktop', 'mobile'],
  offline: true,
  order: 90,
} satisfies ToolManifest
