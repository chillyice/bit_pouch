import { describe, expect, it } from 'vitest'
import { run } from './run'

const en = { locale: 'en' }
const zh = { locale: 'zh' }

function convert(command, target = 'fetch') {
  return run(command, { target }, en)
}

describe('curl-convert / 解析', () => {
  it('简单 GET', () => {
    const result = convert("curl 'https://example.com/api?a=1'")
    expect(result.ok).toBe(true)
    expect(result.data.request.method).toBe('GET')
    expect(result.data.request.url).toBe('https://example.com/api?a=1')
  })

  it('短选项簇与 -XPOST', () => {
    const result = convert("curl -sS -XPOST https://example.com -d '{\"a\":1}'")
    expect(result.ok).toBe(true)
    expect(result.data.request.method).toBe('POST')
    expect(result.data.request.body).toBe('{"a":1}')
  })

  it('多个头与重复头', () => {
    const result = convert("curl https://example.com -H 'X-One: 1' -H 'X-Two: 2' -H 'X-One: 3'")
    expect(result.data.request.headers).toEqual([
      ['X-One', '1'],
      ['X-Two', '2'],
      ['X-One', '3'],
    ])
    expect(result.output).toContain('"X-One"')
  })

  it('-u 生成 Basic 认证', () => {
    const result = convert("curl https://example.com -u 'demo:secret'")
    expect(result.data.request.auth).toEqual({ user: 'demo', password: 'secret' })
    expect(result.output).toContain('Authorization')
    expect(result.output).toContain('ZGVtbzpzZWNyZXQ=')
  })

  it('-F 普通字段与文件字段', () => {
    const result = convert("curl https://example.com -F 'name=demo' -F 'file=@./avatar.png'")
    expect(result.data.request.form).toEqual([
      { name: 'name', value: 'demo', contentType: undefined },
      { name: 'file', file: './avatar.png', contentType: undefined },
    ])
    const python = convert("curl https://example.com -F 'name=demo' -F 'file=@./avatar.png'", 'python')
    expect(python.output).toContain('open("./avatar.png", "rb")')
  })

  it('--data-urlencode 与 -G 把数据拼到查询串', () => {
    const result = convert("curl -G 'https://example.com/api' --data-urlencode 'q=hello world' -d 'page=2'")
    expect(result.data.request.method).toBe('GET')
    expect(result.data.request.url).toBe('https://example.com/api?q=hello%20world&page=2')
    expect(result.data.request.body).toBeUndefined()
  })

  it('双引号转义、单引号字面量与 ANSI-C 引号', () => {
    const doubled = convert('curl https://example.com -H "X-Test: a\\"b"')
    expect(doubled.data.request.headers[0]).toEqual(['X-Test', 'a"b'])

    const single = convert("curl https://example.com -d 'a $HOME \\n'")
    expect(single.data.request.body).toBe('a $HOME \\n')
    expect(single.data.warnings.some((warning) => warning.startsWith('unexpandedVariable'))).toBe(true)

    const ansi = convert("curl https://example.com --data $'line1\\nline2'")
    expect(ansi.data.request.body).toBe('line1\nline2')
  })

  it('反斜杠续行合并', () => {
    const command = "curl https://example.com \\\n  -H 'A: b'"
    const result = convert(command)
    expect(result.ok).toBe(true)
    expect(result.data.request.headers).toEqual([['A', 'b']])
  })

  it('短选项 -kL 组合', () => {
    const result = convert('curl -kL https://example.com')
    expect(result.data.request.insecure).toBe(true)
    expect(result.data.request.followRedirects).toBe(true)
  })

  it('未知选项给出可见警告但仍生成', () => {
    const result = convert('curl --foo https://example.com')
    expect(result.ok).toBe(true)
    expect(result.data.warnings.some((warning) => warning.startsWith('unsupportedOption'))).toBe(true)
  })

  it('代理/证书选项给出警告并消费参数', () => {
    const result = convert('curl --proxy http://127.0.0.1:8080 https://example.com')
    expect(result.ok).toBe(true)
    expect(result.data.request.url).toBe('https://example.com')
    expect(result.data.warnings.some((warning) => warning.includes('--proxy'))).toBe(true)
  })

  it('多个 URL 只取第一个并警告', () => {
    const result = convert('curl https://a.example https://b.example')
    expect(result.data.request.url).toBe('https://a.example')
    expect(result.data.warnings.some((warning) => warning.startsWith('multipleUrls'))).toBe(true)
  })

  it('-b Cookie 字符串与文件形式', () => {
    const stringCookie = convert("curl https://example.com -b 'sid=abc; theme=dark'")
    expect(stringCookie.data.request.headers).toContainEqual(['Cookie', 'sid=abc; theme=dark'])

    const fileCookie = convert('curl https://example.com -b cookies.txt')
    expect(fileCookie.data.warnings.some((warning) => warning.startsWith('cookieFileUnsupported'))).toBe(true)
  })

  it('同时有 -d 与 -F 时以表单为准并警告', () => {
    const result = convert("curl https://example.com -d 'a=1' -F 'b=2'")
    expect(result.data.request.form).toHaveLength(1)
    expect(result.data.warnings.some((warning) => warning.startsWith('ignoredBody'))).toBe(true)
  })

  it('非 curl、未闭合引号、缺值、无 URL', () => {
    expect(convert('wget https://example.com').error.code).toBe('notCurl')
    expect(convert("curl 'https://example.com").error.code).toBe('unterminatedQuote')
    expect(convert('curl https://example.com -H').error.code).toBe('missingValue')
    expect(convert('curl -s').error.code).toBe('invalidUrl')
  })

  it('空输入、超长输入与本地化错误', () => {
    expect(convert('   ').error.code).toBe('empty')
    expect(convert(`curl ${'a'.repeat(100_001)}`).error.code).toBe('tooLong')
    expect(run('', {}, zh).error.message).toBe('内容为空')
  })

  it('非法头缺少冒号', () => {
    expect(convert("curl https://example.com -H 'NoColon'").error.code).toBe('invalidHeader')
  })
})

describe('curl-convert / 代码生成', () => {
  const command =
    "curl -X POST 'https://api.example.com/v1/login?next=%2Fhome' -H 'Content-Type: application/json' -H 'Accept: application/json' -u 'demo:secret' -d '{\"name\":\"demo\"}'"

  it('五个目标都包含方法、URL、头与正文', () => {
    for (const target of ['fetch', 'axios', 'python', 'go', 'powershell']) {
      const result = convert(command, target)
      expect(result.ok).toBe(true)
      expect(result.output).toContain('https://api.example.com/v1/login?next=%2Fhome')
      expect(result.output.toLowerCase()).toContain('post')
      expect(result.output).toContain('Content-Type')
      expect(result.output).toContain('name')
    }
  })

  it('fetch 使用 headers 对象并转义引号', () => {
    const result = convert('curl https://example.com -H \'X-Test: a"b\'')
    expect(result.output).toContain('headers:')
    expect(result.output).toContain('a\\"b')
    expect(result.output).toContain("redirect: 'manual'")
  })

  it('axios 使用 auth 对象而不是 Authorization 头', () => {
    const result = convert("curl https://example.com -u 'demo:secret'", 'axios')
    expect(result.output).toContain('auth: { username: "demo", password: "secret" }')
    expect(result.output).not.toContain('Authorization')
  })

  it('python 使用 requests 与 verify=False', () => {
    const result = convert("curl -k https://example.com -u 'demo:secret'", 'python')
    expect(result.output).toContain('import requests')
    expect(result.output).toContain('verify=False')
    expect(result.output).toContain('auth=("demo", "secret")')
  })

  it('go 输出可编译骨架并按需引入标准库', () => {
    const body = convert("curl -X POST https://example.com -d 'hello'", 'go')
    expect(body.output).toContain('package main')
    expect(body.output).toContain('"strings"')
    expect(body.output).toContain('http.NewRequest("POST"')

    const insecure = convert('curl -k https://example.com', 'go')
    expect(insecure.output).toContain('"crypto/tls"')
    expect(insecure.output).toContain('InsecureSkipVerify: true')

    const form = convert("curl https://example.com -F 'a=b' -F 'file=@./x.bin'", 'go')
    expect(form.output).toContain('"mime/multipart"')
    expect(form.output).toContain('os.Open("./x.bin")')
    expect(form.output).toContain('CreateFormFile("file", "./x.bin")')
    expect(form.output).not.toContain('textproto')
  })

  it('powershell 使用 Invoke-WebRequest 与单引号转义', () => {
    const result = convert("curl -X POST https://example.com -d 'it''s'", 'powershell')
    expect(result.output).toContain('Invoke-WebRequest')
    expect(result.output).toContain("-Method 'POST'")
  })

  it('File 表单与 chunked 无关的正文保持原样', () => {
    const result = convert("curl https://example.com -F 'name=demo' -F 'file=@./a.png'")
    expect(result.output).toContain('FormData')
    expect(result.output).toContain('form.append("file", file, "./a.png")')
  })
})
