import { describe, it, expect } from 'vitest'
import { bytesToBase64, bytesToHex, md5, run } from './run'

const hex = (bytes) => bytesToHex(bytes)

describe('md5', () => {
  it('匹配 RFC 1321 测试向量', () => {
    const encode = (text) => hex(md5(new TextEncoder().encode(text)))
    expect(encode('')).toBe('d41d8cd98f00b204e9800998ecf8427e')
    expect(encode('a')).toBe('0cc175b9c0f1b6a831c399e269772661')
    expect(encode('abc')).toBe('900150983cd24fb0d6963f7d28e17f72')
    expect(encode('message digest')).toBe('f96b697d7cb7938d525a2f31aaf161d0')
    expect(encode('12345678901234567890123456789012345678901234567890123456789012345678901234567890')).toBe(
      '57edf4a22be3c955ac49da2e2107b67a',
    )
  })
})

describe('helpers', () => {
  it('hex 与 base64 编码', () => {
    expect(hex(new Uint8Array([0, 15, 255]))).toBe('000fff')
    expect(bytesToBase64(new TextEncoder().encode('abc'))).toBe('YWJj')
    expect(bytesToBase64(new TextEncoder().encode('ab'))).toBe('YWI=')
  })
})

describe('hash run', () => {
  it('SHA-256 / SHA-1 已知向量', async () => {
    const sha256 = await run('abc', { algorithm: 'sha256' }, { locale: 'zh' })
    expect(sha256.ok).toBe(true)
    expect(sha256.output).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')

    const sha1 = await run('abc', { algorithm: 'sha1' }, { locale: 'zh' })
    expect(sha1.output).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
  })

  it('空输入也有稳定摘要', async () => {
    const result = await run('', { algorithm: 'sha256' }, { locale: 'zh' })
    expect(result.output).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('base64 输出与 MD5', async () => {
    const result = await run('abc', { algorithm: 'md5', format: 'base64' }, { locale: 'zh' })
    expect(result.data.hex).toBe('900150983cd24fb0d6963f7d28e17f72')
    expect(result.output).toBe('kAFQmDzST7DWlj99KOF/cg==')
  })

  it('非法算法返回错误码', async () => {
    const result = await run('abc', { algorithm: 'sha3' }, { locale: 'zh' })
    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('invalidAlgorithm')
  })
})
