# bit_pouch API 接入文档

> 面向想给 bit_pouch 增加工具的人。bit_pouch 没有后端，也没有 HTTP / RPC 接口；所有“接入”都是**本地插件契约**：提供一份 `manifest` 和一个纯函数 `run`，应用负责注册、搜索、路由、执行与展示。
>
> - 适用版本：V0.4（契约随应用版本演进）
> - 用户插件（免构建）完整运行时说明：[`用户插件API.md`](用户插件API.md)
> - 内置插件（进仓库）完整开发步骤：[`插件开发指南.md`](插件开发指南.md)
> - 执行模型与性能预算：[`架构设计.md`](架构设计.md)

## 1. 先选接入方式

| | 用户插件 | 内置插件 |
|---|---|---|
| 交付形态 | 单个 `.js` / `.mjs` 文件 | `src/plugins/<id>/` 目录 |
| 是否重新构建 | 否，设置页导入即生效 | 是，随应用一起发布 |
| 谁能安装 | 任何使用者 | 只能随版本分发 |
| 界面 | 统一的输入 / 输出工具页 | 自定义 `View.vue` |
| 执行线程 | 固定主线程 | `main` 或 `worker` |
| 适合 | 文本变换、格式化、个人小工具、快速验证 | 复杂交互、二进制、性能敏感、需要专门 UI |
| 源码位置 | 本机 `localStorage` | 仓库，进版本控制 |

两者共用同一套 `ToolManifest`、`ToolRun`、`ToolResult` 契约。先按用户插件把逻辑跑通，再升级为内置插件，通常不需要改 `run`。

## 2. 最小可运行示例

把下面内容保存为 `my-upper.js`，在 **设置 → 用户插件 → 导入插件文件** 中选择它：

```js
return {
  manifest: {
    id: 'my-upper',
    name: { zh: '我的大写工具', en: 'My uppercase tool' },
    description: { zh: '把输入转成大写', en: 'Uppercase the input' },
    category: 'text',
  },
  run(input) {
    return { ok: true, output: input.toUpperCase() }
  },
}
```

导入后工具立即出现在首页、搜索结果和命令面板里。相同 `id` 再次导入会覆盖更新。

等效的 `export default` 写法也支持：

```js
export default {
  manifest: {
    id: 'my-upper',
    name: { zh: '我的大写工具', en: 'My uppercase tool' },
    description: { zh: '把输入转成大写', en: 'Uppercase the input' },
    category: 'text',
  },
  run(input) {
    return input.toUpperCase()
  },
}
```

## 3. 接入路径 A：用户插件

### 3.1 文件约定

- 单文件、自包含，**不支持 `import`**；只允许一个 `export default`。
- 文件内容被当作**函数体**，在严格模式下执行，最后必须 `return { manifest, run }`。
- 顶层代码在导入时和应用每次启动时都会执行，应保持轻量、无副作用。
- 源码上限 64KB（64 × 1024 字符，导入时同时检查文件字节数）。
- 最多同时安装 32 个用户插件。
- 源码保存在本机 `localStorage` 的 `bitpouch:user-plugins:v1`，不上传、不自动下载、不参与同步。

### 3.2 安装、更新、导出

1. **设置 → 用户插件 → 下载示例**，得到一个可运行的模板。
2. 用任意编辑器修改，回到同一位置选择 **导入插件文件**。
3. 已安装列表提供 **导出** 与 **删除**；导出得到 `<id>.js`，可直接分享给别人导入。
4. 导入失败时设置页显示错误码和原始信息；坏插件不会阻塞应用启动。

### 3.3 运行时行为

- 打开工具页时先用空输入运行一次，之后输入变化会以 120ms 防抖自动运行。
- `Ctrl/Cmd+Enter` 立即运行。
- 固定主线程执行，没有 Worker、没有沙箱；死循环会卡住界面。
- `run` 可以是 `async`，返回 Promise 会被等待并归一化。
- 闭包状态只在本次应用会话内保留；刷新或重启后重新初始化。

## 4. 接入路径 B：内置插件

```bash
npm run plugin:new -- my-tool "我的工具" "My tool" text
```

生成：

```text
src/plugins/my-tool/
  manifest.ts   # 纯数据清单
  run.ts        # 纯函数，导出 run
  View.vue      # 工具界面
  run.spec.js   # 行为测试
  README.md     # 可选
```

目录名必须等于 `manifest.id`，且匹配 `^[a-z][a-z0-9-]*$`。注册由 `import.meta.glob` 自动完成，不需要改路由、首页或构建配置。

`run.ts` 必须是纯函数：不访问 DOM / `window` / `localStorage` / 网络，不修改入参。重计算或大输入在 manifest 写 `runtime: 'worker'`。

## 5. 数据契约

### 5.1 manifest

```ts
interface ToolManifest {
  id: string
  name: { zh: string; en: string }
  description: { zh: string; en: string }
  category: 'codec' | 'convert' | 'inspect' | 'network' | 'text'
  icon: string
  keywords: string[]
  version: string
  runtime: 'main' | 'worker'
  platforms: Array<'web' | 'desktop' | 'mobile'>
  offline: boolean
  order?: number
  experimental?: boolean
}
```

| 字段 | 必填 | 用户插件默认值 | 说明 |
|------|------|----------------|------|
| `id` | 是 | — | kebab-case，`^[a-z][a-z0-9-]*$`；不能与内置工具冲突；相同 id 视为更新 |
| `name` | 是 | — | `zh` 与 `en` 都必须是非空字符串 |
| `description` | 是 | — | 同上 |
| `category` | 是 | — | `codec` / `convert` / `inspect` / `network` / `text` |
| `icon` | 内置必填 | `wrench` | 图标名；未登记时回退 `wrench` |
| `keywords` | 内置必填 | `[]` | 中英文都建议放，搜索会匹配 |
| `version` | 内置必填 | `0.1.0` | 插件自身版本，不是 API 版本 |
| `runtime` | 内置必填 | 固定 `main` | 用户插件即使写了 `worker` 也会被忽略 |
| `platforms` | 内置必填 | `['web','desktop','mobile']` | 非空子集；不匹配当前端时不展示 |
| `offline` | 内置必填 | `true` | 有网络行为的工具必须显式声明并评审 |
| `order` | 否 | `100` | 首页排序，数字小的在前 |
| `experimental` | 否 | `false` | 为 `true` 时界面显示 Beta 标记 |

内置清单还必须满足 `manifest.id === 目录名`。用户插件没有目录约束，但 `id` 仍会做格式与冲突校验。

### 5.2 run

```ts
run(
  input: string,
  options: Record<string, unknown>,
  ctx: { locale: 'zh' | 'en' },
): ToolResult | string | number | boolean | bigint | null | undefined | Promise<...>
```

| 参数 | 说明 |
|------|------|
| `input` | 输入框里的完整文本，可能为空字符串 |
| `options` | 工具选项。用户插件的通用界面当前始终传 `{}`；内置插件可由自己的 `View.vue` 传入 |
| `ctx.locale` | 当前界面语言，`'zh'` 或 `'en'`，用于本地化输出和错误信息 |

约定：

- **空输入必须安全**。打开工具页会先用 `run('')` 跑一次，通常返回空输出即可。
- `run` 不修改入参；不依赖调用次数或外部可变状态。
- 业务错误用 `{ ok: false, error }` 返回，不要抛裸异常。
- 内置插件若声明 `runtime: 'worker'`，返回值和错误对象必须可结构化克隆：普通对象、数组、字符串、数字、布尔、`BigInt`、`null`；不要返回函数、类实例或 DOM 节点。
- `ctx.signal` 在类型中保留，但当前 `run` 调用不会传入；取消只影响等待方，不中断已开始的计算。

### 5.3 ToolResult

```ts
interface ToolResult<T = unknown> {
  ok: boolean
  output?: string
  error?: ToolError
  stats?: Record<string, number | string>
  data?: T
}

interface ToolError {
  code: string
  message: string
  line?: number
  column?: number
  char?: string
  lineText?: string
}
```

| `run` 返回值 | 归一化结果 |
|--------------|------------|
| `string` | `{ ok: true, output }` |
| `number` / `boolean` / `bigint` | 转成字符串作为 `output` |
| `null` / `undefined` | `{ ok: true, output: '' }` |
| `{ ok: true, output }` | `output` 必须是原始值；对象 / 数组会报 `PLUGIN_RESULT` |
| `{ ok: true, output: '', data }` | 界面以格式化 JSON 展示 `data` |
| `{ ok: false, error }` | 错误展示，`code` / `message` 原样透传 |
| 其他对象（数组、缺少布尔 `ok`） | `PLUGIN_RESULT` |
| 抛出异常 | `{ ok: false, error: { code: 'PLUGIN_ERROR', message } }` |

`stats` 只保留 `number` / `string` 值，显示在输出面板底部。需要复制的文本放 `output`，结构化结果放 `data`。

### 5.4 错误信息本地化

`error.message` 应按 `ctx.locale` 返回中文或英文；`error.code` 保持稳定、供程序判断。`line` / `column` / `char` / `lineText` 可选，用于在输出区定位问题。

```js
run(input, options, ctx) {
  if (!input.trim()) {
    return {
      ok: false,
      error: {
        code: 'EMPTY_INPUT',
        message: ctx.locale === 'zh' ? '请输入内容' : 'Input is empty',
      },
    }
  }
  return { ok: true, output: input }
}
```

## 6. 执行模型

```text
View ──callTool(id, input, options, locale)──┐
                                             ├─ runtime=main   → 动态 import run.ts，直接调用
                                             └─ runtime=worker → 单例 Worker，postMessage
```

- Worker 超时 30 秒；超时后销毁并在下次请求时重建。
- Worker 基础设施不可用时自动回退主线程；插件自身抛错不会回退，错误原样暴露。
- Worker 协议只传 `{ requestId, id, input, options, locale }`，返回 `{ requestId, result | error }`。
- 用户插件绕过 Worker：注册后固定 `runtime: 'main'`，结果经过 `normalizeToolResult` 归一化。
- 单 Worker 模型下，取消等待不会中断正在执行的计算。

## 7. 限制

| 项 | 限制 |
|----|------|
| 用户插件单文件 | ≤ 64KB |
| 用户插件数量 | ≤ 32 |
| 用户插件模块系统 | 不支持 `import`，必须单文件自包含 |
| 用户插件执行线程 | 固定主线程 |
| 用户插件沙箱 | 无，与页面同权限 |
| Worker 返回值 | 必须可结构化克隆 |
| Worker 超时 | 30 秒 |
| 输入持久化 | 禁止；只允许持久化工具选项、收藏、最近使用、主题、语言 |
| 网络 | 应用不上传、不自动下载；工具默认离线，联网必须显式声明并评审 |

## 8. 错误码

### 8.1 用户插件导入 / 加载

| 错误码 | 含义 |
|--------|------|
| `PLUGIN_SYNTAX` | JavaScript 语法错误 |
| `PLUGIN_EVAL` | 顶层代码执行时抛错 |
| `PLUGIN_EXPORT` | 代码为空，或没有 `return` 出对象 |
| `PLUGIN_MANIFEST` | manifest 缺失或字段不合法 |
| `PLUGIN_RUN` | 没有提供 `run` 函数 |
| `PLUGIN_ID_CONFLICT` | id 与内置工具冲突，或用户插件之间重复 |
| `PLUGIN_TOO_LARGE` | 源码超过 64KB |
| `PLUGIN_LIMIT` | 用户插件数量超过 32 个 |
| `PLUGIN_STORAGE` | localStorage 不可用或已满 |
| `PLUGIN_LOAD` | 其他加载失败 |

### 8.2 运行阶段

| 错误码 | 含义 |
|--------|------|
| `PLUGIN_RESULT` | `run` 返回值格式不对 |
| `PLUGIN_ERROR` | `run` 抛出了异常，或 Worker 超时 / 取消等运行期失败 |
| `NOT_FOUND` | 请求的工具 id 不存在 |

`WORKER_TIMEOUT`、`WORKER_UNAVAILABLE`、`ABORTED` 是 runner 的内部错误码：`WORKER_UNAVAILABLE` 会触发主线程回退，其余最终通常收敛为 `PLUGIN_ERROR`，插件不需要依赖这些内部码。

内置插件的业务错误码由插件自己定义（如 `EMPTY_INPUT`、`INVALID_BASE64`），只需保证 `code` 稳定、`message` 已本地化。

## 9. 生命周期

### 用户插件

1. **导入**：大小检查 → 语法检查 → 顶层代码执行 → manifest 校验 → id 冲突检查 → 写入 localStorage。
2. **启动**：重新编译所有已保存插件；失败的插件只在设置页列出，不影响启动。
3. **运行**：空输入先跑一次；输入变化 120ms 防抖；`Ctrl/Cmd+Enter` 立即运行。
4. **更新**：导入相同 id 会替换旧插件并重新编译。
5. **删除**：从 localStorage 移除；收藏 / 最近使用里残留的 id 会被自动过滤。

### 内置插件

1. 构建时 `scripts/check-plugins.mjs` 校验目录、清单与必需文件。
2. 启动时由 `import.meta.glob` 静态收集 manifest；视图和 `run` 按需懒加载。
3. 运行走 `callTool`，按 manifest 的 `runtime` 选择主线程或 Worker。

## 10. 安全与隐私

- **输入不落盘**：工具的输入内容不得写入 localStorage、IndexedDB、日志或任何远端。持久化只允许选项、收藏、最近使用、主题、语言。
- **默认离线**：新增插件如果需要网络，必须在 manifest 与文档中显式声明，并通过评审。
- **用户插件无沙箱**：它和页面同权限，可以访问 DOM、`localStorage`、`fetch`，也可能阻塞主线程；只安装可信代码。
- **CSP**：用户插件依赖 `new Function`，严格 CSP 需要允许 `unsafe-eval`；默认构建没有 CSP。
- **最小依赖**：优先原生 API；引入依赖前评估 gzip 体积、离线可用性、跨端兼容性。
- **权限最小化**：Tauri capabilities 只开 `core:default`；新增插件或权限必须写明理由。

## 11. 测试与验收

### 用户插件

- [ ] 正常输入、空输入、超长输入各跑一次。
- [ ] 错误输入返回 `{ ok: false, error }`，中英文提示正确。
- [ ] 确认没有把输入写入 localStorage 或发往网络。
- [ ] 所有循环有上限，单次计算尽量控制在几十毫秒内。
- [ ] 导出再导入同一文件，行为一致。

### 内置插件

```bash
npm run check:plugins   # 目录、清单、必需文件
npm run typecheck       # vue-tsc --noEmit
npm test                # vitest run
npm run build           # check + typecheck + vite build
```

`run.spec.js` 至少覆盖正常路径、边界和错误码；从 ihomy 迁移的工具以原 spec 为行为基线。

## 12. 版本与兼容

- `manifest.version` 是插件自己的版本，不是 API 版本。
- API 契约随 bit_pouch 应用版本发布；不要依赖应用内部模块路径，只使用本文档描述的 `input` / `options` / `ctx` / `ToolResult`。
- 契约发生破坏性变化时，会同步更新本文档、`docs/插件开发指南.md`、`docs/架构设计.md` 与 `AGENTS.md`，并在 `docs/变更归档.md` 记录迁移方式。
- 用户插件在应用升级后可能被重新编译；顶层代码必须保持无副作用。

## 13. 完整示例

### 13.1 文本统计（output + stats + data）

```js
return {
  manifest: {
    id: 'my-text-stats',
    name: { zh: '文本统计', en: 'Text stats' },
    description: { zh: '统计行数、词数与字符数', en: 'Count lines, words and characters' },
    category: 'text',
    icon: 'text',
    keywords: ['count', 'lines', 'words', '统计'],
    version: '1.0.0',
  },
  run(input, options, ctx) {
    const lines = input ? input.split(/\r?\n/).length : 0
    const words = input.trim() ? input.trim().split(/\s+/).length : 0
    const chars = input.length
    return {
      ok: true,
      output:
        ctx.locale === 'zh'
          ? `${lines} 行 / ${words} 词 / ${chars} 字符`
          : `${lines} lines / ${words} words / ${chars} chars`,
      stats: { lines, words, chars },
      data: { lines, words, chars },
    }
  },
}
```

### 13.2 Base64 解码（带错误返回）

```js
return {
  manifest: {
    id: 'my-base64-decode',
    name: { zh: 'Base64 解码', en: 'Base64 decode' },
    description: { zh: '把 Base64 文本解码为 UTF-8', en: 'Decode Base64 into UTF-8' },
    category: 'codec',
    icon: 'binary',
    keywords: ['base64', 'decode', '解码'],
  },
  run(input, options, ctx) {
    const text = input.trim()
    if (!text) {
      return {
        ok: false,
        error: {
          code: 'EMPTY_INPUT',
          message: ctx.locale === 'zh' ? '请输入 Base64 文本' : 'Paste some Base64 text',
        },
      }
    }
    try {
      const bytes = Uint8Array.from(atob(text), (char) => char.charCodeAt(0))
      return { ok: true, output: new TextDecoder().decode(bytes) }
    } catch {
      return {
        ok: false,
        error: {
          code: 'INVALID_BASE64',
          message: ctx.locale === 'zh' ? '不是合法的 Base64' : 'Invalid Base64',
        },
      }
    }
  },
}
```

### 13.3 异步插件

```js
return {
  manifest: {
    id: 'my-async',
    name: { zh: '异步示例', en: 'Async demo' },
    description: { zh: '延迟 300ms 后返回输入', en: 'Return the input after 300ms' },
    category: 'text',
  },
  async run(input) {
    await new Promise((resolve) => setTimeout(resolve, 300))
    return { ok: true, output: input }
  },
}
```

### 13.4 内置插件 run + 测试

```ts
// src/plugins/my-tool/run.ts
import type { ToolRun } from '@/core/types'

export const run: ToolRun = (input, options, ctx) => {
  if (!input.trim()) {
    return {
      ok: false,
      error: { code: 'EMPTY_INPUT', message: ctx.locale === 'zh' ? '请输入内容' : 'Input is empty' },
    }
  }
  return { ok: true, output: input.trim() }
}
```

```js
// src/plugins/my-tool/run.spec.js
import { describe, expect, it } from 'vitest'
import { run } from './run'

describe('my-tool', () => {
  it('trims input', () => {
    expect(run('  hi  ', {}, { locale: 'zh' })).toEqual({ ok: true, output: 'hi' })
  })

  it('rejects empty input', () => {
    const result = run('   ', {}, { locale: 'zh' })
    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('EMPTY_INPUT')
  })
})
```

## 14. 常见问题

| 现象 | 常见原因 | 处理 |
|------|----------|------|
| 导入后没出现 | 设置页有红色错误条 | 按错误码排查；最常见是 `import` 或 manifest 缺双语文案 |
| `PLUGIN_EXPORT` | 没有 `return` 出对象 / 文件为空 | 确认最后是 `return { manifest, run }` |
| `PLUGIN_ID_CONFLICT` | id 与内置工具或已有插件重复 | 换一个 kebab-case id |
| 输出为空 | `output` 与 `data` 都为空 | 返回 `output` 字符串，或把结构化结果放 `data` |
| `PLUGIN_RESULT` | `output` 返回了对象 / 数组 | `output` 用字符串，结构化数据放 `data` |
| 页面卡死 | 主线程死循环或超大数组 | 给循环设上限；大计算改用内置插件 + Worker |
| 刷新后状态丢失 | 闭包状态只在当前会话有效 | 不要依赖跨会话状态；偏好用独立 key 持久化，且不存输入 |
| 浏览器报 `Illegal invocation` | 调用了未绑定的宿主方法 | 用箭头函数或显式绑定 `this` |

## 15. 接入检查清单

- [ ] 文件是单文件、无 `import`，最后 `return { manifest, run }`（或 `export default`）。
- [ ] `id` 是 kebab-case，且不与内置工具冲突。
- [ ] `name` / `description` 的 `zh`、`en` 都非空。
- [ ] `category` 使用允许值。
- [ ] `run('')` 不会抛异常。
- [ ] 业务错误用 `{ ok: false, error }`，`message` 按 `ctx.locale` 本地化。
- [ ] `output` 是字符串；结构化结果放 `data`；`stats` 只用数字或字符串。
- [ ] 不持久化输入 / 输出，不上传数据。
- [ ] 所有循环有上限；单次计算尽量控制在几十毫秒内。
- [ ] 导入后实际跑过正常路径、空输入和错误输入。

## 16. 相关文档

- [`用户插件API.md`](用户插件API.md)：用户插件运行时、存储、限制与安全细节。
- [`插件开发指南.md`](插件开发指南.md)：内置插件从零新增的完整步骤与检查清单。
- [`架构设计.md`](架构设计.md)：插件模型、Worker 协议、性能预算、跨端与安全。
- [`需求设计说明书.md`](需求设计说明书.md)：功能现状与验收口径。
- [`踩坑速查.md`](踩坑速查.md)：常见异常的症状、真因与对策。
