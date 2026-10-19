import type { ToolManifest } from '@/core/types'

export default {
  id: 'codec',
  name: { zh: '字符编码转换', en: 'Text Codec' },
  description: {
    zh: 'Unicode / HTML 实体 / URL / Base64 / UTF-8 字节互转',
    en: 'Convert between Unicode, HTML entities, URL, Base64 and UTF-8 bytes',
  },
  category: 'codec',
  icon: 'case-sensitive',
  keywords: ['unicode', 'html', 'entity', 'url', 'base64', 'hex', 'utf8', '编码', '解码', '转义'],
  version: '0.1.0',
  runtime: 'main',
  platforms: ['web', 'desktop', 'mobile'],
  offline: true,
  order: 20,
} satisfies ToolManifest
