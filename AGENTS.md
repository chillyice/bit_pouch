# AGENTS.md — bit_pouch 项目规则

> 自动加载的入口文档：只放**结论与导航**。功能事实在 `docs/需求设计说明书.md`，时序记录在 `docs/变更归档.md`，踩坑在 `docs/踩坑速查.md`。
> 找代码先看 §3，动手前看 §4，收尾看 §9。读文档用 Read/Grep 工具；PowerShell 直接 `Get-Content` 会把中文显示成乱码（见踩坑 1.4）。

## 1. 30 秒上下文

- **定位**：开发者的随身工具袋；本地优先、离线可用、插件化；桌面 + 移动 + Web/PWA 同源。
- **技术栈**：Vue 3 + TypeScript + Vite + Pinia + vue-router；Tauri 2（Rust）；Vitest；vite-plugin-pwa。
- **工作目录**：`C:\Users\chill\OneDrive\WorkStation\Projects\bit_pouch`；ihomy 只读参考：`C:\Users\chill\OneDrive\WorkStation\Projects\ihomy`。
- **版本**：唯一来源仓库根 `VERSION`（`V<主>.<次>`），前端经 `__APP_VERSION__` 注入；发版时 `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 同步 semver。
- **读这三份就够开工**：`docs/现状.md`（版本/在途/下一步/基线）、`docs/工具索引.md`（工具与文件索引，脚本生成）、`docs/需求设计说明书.md` 对应工具节。
- **不做**：后端、账号、云同步；实时 HTTP/WebSocket 客户端（需联网，另立项目）。

## 2. 任务路由表

| 任务 | 先读 | 技能 | 必跑 |
|------|------|------|------|
| 新增 / 修改工具 | `docs/插件开发指南.md` §2–8、`docs/API接入文档.md` §5、需求 4.x 对应节 | `plugin-author` | `check:plugins` + `npx vitest run src/plugins/<id>/run.spec.js` + `typecheck` + `build` |
| 改内核 / 注册 / Worker | `docs/架构设计.md` §5–6、`docs/踩坑速查.md` §2 | — | `typecheck` + `test` + `build` |
| 改界面 / 交互 | `docs/UI设计提示词.md` §5、对应 `View.vue`、`src/styles/app.css` | `frontend-design`（可选） | `build` + 720px / 390px 手工冒烟 |
| 排错 | `docs/踩坑速查.md` 按症状关键词；该工具 `run.spec.js` | — | 复现命令 + 对应测试 |
| 归档 | 本文 §9 | `archive` | `npm run docs:index` + `npm run docs:check` |
| 构建验证 | 本文 §5 | `build-verify` | 见 §5 |
| 发版 | 需求 §5.4 | `release` | `verify:release` + 三平台产物 |
| 从 ihomy 迁移 | `docs/迁移映射.md` + ihomy 源 spec | `sync-from-ihomy` | `npm test` + 差异记档 |

> 技能在 `.agents/skills/`，任务匹配时用 skill 工具加载，不要凭记忆复述流程。

## 3. 代码地图

| 想找 | 入口 |
|------|------|
| 应用装配 | `src/main.ts` → `src/App.vue` → `src/router/index.ts` |
| 工具注册 / 搜索 / 懒加载 | `src/core/registry.ts` |
| 清单校验 | `src/core/manifest.ts`、`scripts/check-plugins.mjs` |
| 工具调用 / 超时 / Worker 回退 | `src/core/runner.ts`、`src/core/worker/tool.worker.ts` |
| 工具页宿主 | `src/views/ToolView.vue`、`src/components/UserToolView.vue` |
| 首页 / 收藏 / 设置 / 命令面板 | `src/views/HomeView.vue`、`src/views/FavoritesView.vue`、`src/views/SettingsView.vue`、`src/components/CommandPalette.vue` |
| 收藏与最近（Pinia） | `src/stores/app.ts` |
| 持久化 key / 工具选项 | `src/core/storage.ts`、`src/core/toolPrefs.ts` |
| i18n | `src/core/i18n.ts` |
| 主题 / 剪贴板 / 提示 / 平台 / 文件拖入 | `src/core/theme.ts`、`src/core/clipboard.ts`、`src/core/toast.ts`、`src/core/platform.ts`、`src/core/fileDrop.ts` |
| 用户插件 | `src/core/userPlugins.ts`、`src/core/registry.ts` |
| 应用内更新 | `src/core/updater.ts`、`src-tauri/src/update.rs` |
| 桌面壳 / 全局快捷键 / 单实例 | `src-tauri/src/lib.rs`、`src-tauri/src/main.rs`、`src-tauri/capabilities/default.json` |
| 样式令牌与全局样式 | `src/styles/app.css` |
| 插件 / 发布 / 文档脚本 | `scripts/check-plugins.mjs`、`scripts/verify-release.mjs`、`scripts/docs-index.mjs`、`scripts/docs-check.mjs`、`.github/workflows/` |

## 4. 硬性不变量

1. **隐私**：工具输入/输出、密钥、令牌、报文原文不写 localStorage / IndexedDB / 日志 / 远端；只有选项、收藏、最近、主题、语言可持久化。
2. **Git**：非用户明确指令不 `commit` / `push` / `tag`；`git add` 只指定具体文件，禁用 `-A` / `.`；禁用 `git stash`（OneDrive 多会话会互相覆盖，动手前先看 `git status` 与文件时间）。
3. **版本**：`VERSION` 唯一来源；每次可交付迭代次位 +1，满 100 进主版本；发版同步三处 semver 并在归档追加小节。
4. **插件五件套**：`src/plugins/<id>/` 必须有 `manifest.ts`、`run.ts`、`View.vue`、`run.spec.js`（建议 `README.md`）；目录名 = `manifest.id`，kebab-case。
5. **run 纯函数**：不碰 DOM / `window` / localStorage / 网络，不改入参；返回值可结构化克隆（字节用 `number[]`，Worker 不传 `Uint8Array`）。
6. **清单纯数据**：`manifest.ts` 只 `import type`，不引入视图或运行时依赖；`name` / `description` 中英双语。
7. **错误统一**：`{ ok:false, error:{ code, message } }`，`message` 按 `ctx.locale` 本地化；不向视图抛裸异常。
8. **零注册**：新增插件不改 router / 首页 / 构建配置，`import.meta.glob` 自动发现。
9. **重活进 Worker**：预计单次 >50ms 或输入可能 >100KB 的工具写 `runtime: 'worker'`。
10. **依赖克制**：先原生 API；引入前评估 gzip 体积、离线、跨端并更新文档；重型依赖必须按需 `import()`。
11. **用户插件只在本机**：源码存 `bitpouch:user-plugins:v1`，`new Function` 编译、固定主线程；不上传、不自动下载、不同步远端；坏插件不得阻塞启动。
12. **在线同步（硬性）**：任何内置工具的功能、界面或交互改动，必须同时改 bit_pouch 插件与 ihomy 在线目录 / 面板 / 中英文案，不能只登记条目；确实无法在线复现的，在 `docs/变更归档.md` 写明原因，不静默漏掉。
13. **跨端**：hash 路由；剪贴板走 `src/core/clipboard.ts`；Tauri capabilities 只开 `core:default`，新增权限必须写明理由；更新签名私钥与密码不入库。
14. **文档**：功能改 `docs/需求设计说明书.md`（就地改写，不写时间叙事）；时序进 `docs/变更归档.md`；踩坑进 `docs/踩坑速查.md`；契约变更加 `src/core/types.ts` + 指南 + 架构 + 本页。

## 5. 命令与验证基线

| 命令 | 用途 |
|------|------|
| `npm run check:plugins` | 插件目录 / 清单 / 文件约定闸门 |
| `npm run typecheck` | `vue-tsc --noEmit` |
| `npm test` | Vitest 全量 |
| `npm run build` | check + typecheck + 生产构建 |
| `npm run lint` | ESLint |
| `npm run docs:index` / `docs:check` | 生成 / 校验工具索引与文档口径 |
| `npm run verify:release` | 版本四处对齐 + Release 资产清单 |
| `cd src-tauri && cargo check` | Rust 侧类型检查 |

- **基线数字只看 `docs/现状.md`**（插件数、测试数、入口 chunk）。不要在 AGENTS 或其它文档手写第二份；`docs:check` 会校验工具数口径。
- 性能预算：首页可交互桌面 <1s / 移动中端 <1.8s；工具切换 <50ms；1MB JSON <300ms；按键不阻塞 >16ms。
- 体积预算：入口 <180KB（gzip <70KB）；单工具 <80KB（gzip <30KB），例外必须在变更归档记录理由与实测。
- 桌面构建失败先区分：WebView2、MSVC 工具链、图标、Rust 依赖下载、签名私钥（见踩坑 §8）。

## 6. UI 规则

- 颜色、间距、圆角、字体全部走 `src/styles/app.css` 的 CSS 变量；组件不写死色值。
- 桌面左侧栏 + 主区；≤900px 顶部栏 + 底部导航；工具页移动端单列。
- 可点击元素最小 34px；底部导航留 `env(safe-area-inset-bottom)`。
- 快捷键：`Ctrl/Cmd+K` 命令面板；文本类工具 `Ctrl+Enter` 运行；`Esc` 关闭面板。
- 图标按钮必须有 `aria-label` / `title`；焦点可见；颜色不作唯一信息载体。
- 文案中文优先、英文同步，动词开头，不用营销腔。完整规格见 `docs/UI设计提示词.md`。

## 7. 执行模型

- `View` → `callTool(id, input, options, locale)` → main 直接 import `run.ts`；worker 经单例 Worker `postMessage`。
- Worker 超时 30s，超时销毁重建；Worker 基础设施不可用回退主线程；插件自身抛错原样暴露。
- Worker 协议只传 `{ requestId, id, input, options, locale }`，返回 `{ requestId, result | error }`。
- 机制与取舍见 `docs/架构设计.md` §6。

## 8. 目录结构（一层；工具明细见 `docs/工具索引.md`）

```text
src/
  core/         注册、调用、Worker、存储、i18n、主题、用户插件（见 §3）
  components/   与工具无关的共享 UI
  views/        首页、工具宿主、收藏、设置
  plugins/<id>/ manifest.ts + run.ts + View.vue + run.spec.js (+ README.md)
  router/  stores/  styles/
src-tauri/      Tauri 2 桌面 / 移动壳
.github/workflows/  CI 与 Release
scripts/        插件 / 发布 / 文档校验脚本
docs/           文档体系（见 §9）
test/           测试资产与手工用例
```

## 9. 文档体系与归档

| 内容 | 唯一去处 |
|------|----------|
| 版本 / 在途 / 下一步 / 基线 | `docs/现状.md` |
| 工具与文件索引（生成） | `docs/工具索引.md` |
| 功能现状 / 验收 / 路线图 | `docs/需求设计说明书.md` |
| 时序实现记录 / 决策 | `docs/变更归档.md`（末尾追加 `#####`） |
| 踩坑（症状 → 真因 → 对策） | `docs/踩坑速查.md` |
| 插件步骤 / 契约 / 机制 | `docs/插件开发指南.md` / `docs/API接入文档.md` / `docs/架构设计.md` |
| 用户插件 | `docs/用户插件API.md` |
| UI 规范 | `docs/UI设计提示词.md` |
| ihomy 迁移差异 | `docs/迁移映射.md` |
| 文档导航 | `docs/README.md` |

- 归档流程用 `archive` 技能；最后跑 `npm run docs:check`。新增 / 删除 / 改 runtime 的插件后先跑 `npm run docs:index`。
- 工具数、测试数、版本不在多处手写：以 `docs/现状.md` 和命令输出为准。
- 收尾三件事：跑完 §5 的验证 → 按上表归档 → 向用户报告“未执行项”（如手工冒烟、未提交）。

## 10. 来源与同步

- ihomy 是只读参考源：只迁纯逻辑与测试，不迁路由、登录态、后端接口、Element Plus 组件或主题外壳。
- 行为有意变化时记 `docs/迁移映射.md`；同步后必须跑 `npm test`。
