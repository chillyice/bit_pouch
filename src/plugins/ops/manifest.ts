import type { ToolManifest } from '@/core/types'

export default {
  id: 'ops',
  name: { zh: '运维速查', en: 'Ops Cheatsheet' },
  description: {
    zh: 'systemd / Nginx / Docker / MySQL / SSH 命令与常用对照表',
    en: 'systemd / Nginx / Docker / MySQL / SSH commands and quick references',
  },
  category: 'text',
  icon: 'terminal',
  keywords: ['ops', 'shell', 'nginx', 'docker', 'systemd', 'mysql', 'ssh', '运维', '命令', '速查'],
  version: '1.0.0',
  runtime: 'main',
  platforms: ['web', 'desktop', 'mobile'],
  offline: true,
  order: 126,
} satisfies ToolManifest
