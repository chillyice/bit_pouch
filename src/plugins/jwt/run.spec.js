import { describe, it, expect } from 'vitest'
import { base64UrlToBytes, run } from './run'

// 造不验签的 JWT（本工具只读载荷，签名段内容无关）。
const makeToken = (payload, header = { alg: 'HS256', typ: 'JWT' }) => {
  const seg = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${seg(header)}.${seg(payload)}.sig`
}
const nowSec = () => Math.floor(Date.now() / 1000)

describe('decodeJwtPayload (via run)', () => {
  it('解出载荷，中文按 UTF-8 还原', () => {
    const result = run(makeToken({ sub: '6', username: '高大尚', familyId: 2 }), {}, { locale: 'zh' })
    expect(result.ok).toBe(true)
    expect(result.data.payload.username).toBe('高大尚')
    expect(result.data.payload.familyId).toBe(2)
  })

  it('支持 Bearer 前缀与无签名两段令牌', () => {
    const token = makeToken({ sub: 'abc' })
    const withBearer = run(`Bearer ${token}`, {}, { locale: 'zh' })
    expect(withBearer.ok).toBe(true)
    expect(withBearer.data.algorithm).toBe('HS256')

    const twoParts = token.split('.').slice(0, 2).join('.')
    const unsigned = run(twoParts, {}, { locale: 'zh' })
    expect(unsigned.ok).toBe(true)
    expect(unsigned.data.signature.present).toBe(false)
  })

  it('非 JWT 结构、空值与坏 JSON 返回错误码', () => {
    expect(run('not-a-jwt', {}, { locale: 'zh' }).error.code).toBe('invalidJwt')
    expect(run('', {}, { locale: 'zh' }).error.code).toBe('empty')
    expect(run('   ', {}, { locale: 'zh' }).error.code).toBe('empty')
    expect(run('a.b.c.d', {}, { locale: 'zh' }).error.code).toBe('invalidJwt')
    expect(run('!!!.e30.sig', {}, { locale: 'zh' }).error.code).toBe('invalidHeader')
    expect(run('e30.!!!.sig', {}, { locale: 'zh' }).error.code).toBe('invalidPayload')
  })

  it('base64url 无填充解码', () => {
    expect(Array.from(base64UrlToBytes('SGk'))).toEqual([72, 105])
  })
})

describe('isTokenExpired (via run)', () => {
  it('已过期的令牌为 true', () => {
    const result = run(makeToken({ exp: nowSec() - 1 }), {}, { locale: 'zh' })
    expect(result.data.expired).toBe(true)
    expect(result.data.secondsLeft).toBeLessThanOrEqual(0)
  })

  it('有效期内为 false', () => {
    const result = run(makeToken({ exp: nowSec() + 3600 }), {}, { locale: 'zh' })
    expect(result.data.expired).toBe(false)
  })

  it('无 exp 时为 null', () => {
    const result = run(makeToken({ sub: '6' }), {}, { locale: 'zh' })
    expect(result.data.expired).toBe(null)
    expect(result.data.secondsLeft).toBe(null)
  })
})
