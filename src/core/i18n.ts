import { computed, ref } from 'vue'
import { readString, STORAGE_KEYS, writeString } from './storage'
import type { Locale, LocalizedText } from './types'

const zh = {
  'app.tagline': '开发者的随身工具袋',
  'nav.all': '全部工具',
  'nav.favorites': '收藏',
  'nav.recent': '最近使用',
  'nav.settings': '设置',
  'nav.about': '关于',
  'search.placeholder': '搜索工具…',
  'search.empty': '没有匹配的工具',
  'home.title': '工具箱',
  'home.subtitle': '本地处理 · 即开即用 · 插件化扩展',
  'home.all': '全部',
  'home.count': '{n} 个工具',
  'home.favorites': '收藏',
  'home.recent': '最近使用',
  'home.emptyFavorites': '还没有收藏。打开工具后点右上角的星标。',
  'home.emptyRecent': '打开过的工具会出现在这里。',
  'category.codec': '编码',
  'category.convert': '转换',
  'category.inspect': '解析',
  'category.network': '网络',
  'category.text': '文本',
  'tool.back': '返回工具箱',
  'tool.local': '本地处理',
  'tool.worker': 'Worker',
  'tool.experimental': '实验',
  'tool.favorite': '收藏',
  'tool.unfavorite': '取消收藏',
  'action.copy': '复制',
  'action.copied': '已复制',
  'action.copyFailed': '复制失败，请手动选择',
  'action.clear': '清空',
  'action.sample': '示例',
  'action.swap': '交换',
  'action.run': '运行',
  'action.format': '格式化',
  'action.minify': '压缩',
  'action.retry': '重试',
  'common.input': '输入',
  'common.output': '输出',
  'common.options': '选项',
  'common.empty': '暂无内容',
  'common.error': '出错',
  'common.loading': '加载中…',
  'common.notFound': '没有找到这个工具',
  'common.notFoundHint': '它可能被移除，或链接拼错了。',
  'settings.title': '设置',
  'settings.appearance': '外观',
  'settings.theme': '主题',
  'settings.theme.dark': '深色',
  'settings.theme.light': '浅色',
  'settings.language': '语言',
  'settings.privacy': '隐私',
  'settings.privacyText': '所有工具默认在本机运行，不上传输入内容。只有工具选项会写入本地存储。',
  'settings.data': '本地数据',
  'settings.clearRecent': '清除最近使用',
  'settings.clearAll': '清除全部本地数据',
  'settings.cleared': '已清除',
  'settings.about': '关于',
  'settings.version': '版本',
  'settings.shell': '运行形态',
  'settings.shell.web': 'Web / PWA',
  'settings.shell.desktop': '桌面端',
  'settings.shell.mobile': '移动端',
  'settings.shortcuts': '快捷键',
  'settings.shortcutPalette': '打开命令面板',
  'settings.shortcutRun': '运行当前工具',
  'settings.shortcutBack': '返回',
  'toast.favorited': '已收藏',
  'toast.unfavorited': '已取消收藏',
  'palette.placeholder': '输入工具名、关键词或描述…',
  'palette.hint': '↑↓ 选择 · Enter 打开 · Esc 关闭',
  'palette.noResults': '没有匹配结果',
  'error.NOT_FOUND': '未找到工具',
  'error.WORKER_TIMEOUT': '处理超时，请缩小输入后重试',
  'error.PLUGIN_ERROR': '工具运行失败',
} as const

export type MessageKey = keyof typeof zh

const en: Record<MessageKey, string> = {
  'app.tagline': 'A pocket toolbox for builders',
  'nav.all': 'All tools',
  'nav.favorites': 'Favorites',
  'nav.recent': 'Recent',
  'nav.settings': 'Settings',
  'nav.about': 'About',
  'search.placeholder': 'Search tools…',
  'search.empty': 'No matching tools',
  'home.title': 'Toolbox',
  'home.subtitle': 'Local-first · instant · plugin-based',
  'home.all': 'All',
  'home.count': '{n} tools',
  'home.favorites': 'Favorites',
  'home.recent': 'Recent',
  'home.emptyFavorites': 'Nothing saved yet. Open a tool and tap the star.',
  'home.emptyRecent': 'Tools you open will show up here.',
  'category.codec': 'Encode',
  'category.convert': 'Convert',
  'category.inspect': 'Inspect',
  'category.network': 'Network',
  'category.text': 'Text',
  'tool.back': 'Back to toolbox',
  'tool.local': 'Local',
  'tool.worker': 'Worker',
  'tool.experimental': 'Beta',
  'tool.favorite': 'Favorite',
  'tool.unfavorite': 'Remove favorite',
  'action.copy': 'Copy',
  'action.copied': 'Copied',
  'action.copyFailed': 'Copy failed — select manually',
  'action.clear': 'Clear',
  'action.sample': 'Sample',
  'action.swap': 'Swap',
  'action.run': 'Run',
  'action.format': 'Format',
  'action.minify': 'Minify',
  'action.retry': 'Retry',
  'common.input': 'Input',
  'common.output': 'Output',
  'common.options': 'Options',
  'common.empty': 'Nothing here yet',
  'common.error': 'Error',
  'common.loading': 'Loading…',
  'common.notFound': 'Tool not found',
  'common.notFoundHint': 'It may have been removed, or the link is wrong.',
  'settings.title': 'Settings',
  'settings.appearance': 'Appearance',
  'settings.theme': 'Theme',
  'settings.theme.dark': 'Dark',
  'settings.theme.light': 'Light',
  'settings.language': 'Language',
  'settings.privacy': 'Privacy',
  'settings.privacyText': 'Every tool runs locally by default. Inputs are never uploaded. Only tool options are stored locally.',
  'settings.data': 'Local data',
  'settings.clearRecent': 'Clear recent tools',
  'settings.clearAll': 'Clear all local data',
  'settings.cleared': 'Cleared',
  'settings.about': 'About',
  'settings.version': 'Version',
  'settings.shell': 'Runtime',
  'settings.shell.web': 'Web / PWA',
  'settings.shell.desktop': 'Desktop',
  'settings.shell.mobile': 'Mobile',
  'settings.shortcuts': 'Shortcuts',
  'settings.shortcutPalette': 'Open command palette',
  'settings.shortcutRun': 'Run current tool',
  'settings.shortcutBack': 'Go back',
  'toast.favorited': 'Added to favorites',
  'toast.unfavorited': 'Removed from favorites',
  'palette.placeholder': 'Search by name, keyword or description…',
  'palette.hint': '↑↓ navigate · Enter open · Esc close',
  'palette.noResults': 'No results',
  'error.NOT_FOUND': 'Tool not found',
  'error.WORKER_TIMEOUT': 'Timed out — try a smaller input',
  'error.PLUGIN_ERROR': 'Tool failed',
}

const dictionaries: Record<Locale, Record<MessageKey, string>> = { zh, en }

const stored = readString(STORAGE_KEYS.locale)
export const locale = ref<Locale>(stored === 'en' ? 'en' : 'zh')

export function setLocale(next: Locale): void {
  locale.value = next
  writeString(STORAGE_KEYS.locale, next)
  document.documentElement.lang = next === 'zh' ? 'zh-CN' : 'en'
}

export function toggleLocale(): void {
  setLocale(locale.value === 'zh' ? 'en' : 'zh')
}

export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const template = dictionaries[locale.value][key] ?? zh[key] ?? key
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? ''))
}

export function localized(text: LocalizedText): string {
  return text[locale.value]
}

export const isZh = computed(() => locale.value === 'zh')
