---
name: plugin-author
description: 在 bit_pouch 中新增或修改一个工具插件：生成目录、定义清单、实现纯函数 run、写测试与视图、验证注册。Use whenever the user says 加一个工具、新增插件、把某个功能做成工具、修改工具插件, or asks for a new engineering utility in the toolbox.
---

# bit_pouch 插件开发

一个工具 = `src/plugins/<id>/` 下的 `manifest.ts` + `run.ts` + `View.vue`（+ `run.spec.js`）。注册由文件系统自动完成。

## 1. 先定契约

动手前写清四件事：

1. **输入**：文本？文件？只需选项？
2. **输出**：一段可复制文本、结构化表格、还是多块结果？
3. **运行时**：单次是否 > 50ms / 输入是否可能 > 100KB？是则 `worker`。
4. **错误**：有哪些失败路径？错误码与本地化文案。

不确定时先看同目录已有插件（`json` 是 Worker 示例，`codec` 是主线程示例）。

## 2. 脚手架

```bash
npm run plugin:new -- <id> "<中文名>" "<English name>" [category]
```

- `id`：kebab-case，与目录名一致。
- `category`：`codec` / `convert` / `inspect` / `network` / `text`。
- 生成后先跑 `npm run check:plugins`，确认目录与清单被识别。

## 3. 实现 run

```ts
import type { ToolRun } from '@/core/types'

export const run: ToolRun<MyData> = (input, options, ctx) => {
  if (!input.trim()) {
    return { ok: false, error: { code: 'empty', message: ctx.locale === 'zh' ? '内容为空' : 'Input is empty' } }
  }
  return { ok: true, output, stats: { chars: output.length }, data }
}
```

硬性要求：

- 纯函数：无 DOM / window / localStorage / 网络。
- 不修改入参。
- 业务错误返回 `ok:false`，不抛裸异常。
- `message` 已按 `ctx.locale` 本地化。
- Worker 插件返回值必须可结构化克隆（用 `number[]` 代替 `Uint8Array`）。
- 大输入设置上限并给出可读错误。

## 4. 写测试

至少覆盖：

- 正常路径（含中文/emoji/边界值）。
- 空输入、超长、非法字符。
- 每个错误码至少一条断言。
- 若从 ihomy 迁移，保留原 spec，先让测试全绿再改视图。

```bash
npm test -- src/plugins/<id>/run.spec.js
```

## 5. 写视图

- 通过 `callTool('<id>', input, options, locale.value)` 调逻辑，不复制算法。
- 选项用 `useToolPrefs('<id>', defaults)`；**输入不持久化**。
- 防抖建议：编码 120ms、报文 180ms、进制 60ms、子网 90ms；JSON 显式运行。
- 用递增序号丢弃旧结果。
- 渲染上限：表格/高亮超过阈值显示截断提示。
- 复用 `Pane`、`CopyButton`、`SegmentedControl`、`StatChips`、`ErrorNote`。
- 空态、错误态、加载态都要有。

## 6. 注册与验证

无需改路由/首页。重启 dev server 后检查：

```bash
npm run check:plugins
npm run typecheck
npm test
npm run build
npm run dev
```

浏览器验收：

- 首页出现新卡片，搜索关键词能命中。
- 打开后无白屏；示例能跑出结果。
- 复制可用；错误输入有可读提示。
- 移动端宽度无溢出。
- Network 无请求；Local Storage 无输入内容。

## 7. 文档

- 更新 `docs/需求设计说明书.md` 对应工具章节（能力、边界、验收）。
- 在 `docs/变更归档.md` 末尾追加本次实现记录。
- 若插件契约变化，同步 `docs/插件开发指南.md` 与 `AGENTS.md`。
- 新依赖记录在变更归档，并说明体积/离线/跨端评估。

## 8. 完成标准

- [ ] `manifest.ts` 双语完整、id 与目录一致。
- [ ] `run.ts` 纯函数、错误本地化、无输入落盘。
- [ ] `run.spec.js` 覆盖正常/边界/错误。
- [ ] `View.vue` 有防抖、竞态守卫、空/错误态。
- [ ] 四项验证命令全绿。
- [ ] 文档已更新。
