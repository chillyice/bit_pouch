import type { ToolManifest } from '@/core/types'

export default {
  id: 'http-message',
  name: { zh: 'HTTP 报文', en: 'HTTP Message' },
  description: {
    zh: '解析或生成原始 HTTP 请求/响应，展开头、Cookie、查询与正文',
    en: 'Parse or build raw HTTP requests/responses with headers, cookies, query and body',
  },
  category: 'network',
  icon: 'ethernet-port',
  keywords: ['http', 'request', 'response', 'header', 'cookie', 'chunked', '报文', '请求', '响应'],
  version: '0.1.0',
  runtime: 'worker',
  platforms: ['web', 'desktop', 'mobile'],
  offline: true,
  order: 55,
} satisfies ToolManifest
