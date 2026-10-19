import type { ToolManifest } from '@/core/types'

export default {
  id: 'hash',
  name: { zh: 'Hash 计算', en: 'Hash Calculator' },
  description: {
    zh: '计算文本的 MD5 / SHA-1 / SHA-256 / SHA-384 / SHA-512 摘要',
    en: 'Compute MD5 / SHA-1 / SHA-256 / SHA-384 / SHA-512 digests for text',
  },
  category: 'inspect',
  icon: 'hash',
  keywords: ['hash', 'md5', 'sha1', 'sha256', 'sha384', 'sha512', 'digest', 'checksum', '摘要', '校验'],
  version: '0.1.0',
  runtime: 'worker',
  platforms: ['web', 'desktop', 'mobile'],
  offline: true,
  order: 70,
} satisfies ToolManifest
