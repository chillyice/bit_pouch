import { getManifest, loadRun } from './registry'
import type { Locale, ToolResult } from './types'

interface Pending {
  resolve: (result: ToolResult) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

let worker: Worker | null = null
let requestSeq = 0
const pending = new Map<number, Pending>()

const WORKER_TIMEOUT_MS = 30_000

function rejectAll(reason: string): void {
  for (const [id, entry] of pending) {
    clearTimeout(entry.timer)
    pending.delete(id)
    entry.reject(new Error(reason))
  }
}

function ensureWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null
  if (worker) return worker
  try {
    worker = new Worker(new URL('./worker/tool.worker.ts', import.meta.url), { type: 'module' })
    worker.addEventListener('message', (event: MessageEvent) => {
      const { requestId, result, error } = event.data ?? {}
      const entry = pending.get(requestId)
      if (!entry) return
      clearTimeout(entry.timer)
      pending.delete(requestId)
      if (error) {
        entry.reject(Object.assign(new Error(error.message || 'worker error'), { code: error.code }))
      } else {
        entry.resolve(result as ToolResult)
      }
    })
    worker.addEventListener('error', (event) => {
      const message = event.message || 'Worker 运行失败'
      rejectAll(message)
      worker?.terminate()
      worker = null
    })
    return worker
  } catch (error) {
    console.warn('[bit_pouch] Worker 不可用，回退主线程', error)
    worker = null
    return null
  }
}

function runInWorker(
  id: string,
  input: string,
  options: Record<string, unknown>,
  locale: Locale,
  signal?: AbortSignal,
): Promise<ToolResult> {
  const active = ensureWorker()
  if (!active) return Promise.reject(Object.assign(new Error('worker unavailable'), { code: 'WORKER_UNAVAILABLE' }))

  return new Promise<ToolResult>((resolve, reject) => {
    const requestId = ++requestSeq
    const timer = setTimeout(() => {
      pending.delete(requestId)
      reject(Object.assign(new Error(`工具 ${id} 运行超时（${WORKER_TIMEOUT_MS}ms）`), { code: 'WORKER_TIMEOUT' }))
      // 单 Worker 模型下超时通常意味着计算失去响应，销毁后下次请求会重新创建。
      worker?.terminate()
      worker = null
      rejectAll('Worker 已因超时重置')
    }, WORKER_TIMEOUT_MS)

    pending.set(requestId, { resolve, reject, timer })

    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer)
        pending.delete(requestId)
        reject(Object.assign(new Error('aborted'), { code: 'ABORTED' }))
        return
      }
      signal.addEventListener(
        'abort',
        () => {
          if (!pending.has(requestId)) return
          clearTimeout(timer)
          pending.delete(requestId)
          reject(Object.assign(new Error('aborted'), { code: 'ABORTED' }))
        },
        { once: true },
      )
    }

    active.postMessage({ requestId, id, input, options, locale })
  })
}

async function runInMain(
  id: string,
  input: string,
  options: Record<string, unknown>,
  locale: Locale,
): Promise<ToolResult> {
  const module = await loadRun(id)
  return module.run(input, options, { locale })
}

/**
 * 统一调用入口。视图不需要关心工具跑在主线程还是 Worker。
 * 失败一律收敛成 ToolResult，只有 Worker 基础设施异常才会抛出。
 */
export async function callTool<T = unknown>(
  id: string,
  input: string,
  options: Record<string, unknown> = {},
  locale: Locale = 'zh',
  signal?: AbortSignal,
): Promise<ToolResult<T>> {
  const manifest = getManifest(id)
  if (!manifest) {
    return { ok: false, error: { code: 'NOT_FOUND', message: `未找到工具 ${id}` } }
  }

  try {
    if (manifest.runtime === 'worker') {
      try {
        return (await runInWorker(id, input, options, locale, signal)) as ToolResult<T>
      } catch (error) {
        const code = (error as { code?: string }).code
        // 只有 Worker 本身不可用才回退；插件抛错必须原样暴露，避免掩盖 bug。
        if (code !== 'WORKER_UNAVAILABLE') throw error
      }
    }
    return (await runInMain(id, input, options, locale)) as ToolResult<T>
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: { code: 'PLUGIN_ERROR', message } }
  }
}

/** 测试或热更新时可手动重置 Worker。 */
export function resetRunner(): void {
  worker?.terminate()
  worker = null
  rejectAll('runner reset')
}
