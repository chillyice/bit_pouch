# bit_pouch 用户插件 API

> 面向“自己写、自己用”的本地工具扩展。插件是单文件 JavaScript，导入后立即出现在工具列表；不联网、不上传、不需要重新构建应用。
>
> 统一的 manifest / run / ToolResult 契约见 [`API接入文档.md`](API接入文档.md)；本文只展开用户插件的运行时细节。

## 1. 快速开始

1. 打开 **设置 → 用户插件 → 下载示例**，得到 `bit_pouch-plugin-example.js`。
2. 用任意编辑器修改它（VS Code、Sublime、记事本均可）。
3. 回到 **设置 → 用户插件 → 导入插件文件**，选择该 `.js` 文件。
4. 导入成功后，插件立即出现在首页、搜索结果和命令面板里。
5. 修改插件：在已安装列表点 **导出**，改完再导入；相同 `id` 会覆盖更新。

应用不提供内置代码编辑器。插件源码只保存在本机 `localStorage` 的 `bitpouch:user-plugins:v1`。

## 2. 文件与执行模型

- 文件扩展名建议 `.js` 或 `.mjs`；单文件、自包含，**不支持 `import`**。
- 文件内容被当作一个**函数体**，在严格模式下执行。最后必须 `return { manifest, run }`。
- 也支持 `export default { manifest, run }` 写法（应用会自动转换）。
- 顶层代码在“导入时”和“每次应用启动时”都会执行一次，应保持轻量、无副作用。
- `run` 固定在主线程调用，可以返回普通值、`ToolResult` 或 Promise。
- 用户插件不进入 Worker，也没有沙箱；详见 §10。

最小插件：

```js
return {
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

## 3. manifest 字段

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `id` | 是 | string | kebab-case，`^[a-z][a-z0-9-]*$`；不能与内置工具 id 冲突；相同 id 再次导入视为更新 |
| `name` | 是 | `{ zh, en }` | 两个语言都必须是非空字符串 |
| `description` | 是 | `{ zh, en }` | 两个语言都必须是非空字符串 |
| `category` | 是 | string | `codec` / `convert` / `inspect` / `network` / `text` |
| `icon` | 否 | string | 图标名；未登记时回退 `wrench` |
| `keywords` | 否 | string[] | 搜索关键词，建议中英文都放；默认 `[]` |
| `version` | 否 | string | 插件自己的版本号，不是 API 版本；默认 `0.1.0` |
| `platforms` | 否 | string[] | `web` / `desktop` / `mobile` 的非空子集；默认三端全开 |
| `offline` | 否 | boolean | 默认 `true`；有网络行为的插件应显式声明并说明 |
| `order` | 否 | number | 首页排序，小的在前；默认 `100` |
| `experimental` | 否 | boolean | 为 `true` 时界面显示 Beta 标记 |
| `runtime` | 否 | — | 用户插件固定主线程；即使写了也会被忽略 |

完整模板：

```js
return {
  manifest: {
    id: 'my-tool',
    name: { zh: '我的工具', en: 'My tool' },
    description: { zh: '一句话说明', en: 'One line description' },
    category: 'text',
    icon: 'wrench',
    keywords: ['demo', '示例'],
    version: '1.0.0',
    platforms: ['web', 'desktop', 'mobile'],
    offline: true,
    order: 120,
    experimental: false,
  },
  run(input, options, ctx) {
    return { ok: true, output: input }
  },
}
```

## 4. run 契约

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
| `options` | 当前通用界面不渲染额外选项，始终为 `{}`；签名保留给未来扩展 |
| `ctx.locale` | 当前界面语言，`'zh'` 或 `'en'`，用于本地化输出/错误 |

注意：打开工具页时会先用空输入运行一次。请让 `run('')` 安全返回（通常返回空输出），不要抛异常。

## 5. 返回值

推荐返回标准 `ToolResult`：

```ts
interface ToolResult<T = unknown> {
  ok: boolean
  output?: string
  error?: {
    code: string
    message: string
    line?: number
    column?: number
    char?: string
    lineText?: string
  }
  stats?: Record<string, number | string>
  data?: T
}
```

也可以直接返回字符串、数字、布尔或 `BigInt`，会被当作 `output`：

```js
run(input) {
  return input.length
}
// 等价于 { ok: true, output: '12' }
```

返回规则：

| 返回值 | 结果 |
|--------|------|
| `string` / `number` / `boolean` / `bigint` | 转成 `output` 文本 |
| `null` / `undefined` | `{ ok: true, output: '' }` |
| `{ ok: true, output }` | 正常结果；`output` 必须是原始值，对象/数组会报 `PLUGIN_RESULT` |
| `{ ok: true, data }` | `output` 为空时，`data` 会以格式化 JSON 展示 |
| `{ ok: false, error }` | 错误展示；`error.code` / `error.message` 原样透传 |
| 其他对象（含数组、缺少布尔 `ok`） | `PLUGIN_RESULT` |

`stats` 只保留 `number` / `string` 值，显示在输出面板底部。结构化结果放 `data`，需要复制的文本放 `output`。

## 6. 错误处理

业务错误建议返回 `ok: false`，不要抛裸异常：

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

抛出异常时，应用会收敛成：

```js
{ ok: false, error: { code: 'PLUGIN_ERROR', message: '原始异常信息' } }
```

### 应用侧错误码

导入/加载阶段：

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

运行阶段：

| 错误码 | 含义 |
|--------|------|
| `PLUGIN_RESULT` | `run` 返回值格式不对 |
| `PLUGIN_ERROR` | `run` 抛出了异常 |

## 7. 生命周期与状态

- **导入时**：语法检查 → 顶层代码执行 → manifest 校验 → 写入 localStorage。
- **启动时**：重新编译所有已保存插件；失败的插件只在设置页列出，不影响应用启动。
- **运行**：每次输入变化（120ms 防抖）或 `Ctrl/Cmd+Enter` 时调用 `run`。
- **更新**：导入相同 id 会替换旧插件并重新编译。
- **删除**：从 localStorage 移除；收藏/最近使用里残留的 id 会被列表自动过滤。
- **状态**：`run` 闭包里的变量在本次应用会话内保留；刷新/重启/更新后重新初始化。不要把跨会话状态存在插件里。

## 8. 界面行为

用户插件统一使用通用工具页：

- 左侧输入、右侧输出，输入变化后自动运行。
- `Ctrl/Cmd+Enter` 立即运行。
- 输出支持一键复制；`data` 在无 `output` 时以 JSON 展示。
- `stats` 显示为底部统计标签。
- 工具卡和标题区显示「用户插件」徽标。

## 9. 限制

| 项 | 限制 |
|----|------|
| 单文件大小 | ≤ 64KB（导入时还按文件字节数检查） |
| 插件数量 | ≤ 32 |
| 模块系统 | 不支持 `import`；必须单文件自包含 |
| 执行线程 | 固定主线程，不能进 Worker |
| 沙箱 | 无；与页面同权限 |
| 网络 | 应用不上传、不自动下载；插件自身如发起网络请求，由作者负责 |
| 输出渲染 | 无硬上限，但超大文本/JSON 会拖慢界面，建议自行截断到合理长度 |

## 10. 安全与隐私

用户插件以页面权限运行，可以访问 DOM、`localStorage`、`fetch`，也可以阻塞主线程。它面向“用户自己编写或信任的代码”，**不是沙箱，也不是插件市场**。

- 只导入你信任的 `.js` 文件。
- 不要读取、上传或持久化工具输入；应用的隐私约束同样适用于插件。
- 死循环会直接卡住界面；所有循环都应有明确上限。
- 严格 CSP 的宿主会阻止 `new Function`，需要允许 `unsafe-eval`；默认构建没有 CSP。
- 插件源码只保存在本机，不会同步到任何远端。

## 11. 完整示例

### 11.1 文本统计（output + stats + data）

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
    const summary =
      ctx.locale === 'zh'
        ? `${lines} 行 / ${words} 词 / ${chars} 字符`
        : `${lines} lines / ${words} words / ${chars} chars`
    return {
      ok: true,
      output: summary,
      stats: { lines, words, chars },
      data: { lines, words, chars },
    }
  },
}
```

### 11.2 Base64 解码（带错误返回）

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

### 11.3 异步插件

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

### 11.4 `export default` 写法

```js
export default {
  manifest: {
    id: 'my-export-default',
    name: { zh: '默认导出示例', en: 'Export default demo' },
    description: { zh: '与 return 写法等价', en: 'Same as the return form' },
    category: 'text',
  },
  run(input) {
    return input
  },
}
```

## 12. 调试与常见问题

**导入后没出现？**
看设置页的红色错误条。最常见是 `PLUGIN_SYNTAX`（代码里有 `import` / 多余 `export`）或 `PLUGIN_MANIFEST`（缺双语文案、分类拼错）。

**提示 `PLUGIN_EXPORT`？**
代码没有 `return` 出对象，或者文件是空的。确认最后是 `return { manifest, run }`。

**提示 `PLUGIN_ID_CONFLICT`？**
换一个 id。内置工具 id 见首页 19 个工具（如 `json`、`hash`、`uuid`），不能占用。

**输出是空的？**
`output` 为空时，界面会展示 `data`；两者都为空才是“插件没有返回内容”。如果只设置了 `data` 为对象，会以 JSON 展示。

**浏览器报 `Illegal invocation` / 页面卡死？**
插件在页面主线程运行。检查死循环、超大数组/字符串拼接。

**刷新后状态丢了？**
插件闭包状态只存在于当前会话；持久化偏好应使用插件自己管理的 key，且不要存输入内容。

**怎么分享插件？**
在已安装列表点导出，得到 `<id>.js`，对方导入即可。插件不经过任何市场或签名校验。

**API 有没有版本号？**
当前契约随应用版本发布，manifest 的 `version` 只是插件自身版本。不要依赖应用内部模块路径；只使用本文档描述的 `input` / `options` / `ctx` / `ToolResult`。

## 13. 接入检查清单

- [ ] 文件是单文件、无 `import`，最后 `return { manifest, run }`。
- [ ] `id` 是 kebab-case，且不与内置工具冲突。
- [ ] `name` / `description` 的 `zh`、`en` 都非空。
- [ ] `category` 使用允许值。
- [ ] `run('')` 不会抛异常。
- [ ] 业务错误用 `{ ok: false, error }`，`message` 按 `ctx.locale` 本地化。
- [ ] 不持久化输入/输出，不上传数据。
- [ ] 所有循环有上限；单次计算尽量控制在几十毫秒内。
- [ ] 导入后实际在工具页跑一遍正常路径、空输入和错误输入。
