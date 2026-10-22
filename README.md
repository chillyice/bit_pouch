# bit_pouch（比特口袋）

> 开发者的随身工具袋。本地处理、插件化、桌面与移动同源。

bit_pouch 把 ihomy 工具箱里已经验证过的工程工具抽出来，做成一个独立产品：启动快、输入即算、数据不离开设备，并且可以按插件持续扩展。

## 为什么现在做

ihomy 的工具箱解决了“有没有”的问题：JSON 格式化、字符编码、进制转换、报文解析、子网计算都能用。但它们是家庭站里的页面，受路由、外壳、依赖体积和登录态牵制，无法承担“高频、随手、跨端”的工具场景。

bit_pouch 的目标是把这些能力产品化：

- **快**：纯前端计算 + Worker，重活不阻塞输入；常用工具一次点击直达。
- **净**：默认零网络请求，输入内容不落盘、不上传。
- **小**：不引入重型 UI 框架，按需加载插件，Web/PWA/桌面/移动共用一套内核。
- **可长**：新增工具只加一个目录，不改路由、不改首页、不改构建配置；也可以在设置页导入自己写的 JavaScript 小工具（只存本机，不上传）。

## 工具清单（24 个）

| 工具 | 说明 | 运行时 |
|------|------|--------|
| 格式化（JSON / XML / HTML / SVG） | 自动识别格式；格式化 / 压缩 / 校验；JSON 键名排序，保留长整数、重复键与原始转义 | Worker |
| 数据格式转换 | YAML / TOML / INI / .env / Properties 与 JSON 互转，自动识别与警告提示 | Worker |
| 字符编码转换 | Unicode / HTML 实体 / URL / Base64 / UTF-8 字节互转，逐字码位表 | 主线程 |
| 进制转换 | 2–36 进制整数/小数互转，BigInt 精确，近似值标记 | 主线程 |
| 网络报文解析 | 自动识别 Ethernet / IPv4 / IPv6 / ARP / TCP / UDP / DNS / HTTP / TLS，原文与 ASCII 分行、字段悬停释义；保留逐字节与校验值 | 主线程 |
| 子网计算 | IPv4 网络/广播/可用范围、掩码与前缀互转、地址类型、二进制对照 | 主线程 |
| HTTP 报文 | 解析或生成原始 HTTP/1.x 请求/响应，展开头、Cookie、query、chunked 与 multipart | Worker |
| cURL 转换 | cURL → fetch / axios / Python / Go / PowerShell，只解析不执行 | 主线程 |
| IP 段计算 | CIDR 合并、范围互转、包含判断与排除，支持 IPv4 / IPv6 | 主线程 |
| MQTT 主题 | 解析主题层级、共享订阅与通配符，校验并判断匹配 | 主线程 |
| URL 解析 | 拆解协议、主机、路径、片段与查询参数 | 主线程 |
| 哈希与校验 | MD5 / SHA / CRC32 / HMAC，文本与文件摘要，全程本地 | Worker |
| JWT 与密钥 | 解码 / HMAC·RSA·ECDSA 验签 / 密钥对与 PEM·JWK / AES-GCM 加解密 | 主线程 |
| 时间工具箱 | 时间戳 / 时区 / 日期差 / Cron，本地换算 | 主线程 |
| 随机生成器 | 密码 / UUID / ULID / 随机字节 / 抽签分组，本地生成 | 主线程 |
| UUID 生成 | 批量生成 UUID v4，或解析现有 UUID 的版本与变体 | 主线程 |
| 正则测试 | 实时查看匹配、分组与替换结果 | 主线程 |
| 文本清洗与对比 | 清洗 / 命名转换 / Markdown 表格 / 文本 diff | 主线程 |
| 颜色与前端设计 | 格式互转 / 对比度 / 配色 / CSS | 主线程 |
| 单位换算 | 长度 / 重量 / 温度 / 数据量等 | 主线程 |
| 文件工具 | 类型识别 / ZIP 打包与解压 | 主线程 |
| 图片工具 | 压缩 / ICO 图标 / EXIF 查看 | 主线程 |
| 运维速查 | systemd / Nginx / Docker / MySQL / SSH 命令与常用对照表 | 主线程 |
| PDF 转换 | PDF 转图片 / 图片转 PDF / PDF 提取文字，全部本机完成 | 主线程 |

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
  - Windows：`bit_pouch_<版本>_x64-setup.exe`（NSIS）+ `_x64-portable.zip` + `_x64-portable.exe`（免安装版的自动更新包）
  - Linux：`_amd64.deb` + `_amd64.AppImage`
  - macOS：`_universal.dmg`（未签名 / 未公证）
  - Web/PWA：`_web.zip`（`dist/` 静态站点，任意静态服务器可托管）
- **签名与更新清单**：流水线用 `TAURI_SIGNING_PRIVATE_KEY` 给更新包签名，并生成 `latest.json`；Windows 的 `latest.json` 同时含安装版与免安装版条目。
- **校验**：`npm run verify:release` 检查 `VERSION` / `package.json` / `tauri.conf.json` / `Cargo.toml` 版本一致；CI 的最后一步再核对 Release 资产、`latest.json` 平台条目与每个 `.sig` 的 key id / 版本号。
- **分发**：ihomy 发布页 `https://ihomy.top/bit-pouch` 统一走服务器直链 `/files/bit_pouch/<文件名>`；本仓 `scripts/ihomy-mirror/` 部署在 ihomy 服务器，每日从 GitHub 最新**已发布** Release 同步安装包与更新清单到 `/files/bit_pouch/updates/`（draft / prerelease 不会被镜像）。GitHub Releases 作为备用入口。
- **应用内更新**：桌面端「设置 → 软件更新」检查、下载、安装；默认读 ihomy 镜像，可切 GitHub Releases；Ed25519 签名不符的包会被拒绝。安装版走 NSIS 静默安装，免安装版原位替换 exe 后重启。
- **版本切换点**：发版后只改 ihomy `BitPouch.vue` 顶部的 `version` 常量；前提是该 tag 的 Release 已 Publish。

> 本地打桌面安装包时 `createUpdaterArtifacts` 需要签名私钥：
> `TAURI_SIGNING_PRIVATE_KEY="$HOME/.tauri/bit_pouch.key" npm run desktop:build`。

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
- [API 接入文档](docs/API接入文档.md) — manifest / run / ToolResult 契约与两条接入路径
- [架构设计](docs/架构设计.md) — 插件模型、执行模型、性能预算、跨端策略
- [需求设计说明书](docs/需求设计说明书.md) — 功能现状与验收口径
- [插件开发指南](docs/插件开发指南.md) — 从零新增一个工具
- [用户插件 API](docs/用户插件API.md) — 免构建单文件插件的运行时细节
- [踩坑速查](docs/踩坑速查.md) — 症状 → 真因 → 对策
- [变更归档](docs/变更归档.md) — 唯一时序记录
- [迁移映射](docs/迁移映射.md) — ihomy → bit_pouch 的来源与差异

## 状态

当前为 **V0.6 平台能力版本**：插件内核、24 个工具（含网络报文自动解析、数据格式转换、HTTP 报文、cURL 转换、IP 段计算、MQTT 主题，以及 JWT、哈希、时间、随机、文本、颜色、单位、文件、图片、运维、PDF 与统一格式化）、桌面/移动壳与文档基线已完成；工具页已支持文件拖入。后续优先桌面安装包与移动端真机验证、多窗口/悬浮窗等平台能力。

许可证尚未确定；在明确之前请勿对外分发。
