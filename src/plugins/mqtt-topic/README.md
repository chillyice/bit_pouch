# mqtt-topic — MQTT 主题

解析 MQTT 主题/过滤器、校验语法并判断通配匹配。规则依据 MQTT 3.1.1 / 5.0，本地计算，不联网。

## 模式

| 模式 | 输入 | 输出 |
|------|------|------|
| `parse` | 每行一个主题或过滤器 | 层级、通配符位置、共享订阅、系统主题标记 |
| `match` | 第一行过滤器，后续每行具体主题 | 每个主题是否匹配 |
| `validate` | 每行分别按过滤器与发布主题校验 | 两个布尔值与错误原因 |

## 规则

- 主题层级以 `/` 分隔，空层级合法（`a//b`）。
- `+` 必须独占一层；`#` 必须独占最后一层。
- 共享订阅：`$share/{group}/{filter}`，group 不能为空、不能含 `/`、`+`、`#`，filter 不能为空。
- `$` 开头的系统主题不会被首层 `#` 或 `+` 匹配；需显式写 `$SYS/#`。
- 发布主题不能包含 `+` / `#`。
- `#` 是通配符，**不是**注释，因此本工具没有注释语法。
- 单个主题上限 65,535 字节；输入上限 10,000 行。

## 数据结构

```ts
{
  mode: 'parse' | 'match' | 'validate'
  rows: Array<{
    input, levels?, wildcards?, shared?, system?,
    matched?, validFilter?, validTopic?, errors?
  }>
  warnings: string[]
}
```

## 错误码

`emptyTopic`、`emptyFilter`、`invalidWildcard`、`invalidShared`、`publishWildcard`、`tooLong`。

`validate` 模式不中断：非法项写入行的 `errors`，仍返回结果表。

## 已知限制

- 不连接 broker，不查询实际订阅或保留消息。
- 不校验 ACL、Topic Alias 或 MQTT 5.0 属性。
- 共享订阅只做 `$share/` 语法校验，不做服务端行为模拟。
