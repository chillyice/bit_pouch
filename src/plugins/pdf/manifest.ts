import type { ToolManifest } from '@/core/types'

export default {
  id: 'pdf',
  name: { zh: 'PDF 转换', en: 'PDF Converter' },
  description: {
    zh: 'PDF 转图片 / 图片转 PDF / PDF 提取文字，全部本机完成',
    en: 'PDF to images / images to PDF / extract text, all on-device',
  },
  category: 'convert',
  icon: 'pdf',
  keywords: ['pdf', 'image', 'text', 'convert', '转换', '提取文字', 'zip'],
  version: '1.0.0',
  runtime: 'main',
  platforms: ['web', 'desktop', 'mobile'],
  offline: true,
  order: 40,
} satisfies ToolManifest
