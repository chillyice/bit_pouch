# 交接提示词（新会话直接粘贴下面一段即可）

> 用法：在新会话中把下面的引用块整段复制为第一条消息。工作目录切到 bit_pouch 后再发。

---

继续 bit_pouch（`C:\Users\chill\OneDrive\WorkStation\Projects\bit_pouch`）的开发。这是一个已立项的独立项目：本地优先、插件化的开发者工具袋，Vue 3 + TS + Vite + Tauri 2，工具逻辑从 ihomy 工具箱迁移而来。

**先读这些再动手**（按序）：
1. 根 `AGENTS.md` —— 项目硬性规则（插件契约、隐私、性能预算、构建命令）
2. `docs/变更归档.md` 顶部 V0.1 小节 —— 已完成内容、实测验证数据、遗留项
3. `docs/踩坑速查.md` —— 动手前按关键词检索（尤其 §1 工具链、§2 插件系统、§10.4 自动化点击）
4. `docs/迁移映射.md` —— 与 ihomy 的对应关系（源仓 `C:\Users\chill\OneDrive\WorkStation\Projects\ihomy`，只读参考）

**当前状态（V0.1，2026-10-19 全部实测通过）**：
- 插件内核：`src/core`（registry 自动发现 / runner main+worker / 清单校验）；5 个插件 json(worker)、codec、base、packet、subnet 已迁移，ihomy 原 spec 84 条断言全绿
- UI：桌面侧栏 + 移动底部导航自适应、命令面板 Ctrl/Cmd+K、收藏/最近持久化、中英双语、深浅主题
- 浏览器冒烟已过：JSON 长整数、编码往返、BigInt 进制、Modbus CRC16（0000/CDC5）、子网 /24 与 /31、命令面板路由、收藏持久化、localStorage 无输入泄漏
- Tauri：`cargo check` 通过（含 global-shortcut、single-instance）；`npm run build` 通过，入口+框架 gzip ≈ 56KB
- 文档/Skill：docs/ 结构与 `.agents/skills/`（archive、build-verify、plugin-author、release、sync-from-ihomy）已按 ihomy 体系改编；`.zcode/skills/` 为同名 junction

**遗留项（按优先级）**：
1. `git init` + 首次提交（需我确认后再执行 commit）
2. 构建桌面安装包验证（`npm run desktop:build`，首次需 `npm run tauri icon src-tauri/app-icon.svg`）
3. V0.2 工具扩展：JWT 解析、Hash、时间戳、UUID、URL 解析、正则测试（用 `npm run plugin:new` 脚手架，流程见 `docs/插件开发指南.md`）
4. 移动端 `tauri android init` 真机验证；PWA 补 192/512 PNG 图标；发布前收紧 CSP

**环境备注**：
- dev server 可能仍在后台跑（http://localhost:5173）；ZCode 内置浏览器有一个标签停在该地址
- 本机 Node 24 / Rust 1.98 / cargo 可用；pnpm 不可用，用 npm
- 验证命令：`npm run check:plugins && npm run typecheck && npm test && npm run build`，Rust 侧 `cd src-tauri && cargo check`

先按 `docs/变更归档.md` 的遗留项给我一个建议的 V0.2 计划（不超过 10 行），确认后再动手。
