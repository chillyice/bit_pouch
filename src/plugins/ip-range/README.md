# ip-range — IP 段计算

CIDR 合并、CIDR 与起止地址互转、包含判断与排除。纯本地计算，IPv4 与 IPv6 都支持，但同一次计算不能混用。

## 模式

| 模式 | 输入 | 输出 |
|------|------|------|
| `merge` | 每行一个 CIDR / 地址 / `start-end` | 合并后的最小 CIDR 集 |
| `range` | 每行 CIDR 或 `start-end` | CIDR → 起止地址；起止 → 最小 CIDR 集 |
| `contains` | 第一行基准 CIDR / 范围，后续每行地址 | 每个地址是否落在基准内 |
| `exclude` | 第一行基准 CIDR / 范围，后续每行要排除的子段 | 剩余最小 CIDR 集 |

## 规则

- 空行与 `#` 注释行忽略；输入上限 10,000 行。
- IPv4 用 32 位、IPv6 用 128 位 BigInt 运算。
- 输出按地址升序；范围内相邻、可合并的段必须合并。
- CIDR 的主机位会被归一到网络地址（例如 `10.0.0.5/24` 视为 `10.0.0.0/24`）。
- IPv6 输出使用 RFC 5952 风格：小写、最长零段压缩为 `::`。
- 排除段超出基准范围时忽略；排除全部时输出为空。

## 数据结构

```ts
{
  mode: 'merge' | 'range' | 'contains' | 'exclude'
  family: 'ipv4' | 'ipv6'
  base?: { start, end, cidrs }
  rows: Array<{ input, start?, end?, cidrs?, contained? }>
  warnings: string[]
}
```

## 错误码

`empty`、`invalidAddress`、`invalidPrefix`、`invalidRange`、`mixedFamily`、`tooMany`。

## 已知限制

- 不支持 IPv4/IPv6 混合计算，返回 `mixedFamily`。
- 不支持 ASN、地理位置或外部数据查询。
- IPv6 zone id（`%eth0`）会被忽略。
