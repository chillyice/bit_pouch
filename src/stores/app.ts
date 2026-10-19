import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { clearRecent, loadFavorites, loadRecent, pushRecent, saveFavorites } from '@/core/storage'

export const useAppStore = defineStore('app', () => {
  const favorites = ref<string[]>(loadFavorites())
  const recent = ref<string[]>(loadRecent())

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
    recent.value = pushRecent(id)
  }

  function clearRecentTools(): void {
    recent.value = []
    clearRecent()
  }

  return { favorites, recent, isFavorite, toggleFavorite, markOpened, clearRecentTools }
})
