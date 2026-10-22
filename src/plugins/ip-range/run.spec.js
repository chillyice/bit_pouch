import { describe, expect, it } from 'vitest'
import { run } from './run'

const en = { locale: 'en' }
const zh = { locale: 'zh' }

function calc(input, mode = 'merge') {
  return run(input, { mode }, en)
}

describe('ip-range / 合并', () => {
  it('相邻 IPv4 段合并', () => {
    const result = calc('10.0.0.0/25\n10.0.0.128/25')
    expect(result.ok).toBe(true)
    expect(result.output).toBe('10.0.0.0/24')
    expect(result.data.family).toBe('ipv4')
  })

  it('包含关系与相邻单地址合并', () => {
    expect(calc('10.0.0.0/24\n10.0.0.128/25').output).toBe('10.0.0.0/24')
    expect(calc('192.168.1.0-192.168.1.3\n192.168.1.4/32').output).toBe('192.168.1.0/30\n192.168.1.4/32')
  })

  it('/0 吸收全部 IPv4 段', () => {
    expect(calc('0.0.0.0/0\n10.1.2.3/32').output).toBe('0.0.0.0/0')
  })

  it('/32 保持单地址', () => {
    expect(calc('192.168.1.1').output).toBe('192.168.1.1/32')
  })

  it('IPv6 /64 合并与规范压缩', () => {
    const result = calc('2001:db8::/65\n2001:db8:0:0:8000::/65')
    expect(result.ok).toBe(true)
    expect(result.data.family).toBe('ipv6')
    expect(result.output).toBe('2001:db8::/64')

    expect(calc('2001:db8::1').output).toBe('2001:db8::1/128')
  })

  it('注释与空行被忽略', () => {
    const result = calc('# comment\n\n10.0.0.0/24\n  # another\n')
    expect(result.output).toBe('10.0.0.0/24')
  })
})

describe('ip-range / 范围互转', () => {
  it('CIDR → 起止地址', () => {
    const result = calc('192.168.1.0/24', 'range')
    expect(result.ok).toBe(true)
    expect(result.data.rows[0]).toMatchObject({ start: '192.168.1.0', end: '192.168.1.255' })
    expect(result.output).toBe('192.168.1.0 - 192.168.1.255')
  })

  it('起止地址 → CIDR 集', () => {
    const result = calc('192.168.1.0-192.168.1.255', 'range')
    expect(result.data.rows[0].cidrs).toEqual(['192.168.1.0/24'])
    expect(result.output).toBe('192.168.1.0/24')
  })

  it('非对齐区间拆成最小 CIDR 集', () => {
    const result = calc('10.0.0.1-10.0.0.6', 'range')
    expect(result.data.rows[0].cidrs).toEqual(['10.0.0.1/32', '10.0.0.2/31', '10.0.0.4/31', '10.0.0.6/32'])
  })

  it('IPv6 范围互转', () => {
    const cidr = calc('2001:db8::/126', 'range')
    expect(cidr.data.rows[0]).toMatchObject({ start: '2001:db8::', end: '2001:db8::3' })

    const range = calc('2001:db8::1-2001:db8::2', 'range')
    expect(range.data.rows[0].cidrs).toEqual(['2001:db8::1/128', '2001:db8::2/128'])
  })
})

describe('ip-range / 包含与排除', () => {
  it('判断地址是否落在 CIDR 内', () => {
    const result = calc('10.0.0.0/24\n10.0.0.1\n10.0.0.255\n10.0.1.1', 'contains')
    expect(result.ok).toBe(true)
    expect(result.data.rows).toEqual([
      { input: '10.0.0.1', contained: true },
      { input: '10.0.0.255', contained: true },
      { input: '10.0.1.1', contained: false },
    ])
    expect(result.output).toBe('10.0.0.1: true\n10.0.0.255: true\n10.0.1.1: false')
  })

  it('从大段中排除两个子段', () => {
    const result = calc('10.0.0.0/24\n10.0.0.64/26\n10.0.0.128/26', 'exclude')
    expect(result.ok).toBe(true)
    expect(result.output).toBe('10.0.0.0/26\n10.0.0.192/26')
  })

  it('排除全部时结果为空', () => {
    const result = calc('10.0.0.0/24\n10.0.0.0/24', 'exclude')
    expect(result.ok).toBe(true)
    expect(result.output).toBe('')
  })

  it('排除范围外的子段被忽略', () => {
    const result = calc('10.0.0.0/24\n192.168.0.0/24', 'exclude')
    expect(result.output).toBe('10.0.0.0/24')
  })

  it('IPv6 包含判断', () => {
    const result = calc('2001:db8::/64\n2001:db8::1\n2001:db8:0:1::1', 'contains')
    expect(result.data.rows.map((row) => row.contained)).toEqual([true, false])
  })
})

describe('ip-range / 错误与边界', () => {
  it('混合 IPv4 与 IPv6', () => {
    const result = calc('10.0.0.0/24\n2001:db8::/64')
    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('mixedFamily')
    expect(result.error.line).toBe(2)
  })

  it('非法地址与前缀', () => {
    expect(calc('300.1.1.1').error.code).toBe('invalidAddress')
    expect(calc('10.0.0.0/33').error.code).toBe('invalidPrefix')
    expect(calc('2001:db8::/129').error.code).toBe('invalidPrefix')
    expect(calc('10.0.0.5-10.0.0.1').error.code).toBe('invalidRange')
    expect(calc('gggg::1').error.code).toBe('invalidAddress')
  })

  it('空输入与超过 10,000 行', () => {
    expect(calc('  \n# only comments').error.code).toBe('empty')
    expect(calc(Array.from({ length: 10_001 }, () => '10.0.0.1').join('\n')).error.code).toBe('tooMany')
  })

  it('错误文案按 locale 本地化', () => {
    const result = run('', {}, zh)
    expect(result.error.message).toBe('没有有效输入')
  })
})
