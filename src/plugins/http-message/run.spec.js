import { describe, expect, it } from 'vitest'
import { run } from './run'

const en = { locale: 'en' }
const zh = { locale: 'zh' }

function parse(input, options = {}) {
  return run(input, { mode: 'parse', ...options }, en)
}

function build(value, options = {}) {
  return run(JSON.stringify(value), { mode: 'build', ...options }, en)
}

function crlf(lines) {
  return lines.join('\r\n')
}

describe('http-message / 解析', () => {
  it('解析标准 GET 请求与查询参数', () => {
    const input = crlf(['GET /path?x=1&y=%E4%BD%A0 HTTP/1.1', 'Host: example.com', '', ''])
    const result = parse(input)
    expect(result.ok).toBe(true)
    expect(result.data.kind).toBe('request')
    expect(result.data.request).toEqual({ method: 'GET', target: '/path?x=1&y=%E4%BD%A0', version: 'HTTP/1.1' })
    expect(result.data.query).toEqual([
      { key: 'x', value: '1' },
      { key: 'y', value: '你' },
    ])
    expect(result.data.body.encoding).toBe('empty')
  })

  it('解析 POST JSON 正文', () => {
    const body = '{"name":"demo"}'
    const input = crlf([
      'POST /api HTTP/1.1',
      'Host: example.com',
      'Content-Type: application/json',
      `Content-Length: ${body.length}`,
      '',
      body,
    ])
    const result = parse(input)
    expect(result.ok).toBe(true)
    expect(result.data.body.json).toEqual({ name: 'demo' })
    expect(result.data.body.bytes).toBe(body.length)
    expect(result.data.body.encoding).toBe('utf8')
  })

  it('解析响应状态行与 JSON 正文', () => {
    const body = '{"ok":true}'
    const input = crlf(['HTTP/1.1 200 OK', 'Content-Type: application/json', `Content-Length: ${body.length}`, '', body])
    const result = parse(input)
    expect(result.ok).toBe(true)
    expect(result.data.kind).toBe('response')
    expect(result.data.response).toEqual({ version: 'HTTP/1.1', status: 200, reason: 'OK' })
    expect(result.data.body.json).toEqual({ ok: true })
  })

  it('保留多条 Set-Cookie 并解析属性', () => {
    const input = crlf([
      'HTTP/1.1 200 OK',
      'Set-Cookie: sid=abc; Path=/; HttpOnly; SameSite=Lax',
      'Set-Cookie: theme=dark; Max-Age=3600',
      'Content-Length: 0',
      '',
      '',
    ])
    const result = parse(input)
    expect(result.data.cookies).toEqual([
      { name: 'sid', value: 'abc', attributes: { path: '/', httponly: '', samesite: 'Lax' } },
      { name: 'theme', value: 'dark', attributes: { 'max-age': '3600' } },
    ])
  })

  it('解析 chunked、扩展与 trailer', () => {
    const input = crlf([
      'POST /upload HTTP/1.1',
      'Host: example.com',
      'Transfer-Encoding: chunked',
      '',
      '4;ext=1',
      'Wiki',
      '5',
      'pedia',
      '0',
      'X-Trailer: yes',
      '',
      '',
    ])
    const result = parse(input)
    expect(result.ok).toBe(true)
    expect(result.data.body.raw).toBe('Wikipedia')
    expect(result.data.body.bytes).toBe(9)
    expect(result.data.body.chunks).toEqual([
      { size: 4, bytes: 4 },
      { size: 5, bytes: 5 },
    ])
    expect(result.data.headers.some((header) => header.name === 'x-trailer')).toBe(true)
  })

  it('Content-Length 大于实际正文返回 truncatedBody', () => {
    const input = crlf(['POST / HTTP/1.1', 'Content-Length: 10', '', 'abc'])
    const result = parse(input)
    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('truncatedBody')
  })

  it('Transfer-Encoding 与 Content-Length 并存时警告并以 chunked 为准', () => {
    const input = crlf([
      'POST / HTTP/1.1',
      'Transfer-Encoding: chunked',
      'Content-Length: 99',
      '',
      '3',
      'abc',
      '0',
      '',
      '',
    ])
    const result = parse(input)
    expect(result.ok).toBe(true)
    expect(result.data.body.raw).toBe('abc')
    expect(result.data.warnings.some((warning) => warning.startsWith('conflictingLength'))).toBe(true)
  })

  it('头部折行拼接并给出警告', () => {
    const input = crlf(['GET / HTTP/1.1', 'X-Long: one', ' two', '', ''])
    const result = parse(input)
    expect(result.data.headers[0].value).toBe('one two')
    expect(result.data.warnings.some((warning) => warning.startsWith('obsoleteLineFolding'))).toBe(true)
  })

  it('非法起始行、非法头名与 HTTP/2 前言', () => {
    expect(parse('HELLO').error.code).toBe('invalidStartLine')
    expect(parse(crlf(['GET / HTTP/1.1', 'Bad Header: x', '', ''])).error.code).toBe('invalidHeader')
    expect(parse('PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n').error.code).toBe('unsupportedVersion')
    expect(parse(crlf(['HTTP/2 200 OK', '', ''])).error.code).toBe('unsupportedVersion')
  })

  it('解析表单正文', () => {
    const body = 'user=demo&pass=a%20b'
    const input = crlf([
      'POST /login HTTP/1.1',
      'Content-Type: application/x-www-form-urlencoded',
      `Content-Length: ${body.length}`,
      '',
      body,
    ])
    const result = parse(input)
    expect(result.ok).toBe(true)
    expect(result.data.body.form).toEqual([
      { key: 'user', value: 'demo' },
      { key: 'pass', value: 'a b' },
    ])
  })

  it('解析 multipart 两个字段与一个文件', () => {
    const boundary = '----X'
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="field1"',
      '',
      'value1',
      `--${boundary}`,
      'Content-Disposition: form-data; name="field2"',
      '',
      'value2',
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="a.txt"',
      'Content-Type: text/plain',
      '',
      'hello',
      `--${boundary}--`,
      '',
    ].join('\r\n')
    const input = crlf([
      'POST /upload HTTP/1.1',
      `Content-Type: multipart/form-data; boundary=${boundary}`,
      '',
      body,
    ])
    const result = parse(input)
    expect(result.ok).toBe(true)
    expect(result.data.body.multipart).toEqual([
      { name: 'field1', filename: undefined, contentType: undefined, bytes: 6, preview: 'value1' },
      { name: 'field2', filename: undefined, contentType: undefined, bytes: 6, preview: 'value2' },
      { name: 'file', filename: 'a.txt', contentType: 'text/plain', bytes: 5, preview: 'hello' },
    ])
  })

  it('二进制正文标记为 binary 并给十六进制预览', () => {
    const input = crlf(['POST /bin HTTP/1.1', 'Content-Encoding: gzip', '', 'not-really-gzip'])
    const result = parse(input)
    expect(result.ok).toBe(true)
    expect(result.data.body.encoding).toBe('binary')
    expect(result.data.body.raw).toMatch(/^[0-9a-f ]+$/)
    expect(result.data.warnings.some((warning) => warning.startsWith('contentEncodingNotDecoded'))).toBe(true)

    const replacement = crlf(['POST /bin HTTP/1.1', 'Content-Length: 4', '', '\uFFFD\u0000ab'])
    const second = parse(replacement)
    expect(second.data.body.encoding).toBe('binary')
    expect(second.data.warnings.some((warning) => warning.startsWith('binaryBody'))).toBe(true)
  })

  it('LF 换行可解析，混合换行给出警告', () => {
    const result = parse('GET / HTTP/1.1\nHost: x\n\n')
    expect(result.ok).toBe(true)

    const mixed = parse('GET / HTTP/1.1\r\nHost: x\n\n')
    expect(mixed.data.warnings.some((warning) => warning.startsWith('mixedLineEndings'))).toBe(true)
  })

  it('空输入与超长输入', () => {
    expect(parse('   ').error.code).toBe('empty')
    expect(parse('G'.repeat(1_000_001)).error.code).toBe('tooLarge')
  })

  it('头部超过 500 条', () => {
    const headers = Array.from({ length: 501 }, (_, index) => `X-H${index}: v`)
    const result = parse(crlf(['GET / HTTP/1.1', ...headers, '', '']))
    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('tooManyHeaders')
  })

  it('错误文案按 locale 本地化', () => {
    const result = run('', {}, zh)
    expect(result.error.message).toBe('内容为空')
  })
})

describe('http-message / 生成', () => {
  it('生成请求并自动补 Content-Length，可再解析', () => {
    const value = {
      kind: 'request',
      method: 'POST',
      target: '/api/login?next=%2Fhome',
      headers: [
        ['Host', 'example.com'],
        ['Content-Type', 'application/json'],
      ],
      body: '{"name":"demo"}',
    }
    const result = build(value)
    expect(result.ok).toBe(true)
    expect(result.output).toContain('Content-Length: 15')
    expect(result.output).toContain('\r\n\r\n{"name":"demo"}')

    const back = parse(result.output)
    expect(back.ok).toBe(true)
    expect(back.data.request.method).toBe('POST')
    expect(back.data.request.target).toBe('/api/login?next=%2Fhome')
    expect(back.data.body.json).toEqual({ name: 'demo' })
    expect(back.data.headers.map((header) => header.name)).toContain('host')
  })

  it('生成响应并使用默认 reason', () => {
    const result = build({ kind: 'response', status: 201, headers: [['Content-Type', 'text/plain']], body: 'ok' })
    expect(result.ok).toBe(true)
    expect(result.output.startsWith('HTTP/1.1 201 Created\r\n')).toBe(true)
    expect(result.output).toContain('Content-Length: 2')

    const back = parse(result.output)
    expect(back.data.response.status).toBe(201)
    expect(back.data.response.reason).toBe('Created')
  })

  it('chunked 生成去掉 Content-Length 并输出结束块', () => {
    const result = build({
      kind: 'request',
      method: 'POST',
      target: '/',
      headers: [['Content-Length', '999']],
      body: 'hello',
      chunked: true,
    })
    expect(result.ok).toBe(true)
    expect(result.output).not.toContain('Content-Length')
    expect(result.output).toContain('\r\n\r\n5\r\nhello\r\n0\r\n\r\n')

    const back = parse(result.output)
    expect(back.data.body.raw).toBe('hello')
    expect(back.data.body.chunks).toEqual([{ size: 5, bytes: 5 }])
  })

  it('LF 换行选项生效', () => {
    const result = build({ kind: 'request', method: 'GET', target: '/' }, { lineEnding: 'lf' })
    expect(result.output).toContain('\n\n')
    expect(result.output).not.toContain('\r\n')
  })

  it('头值含 CRLF 被拒绝，防止响应拆分', () => {
    const result = build({
      kind: 'request',
      method: 'GET',
      target: '/',
      headers: [['X-Test', 'a\r\nInjected: 1']],
    })
    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('invalidHeader')
  })

  it('缺少 method / status 时返回 invalidBuildInput', () => {
    expect(build({ kind: 'request', target: '/' }).error.code).toBe('invalidBuildInput')
    expect(build({ kind: 'response', status: 99 }).error.code).toBe('invalidBuildInput')
    expect(run('not json', { mode: 'build' }, en).error.code).toBe('invalidBuildInput')
  })
})
