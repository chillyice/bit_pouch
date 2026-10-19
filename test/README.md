# 测试资产

## 结构

```text
test/
  README.md                 # 本文件
  cases/功能测试用例.md      # 手工验收用例（工具 + 外壳 + 跨端）
src/plugins/<id>/run.spec.js # 纯函数单测（随插件）
```

## 自动化

```bash
npm test                 # 全部单测
npm test -- src/plugins/json/run.spec.js
npm run check:plugins
npm run typecheck
npm run build
```

单测只覆盖纯函数 `run`；视图交互、响应式布局、剪贴板、Tauri 能力走手工用例。

## 手工回归

发版前按 `cases/功能测试用例.md` 执行；在“结果”列记录 `PASS` / `FAIL` / `SKIP` 与环境（Web / Desktop / Android / iOS）。

## 基线

- 2026-10-19 V0.1：5 个 spec 文件 / 84 条断言。
- 迁移工具以 ihomy 原 spec 为行为基线；改断言必须在 `docs/迁移映射.md` 记录原因。
