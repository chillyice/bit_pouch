const PREFIX = 'bitpouch:'

export const STORAGE_KEYS = {
  favorites: `${PREFIX}favorites:v1`,
  recent: `${PREFIX}recent:v1`,
  locale: `${PREFIX}locale:v1`,
  theme: `${PREFIX}theme:v1`,
  prefs: (toolId: string) => `${PREFIX}prefs:${toolId}:v1`,
} as const

export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 隐私模式 / 配额满时静默降级，不影响本次会话
  }
}

export function readString(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // ignore
  }
}

export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // ignore
  }
}

export function clearAppStorage(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(PREFIX)) localStorage.removeItem(key)
    }
  } catch {
    // ignore
  }
}

export function loadFavorites(): string[] {
  const value = readJson<unknown>(STORAGE_KEYS.favorites, [])
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
}

export function saveFavorites(ids: string[]): void {
  writeJson(STORAGE_KEYS.favorites, [...new Set(ids)])
}

export function loadRecent(): string[] {
  const value = readJson<unknown>(STORAGE_KEYS.recent, [])
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
}

export function pushRecent(id: string): string[] {
  const next = [id, ...loadRecent().filter((item) => item !== id)].slice(0, 8)
  writeJson(STORAGE_KEYS.recent, next)
  return next
}

export function clearRecent(): void {
  removeKey(STORAGE_KEYS.recent)
}
