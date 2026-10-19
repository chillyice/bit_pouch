import { describe, it, expect } from 'vitest'
import { MAX_MATCHES, normalizeFlags, run } from './run'

describe('normalizeFlags', () => {
  it('保留合法标志并去重', () => {
    expect(normalizeFlags('gi')).toBe('gi')
    expect(normalizeFlags('ggim')).toBe('gim')
    expect(normalizeFlags('')).toBe('')
  })

  it('非法标志返回 null', () => {
    expect(normalizeFlags('gz')).toBe(null)
    expect(normalizeFlags('G')).toBe(null)
  })
})

describe('regex run', () => {
  it('收集全部匹配与位置', () => {
    const result = run('abc 123 ABC', { pattern: '\\d+', flags: 'g' }, { locale: 'zh' })
    expect(result.ok).toBe(true)
    expect(result.data.count).toBe(1)
    expect(result.data.matches[0]).toMatchObject({ index: 4, value: '123' })
  })

  it('未写 g 时也按全部匹配处理', () => {
    const result = run('a1 b2', { pattern: '[a-z]\\d', flags: '' }, { locale: 'zh' })
    expect(result.data.flags).toBe('g')
    expect(result.data.count).toBe(2)
  })

  it('捕获组、命名组与 i 标志', () => {
    const result = run('Name: Alice', { pattern: '(?<key>\\w+):\\s+(\\w+)', flags: '' }, { locale: 'zh' })
    expect(result.data.matches[0].groups).toEqual(['Name', 'Alice'])
    expect(result.data.matches[0].named).toEqual({ key: 'Name' })

    const insensitive = run('ABC', { pattern: 'abc', flags: 'i' }, { locale: 'zh' })
    expect(insensitive.data.count).toBe(1)
  })

  it('零宽匹配不会死循环', () => {
    const result = run('aaa', { pattern: '(?=a)', flags: 'g' }, { locale: 'zh' })
    expect(result.data.matches.map((m) => m.index)).toEqual([0, 1, 2])
  })

  it('替换预览', () => {
    const result = run('abc 123', { pattern: '(\\w+)', flags: 'g', replacement: '[$1]' }, { locale: 'zh' })
    expect(result.data.replaced).toBe('[abc] [123]')
    expect(result.output).toBe('[abc] [123]')
  })

  it('超过上限时截断', () => {
    const result = run('a'.repeat(MAX_MATCHES + 10), { pattern: 'a', flags: 'g' }, { locale: 'zh' })
    expect(result.data.count).toBe(MAX_MATCHES)
    expect(result.data.truncated).toBe(true)
  })

  it('空模式、非法模式、非法标志返回错误码', () => {
    expect(run('abc', { pattern: '' }, { locale: 'zh' }).error.code).toBe('emptyPattern')
    expect(run('abc', { pattern: '(', flags: 'g' }, { locale: 'zh' }).error.code).toBe('invalidPattern')
    expect(run('abc', { pattern: 'a', flags: 'z' }, { locale: 'zh' }).error.code).toBe('invalidFlags')
  })
})
