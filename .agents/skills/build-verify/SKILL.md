---
name: build-verify
description: bit_pouch 构建验证基线：插件闸门 + TypeScript + 单元测试 + 生产构建 + ESLint，可选 Tauri cargo check 与浏览器冒烟。Use whenever the user says 验证构建、构建一下、跑下基线、检查一下, or after non-trivial code changes before commit/release.
---

# bit_pouch 构建验证

改代码后的标准自查。V0.1 基线（2026-10-19）：

| 项目 | 基线 |
|------|------|
| 插件数 | 5（base / codec / json / packet / subnet） |
| 单测 | 84 passed / 5 files |
| 入口 chunk | `index-*.js` ≈ 33.6KB（gzip 12.0KB） |
| 框架 chunk | `framework-*.js` ≈ 112.6KB（gzip 43.9KB） |
| PWA precache | 34 entries ≈ 247KiB |
| Tauri | `cargo check` 通过（需 MSVC + WebView2） |

> 数字会随功能演进；偏离先判断“合理增长”还是“打包事故”，拿不准报告给用户。

## 步骤

1. **插件闸门**

```bash
npm run check:plugins
```

必须输出 `Plugin check passed.`，插件数与实际目录一致。

2. **TypeScript**

```bash
npm run typecheck
```

必须无输出（`vue-tsc --noEmit`）。

3. **单元测试**

```bash
npm test
```

必须全绿。迁移工具以 ihomy 原 spec 为基线；若断言变化，先确认是有意行为变化，再改测试并记录。

4. **生产构建**

```bash
npm run build
```

关注：

- 无 error；sourcemap 不得出现同名覆盖警告。
- 入口 + framework gzip 是否明显超出基线（>20% 先查依赖）。
- 每个插件的 `run-*.js` / `View-*.js` 是否独立 chunk；若所有插件进入入口，检查 `manifest.ts` 是否误 import 视图。
- PWA precache 是否包含新资源。

5. **ESLint**

```bash
npm run lint
```

必须 0 error。warning 可接受但要在报告里列出。

6. **Tauri（改动 Rust/配置/依赖时）**

```bash
cd src-tauri && cargo check
```

- 失败先区分：MSVC 缺失、WebView2 缺失、图标缺失、crates 下载失败。
- 改了 `tauri.conf.json` / `Cargo.toml` / `lib.rs` 必须跑。
- 移动端改动还需 `tauri android init` / `ios init` 的真机构建（不在日常基线内）。

7. **浏览器冒烟（可选，改 UI 时强烈建议）**

```bash
npm run dev
```

检查：

- 首页 5 个工具卡片可见；搜索/分类/收藏/最近/命令面板正常。
- `Ctrl/Cmd+K` 打开命令面板，Enter 打开、Esc 关闭。
- 5 个工具各跑一次示例；JSON 错误定位、报文 CRC、子网 /31 /32。
- 720px 与 390px 宽度无横向溢出；移动端底部导航不遮挡。
- DevTools Network：运行工具时无请求；Local Storage 无输入内容。

## 报告格式

```text
插件闸门：通过（5）
类型检查：通过
单测：84 passed
构建：通过；入口 33.6KB / framework 112.6KB / gzip 合计 56KB
Lint：0 error
Tauri：未跑 / 通过
冒烟：通过（或列出失败项）
```

失败时贴关键报错行，不吞错误；不要用“应该没问题”代替实际输出。
