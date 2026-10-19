import { describe, it, expect } from 'vitest'
import { parseTimestamp, run } from './run'

describe('parseTimestamp', () => {
  it('自动区分秒与毫秒', () => {
    expect(parseTimestamp('1700000000', 'auto')).toEqual({ ms: 1700000000000, numeric: true, unit: 's' })
    expect(parseTimestamp('1700000000000', 'auto')).toEqual({ ms: 1700000000000, numeric: true, unit: 'ms' })
  })

  it('指定单位时不再猜测', () => {
    expect(parseTimestamp('1700000000', 'ms')?.ms).toBe(1700000000)
    expect(parseTimestamp('1700000000000', 's')?.ms).toBe(1700000000000000)
  })

  it('支持小数秒与负时间戳', () => {
    expect(parseTimestamp('1700000000.5', 's')?.ms).toBe(1700000000500)
    expect(parseTimestamp('-1', 's')?.ms).toBe(-1000)
  })

  it('解析 ISO 日期', () => {
    expect(parseTimestamp('2023-11-14T22:13:20Z', 'auto')).toEqual({
      ms: 1700000000000,
      numeric: false,
      unit: 'date',
    })
  })

  it('非法输入返回 null', () => {
    expect(parseTimestamp('', 'auto')).toBe(null)
    expect(parseTimestamp('not-a-date', 'auto')).toBe(null)
  })
})

describe('timestamp run', () => {
  it('秒时间戳输出 ISO 与毫秒', () => {
    const result = run('1700000000', {}, { locale: 'zh' })
    expect(result.ok).toBe(true)
    expect(result.output).toBe('2023-11-14T22:13:20.000Z')
    expect(result.data.milliseconds).toBe(1700000000000)
    expect(result.data.seconds).toBe(1700000000)
    expect(result.data.unit).toBe('s')
  })

  it('毫秒时间戳与 ISO 输入得到同一时刻', () => {
    const ms = run('1700000000000', {}, { locale: 'zh' })
    const iso = run('2023-11-14T22:13:20Z', {}, { locale: 'zh' })
    expect(ms.data.milliseconds).toBe(iso.data.milliseconds)
    expect(iso.data.numeric).toBe(false)
  })

  it('unit 选项生效', () => {
    expect(run('1700000000', { unit: 'ms' }, { locale: 'zh' }).data.milliseconds).toBe(1700000000)
  })

  it('空、非法与越界输入返回错误码', () => {
    expect(run('   ', {}, { locale: 'zh' }).error.code).toBe('empty')
    expect(run('hello', {}, { locale: 'zh' }).error.code).toBe('invalidInput')
    expect(run('99999999999999999999', { unit: 'ms' }, { locale: 'zh' }).error.code).toBe('outOfRange')
  })
})
