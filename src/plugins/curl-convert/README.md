# curl-convert — cURL 转换

把 cURL 命令转换成 fetch / axios / Python / Go / PowerShell 代码。只做词法解析，不执行命令、不展开变量、不发起网络请求。

## 能力

- 解析常见 cURL 选项：方法、头、正文、表单、查询、Basic 认证、Cookie、UA/Referer、压缩、TLS、重定向、代理/证书（提示不支持）。
- 支持单引号、双引号转义、ANSI-C `$'...'` 与反斜杠续行。
- 五个目标都输出可直接复制的代码；文件字段给出明确的占位或 `open()` / `os.Open()`。

## 选项

```ts
{ target: 'fetch' | 'axios' | 'python' | 'go' | 'powershell' }  // 默认 fetch
```

## 解析规则

- 第一个 token 必须是 `curl` / `curl.exe`。
- URL 取第一个非选项 token 或 `--url`；多个 URL 只取第一个并给 `multipleUrls` 警告。
- `-d` 多个值按 `&` 拼接；`--data-urlencode name=value` 只编码 value；`-G` 把数据拼到查询串。
- `-F name=value` 普通字段，`name=@path` 文件字段，`name=<path` 文件内容字段。
- 有 `-d` / `-F` 且无 `-X` 时默认 POST；`-G` 默认 GET。
- 短选项簇支持 `-sS`、`-kL`、`-XPOST`、`-H'...'`。
- 未知选项不猜测是否带值：记 `unsupportedOption` 警告后继续；如果最终找不到 URL，返回 `invalidUrl` 并提示可能是未知选项导致。
- `$VAR` / `${VAR}` 不展开，保留字面量并给 `unexpandedVariable` 警告。

## 生成要点

| 目标 | 认证 | `-k` | 表单 |
|------|------|------|------|
| fetch | `Authorization: Basic ...` 头 | 浏览器无法关闭校验，输出注释 + 警告 | `FormData` |
| axios | `auth: { username, password }` | 注释说明 `httpsAgent` | `form-data` |
| python | `auth=(user, pass)` | `verify=False` | `data` + `files` |
| go | `req.SetBasicAuth` | `tls.Config{InsecureSkipVerify: true}` | `mime/multipart` |
| powershell | Basic 头 | `-SkipCertificateCheck`（PS 7+） | `-Form` |

- 头值中的引号、反斜杠与换行按目标语言转义；Go / PowerShell 输出可读骨架。
- fetch 不能保证发送所有受限头；生成代码保持原样，由使用者决定。
- 不提供“执行”按钮，也没有任何网络调用。

## 数据结构

```ts
{
  request: {
    method, url,
    headers: Array<[string, string]>,
    body?, form?, auth?, cookies?,
    insecure, followRedirects, compressed
  },
  warnings: string[]
}
```

## 错误码

`empty`、`notCurl`、`unterminatedQuote`、`missingValue`、`invalidUrl`、`invalidHeader`、`tooLong`。

警告：`unexpandedVariable`、`multipleUrls`、`unsupportedScheme`、`unsupportedOption`、`cookieFileUnsupported`、`ignoredOption`、`ignoredBody`。

## 已知限制

- 只做 cURL → 代码；反向转换不在本版。
- 不执行 shell 展开：变量、命令替换、进程替换都不解析。
- `-d @file`、Cookie 文件、客户端证书等不读取文件，只给出提示。
- 输入上限 100,000 字符。
