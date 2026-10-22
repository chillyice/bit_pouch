# data-format — 数据格式转换

在 YAML、TOML、INI、.env、Properties 与 JSON 之间互转。所有处理在本机完成，输入不写入 localStorage、日志或任何远端。

## 能力

- `toJson`：读取 YAML / TOML / INI / .env / Properties / JSON，输出格式化 JSON。
- `fromJson`：读取 JSON，按目标格式输出。
- 自动识别源格式；无法判断时返回 `unsupportedFormat`，不猜测。
- 选项：缩进（2 / 4 / Tab）、`flatten`（INI 嵌套展开）、`sortKeys`。

## 运行时

`runtime: 'worker'`。YAML 与 TOML 依赖随插件 chunk 加载，1MB 输入不阻塞主线程。

## 数据形状

```ts
{
  sourceFormat: 'json' | 'yaml' | 'toml' | 'ini' | 'env' | 'properties'
  targetFormat: 'json' | 'yaml' | 'toml' | 'ini' | 'env' | 'properties'
  keyCount: number
  warnings: string[]   // 已本地化，带警告码前缀
}
```

## 错误码

| 码 | 说明 |
|----|------|
| `empty` | 输入为空 |
| `tooLarge` | 超过 1,000,000 字符 |
| `tooDeep` | 嵌套超过 100 层 |
| `syntaxError` | 语法错误，附 `line` / `column` / `lineText` |
| `unsupportedFormat` | 自动识别失败 |
| `multiDocument` | 多个 YAML 文档 |
| `tooManyAliases` | YAML 别名超过 100 |
| `cyclicReference` | YAML 锚点循环引用 |
| `unsafeKey` | 键名为 `__proto__` / `constructor` / `prototype` |
| `nestedNotSupported` | 目标格式不支持嵌套对象或数组 |
| `invalidKey` | .env 键名不匹配 `^[A-Za-z_][A-Za-z0-9_]*$` |
| `unsupportedValue` | TOML 不支持 `null` / `undefined` |

警告（不阻断）：`nonFiniteNumber`、`commentsDropped`、`precisionLoss`、`duplicateKey`。

## 边界与已知限制

- 注释只用于解析，输出会丢弃；源文本含注释时给 `commentsDropped`。
- YAML 日期按字符串保留；TOML 日期/时间统一转 ISO 字符串（纯时间会带 `0000-01-01` 日期）。
- TOML 的 `nan` / `inf` 在 JSON 输出中转成字符串，并给 `nonFiniteNumber`。
- INI 输出：`flatten=true` 全部转为点号键；`flatten=false` 顶层对象为节，第二层必须是标量。
- .env 只接受扁平标量对象；含空格、引号或 `#` 的值会加双引号。
- JSON 中超过 `Number.MAX_SAFE_INTEGER` 的整数会丢精度，仅给 `precisionLoss` 警告。
- 自动识别基于结构特征；无 `[section]`、无引号值、无 `[[]]` 的 TOML 可能与 INI 相同，必要时手动选择。
