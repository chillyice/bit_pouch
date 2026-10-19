import type { ToolManifest } from '@/core/types'

export default {
  id: 'packet',
  name: { zh: '报文解析', en: 'Packet Parser' },
  description: {
    zh: '十六进制报文拆字段、逐字节查看、CRC/校验值参考',
    en: 'Split hex frames into fields, inspect bytes and compute checksums',
  },
  category: 'inspect',
  icon: 'ethernet-port',
  keywords: ['packet', 'hex', 'frame', 'protocol', 'crc', 'modbus', '报文', '帧', '校验', '十六进制'],
  version: '0.1.0',
  runtime: 'main',
  platforms: ['web', 'desktop', 'mobile'],
  offline: true,
  order: 40,
} satisfies ToolManifest
