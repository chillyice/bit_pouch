---
name: sync-from-ihomy
description: 从 ihomy 工具箱同步工具逻辑与测试到 bit_pouch：定位源文件、迁移纯函数、适配 TypeScript、跑行为基线、记录差异。Use whenever the user says 从 ihomy 同步、把 ihomy 的工具迁过来、ihomy 更新了某个工具, or asks to port a toolbox feature from the ihomy project.
---

# 从 ihomy 同步工具

ihomy 是开发与体验来源，bit_pouch 是产品化目标。**只迁纯逻辑与测试，不迁外壳。**

源仓：

```text
C:\Users\chill\OneDrive\WorkStation\Projects\ihomy
frontend/src/utils/*.js
frontend/src/utils/*.spec.js
frontend/src/views/tools/*.vue   （只读交互意图）
```

## 流程

1. **定位**
   - 工具逻辑：`frontend/src/utils/<name>.js`
   - 测试：`frontend/src/utils/<name>.spec.js`
   - 页面：`frontend/src/views/tools/<Name>.vue`
   - 路由/卡片：`frontend/src/router/index.js`、`views/tools/Tools.vue`（只用于确认工具名与描述）

2. **读最新实现与测试**
   - `git log --oneline -10 -- <path>` 看近期是否改过。
   - 先读 spec，明确行为边界；再读实现。

3. **迁移纯逻辑**
   - 目标：`src/plugins/<id>/run.ts`。
   - 保留：函数名、错误码、边界行为、注释中的关键原因。
   - 增加：TS 类型、`run` 包装、按 `ctx.locale` 的本地化 `message`。
   - 删除：ihomy 的 i18n key 依赖、Vue/DOM 依赖、后端调用。

4. **迁移测试**
   - 复制 spec 到 `src/plugins/<id>/run.spec.js`，只改 import 路径。
   - 先跑 `npm test -- src/plugins/<id>/run.spec.js`，确保全绿。
   - 若必须改断言，先确认是有意行为变化，并在 `docs/迁移映射.md` 记录。

5. **重写视图**
   - 不复制 Element Plus 结构；用 `Pane`/`CopyButton`/`SegmentedControl`/`StatChips`/`ErrorNote`。
   - 保留交互意图：输入输出、选项、示例、清空、复制、错误定位、统计。
   - 增加：防抖、序号守卫、渲染上限、移动端布局。

6. **注册与验证**
   - 只需目录存在；无需改 router/首页。
   - 更新 `docs/迁移映射.md` 与 `docs/变更归档.md`。
   - 运行：

```bash
npm run check:plugins
npm test
npm run typecheck
npm run build
```

## 迁移判定

- ihomy 原 spec 全绿。
- 新视图的手工用例通过。
- 输入不落盘、无网络。
- 行为差异已记录。

## 不要迁

- 登录/权限/家庭/后端接口。
- Element Plus 组件、ihomy 主题、首页模块体系。
- PDF/脑图/AI/Flash/GBA/贷款/光照等非工程工具。
- 生产部署脚本、数据库 schema、凭证。
