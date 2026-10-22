import type { ToolManifest } from '@/core/types'

export default {
  id: 'curl-convert',
  name: { zh: 'cURL 转换', en: 'cURL Converter' },
  description: {
    zh: '把 cURL 命令转换为 fetch / axios / Python / Go / PowerShell 代码',
    en: 'Convert a cURL command into fetch, axios, Python, Go or PowerShell code',
  },
  category: 'convert',
  icon: 'terminal',
  keywords: ['curl', 'fetch', 'axios', 'python', 'go', 'powershell', 'http', '请求', '转换'],
  version: '0.1.0',
  runtime: 'main',
  platforms: ['web', 'desktop', 'mobile'],
  offline: true,
  order: 56,
} satisfies ToolManifest
