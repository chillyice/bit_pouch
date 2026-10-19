/// <reference lib="webworker" />

import type { Locale, ToolResult, ToolRuntimeModule } from '../types'

/**
 * 单例 Worker：按 id 懒加载插件 run.ts。
 * 只允许传 structured-clone 友好的数据（string / number / boolean / Array / plain object）。
 */
const runners = import.meta.glob<ToolRuntimeModule>('../../plugins/*/run.ts')

interface RequestMessage {
  requestId: number
  id: string
  input: string
  options: Record<string, unknown>
  locale: Locale
}

const scope = self as unknown as DedicatedWorkerGlobalScope

scope.addEventListener('message', async (event: MessageEvent<RequestMessage>) => {
  const { requestId, id, input, options, locale } = event.data
  const entry = Object.entries(runners).find(([path]) => path.includes(`/plugins/${id}/run.ts`))
  if (!entry) {
    scope.postMessage({
      requestId,
      error: { code: 'NOT_FOUND', message: `Worker 中未找到插件 ${id}` },
    })
    return
  }

  try {
    const module = await entry[1]()
    const result: ToolResult = await module.run(input, options ?? {}, { locale })
    scope.postMessage({ requestId, result })
  } catch (error) {
    scope.postMessage({
      requestId,
      error: { code: 'PLUGIN_ERROR', message: error instanceof Error ? error.message : String(error) },
    })
  }
})
