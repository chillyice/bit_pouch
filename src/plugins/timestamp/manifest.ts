import type { ToolManifest } from '@/core/types'

export default {
  id: 'timestamp',
  name: { zh: '时间戳转换', en: 'Timestamp Converter' },
  description: {
    zh: 'Unix 秒/毫秒、ISO 8601 与本地时间互转',
    en: 'Convert Unix seconds/milliseconds, ISO 8601 and local time',
  },
  category: 'convert',
  icon: 'clock',
  keywords: ['timestamp', 'unix', 'epoch', 'date', 'iso', 'utc', '时间戳', '日期', '时间'],
  version: '0.1.0',
  runtime: 'main',
  platforms: ['web', 'desktop', 'mobile'],
  offline: true,
  order: 80,
} satisfies ToolManifest
