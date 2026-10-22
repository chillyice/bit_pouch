import type { ToolManifest } from '@/core/types'

export default {
  id: 'ip-range',
  name: { zh: 'IP 段计算', en: 'IP Range' },
  description: {
    zh: 'CIDR 合并、CIDR 与起止地址互转、包含判断与排除',
    en: 'Merge CIDRs, convert CIDR ↔ address ranges, test containment and exclude sub-ranges',
  },
  category: 'network',
  icon: 'network',
  keywords: ['ip', 'cidr', 'subnet', 'range', 'ipv4', 'ipv6', '网段', '合并', '排除'],
  version: '0.1.0',
  runtime: 'main',
  platforms: ['web', 'desktop', 'mobile'],
  offline: true,
  order: 57,
} satisfies ToolManifest
