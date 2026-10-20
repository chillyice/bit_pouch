import type { ToolManifest } from '@/core/types'

export default {
  id: 'jwt',
  name: { zh: 'JWT 与密钥', en: 'JWT & Keys' },
  description: {
    zh: '解码 / HMAC·RSA·ECDSA 验签 / 密钥对与 PEM·JWK / AES-GCM 加解密',
    en: 'Decode / HMAC, RSA & ECDSA verify / key pairs & PEM-JWK / AES-GCM encryption',
  },
  category: 'inspect',
  icon: 'key',
  keywords: ['jwt', 'token', 'hmac', 'rsa', 'ecdsa', 'pem', 'jwk', 'aes', '令牌', '验签', '密钥'],
  version: '1.0.0',
  runtime: 'main',
  platforms: ['web', 'desktop', 'mobile'],
  offline: true,
  order: 60,
} satisfies ToolManifest
