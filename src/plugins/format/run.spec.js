import { describe, it, expect } from 'vitest'
import {
  JSON_MAX_DEPTH,
  MARKUP_MAX_INPUT,
  detectFormat,
  formatJson,
  formatMarkup,
  formatSql,
  jsonErrorMessage,
  markupErrorMessage,
  run,
  tokenizeJson,
  tokenizeMarkup,
  tokenizeSqlHighlight,
} from './run'
import { buildFormatTree, findDeepestNode } from './tree'

const ok = (text, options) => {
  const r = formatJson(text, options)
  expect(r.ok).toBe(true)
  return r.text
}
const fail = (text, options) => {
  const r = formatJson(text, options)
  expect(r.ok).toBe(false)
  return r.error
}

describe('JSON 格式化', () => {
  it('按 2 空格缩进,对象与数组换行', () => {
    expect(ok('{"a":1,"b":[1,2]}')).toBe('{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}')
  })

  it('空对象/空数组保持单行', () => {
    expect(ok('{"a":{},"b":[]}')).toBe('{\n  "a": {},\n  "b": []\n}')
  })

  it('indent 传空串即压缩为单行', () => {
    expect(ok('{\n "a": 1,\n "b": [1, 2]\n}', { indent: '' })).toBe('{"a":1,"b":[1,2]}')
  })

  it('保留长整数、指数与小数原始字面量', () => {
    const text = '{"id":12345678901234567890,"n":1.0,"e":1E+3,"z":-0.5}'
    expect(ok(text, { indent: '' })).toBe(text)
  })

  it('保留字符串转义与重复键', () => {
    const text = '{"s":"a\\u00e9\\n\\"b\\"","k":1,"k":2}'
    expect(ok(text, { indent: '' })).toBe(text)
  })

  it('sortKeys 递归按键名排序,不用 locale 规则', () => {
    const text = '{"b":{"z":1,"a":2},"A":1,"a":2,"10":3,"9":4}'
    expect(ok(text, { indent: '', sortKeys: true })).toBe('{"10":3,"9":4,"A":1,"a":2,"b":{"a":2,"z":1}}')
  })

  it('返回输出统计', () => {
    const r = formatJson('{"a":1}')
    expect(r.stats).toEqual({ lines: 3, chars: 12, bytes: 12 })
  })

  it('空内容返回 empty', () => {
    expect(fail('').code).toBe('empty')
    expect(fail('   \n ').code).toBe('empty')
  })

  it('指出意外字符的行列', () => {
    const err = fail('{\n  "a": @\n}')
    expect(err).toMatchObject({ code: 'unexpectedChar', line: 2, column: 8, char: '@' })
  })

  it('识别缺冒号、缺逗号与多余逗号', () => {
    expect(fail('{"a" 1}')).toMatchObject({ code: 'expectedColon', line: 1, column: 6 })
    expect(fail('{"a":1 "b":2}')).toMatchObject({ code: 'expectedComma', line: 1, column: 8 })
    expect(fail('{"a":1,}')).toMatchObject({ code: 'trailingComma', line: 1, column: 8 })
    expect(fail('[1, ]')).toMatchObject({ code: 'trailingComma', line: 1, column: 5 })
  })

  it('识别引号、转义与数字格式问题', () => {
    expect(fail('{"a":"abc}').code).toBe('unterminatedString')
    expect(fail('{"a":"\\q"}')).toMatchObject({ code: 'invalidEscape', line: 1, column: 8 })
    expect(fail('{"a":01}')).toMatchObject({ code: 'expectedComma', line: 1, column: 7 })
    expect(fail('{"a":-}').code).toBe('invalidNumber')
  })

  it('结束符后有多余内容会被拒绝', () => {
    expect(fail('{"a":1}\n{}')).toMatchObject({ code: 'trailingContent', line: 2, column: 1 })
  })

  it('嵌套超过上限返回 tooDeep', () => {
    const deep = '['.repeat(JSON_MAX_DEPTH + 1) + ']'.repeat(JSON_MAX_DEPTH + 1)
    expect(fail(deep).code).toBe('tooDeep')
    const atLimit = '['.repeat(JSON_MAX_DEPTH) + ']'.repeat(JSON_MAX_DEPTH)
    expect(formatJson(atLimit).ok).toBe(true)
  })

  it('错误文案中英双语', () => {
    expect(jsonErrorMessage('unexpectedChar', 'zh')).toBe('意外的字符')
    expect(jsonErrorMessage('unexpectedChar', 'en')).toBe('Unexpected character')
    expect(jsonErrorMessage('unknown', 'en')).toBe('Failed to parse JSON')
  })
})

describe('JSON 语法着色', () => {
  it('区分键名、字符串、数字、布尔、null 与标点', () => {
    const tokens = tokenizeJson('{\n  "a": "x",\n  "b": [1, true, null]\n}')
    expect(tokens.map((t) => t.type)).toContain('key')
    expect(tokens.filter((t) => t.type === 'key')).toHaveLength(2)
    expect(tokens.find((t) => t.type === 'string')?.text).toBe('"x"')
    expect(tokens.find((t) => t.type === 'number')?.text).toBe('1')
    expect(tokens.find((t) => t.type === 'boolean')?.text).toBe('true')
    expect(tokens.find((t) => t.type === 'null')?.text).toBe('null')
  })

  it('拼回原文不丢字符', () => {
    const text = '{\n  "a": "x",\n  "b": [1, true, null]\n}'
    expect(
      tokenizeJson(text)
        .map((t) => t.text)
        .join(''),
    ).toBe(text)
  })
})

describe('XML 格式化', () => {
  it('按层级展开，自闭合标签补空格', () => {
    const result = formatMarkup('<root><item id="1">a</item><item id="2"/></root>', { mode: 'xml' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.text).toBe(`<root>
  <item id="1">a</item>
  <item id="2" />
</root>`)
    expect(result.mode).toBe('xml')
    expect(result.stats.tags).toBe(3)
  })

  it('保留注释、CDATA、DOCTYPE 与处理指令', () => {
    const input = '<?xml version="1.0"?><!DOCTYPE note [<!ENTITY x "y">]><note><!-- c --><![CDATA[a < b]]><to>Tove</to></note>'
    const result = formatMarkup(input, { mode: 'xml', indent: '    ' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.text).toBe(`<?xml version="1.0"?>
<!DOCTYPE note [<!ENTITY x "y">]>
<note>
    <!-- c -->
    <![CDATA[a < b]]>
    <to>Tove</to>
</note>`)
  })

  it('混合文本保持行内，不额外插入空白', () => {
    const result = formatMarkup('<p>Hello <b>world</b>!</p>', { mode: 'xml' })
    expect(result.ok && result.text).toBe('<p>Hello <b>world</b>!</p>')
  })

  it('标签不匹配时报错并给出行列', () => {
    const result = formatMarkup('<root>\n  <a>\n</root>', { mode: 'xml' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('mismatchedTag')
    expect(result.error.line).toBe(3)
    expect(result.error.detail).toBe('a')
  })

  it('未闭合标签报错', () => {
    const result = formatMarkup('<root><a></a>', { mode: 'xml' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('unclosedTag')
    expect(result.error.detail).toBe('root')
  })

  it('多余闭合标签报错', () => {
    const result = formatMarkup('</root>', { mode: 'xml' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('strayCloseTag')
  })
})

describe('HTML 格式化', () => {
  it('识别空元素并保持行内内容', () => {
    const input = '<!DOCTYPE html><html><body><h1>Hi</h1><p>Hello <b>world</b>!</p><br><img src="a>b.png" alt="x"></body></html>'
    const result = formatMarkup(input, { mode: 'html' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.text).toBe(`<!DOCTYPE html>
<html>
  <body>
    <h1>Hi</h1>
    <p>Hello <b>world</b>!</p>
    <br>
    <img src="a>b.png" alt="x">
  </body>
</html>`)
  })

  it('容错省略闭合标签（li / p / td）', () => {
    const input = '<ul><li>a<li>b</ul><p>x<div>y</div>'
    const result = formatMarkup(input, { mode: 'html' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.text).toBe(`<ul>
  <li>a</li>
  <li>b</li>
</ul>
<p>x</p>
<div>y</div>`)
  })

  it('script / style / pre 内容原样保留', () => {
    const input = '<script>if (a < b) { console.log("</div>") }</script>'
    const result = formatMarkup(input, { mode: 'html' })
    expect(result.ok && result.text).toBe(input)
  })

  it('空白文本按 HTML 规则折叠', () => {
    const result = formatMarkup('<p>\n  Hello   <b>world</b>\n</p>', { mode: 'html' })
    expect(result.ok && result.text).toBe('<p>Hello <b>world</b></p>')
  })

  it('缩进支持 4 空格与 Tab', () => {
    const four = formatMarkup('<div><p>a</p></div>', { mode: 'html', indent: '    ' })
    expect(four.ok && four.text).toBe('<div>\n    <p>a</p>\n</div>')
    const tab = formatMarkup('<div><p>a</p></div>', { mode: 'html', indent: '\t' })
    expect(tab.ok && tab.text).toBe('<div>\n\t<p>a</p>\n</div>')
  })
})

describe('标记压缩', () => {
  it('XML 去掉格式化空白，保留有效文本', () => {
    const result = formatMarkup('<root>\n  <a> 1 </a>\n  <b/>\n</root>', { mode: 'xml', minify: true })
    expect(result.ok && result.text).toBe('<root><a> 1 </a><b /></root>')
  })

  it('HTML 去掉标签间空白但保留行内空格', () => {
    const input = '<div>\n  <p><span>a</span> <span>b</span></p>\n</div>'
    const result = formatMarkup(input, { mode: 'html', minify: true })
    expect(result.ok && result.text).toBe('<div><p><span>a</span> <span>b</span></p></div>')
  })
})

describe('标记模式推断与边界', () => {
  it('XML 声明 / SVG 根元素推断为 XML', () => {
    expect(formatMarkup('<?xml version="1.0"?><root/>')).toMatchObject({ ok: true, mode: 'xml' })
    const svg = formatMarkup('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>')
    expect(svg.ok && svg.mode).toBe('xml')
  })

  it('HTML DOCTYPE 与常见标签推断为 HTML', () => {
    const html = formatMarkup('<!DOCTYPE html><div><br></div>')
    expect(html.ok && html.mode).toBe('html')
  })

  it('空输入与超限输入返回错误', () => {
    const empty = formatMarkup('   ')
    expect(empty.ok).toBe(false)
    expect(!empty.ok && empty.error.code).toBe('empty')

    const big = formatMarkup('a'.repeat(MARKUP_MAX_INPUT + 1))
    expect(big.ok).toBe(false)
    if (big.ok) return
    expect(big.error.code).toBe('tooLarge')
  })

  it('未结束的注释与标签返回错误码', () => {
    const comment = formatMarkup('<div><!-- x</div>', { mode: 'html' })
    expect(comment.ok).toBe(false)
    if (comment.ok) return
    expect(comment.error.code).toBe('unterminatedComment')

    const tag = formatMarkup('<div class="x"', { mode: 'html' })
    expect(tag.ok).toBe(false)
    if (tag.ok) return
    expect(tag.error.code).toBe('unterminatedTag')
  })

  it('错误文案中英双语', () => {
    expect(markupErrorMessage('unclosedTag', 'zh', 'root')).toBe('标签未闭合: root')
    expect(markupErrorMessage('unclosedTag', 'en', 'root')).toBe('Unclosed tag: root')
    expect(markupErrorMessage('unknown', 'en')).toBe('Failed to parse markup')
  })
})

describe('统一入口', () => {
  it('自动模式按开头识别 JSON / XML / HTML', () => {
    expect(detectFormat('{"a":1}')).toBe('json')
    expect(detectFormat('  [1, 2]')).toBe('json')
    expect(detectFormat('<?xml version="1.0"?><root/>')).toBe('xml')
    expect(detectFormat('<svg xmlns="http://www.w3.org/2000/svg"><path/></svg>')).toBe('xml')
    expect(detectFormat('<!DOCTYPE html><div></div>')).toBe('html')
  })

  it('auto 模式格式化 JSON 并返回 mode', () => {
    const result = run('{"b":1,"a":2}', { mode: 'auto', indent: '  ', sortKeys: true }, { locale: 'zh' })
    expect(result.ok).toBe(true)
    expect(result.output).toBe('{\n  "a": 2,\n  "b": 1\n}')
    expect(result.data).toEqual({ mode: 'json' })
  })

  it('auto 模式格式化标记并带出标签统计', () => {
    const result = run('<?xml version="1.0"?><root><a/></root>', { mode: 'auto', indent: '  ' }, { locale: 'zh' })
    expect(result.ok).toBe(true)
    expect(result.output).toBe('<?xml version="1.0"?>\n<root>\n  <a />\n</root>')
    expect(result.data).toMatchObject({ mode: 'xml', tags: 2 })
    expect(result.stats).toMatchObject({ tags: 2, lines: 4 })
  })

  it('显式模式覆盖自动识别', () => {
    const result = run('<root><a/></root>', { mode: 'xml' }, { locale: 'zh' })
    expect(result.ok).toBe(true)
    expect(result.data?.mode).toBe('xml')
  })

  it('压缩同时适用于 JSON 与标记', () => {
    const json = run('{\n  "a": [1, 2]\n}', { mode: 'json', minify: true }, { locale: 'zh' })
    expect(json.output).toBe('{"a":[1,2]}')
    const html = run('<div>\n  <p>a</p>\n</div>', { mode: 'html', minify: true }, { locale: 'zh' })
    expect(html.output).toBe('<div><p>a</p></div>')
  })

  it('空输入与错误文案本地化', () => {
    const empty = run('   ', { mode: 'auto' }, { locale: 'zh' })
    expect(empty).toMatchObject({ ok: false, error: { code: 'empty', message: '内容为空' } })
    expect(run('   ', { mode: 'auto' }, { locale: 'en' }).error?.message).toBe('Input is empty')

    const badJson = run('{"a":}', { mode: 'json' }, { locale: 'zh' })
    expect(badJson.error?.message).toBe('意外的字符')

    const badXml = run('<a>', { mode: 'xml' }, { locale: 'zh' })
    expect(badXml.error?.message).toBe('标签未闭合: a')
  })
})

describe('标记语法着色', () => {
  it('区分标签、属性、字符串与注释', () => {
    const tokens = tokenizeMarkup('<div class="x">hi</div><!-- c -->')
    const types = tokens.map((token) => token.type)
    expect(types).toContain('tag')
    expect(types).toContain('attr')
    expect(types).toContain('string')
    expect(types).toContain('comment')
    expect(tokens.map((token) => token.text).join('')).toBe('<div class="x">hi</div><!-- c -->')
  })
})

describe('SQL 格式化', () => {
  it('子句换行、关键字大写、运算符留空格', () => {
    const output = formatSql('select a,b from t where x=1 order by a desc')
    expect(output).toContain('SELECT a, b')
    expect(output).toContain('\nFROM t')
    expect(output).toContain('\nWHERE x = 1')
    expect(output).toContain('\nORDER BY a DESC')
  })

  it('多词 JOIN 保持同一行', () => {
    const output = formatSql('select * from a left join b on a.id=b.id')
    expect(output).toContain('\nLEFT JOIN b ON a.id = b.id')
  })

  it('保留字符串、引号标识符与注释', () => {
    const output = formatSql("select 'a,b' as x, `weird col` from t -- tail")
    expect(output).toContain("'a,b'")
    expect(output).toContain('`weird col`')
    expect(output).toContain('-- tail')
  })

  it('压缩为单行', () => {
    expect(formatSql('select *\nfrom t\nwhere a in (1, 2)', { minify: true })).toBe(
      'SELECT * FROM t WHERE a IN (1,2)',
    )
  })

  it('自动识别 SQL 并走统一入口', () => {
    expect(detectFormat('  select 1')).toBe('sql')
    const result = run('select * from t', { mode: 'auto' }, { locale: 'zh' })
    expect(result.ok).toBe(true)
    expect(result.data.mode).toBe('sql')
    expect(result.output).toContain('SELECT')
  })

  it('语法着色标出关键字与字符串', () => {
    const types = tokenizeSqlHighlight("select 'x' from t").map((token) => token.type)
    expect(types).toContain('keyword')
    expect(types).toContain('string')
  })
})

describe('树形视图', () => {
  it('JSON 树带输出与原文偏移量', () => {
    const input = '{"a":1,"b":{"c":[2,3]}}'
    const output = formatJson(input).text
    const nodes = buildFormatTree(input, output, 'json')
    expect(nodes).toHaveLength(1)
    expect(nodes[0].kind).toBe('object')
    const a = nodes[0].children.find((node) => node.name === 'a')
    expect(output.slice(a.start, a.end)).toBe('1')
    expect(input.slice(a.inputStart, a.inputEnd)).toBe('1')
    const c = nodes[0].children.find((node) => node.name === 'b').children[0]
    expect(c.kind).toBe('array')
    expect(findDeepestNode(nodes, c.children[1].start)?.name).toBe('1')
  })

  it('标记树保留层级', () => {
    const input = '<root><item>x</item><item/></root>'
    const output = formatMarkup(input, { mode: 'xml' }).text
    const nodes = buildFormatTree(input, output, 'xml')
    expect(nodes[0].name).toBe('root')
    expect(nodes[0].children).toHaveLength(2)
    expect(nodes[0].children[1].name).toBe('item')
  })
})
