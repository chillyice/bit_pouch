import type { ToolManifest } from '@/core/types'

export default {
  id: 'subnet',
  name: { zh: '子网计算', en: 'Subnet Calculator' },
  description: {
    zh: 'IPv4 网络/广播地址、可用主机范围、地址类型与二进制对照',
    en: 'IPv4 network, broadcast, host range, address class and binary view',
  },
  category: 'network',
  icon: 'network',
  keywords: ['ipv4', 'subnet', 'mask', 'cidr', 'network', 'broadcast', '子网', '掩码', '网段'],
  version: '0.1.0',
  runtime: 'main',
  platforms: ['web', 'desktop', 'mobile'],
  offline: true,
  order: 50,
} satisfies ToolManifest
