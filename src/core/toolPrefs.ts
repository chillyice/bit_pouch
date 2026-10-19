import { reactive, watch } from 'vue'
import { readJson, STORAGE_KEYS, writeJson } from './storage'

/**
 * 只持久化「选项」，不持久化输入内容。
 * 这是工具的隐私边界：任何输入文本都不应落到 localStorage。
 */
export function useToolPrefs<T extends Record<string, unknown>>(toolId: string, defaults: T): T {
  const saved = readJson<Partial<T>>(STORAGE_KEYS.prefs(toolId), {})
  const state = reactive({ ...defaults, ...saved }) as T

  watch(
    state,
    () => writeJson(STORAGE_KEYS.prefs(toolId), state),
    { deep: true, flush: 'post' },
  )

  return state
}
