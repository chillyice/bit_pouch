# http-message — HTTP 报文

解析或生成 HTTP/1.x 明文请求/响应。只在本地处理，不发起网络请求；Cookie、Authorization 与正文不会写入 localStorage。

## 能力

- **解析**：起始行、头部、Cookie / Set-Cookie、查询参数、正文。
- **生成**：从 JSON 描述输出原始报文，支持 CRLF / LF 与 chunked。
- 正文识别：JSON、`x-www-form-urlencoded`、`multipart/form-data`、chunked、二进制十六进制预览。

## 选项

```ts
{
  mode: 'parse' | 'build'        // 默认 parse
  kind: 'auto' | 'request' | 'response'
  lineEnding: 'crlf' | 'lf'      // build，默认 crlf
  autoContentLength: boolean     // build，默认 true
}
```

## 解析规则

- 接受 `\r\n` 与 `\n`，混合换行给 `mixedLineEndings` 警告；允许开头有空行。
- 头部名称按 token 校验，重复头保留多条，`Set-Cookie` 不合并。
- obs-fold 续行拼接到上一条头，给 `obsoleteLineFolding` 警告；头部上限 500。
- chunked 按 UTF-8 字节解析块大小、扩展与 trailer；trailer 追加到 `headers`。
- 同时有 `Transfer-Encoding` 与 `Content-Length` 时以 chunked 为准并给 `conflictingLength`。
- `Content-Length` 按 UTF-8 重新编码后截取；不足返回 `truncatedBody`。
- `Content-Encoding: gzip / br / deflate` 不解压，标为 `binary` 并给十六进制预览。
- 正文 UTF-8 解码出现 `\uFFFD` 时标为 `binary`，给 `binaryBody`。

## 生成规则

```json
{
  "kind": "request",
  "method": "POST",
  "target": "/api/login?next=%2Fhome",
  "version": "HTTP/1.1",
  "headers": [["Host", "example.com"], ["Content-Type", "application/json"]],
  "body": "{\"name\":\"demo\"}",
  "chunked": false
}
```

- 头名称必须合法，头值不得含 CR/LF，否则 `invalidHeader`（防响应拆分）。
- `autoContentLength=true` 且未显式设置时自动补 `Content-Length`。
- `chunked=true` 时移除 `Content-Length`，补 `Transfer-Encoding: chunked`，输出单块与结束块。
- 请求必须有 `method` / `target`；响应必须有 3 位 `status`，可省略 `reason`（按常见状态码补默认值）。

## 数据结构

```ts
{
  kind: 'request' | 'response'
  request?: { method, target, version }
  response?: { version, status, reason }
  headers: Array<{ name, value, rawName }>
  cookies: Array<{ name, value, attributes }>
  query: Array<{ key, value }>
  body: {
    raw, bytes, encoding: 'utf8' | 'binary' | 'empty', contentType,
    json?, form?, multipart?, chunks?
  }
  warnings: string[]
}
```

解析模式的 `output` 是该结构的格式化 JSON；生成模式的 `output` 是原始报文。

## 错误码

`empty`、`tooLarge`、`invalidStartLine`、`unsupportedVersion`、`invalidHeader`、`tooManyHeaders`、`invalidContentLength`、`truncatedBody`、`invalidChunk`、`unsupportedTransferEncoding`、`invalidBuildInput`。

警告：`mixedLineEndings`、`obsoleteLineFolding`、`conflictingLength`、`lengthMissing`、`contentEncodingNotDecoded`、`invalidJsonBody`、`invalidMultipart`、`binaryBody`、`invalidPercentEncoding`。

## 已知限制

- 只处理 HTTP/1.0 / 1.1 明文；HTTP/2 前言与 HTTP/3 返回 `unsupportedVersion`。
- 输入是字符串，Content-Length 按 UTF-8 重新编码计算；二进制正文只能给十六进制预览，不承诺还原原始字节。
- 不解压 gzip / br / deflate，也不做 HTTP/2 HPACK。
- 输入上限 1,000,000 字符。
