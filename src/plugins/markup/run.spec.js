import { describe, expect, it } from 'vitest'
import {
  formatMarkup,
  MARKUP_MAX_INPUT,
  markupErrorMessage,
  run,
  tokenizeMarkup,
} from './run'

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

describe('压缩', () => {
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

describe('模式推断与边界', () => {
  it('XML 声明 / SVG 根元素推断为 XML', () => {
    expect(formatMarkup('<?xml version="1.0"?><root/>').ok && formatMarkup('<?xml version="1.0"?><root/>')).toMatchObject({ mode: 'xml' })
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

  it('run 返回本地化错误与统计数据', () => {
    const bad = run('<a>', { mode: 'xml' }, { locale: 'zh' })
    expect(bad.ok).toBe(false)
    expect(bad.error?.message).toBe('标签未闭合: a')

    const good = run('<root><a/></root>', { mode: 'xml', indent: '  ' }, { locale: 'zh' })
    expect(good.ok).toBe(true)
    expect(good.stats).toMatchObject({ tags: 2, lines: 3 })
    expect(good.data).toMatchObject({ mode: 'xml', tags: 2 })
  })
})

describe('语法着色', () => {
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
