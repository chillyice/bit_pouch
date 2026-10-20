---
name: release
description: bit_pouch 发布流程：版本号同步、构建验证、Web/PWA 产物、Tauri 桌面安装包、移动端构建与签名检查。Use whenever the user says 发布、打包、出安装包、发版、release, or asks to produce distributable artifacts.
---

# bit_pouch 发布

发布 = 版本确认 → 全量验证 → 构建产物 → 产物验收。**任何对外发布/上传/推送商店都必须先得到用户明确指令**。

## 前置检查

1. **版本（四处必须对齐）**
   - 根 `VERSION` 为 `V<主>.<次>`（如 `V0.2`）。
   - `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 为 semver，且主次与 `VERSION` 一致（如 `0.2.0`）。
   - 跑 `npm run verify:release`；不一致先统一，再发布。
2. **工作区**：`git status` 确认改动都是预期要发布的；有多余未提交内容先问用户。
3. **文档**：`docs/变更归档.md` 已追加本次版本小节；需求文档对应章节已是当前事实。
4. **验证**：执行 `/build-verify` 全部步骤；Tauri 改动必须 `cargo check`。
5. **更新签名（一次性）**：仓库 Secrets 配好
   - `TAURI_SIGNING_PRIVATE_KEY` = 本机 `~/.tauri/bit_pouch.key` 的文件内容
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` = 私钥密码（本项目生成时未设密码，填空字符串）
   - `@tauri-apps/cli` 必须 ≥ 2.12.1（`requireSignedVersion` 要求签名里带版本号）。

## GitHub Actions（主路径）

发布流水线与咔哒同一套，产物由 CI 出，本机只做验收。

### CI（`.github/workflows/ci.yml`）

push / PR 自动跑：

- 前端：`check:plugins` → `typecheck` → `test` → `build` → `lint`。
- 三平台：Windows / Linux / macOS 的 `cargo check`。

### Release（`.github/workflows/release.yml`）

```bash
# 1. 确认版本已同步（四处）
npm run verify:release

# 2. 打 tag 并推送（需用户明确指令）
git tag v0.2.0
git push origin v0.2.0
```

流水线行为：

- Windows：NSIS `_x64-setup.exe` + 免安装 `_x64-portable.zip` + 免安装更新包 `_x64-portable.exe`。
- Linux：`_amd64.deb` + `_amd64.AppImage`。
- macOS：`_universal.dmg`（未签名 / 未公证）。
- Web/PWA：`_web.zip`（`dist/` 静态站点）。
- 更新：各平台安装包带 `.sig`；`tauri-action` 生成 `latest.json`，Windows 再补
  `windows-x86_64-portable` 条目。
- 全部进**同一个 draft Release**；人工检查后再 Publish（镜像只同步已发布版本）。
- 最后 `verify` job 拉取资产、`latest.json` 与全部 `.sig`，跑
  `scripts/verify-release.mjs --assets … --latest … --sigs …`：版本一致、资产齐全、
  平台条目与签名一一对应、key id / 签名版本正确。

### 分发到 ihomy

```bash
# 首次部署（ihomy 服务器，root）
cd scripts/ihomy-mirror && sudo ./install.sh

# 发版后立即同步（否则等每日 04:23 的定时器）
sudo -u ihomy /usr/local/bin/bit-pouch-mirror
```

- 落盘 `/opt/ihomy/uploads/bit_pouch/`，对外 `/files/bit_pouch/`（后端已 permitAll）。
- 更新清单与更新包落在 `/opt/ihomy/uploads/bit_pouch/updates/`，对外
  `/files/bit_pouch/updates/latest.json`；镜像只改 URL，签名原样保留。
- 发布页在 ihomy 仓 `frontend/src/views/BitPouch.vue`，地址 `/bit-pouch`（alias `/bit_pouch`）。
- **换版本只改该页顶部 `version` 常量**，前提是该 tag 的 Release 已 Publish。

## Web / PWA

```bash
npm run build
```

产物 `dist/`：

- `index.html` + `assets/*` + `manifest.webmanifest` + `sw.js`。
- 静态托管即可；hash 路由无需 rewrite。
- Release 里的 `_web.zip` 就是 `dist/` 整包。
- 验收：本地 `npm run preview` 打开，检查首页与各工具、刷新深链接、离线二次访问。

## Desktop（Tauri 2）

```bash
# createUpdaterArtifacts 需要签名私钥，否则打包阶段会失败
TAURI_SIGNING_PRIVATE_KEY="$HOME/.tauri/bit_pouch.key" npm run desktop:build
```

- 首次/改图标后：`npm run tauri icon src-tauri/app-icon.svg`。
- Windows 产物在 `src-tauri/target/release/bundle/`（msi / nsis）；`.sig` 与安装包同目录。
- macOS / Linux 需在对应平台构建（交叉编译不在基线内）。
- 验收：
  - 安装后启动不白屏。
  - `Ctrl+Shift+B` 显示/隐藏窗口。
  - 重复启动只保留一个实例。
  - 复制按钮可用。
  - 卸载/覆盖安装不丢本地偏好（localStorage 按 WebView 数据目录保留）。
  - **更新**：装上一版 → 设置页「检查更新」看到新版本 → 下载 → 安装后重启到新版本；
    免安装版更新后仍留在原目录，不被装成安装版。

## Mobile（Tauri 2）

```bash
npm run mobile:android    # tauri android init && tauri android dev
npm run mobile:ios
```

- 首次需要 Android SDK / Xcode；按 Tauri 官方文档配置。
- 真机验收：布局、底部导航安全区、输入法、剪贴板、旋转屏幕。
- 签名：
  - Android keystore / iOS 证书**不入库**；放在本机安全位置。
  - 构建 release 前确认签名配置由本机或 CI secret 注入。

## 发布报告

```text
版本：V0.x / 0.x.0
CI：frontend + 三平台 cargo check 通过
Release：draft / 已发布；资产 + latest.json + .sig 齐全（verify-release 通过）
Web：dist 构建通过；preview 冒烟通过
Desktop：xxx-setup.exe / _x64-portable.zip / _x64-portable.exe；快捷键/单实例/复制/更新通过
Mobile：Android/iOS（已构建 / 未构建）
镜像：/files/bit_pouch/ 与 /files/bit_pouch/updates/ 已同步；发布页 version 已更新
验证：check-plugins / typecheck / test / build / lint / cargo check / cargo test / verify:release
已知问题：……
```

## 禁止

- 不自动 `git push` / 打 tag / Publish Release / 上传应用商店。
- 不在仓库写入签名文件、密钥、证书密码、GitHub Secrets。
- 不把 `dist/`、`src-tauri/target/`、`node_modules/` 提交入库。
- 不在 Release 还是 draft 时改发布页版本号（镜像取不到草稿）。
