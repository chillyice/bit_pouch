import { describe, expect, it } from 'vitest'
import { run } from './run'

const en = { locale: 'en' }
const zh = { locale: 'zh' }

function calc(input, mode = 'parse') {
  return run(input, { mode }, en)
}

describe('mqtt-topic / 解析', () => {
  it('解析层级与通配符位置', () => {
    const result = calc('sensors/+/temperature\nsensors/#\n$SYS/broker/uptime\n$share/workers/sensors/+/temperature')
    expect(result.ok).toBe(true)
    expect(result.data.rows[0].levels).toEqual(['sensors', '+', 'temperature'])
    expect(result.data.rows[0].wildcards).toEqual([{ level: 1, kind: '+' }])
    expect(result.data.rows[1].wildcards).toEqual([{ level: 1, kind: '#' }])
    expect(result.data.rows[2].system).toBe(true)
    expect(result.data.rows[3].shared).toEqual({ group: 'workers', filter: 'sensors/+/temperature' })
    expect(result.data.rows[3].wildcards).toEqual([{ level: 1, kind: '+' }])
  })

  it('空层级合法', () => {
    const result = calc('a//b')
    expect(result.ok).toBe(true)
    expect(result.data.rows[0].levels).toEqual(['a', '', 'b'])
  })
})

describe('mqtt-topic / 匹配', () => {
  it('+ 匹配单层，不匹配父层', () => {
    const result = calc('sport/+/player1\nsport/tennis/player1\nsport/tennis/player2\nsport', 'match')
    expect(result.ok).toBe(true)
    expect(result.data.rows).toEqual([
      { input: 'sport/tennis/player1', matched: true },
      { input: 'sport/tennis/player2', matched: false },
      { input: 'sport', matched: false },
    ])
  })

  it('# 匹配剩余层级并包含父层', () => {
    const result = calc('sport/#\nsport\nsport/tennis/player1', 'match')
    expect(result.data.rows.map((row) => row.matched)).toEqual([true, true])
  })

  it('+ 匹配空层级', () => {
    const result = calc('a/+/b\na//b', 'match')
    expect(result.data.rows[0].matched).toBe(true)
  })

  it('$ 系统主题不被首层通配符匹配', () => {
    const plain = calc('#\n$SYS/broker/uptime', 'match')
    expect(plain.data.rows[0].matched).toBe(false)

    const explicit = calc('$SYS/#\n$SYS/broker/uptime', 'match')
    expect(explicit.data.rows[0].matched).toBe(true)

    const plus = calc('+/broker/uptime\n$SYS/broker/uptime', 'match')
    expect(plus.data.rows[0].matched).toBe(false)
  })

  it('共享订阅按内部过滤器匹配', () => {
    const result = calc('$share/workers/sensors/+/temperature\nsensors/room1/temperature', 'match')
    expect(result.data.rows[0].matched).toBe(true)
  })

  it('匹配模式的主题不能含通配符', () => {
    const result = calc('sensors/#\nsensors/+/temperature', 'match')
    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('publishWildcard')
    expect(result.error.line).toBe(2)
  })
})

describe('mqtt-topic / 校验', () => {
  it('同时报告过滤器与发布主题是否合法', () => {
    const result = calc('sensors/room1\nsensors/+/temperature\nbad/level+\n$share//sensors/#', 'validate')
    expect(result.ok).toBe(true)
    expect(result.data.rows[0]).toMatchObject({ validFilter: true, validTopic: true })
    expect(result.data.rows[1]).toMatchObject({ validFilter: true, validTopic: false })
    expect(result.data.rows[2]).toMatchObject({ validFilter: false, validTopic: false })
    expect(result.data.rows[3]).toMatchObject({ validFilter: false, validTopic: false })
    expect(result.output.split('\n')[1]).toBe('sensors/+/temperature: filter=true topic=false')
  })
})

describe('mqtt-topic / 错误与边界', () => {
  it('非法通配符', () => {
    expect(calc('sport/tennis#').error.code).toBe('invalidWildcard')
    expect(calc('sport/#/ranking').error.code).toBe('invalidWildcard')
    expect(calc('sport/ten+nis').error.code).toBe('invalidWildcard')
  })

  it('非法共享订阅', () => {
    expect(calc('$share//sensors/#').error.code).toBe('invalidShared')
    expect(calc('$share/workers').error.code).toBe('invalidShared')
    expect(calc('$share/wo+rkers/sensors/#').error.code).toBe('invalidShared')
  })

  it('空输入与超长主题', () => {
    expect(calc('   ').ok).toBe(false)
    expect(run('a'.repeat(65_536), { mode: 'parse' }, en).error.code).toBe('tooLong')
  })

  it('匹配模式没有目标地址时返回空结果', () => {
    const result = calc('sensors/#', 'match')
    expect(result.ok).toBe(true)
    expect(result.data.rows).toEqual([])
  })

  it('错误文案按 locale 本地化', () => {
    const result = run('sport/#/x', { mode: 'parse' }, zh)
    expect(result.error.message).toContain('+ 必须独占一层')
  })
})
