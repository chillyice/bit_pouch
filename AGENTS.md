# AGENTS.md — bit_pouch 项目规则

> 本文件供 ZCode 等 AI 会话跨会话加载，记录项目的**关键规则、约定与导航索引**。新会话启动自动读取，无需重复说明背景。
>
> **分工**：本文件只留“结论级规定 + 索引”，目标 ≤ 32KB。细节各有归属：

| 内容类型 | 去处 |
|---------|------|
| 功能现状、验收口径、路线图 | `docs/需求设计说明书.md` |
| 实现记录、决策、live 数据变更 | `docs/变更归档.md`（唯一时序记录） |
| 踩坑成因、机制细节、排查方法 | `docs/踩坑速查.md` |
| 插件开发步骤与契约 | `docs/插件开发指南.md` |
| 对外 API 契约（manifest / run / ToolResult） | `docs/API接入文档.md` |
| 用户插件运行时细节 | `docs/用户插件API.md` |
| UI/交互/视觉规范 | `docs/UI设计提示词.md` |
| ihomy 来源与差异 | `docs/迁移映射.md` |

> **⚠ Git 规定**：非用户明确指令，不主动 `git commit` / `git push`。`git add` 只能指定具体文件路径，禁止 `git add -A` / `git add .`。归档技能默认只写文档，提交需用户确认。

> **⚠ 隐私规定**：工具输入内容**不得**写入 localStorage、IndexedDB、日志或任何远端。只有工具选项、收藏、最近使用、主题、语言可以持久化。新增插件若需要网络，必须在清单与文档中显式声明，默认禁止。

> **⚠ 多会话并行**：OneDrive 同步目录下并行改同一文件会被覆盖。开始工作前先看 `git status` 与文件时间；不要使用 `git stash` 回滚他人改动。

## 项目概述

- **名称**：bit_pouch（显示名、npm 包名、Tauri productName、窗口标题统一）。
- **定位**：开发者的随身工具袋；桌面 + 移动 + Web/PWA 同源。
- **核心能力**：本地优先的工程工具集合；插件化扩展；命令面板；收藏与最近使用。
- **技术栈**：Vue 3 + TypeScript + Vite + Pinia + vue-router；Tauri 2（Rust）作为桌面/移动壳；Vitest；vite-plugin-pwa。
- **不引入**：Element Plus 等重型 UI 库、后端服务、账号体系、云同步（V0.1 明确不做）。

## 工作目录

唯一工作目录：

```text
C:\Users\chill\OneDrive\WorkStation\Projects\bit_pouch
```

ihomy 是**开发与体验的来源仓**，只读参考，不在本仓内直接引用其运行时依赖：

```text
C:\Users\chill\OneDrive\WorkStation\Projects\ihomy
```

## 命名与版本

| 项 | 规则 |
|----|------|
| 应用标识 | `bit_pouch`（下划线）；Rust crate/lib 用 `bit_pouch` / `bit_pouch_lib` |
| 插件 id | kebab-case，`^[a-z][a-z0-9-]*$`，必须与目录名一致 |
| 用户插件 id | 同格式；不能与内置工具冲突；无目录，代码存 localStorage |
| 插件目录 | `src/plugins/<id>/` |
| 组件文件 | PascalCase（`HomeView.vue`、`ToolCard.vue`） |
| 组合式/工具 | camelCase（`toolPrefs.ts`、`clipboard.ts`） |
| 版本唯一来源 | 仓库根 `VERSION`，格式 `V<主>.<次>`（如 `V0.1`）；前端经 `__APP_VERSION__` 注入 |
| Tauri 版本 | `src-tauri/tauri.conf.json` 与 `Cargo.toml` 使用 semver（如 `0.1.0`），发版时与 `VERSION` 同步 |

版本进位：每次可交付迭代次位 +1；次位满 100 进位主版本；结构性里程碑可提前进位。发版时在 `docs/变更归档.md` 末尾追加 `#####` 小节，并就地更新需求文档对应章节。

## 目录结构

```text
src/
  core/
    types.ts          # ToolManifest / ToolResult / ToolRun 契约
    manifest.ts       # 清单运行时校验（构建脚本与启动共用）
    registry.ts       # import.meta.glob 自动发现、搜索、懒加载
    runner.ts         # main/worker 统一调用、超时、回退
    worker/           # 单例工具 Worker
    i18n.ts           # 轻量中英双语
    theme.ts          # dark/light + CSS 变量
    storage.ts        # 版本化 localStorage key、最近/收藏
    userPlugins.ts    # 运行时用户插件：编译、校验、结果归一化、本地存储
    toolPrefs.ts      # 只持久化选项的 useToolPrefs
    clipboard.ts      # WebView 兼容复制
    platform.ts       # web/desktop/mobile 判定
    toast.ts          # 轻量提示
  components/         # 与工具无关的共享 UI
  views/              # 首页、工具宿主、收藏、设置、404
  plugins/<id>/       # manifest.ts + run.ts + View.vue + run.spec.js
  router/             # hash 路由，工具统一走 /t/:id
  stores/             # Pinia：收藏与最近使用
  styles/app.css      # 设计令牌 + 全部全局样式
src-tauri/            # Tauri 2 桌面/移动壳
.github/workflows/    # CI 与 Release（三平台矩阵 + Web/PWA 包）
scripts/              # 插件校验、脚手架、发布校验、ihomy 镜像
docs/                 # 文档体系
test/                 # 测试资产与用例
```

## 插件硬性规则

1. **一个工具 = 一个目录**。必需文件：`manifest.ts`、`run.ts`、`View.vue`；建议 `run.spec.js`。
2. **`run.ts` 是纯函数**：不得访问 DOM / `window` / `localStorage` / 网络；不得修改入参。
3. **返回值必须可结构化克隆**：Worker 插件不能返回 `Uint8Array`、函数、类实例；用普通对象/数组/字符串/数字/BigInt。
4. **清单是纯数据**：不要在 `manifest.ts` 里 import 视图、运行时代码或依赖 DOM 的模块。
5. **输入不落盘**：`useToolPrefs` 只存选项；不要把输入文本塞进 prefs。
6. **注册零改动**：新增插件不需要改 router、首页、构建配置；由 `import.meta.glob` 自动发现。
7. **重活进 Worker**：预计单次 > 50ms 或输入可能 > 100KB 的工具，manifest 写 `runtime: 'worker'`，并在 `run.ts` 中避免依赖 DOM。
8. **必须有测试**：至少覆盖正常路径、边界、错误码；迁移工具以 ihomy 的 spec 为行为基线。
9. **错误统一**：返回 `{ ok:false, error:{ code, message } }`，不要向视图抛裸异常；`message` 按 `ctx.locale` 本地化。
10. **新增依赖要克制**：优先原生 API；引入任何依赖前评估 gzip 体积、离线可用性、跨端兼容性，并更新文档。
11. **用户插件只在本机运行**：源码存 `bitpouch:user-plugins:v1`，`new Function` 编译后注册；固定主线程，不进入 Worker；不得上传、自动下载或同步到远端。设置页只负责导入/导出/删除，不内置编辑器；坏插件不得阻塞启动。

## 执行模型

```text
View ──callTool(id, input, options, locale)──┐
                                             ├─ runtime=main   → 动态 import run.ts，直接调用
                                             └─ runtime=worker → 单例 Worker，postMessage
```

- Worker 超时 30s；超时后销毁并重建。
- Worker 基础设施不可用（老浏览器/受限环境）自动回退主线程；插件自身抛错不回退，原样暴露。
- `AbortSignal` 支持取消等待；单 Worker 模型下取消只停止等待，不中断正在执行的计算。
- Worker 协议只传 `{ requestId, id, input, options, locale }`，返回 `{ requestId, result | error }`。
- 用户插件绕过 Worker：注册后固定 `runtime: 'main'`，由 `loadRun` 包一层 `normalizeToolResult`；主线程死循环会卡住界面，这是已知边界。

## 性能预算（V0.1）

| 指标 | 目标 |
|------|------|
| 首页可交互 | 桌面 < 1s，移动中端 < 1.8s（本地构建） |
| 工具切换 | < 50ms（视图懒加载后） |
| 1MB JSON 格式化 | < 300ms（Worker） |
| 输入响应 | 每次按键不阻塞 > 16ms |
| 入口 chunk | < 180KB（gzip < 70KB），重型工具必须独立 chunk |
| 单工具 chunk | < 80KB（gzip < 30KB），除非有明确理由 |

实现手段：路由懒加载、插件视图懒加载、无重型 UI 组件库、JSON 语法高亮超过 200KB 关闭、字节表最多 512 行、逐字表最多 500 字符。

## UI 规则

- **设计令牌**：颜色、间距、圆角、字体全部走 `src/styles/app.css` 的 CSS 变量；禁止在组件里散落硬编码色值。
- **布局**：桌面左侧栏 + 主区；≤900px 切换为顶部栏 + 底部导航；工具页移动端单列。
- **触控**：可点击元素最小 34px；移动端底部导航留 `env(safe-area-inset-bottom)`。
- **快捷键**：`Ctrl/Cmd+K` 命令面板；JSON 工具 `Ctrl+Enter` 运行；`Esc` 关闭面板。
- **无障碍**：所有图标按钮有 `aria-label`/`title`；焦点可见；颜色不作为唯一信息载体。
- **文案**：中文优先，英文同步；避免营销腔，动词开头。

## 构建与验证

```bash
npm run check:plugins   # 插件目录/清单/文件约定
npm run typecheck       # vue-tsc --noEmit
npm test                # vitest run
npm run build           # check + typecheck + vite build
npm run lint            # eslint（可选，提交前建议）
npm run verify:release  # 版本四处对齐 + Release 资产清单校验
```

发布：打 `v<版本>` tag 触发 `.github/workflows/release.yml`，产物进 **draft** Release，人工 Publish；服务器镜像与 ihomy 发布页 `/bit-pouch` 由 `scripts/ihomy-mirror/` 每日同步（详见 `docs/需求设计说明书.md` §5.4 与 release skill）。

桌面壳：

```bash
cd src-tauri && cargo check     # 仅 Rust 侧类型检查
npm run desktop:dev             # 需要 WebView2
npm run desktop:build           # 生成安装包（createUpdaterArtifacts 需要签名私钥）
```

- **更新签名**：本地打包含 `TAURI_SIGNING_PRIVATE_KEY="$HOME/.tauri/bit_pouch.key"`；CI 用 Secrets `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。私钥、密码、`.sig` 之外的密钥材料一律不入库。
- 构建基线：入口 chunk、单工具 chunk 体积记录在 `docs/变更归档.md`；明显超出先查是否把重型依赖同步打进入口。
- 桌面构建失败先区分：WebView2 缺失、MSVC 工具链缺失、图标缺失、Rust 依赖下载失败、签名私钥未配置。
- PWA 产物在 `dist/`；`dev-dist/` 是开发期生成物，不入库。

## 跨端约定

- 路由用 **hash history**：`file://`、Tauri 自定义协议、静态托管都不会 404。
- 剪贴板走 `core/clipboard.ts`：优先 `navigator.clipboard`，失败回退 `textarea + execCommand`。
- 桌面全局快捷键 `Ctrl+Shift+B` 显示/隐藏窗口，注册在 Rust 侧；与系统或其他应用冲突时在设置文档中记录。
- Tauri capabilities 只开 `core:default`；新增插件/权限必须写明理由并更新 `src-tauri/capabilities/default.json`。
- 移动端初始化前确认 Android SDK / Xcode；`tauri android init` / `tauri ios init` 生成的目录按需入库，签名材料不入库。
- **分发**：安装包统一走 ihomy 直链 `/files/bit_pouch/<版本化文件名>`，GitHub Releases 作为备用。桌面端应用内更新走 `tauri-plugin-updater`：默认读 ihomy 镜像 `/files/bit_pouch/updates/latest.json`，可切 GitHub；更新包经 Ed25519 签名校验，镜像只搬文件与改 URL、不改签名。换版本只改 ihomy `BitPouch.vue` 的 `version` 常量，且该 tag 必须先 Publish（镜像排除 draft）。

## 文档维护规矩

- **变更记录**追加到 `docs/变更归档.md` 末尾，不写回 AGENTS.md。
- **踩坑**写 `docs/踩坑速查.md`，格式“症状 → 真因 → 对策”，附取证命令。
- **功能变更**就地改写 `docs/需求设计说明书.md` 对应章节，按功能组织，不写时间叙事。
- **插件契约变化**同步 `docs/API接入文档.md`、`docs/插件开发指南.md` 与本文件“插件硬性规则”。
- **计数口径**：工具数量、插件数量以 `npm run check:plugins` 输出为准；文档里的数字改动后顺手核对。

## 来源与同步

- ihomy 工具箱的实现与测试是本项目的行为基线；迁移明细见 `docs/迁移映射.md`。
- 从 ihomy 同步时**只迁纯逻辑与测试**，不要迁入其路由、登录态、后端接口、Element Plus 组件或主题外壳。
- 同步后必须跑 `npm test`；若行为有意变化，在 `docs/迁移映射.md` 记录差异与原因。
