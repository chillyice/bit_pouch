import type { ToolManifest } from '@/core/types'

export default {
  id: 'mqtt-topic',
  name: { zh: 'MQTT 主题', en: 'MQTT Topic' },
  description: {
    zh: '解析 MQTT 主题与过滤器，校验语法并判断通配匹配',
    en: 'Parse MQTT topics and filters, validate syntax and test wildcard matching',
  },
  category: 'network',
  icon: 'link',
  keywords: ['mqtt', 'topic', 'filter', 'wildcard', 'share', '主题', '通配', '订阅'],
  version: '0.1.0',
  runtime: 'main',
  platforms: ['web', 'desktop', 'mobile'],
  offline: true,
  order: 58,
} satisfies ToolManifest
