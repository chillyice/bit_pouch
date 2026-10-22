import type { ToolManifest } from '@/core/types'

export default {
  id: 'packet',
  name: { zh: '网络报文解析', en: 'Packet Decoder' },
  description: {
    zh: '自动识别以太网 / IPv4 / IPv6 / TCP / UDP / DNS 等协议，逐字段解释报文含义',
    en: 'Auto-detect Ethernet / IPv4 / IPv6 / TCP / UDP / DNS and explain every field',
  },
  category: 'inspect',
  icon: 'ethernet-port',
  keywords: ['packet', 'hex', 'ethernet', 'ipv4', 'ipv6', 'tcp', 'udp', 'dns', 'http', 'tls', 'capture', '报文', '抓包', '协议', '校验'],
  version: '0.2.0',
  runtime: 'main',
  platforms: ['web', 'desktop', 'mobile'],
  offline: true,
  order: 40,
} satisfies ToolManifest
