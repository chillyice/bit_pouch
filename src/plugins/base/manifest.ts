import type { ToolManifest } from '@/core/types'

export default {
  id: 'base',
  name: { zh: '进制转换', en: 'Base Converter' },
  description: {
    zh: '2–36 进制整数/小数互转，大整数用 BigInt 精确计算',
    en: 'Convert integers and fractions between bases 2–36 with exact BigInt math',
  },
  category: 'convert',
  icon: 'binary',
  keywords: ['base', 'radix', 'binary', 'octal', 'decimal', 'hex', 'bigint', '进制', '二进制', '十六进制'],
  version: '0.1.0',
  runtime: 'main',
  platforms: ['web', 'desktop', 'mobile'],
  offline: true,
  order: 30,
} satisfies ToolManifest
