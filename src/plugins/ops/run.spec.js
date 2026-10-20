import { describe, expect, it } from 'vitest'
import { run } from './run'

describe('ops run', () => {
  it('空查询返回全部命令', () => {
    const result = run('', {}, { locale: 'zh' })
    expect(result.ok).toBe(true)
    expect(result.data.total).toBeGreaterThan(20)
    expect(result.output).toContain('systemctl status')
  })

  it('按关键词过滤命令', () => {
    const result = run('docker', {}, { locale: 'zh' })
    expect(result.ok).toBe(true)
    expect(result.data.total).toBeGreaterThan(0)
    expect(result.data.domains.every((domain) => domain.commands.length > 0)).toBe(true)
  })

  it('按域过滤', () => {
    const result = run('', { domain: 'systemd' }, { locale: 'zh' })
    expect(result.data.domains).toHaveLength(1)
    expect(result.data.domains[0].id).toBe('systemd')
  })

  it('无匹配时返回空列表', () => {
    const result = run('definitely-not-a-command-xyz', {}, { locale: 'zh' })
    expect(result.ok).toBe(true)
    expect(result.data.total).toBe(0)
    expect(result.output).toBe('')
  })
})
