import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { clearRecent, loadFavorites, loadRecent, saveFavorites, saveRecent } from '@/core/storage'

// json / markup 已合并为 format；升级时就地映射旧收藏与最近记录，避免用户数据丢失。
const LEGACY_TOOL_IDS: Record<string, string> = { json: 'format', markup: 'format' }

function migrateToolIds(ids: string[]): { ids: string[]; changed: boolean } {
  let changed = false
  const seen = new Set<string>()
  const next: string[] = []
  for (const id of ids) {
    const mapped = LEGACY_TOOL_IDS[id] ?? id
    if (mapped !== id) changed = true
    if (seen.has(mapped)) {
      changed = true
      continue
    }
    seen.add(mapped)
    next.push(mapped)
  }
  return { ids: next, changed }
}

export const useAppStore = defineStore('app', () => {
  const favoriteIds = migrateToolIds(loadFavorites())
  const recentIds = migrateToolIds(loadRecent())
  if (favoriteIds.changed) saveFavorites(favoriteIds.ids)
  if (recentIds.changed) saveRecent(recentIds.ids)

  const favorites = ref<string[]>(favoriteIds.ids)
  const recent = ref<string[]>(recentIds.ids)

  const favoriteSet = computed(() => new Set(favorites.value))
  const isFavorite = (id: string): boolean => favoriteSet.value.has(id)

  function toggleFavorite(id: string): boolean {
    const next = new Set(favorites.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    favorites.value = [...next]
    saveFavorites(favorites.value)
    return next.has(id)
  }

  function markOpened(id: string): void {
    recent.value = [id, ...recent.value.filter((item) => item !== id)].slice(0, 8)
    saveRecent(recent.value)
  }

  function clearRecentTools(): void {
    recent.value = []
    clearRecent()
  }

  return { favorites, recent, isFavorite, toggleFavorite, markOpened, clearRecentTools }
})
