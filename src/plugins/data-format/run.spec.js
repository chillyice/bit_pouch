import { describe, expect, it } from 'vitest'
import { detectDataFormat, run } from './run'

const en = { locale: 'en' }
const zh = { locale: 'zh' }

function toJson(input, options = {}) {
  return run(input, { mode: 'toJson', format: 'auto', ...options }, en)
}

function fromJson(value, target, options = {}) {
  return run(JSON.stringify(value), { mode: 'fromJson', target, ...options }, en)
}

describe('data-format / JSON 与 YAML', () => {
  it('JSON → YAML → JSON 往返保持数据', async () => {
    const source = { name: 'bit_pouch', port: 8080, list: [1, 2], nested: { ok: true } }
    const yaml = await fromJson(source, 'yaml')
    expect(yaml.ok).toBe(true)
    expect(yaml.output).toContain('name: bit_pouch')

    const back = await run(yaml.output, { mode: 'toJson', format: 'yaml' }, en)
    expect(back.ok).toBe(true)
    expect(JSON.parse(back.output)).toEqual(source)
    expect(back.data.sourceFormat).toBe('yaml')
    expect(back.data.keyCount).toBe(4)
  })

  it('展开 YAML 锚点与别名', async () => {
    const input = 'base: &base\n  a: 1\n  b: two\ncopy: *base\n'
    const result = await toJson(input, { format: 'yaml' })
    expect(result.ok).toBe(true)
    expect(JSON.parse(result.output)).toEqual({ base: { a: 1, b: 'two' }, copy: { a: 1, b: 'two' } })
  })

  it('多文档 YAML 返回 multiDocument', async () => {
    const result = await toJson('---\na: 1\n---\nb: 2\n', { format: 'yaml' })
    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('multiDocument')
  })

  it('YAML 日期保持字符串', async () => {
    const result = await toJson('date: 2024-01-02\n', { format: 'yaml' })
    expect(JSON.parse(result.output).date).toBe('2024-01-02')
  })

  it('YAML 注释给出 commentsDropped 警告', async () => {
    const result = await toJson('# note\nkey: 1 # inline\n', { format: 'yaml' })
    expect(result.ok).toBe(true)
    expect(result.data.warnings.some((w) => w.startsWith('commentsDropped'))).toBe(true)
  })
})

describe('data-format / TOML', () => {
  it('解析标量、数组、数组表并把日期归一化为 ISO', async () => {
    const input = [
      'title = "demo"',
      'nums = [1, 2]',
      'when = 1979-05-27T07:32:00Z',
      '[[items]]',
      'name = "a"',
      '[[items]]',
      'name = "b"',
    ].join('\n')
    const result = await toJson(input, { format: 'toml' })
    expect(result.ok).toBe(true)
    const value = JSON.parse(result.output)
    expect(value.nums).toEqual([1, 2])
    expect(value.when).toBe('1979-05-27T07:32:00.000Z')
    expect(value.items).toEqual([{ name: 'a' }, { name: 'b' }])
  })

  it('TOML 语法错误带行列', async () => {
    const result = await toJson('a = 1\nb = \n', { format: 'toml' })
    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('syntaxError')
    expect(result.error.line).toBe(2)
  })

  it('nan / inf 转为字符串并警告', async () => {
    const result = await toJson('a = nan\nb = inf\n', { format: 'toml' })
    expect(result.ok).toBe(true)
    const value = JSON.parse(result.output)
    expect(value.a).toBe('nan')
    expect(value.b).toBe('inf')
    expect(result.data.warnings.some((w) => w.startsWith('nonFiniteNumber'))).toBe(true)
  })

  it('JSON → TOML 拒绝 null', async () => {
    const result = await fromJson({ a: null }, 'toml')
    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('unsupportedValue')
  })
})

describe('data-format / INI', () => {
  const ini = '; comment\nname=app\n[server]\nhost=127.0.0.1\nport=8080\nport=9090\n'

  it('解析节、注释与重复键，后者覆盖前者', async () => {
    const result = await toJson(ini, { format: 'ini' })
    expect(result.ok).toBe(true)
    expect(JSON.parse(result.output)).toEqual({ name: 'app', 'server.host': '127.0.0.1', 'server.port': '9090' })
    expect(result.data.warnings.some((w) => w.startsWith('duplicateKey'))).toBe(true)
    expect(result.data.warnings.some((w) => w.startsWith('commentsDropped'))).toBe(true)
  })

  it('flatten=true 递归展开为点号键', async () => {
    const result = await fromJson({ global: 1, server: { host: 'x', tls: { enabled: true } } }, 'ini')
    expect(result.ok).toBe(true)
    expect(result.output).toContain('global=1')
    expect(result.output).toContain('server.host=x')
    expect(result.output).toContain('server.tls.enabled=true')
  })

  it('flatten=false 顶层为节，第二层必须是标量', async () => {
    const result = await fromJson({ global: 1, server: { host: 'x', port: 8080 } }, 'ini', { flatten: false })
    expect(result.ok).toBe(true)
    expect(result.output).toContain('[server]')
    expect(result.output).toContain('host=x')

    const bad = await fromJson({ server: { tls: { enabled: true } } }, 'ini', { flatten: false })
    expect(bad.ok).toBe(false)
    expect(bad.error.code).toBe('nestedNotSupported')
  })

  it('数组在 INI 中返回 nestedNotSupported', async () => {
    const result = await fromJson({ list: [1, 2] }, 'ini')
    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('nestedNotSupported')
  })
})

describe('data-format / Properties 与 env', () => {
  it('Properties 支持 \\uXXXX 与续行', async () => {
    const input = 'greeting=hello \\\n    world\nuni=\\u4f60\\u597d\n'
    const result = await toJson(input, { format: 'properties' })
    expect(result.ok).toBe(true)
    expect(JSON.parse(result.output)).toEqual({ greeting: 'hello world', uni: '你好' })
  })

  it('JSON → Properties 转义后可往返', async () => {
    const source = { 'app.name': 'bit=pouch', 'app.path': 'C:\\tmp', 'app.note': 'a:b # c' }
    const result = await fromJson(source, 'properties')
    expect(result.ok).toBe(true)

    const back = await toJson(result.output, { format: 'properties' })
    expect(back.ok).toBe(true)
    expect(JSON.parse(back.output)).toEqual(source)
  })

  it('env 支持 export、引号与注释', async () => {
    const input = [
      '# comment',
      'export APP_NAME=bit_pouch',
      'GREETING="hello world"',
      "SINGLE='raw $value'",
      'PORT=8080 # inline',
    ].join('\n')
    const result = await toJson(input, { format: 'env' })
    expect(result.ok).toBe(true)
    expect(JSON.parse(result.output)).toEqual({
      APP_NAME: 'bit_pouch',
      GREETING: 'hello world',
      SINGLE: 'raw $value',
      PORT: '8080',
    })
  })

  it('env 键名非法与嵌套对象报错', async () => {
    expect((await fromJson({ 'bad-key': 'x' }, 'env')).error.code).toBe('invalidKey')
    expect((await fromJson({ APP: { NESTED: 1 } }, 'env')).error.code).toBe('nestedNotSupported')
    expect((await fromJson({ ARRAY: [1, 2] }, 'env')).error.code).toBe('nestedNotSupported')
  })

  it('env 序列化含空格的值时加引号', async () => {
    const result = await fromJson({ GREETING: 'hello world', EMPTY: '' }, 'env')
    expect(result.ok).toBe(true)
    expect(result.output).toContain('GREETING="hello world"')
    expect(result.output).toContain('EMPTY=')
  })
})

describe('data-format / 安全与边界', () => {
  it('拒绝 __proto__ 且不污染原型', async () => {
    const result = await toJson('{"__proto__":{"polluted":true}}', { format: 'json' })
    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('unsafeKey')
    expect({}.polluted).toBeUndefined()

    const nested = await fromJson({ a: JSON.parse('{"constructor":{"x":1}}') }, 'yaml')
    expect(nested.ok).toBe(false)
    expect(nested.error.code).toBe('unsafeKey')
  })

  it('自动识别六种格式', () => {
    expect(detectDataFormat('{"a":1}')).toBe('json')
    expect(detectDataFormat('a: 1\nb: two\n')).toBe('yaml')
    expect(detectDataFormat('[server]\nport = 8080\nname = "demo"\n')).toBe('toml')
    expect(detectDataFormat('; x\n[server]\nport=8080\n')).toBe('ini')
    expect(detectDataFormat('APP_NAME=bit_pouch\nPORT=8080\n')).toBe('env')
    expect(detectDataFormat('app.name=bit_pouch\napp.port=8080\n')).toBe('properties')
  })

  it('无法识别时返回 unsupportedFormat', async () => {
    const result = await toJson('just some words', { format: 'auto' })
    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('unsupportedFormat')
  })

  it('空输入、超长输入与超深嵌套', async () => {
    expect((await run('   ', {}, en)).error.code).toBe('empty')
    expect((await run('a: 1'.padEnd(1_000_001, ' '), {}, en)).error.code).toBe('tooLarge')
    const deep = `${'{"a":'.repeat(120)}1${'}'.repeat(120)}`
    expect((await toJson(deep, { format: 'json' })).error.code).toBe('tooDeep')
  })

  it('sortKeys 对 JSON 输出稳定生效', async () => {
    const input = JSON.stringify({ b: 1, a: { z: 2, y: 3 } })
    const first = await run(input, { mode: 'fromJson', target: 'json', sortKeys: true }, en)
    const second = await run(input, { mode: 'fromJson', target: 'json', sortKeys: true }, en)
    expect(first.output.indexOf('"a"')).toBeLessThan(first.output.indexOf('"b"'))
    expect(first.output.indexOf('"y"')).toBeLessThan(first.output.indexOf('"z"'))
    expect(first.output).toBe(second.output)
  })

  it('大整数给出精度警告', async () => {
    const result = await toJson('{"id":12345678901234567890}', { format: 'json' })
    expect(result.ok).toBe(true)
    expect(result.data.warnings.some((w) => w.startsWith('precisionLoss'))).toBe(true)
  })

  it('错误文案按 locale 本地化', async () => {
    const result = await run('', {}, zh)
    expect(result.error.message).toBe('内容为空')
  })
})
