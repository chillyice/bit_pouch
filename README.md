# bit_pouch

> 开发者的随身工具袋。本地处理、插件化、桌面与移动同源。

bit_pouch 把 ihomy 工具箱里已经验证过的工程工具抽出来，做成一个独立产品：启动快、输入即算、数据不离开设备，并且可以按插件持续扩展。

## 为什么现在做

ihomy 的工具箱解决了“有没有”的问题：JSON 格式化、字符编码、进制转换、报文解析、子网计算都能用。但它们是家庭站里的页面，受路由、外壳、依赖体积和登录态牵制，无法承担“高频、随手、跨端”的工具场景。

bit_pouch 的目标是把这些能力产品化：

- **快**：纯前端计算 + Worker，重活不阻塞输入；常用工具一次点击直达。
- **净**：默认零网络请求，输入内容不落盘、不上传。
- **小**：不引入重型 UI 框架，按需加载插件，Web/PWA/桌面/移动共用一套内核。
- **可长**：新增工具只加一个目录，不改路由、不改首页、不改构建配置。

## 已迁移工具（V0.1）

| 工具 | 说明 | 运行时 |
|------|------|--------|
| JSON 格式化 | 格式化 / 压缩 / 键名排序；保留长整数、重复键与原始转义 | Worker |
| 字符编码转换 | Unicode / HTML 实体 / URL / Base64 / UTF-8 字节互转，逐字码位表 | 主线程 |
| 进制转换 | 2–36 进制整数/小数互转，BigInt 精确，近似值标记 | 主线程 |
| 报文解析 | HEX/文本转字节、字段模板切分、逐字节查看、SUM8/XOR8/SUM16/CRC16 | 主线程 |
| 子网计算 | IPv4 网络/广播/可用范围、掩码与前缀互转、地址类型、二进制对照 | 主线程 |

## 快速开始

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # 单元测试（ihomy 行为基线）
npm run check:plugins
npm run typecheck
npm run build
```

桌面端（需要 Rust / WebView2）：

```bash
npm run tauri icon src-tauri/app-icon.svg   # 首次生成图标
npm run desktop:dev
npm run desktop:build
```

移动端（需要 Android SDK / Xcode，按 Tauri 2 的移动初始化流程）：

```bash
npm run mobile:android
npm run mobile:ios
```

Web 版构建产物同时是 PWA，可安装到桌面或手机主屏。

## 发布

发布流水线与咔哒（Kada）同一套，由 GitHub Actions 承担：

- **CI**：push / PR 跑插件闸门、`typecheck`、单测、生产构建、ESLint，并做 Windows / Linux / macOS 三平台 `cargo check`。
- **Release**：打 `v<版本>` tag（或手动触发）→ 三平台矩阵构建 → 产物上传到同一个 **draft** Release，确认无误后手动 Publish。
  - Windows：`bit_pouch_<版本>_x64-setup.exe`（NSIS）+ `_x64-portable.zip`
  - Linux：`_amd64.deb` + `_amd64.AppImage`
  - macOS：`_universal.dmg`（未签名 / 未公证）
  - Web/PWA：`_web.zip`（`dist/` 静态站点，任意静态服务器可托管）
- **校验**：`npm run verify:release` 检查 `VERSION` / `package.json` / `tauri.conf.json` / `Cargo.toml` 版本一致；CI 的最后一步再核对 Release 六类资产齐全。
- **分发**：ihomy 发布页 `https://ihomy.top/bit-pouch` 统一走服务器直链 `/files/bit_pouch/<文件名>`；本仓 `scripts/ihomy-mirror/` 部署在 ihomy 服务器，每日从 GitHub 最新**已发布** Release 同步安装包（draft / prerelease 不会被镜像）。GitHub Releases 作为备用入口。
- **版本切换点**：发版后只改 ihomy `BitPouch.vue` 顶部的 `version` 常量；前提是该 tag 的 Release 已 Publish。
- **当前不含自动更新**：没有接入 `tauri-plugin-updater`，也不做 `.sig` / `latest.json`；用户下载新包覆盖安装，本地偏好与收藏保留。

## 架构一览

```text
┌─────────────────────────────────────────────────────────────┐
│ Shell: Web/PWA · Tauri desktop · Tauri mobile               │
│  App.vue · responsive sidebar / bottom nav · ⌘K palette     │
├─────────────────────────────────────────────────────────────┤
│ Registry  import.meta.glob('../plugins/*/manifest.ts')      │
│  list / search / route / validate — 新增插件无需改全局文件    │
├─────────────────────────────────────────────────────────────┤
│ Runner    runtime: main | worker                            │
│  callTool() · timeout · abort · structured-clone only       │
├─────────────────────────────────────────────────────────────┤
│ Plugin    <id>/manifest.ts · run.ts · View.vue · spec       │
│  pure function contract · no DOM · no input persistence     │
├─────────────────────────────────────────────────────────────┤
│ Core      i18n · theme · storage · clipboard · toast        │
└─────────────────────────────────────────────────────────────┘
```

新增插件：

```bash
npm run plugin:new -- jwt "JWT 解析" "JWT Inspector" inspect
```

它会在 `src/plugins/jwt/` 生成清单、纯函数、视图和测试；注册由文件系统约定自动完成。

## 文档

- [文档索引](docs/README.md)
- [架构设计](docs/架构设计.md) — 插件模型、执行模型、性能预算、跨端策略
- [需求设计说明书](docs/需求设计说明书.md) — 功能现状与验收口径
- [插件开发指南](docs/插件开发指南.md) — 从零新增一个工具
- [踩坑速查](docs/踩坑速查.md) — 症状 → 真因 → 对策
- [变更归档](docs/变更归档.md) — 唯一时序记录
- [迁移映射](docs/迁移映射.md) — ihomy → bit_pouch 的来源与差异

## 状态

当前为 **V0.3 工具扩展版本**：插件内核、12 个工具（含 JWT、哈希与校验、时间工具箱、随机生成器、UUID、URL、正则）、桌面/移动壳与文档基线已完成。后续优先文本与数据类工具、桌面安装包与移动端真机验证。

许可证尚未确定；在明确之前请勿对外分发。
