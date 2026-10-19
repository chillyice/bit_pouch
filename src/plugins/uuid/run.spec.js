import { describe, it, expect } from 'vitest'
import { parseUuid, run, uuidV4 } from './run'

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('uuidV4', () => {
  it('生成 RFC 4122 v4 格式', () => {
    for (let i = 0; i < 50; i += 1) expect(uuidV4()).toMatch(UUID_V4_RE)
  })
})

describe('parseUuid', () => {
  it('解析版本与变体', () => {
    expect(parseUuid('550e8400-e29b-41d4-a716-446655440000')).toEqual({
      version: 4,
      variant: 'RFC 4122',
      normalized: '550e8400-e29b-41d4-a716-446655440000',
    })
    expect(parseUuid('00000000-0000-1000-8000-000000000000').version).toBe(1)
  })

  it('非法 UUID 返回 null', () => {
    expect(parseUuid('not-a-uuid')).toBe(null)
    expect(parseUuid('550e8400e29b41d4a716446655440000')).toBe(null)
    expect(parseUuid('550e8400-e29b-41d4-a716-44665544000g')).toBe(null)
  })
})

describe('uuid run', () => {
  it('空输入批量生成', () => {
    const result = run('', { count: 5 }, { locale: 'zh' })
    expect(result.ok).toBe(true)
    expect(result.data.uuids).toHaveLength(5)
    for (const uuid of result.data.uuids) expect(uuid).toMatch(UUID_V4_RE)
    expect(result.data.mode).toBe('generate')
  })

  it('大写与去连字符选项', () => {
    const result = run('', { count: 2, uppercase: true, hyphens: false }, { locale: 'zh' })
    for (const uuid of result.data.uuids) {
      expect(uuid).toMatch(/^[0-9A-F]{32}$/)
    }
  })

  it('输入非空时进入解析模式', () => {
    const result = run('550E8400-E29B-41D4-A716-446655440000', {}, { locale: 'zh' })
    expect(result.data.mode).toBe('parse')
    expect(result.data.parsed.version).toBe(4)
    expect(result.data.parsed.variant).toBe('RFC 4122')
    expect(result.output).toBe('550e8400-e29b-41d4-a716-446655440000')
  })

  it('非法数量与非法 UUID 返回错误码', () => {
    expect(run('', { count: 0 }, { locale: 'zh' }).error.code).toBe('invalidCount')
    expect(run('', { count: 101 }, { locale: 'zh' }).error.code).toBe('invalidCount')
    expect(run('', { count: 1.5 }, { locale: 'zh' }).error.code).toBe('invalidCount')
    expect(run('bad', {}, { locale: 'zh' }).error.code).toBe('invalidUuid')
  })
})
