import type { ToolManifest } from '@/core/types'

export default {
  id: 'url',
  name: { zh: 'URL 解析', en: 'URL Parser' },
  description: {
    zh: '拆解 URL 的协议、主机、路径、片段与查询参数',
    en: 'Break a URL into protocol, host, path, fragment and query parameters',
  },
  category: 'network',
  icon: 'link',
  keywords: ['url', 'uri', 'query', 'params', 'search', '链接', '参数', '解析'],
  version: '0.1.0',
  runtime: 'main',
  platforms: ['web', 'desktop', 'mobile'],
  offline: true,
  order: 100,
} satisfies ToolManifest
