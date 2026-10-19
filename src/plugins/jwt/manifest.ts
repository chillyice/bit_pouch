import type { ToolManifest } from '@/core/types'

export default {
  id: 'jwt',
  name: { zh: 'JWT 解析', en: 'JWT Decoder' },
  description: {
    zh: '解码 JWT 头部与载荷，查看签发/过期时间（不验签）',
    en: 'Decode JWT header and payload and inspect issued/expiry times (no signature check)',
  },
  category: 'inspect',
  icon: 'key',
  keywords: ['jwt', 'token', 'bearer', 'claims', 'exp', 'jws', '令牌', '解析', '过期'],
  version: '0.1.0',
  runtime: 'main',
  platforms: ['web', 'desktop', 'mobile'],
  offline: true,
  order: 60,
} satisfies ToolManifest
