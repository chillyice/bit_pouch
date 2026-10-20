import { describe, expect, it } from 'vitest'
import { parsePageRange, formatBytes } from './core'
import { run } from './run'

describe('parsePageRange', () => {
  it('留空返回全部页码', () => {
    expect(parsePageRange('', 3)).toEqual([1, 2, 3])
  })

  it('支持区间、单页与开放式区间', () => {
    expect(parsePageRange('1-3,5', 6)).toEqual([1, 2, 3, 5])
    expect(parsePageRange('3-', 5)).toEqual([3, 4, 5])
  })

  it('重复与乱序会去重排序', () => {
    expect(parsePageRange('3,1,3', 3)).toEqual([1, 3])
  })

  it('越界与非法输入返回 null', () => {
    expect(parsePageRange('0', 3)).toBeNull()
    expect(parsePageRange('4', 3)).toBeNull()
    expect(parsePageRange('a', 3)).toBeNull()
    expect(parsePageRange('3-1', 3)).toBeNull()
  })
})

describe('formatBytes', () => {
  it('按量级输出单位', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB')
  })
})

describe('pdf run', () => {
  it('返回解析后的页码', () => {
    const result = run('2-3', { total: 5 }, { locale: 'zh' })
    expect(result.ok).toBe(true)
    expect(result.data.pages).toEqual([2, 3])
    expect(result.stats.pages).toBe(2)
  })

  it('没有总页数时报错', () => {
    const result = run('', {}, { locale: 'en' })
    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('noPages')
    expect(result.error.message).toBe('The PDF has no page count yet')
  })
})
