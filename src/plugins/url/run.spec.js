import { describe, it, expect } from 'vitest'
import { parseQuery, run } from './run'

describe('parseQuery', () => {
  it('保留顺序、重复键与原始值', () => {
    expect(parseQuery('?a=1&a=2&b=%E4%BD%A0%E5%A5%BD')).toEqual([
      { key: 'a', value: '1', rawKey: 'a', rawValue: '1' },
      { key: 'a', value: '2', rawKey: 'a', rawValue: '2' },
      { key: 'b', value: '你好', rawKey: 'b', rawValue: '%E4%BD%A0%E5%A5%BD' },
    ])
  })

  it('加号按空格解码，空值与无值参数保留', () => {
    expect(parseQuery('?q=a+b&empty=&flag')).toEqual([
      { key: 'q', value: 'a b', rawKey: 'q', rawValue: 'a+b' },
      { key: 'empty', value: '', rawKey: 'empty', rawValue: '' },
      { key: 'flag', value: '', rawKey: 'flag', rawValue: '' },
    ])
  })

  it('不完整的百分号编码回退原文', () => {
    expect(parseQuery('?bad=%E4%BD')[0].value).toBe('%E4%BD')
  })

  it('空查询返回空数组', () => {
    expect(parseQuery('')).toEqual([])
    expect(parseQuery('?')).toEqual([])
  })
})

describe('url run', () => {
  it('拆解完整 URL', () => {
    const result = run('https://user:pass@example.com:8080/p/ath?a=1&b=2#top', {}, { locale: 'zh' })
    expect(result.ok).toBe(true)
    expect(result.data.protocol).toBe('https:')
    expect(result.data.username).toBe('user')
    expect(result.data.password).toBe('pass')
    expect(result.data.host).toBe('example.com:8080')
    expect(result.data.hostname).toBe('example.com')
    expect(result.data.port).toBe('8080')
    expect(result.data.pathname).toBe('/p/ath')
    expect(result.data.hash).toBe('#top')
    expect(result.data.origin).toBe('https://example.com:8080')
    expect(result.data.params.map((p) => p.value)).toEqual(['1', '2'])
  })

  it('无查询参数时返回空数组', () => {
    const result = run('https://example.com/', {}, { locale: 'zh' })
    expect(result.data.params).toEqual([])
    expect(result.data.search).toBe('')
  })

  it('空、过长与相对 URL 返回错误码', () => {
    expect(run('', {}, { locale: 'zh' }).error.code).toBe('empty')
    expect(run('example.com/a', {}, { locale: 'zh' }).error.code).toBe('invalidUrl')
    expect(run('https://example.com/' + 'a'.repeat(100_001), {}, { locale: 'zh' }).error.code).toBe('tooLong')
  })
})
