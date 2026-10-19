// 子网掩码计算的纯逻辑：IPv4 解析/输出、掩码与前缀互转、网络地址/广播地址/可用主机范围、
// 地址类型判断与二进制对照。全部基于手写计算，不引第三方库。
import type { Locale, ToolResult, ToolRun } from '@/core/types'

export type SubnetErrorCode = 'ipInvalid' | 'maskMissing' | 'maskInvalid' | 'maskNonContiguous'

export class SubnetError extends Error {
  code: SubnetErrorCode

  constructor(code: SubnetErrorCode) {
    super(code)
    this.name = 'SubnetError'
    this.code = code
  }
}

const UINT32 = 0xffffffff

/** 32 位无符号整数 → 点分十进制 */
export const ipToString = (value: number): string =>
  [24, 16, 8, 0].map((shift) => (value >>> shift) & 0xff).join('.')

/** 点分十进制 → {value, text}；每段必须是 0–255 的十进制 */
export function parseIpv4(text: string): { value: number; text: string } {
  const raw = String(text).trim()
  const parts = raw.split('.')
  if (parts.length !== 4) throw new SubnetError('ipInvalid')
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) throw new SubnetError('ipInvalid')
    const n = Number(part)
    if (n > 255) throw new SubnetError('ipInvalid')
    value = value * 256 + n
  }
  const unsigned = value >>> 0
  return { value: unsigned, text: ipToString(unsigned) }
}

/** 前缀长度 → 子网掩码（32 位无符号）；0 位掩码为 0.0.0.0 */
export const prefixToMask = (prefix: number): number => (prefix === 0 ? 0 : (UINT32 << (32 - prefix)) >>> 0)

/** 子网掩码 → 前缀长度；非连续掩码（如 255.0.255.0）抛 maskNonContiguous */
export function maskToPrefix(mask: number): number {
  let prefix = 0
  while (prefix < 32 && ((mask >>> (31 - prefix)) & 1) === 1) prefix++
  if (prefixToMask(prefix) !== mask) throw new SubnetError('maskNonContiguous')
  return prefix
}

/** 掩码输入 → {prefix, mask}：接受 24、/24、255.255.255.0 三种写法 */
export function parseMask(text: string): { prefix: number; mask: number } {
  const raw = String(text).trim().replace(/^\//, '')
  if (!raw) throw new SubnetError('maskMissing')
  if (/^\d{1,2}$/.test(raw)) {
    const prefix = Number(raw)
    if (prefix > 32) throw new SubnetError('maskInvalid')
    return { prefix, mask: prefixToMask(prefix) }
  }
  let parsed: { value: number; text: string }
  try {
    parsed = parseIpv4(raw)
  } catch {
    throw new SubnetError('maskInvalid')
  }
  return { prefix: maskToPrefix(parsed.value), mask: parsed.value }
}

export type IpClass = 'PRIVATE' | 'SHARED' | 'LOOPBACK' | 'LINK_LOCAL' | 'MULTICAST' | 'RESERVED' | 'PUBLIC'

/** IPv4 地址类型：PRIVATE / SHARED / LOOPBACK / LINK_LOCAL / MULTICAST / RESERVED / PUBLIC */
export function classifyIp(value: number): IpClass {
  const first = value >>> 24
  const second = (value >>> 16) & 0xff
  if (first === 10) return 'PRIVATE'
  if (first === 172 && second >= 16 && second <= 31) return 'PRIVATE'
  if (first === 192 && second === 168) return 'PRIVATE'
  if (first === 100 && second >= 64 && second <= 127) return 'SHARED'
  if (first === 127) return 'LOOPBACK'
  if (first === 169 && second === 254) return 'LINK_LOCAL'
  if (first >= 224 && first <= 239) return 'MULTICAST'
  if (first === 0 || first >= 240) return 'RESERVED'
  return 'PUBLIC'
}

export interface SubnetInfo {
  ip: number
  prefix: number
  mask: number
  wildcard: number
  network: number
  broadcast: number
  first: number
  last: number
  total: number
  hosts: number
  type: IpClass
}

/**
 * 计算子网信息。hosts 与可用范围口径：
 * /0–/30 扣掉网络地址与广播地址；/31 两个地址都可用（点对点）；/32 单机地址本身可用。
 */
export function subnetInfo(ipValue: number, prefix: number): SubnetInfo {
  const mask = prefixToMask(prefix)
  const network = (ipValue & mask) >>> 0
  const wildcard = ~mask >>> 0
  const broadcast = (network | wildcard) >>> 0
  const total = 2 ** (32 - prefix)
  const hosts = prefix >= 31 ? total : total - 2
  return {
    ip: ipValue,
    prefix,
    mask,
    wildcard,
    network,
    broadcast,
    first: prefix >= 31 ? network : network + 1,
    last: prefix >= 31 ? broadcast : broadcast - 1,
    total,
    hosts,
    type: classifyIp(ipValue),
  }
}

/** 32 位整数 → 按字节分组的二进制串，如 11000000.10101000.00000001.00001010 */
export const ipToBinary = (value: number): string =>
  [24, 16, 8, 0].map((shift) => ((value >>> shift) & 0xff).toString(2).padStart(8, '0')).join('.')

/** 二进制串在网络位与主机位之间插入竖线，便于对照前缀长度 */
export function binaryWithPrefix(value: number, prefix: number): string {
  const groups = 4
  const dots = Math.min(Math.floor(prefix / 8), groups - 1)
  const position = Math.min(prefix + dots, 35)
  const binary = ipToBinary(value)
  return `${binary.slice(0, position)}|${binary.slice(position)}`
}

const MESSAGES: Record<SubnetErrorCode, { zh: string; en: string }> = {
  ipInvalid: { zh: 'IPv4 地址不合法，应为 0–255 的四段十进制', en: 'Invalid IPv4 address (four decimal octets, 0–255)' },
  maskMissing: { zh: '请输入子网掩码或前缀长度', en: 'Enter a subnet mask or prefix length' },
  maskInvalid: { zh: '子网掩码不合法', en: 'Invalid subnet mask' },
  maskNonContiguous: { zh: '子网掩码必须连续（如 255.255.255.0）', en: 'Subnet mask bits must be contiguous' },
}

export function subnetErrorMessage(code: SubnetErrorCode, locale: Locale): string {
  return MESSAGES[code][locale]
}

export interface SubnetRunData {
  ip: string
  prefix: number
  mask: string
  wildcard: string
  network: string
  broadcast: string
  first: string
  last: string
  total: number
  hosts: number
  type: IpClass
  binary: string
  networkBinary: string
  broadcastBinary: string
}

export const run: ToolRun<SubnetRunData> = (input, options, ctx): ToolResult<SubnetRunData> => {
  const raw = String(input ?? '').trim()
  if (!raw) {
    return { ok: false, error: { code: 'ipInvalid', message: subnetErrorMessage('ipInvalid', ctx.locale) } }
  }

  // 支持 192.168.1.10/24 这种内联前缀；未写则用掩码输入框
  let ipText = raw
  let inlineMask: string | undefined
  const slash = raw.lastIndexOf('/')
  if (slash > 0) {
    ipText = raw.slice(0, slash)
    inlineMask = raw.slice(slash + 1)
  }
  const maskText = inlineMask || (typeof options.mask === 'string' ? options.mask : '24')

  try {
    const ip = parseIpv4(ipText)
    const { prefix } = parseMask(maskText)
    const info = subnetInfo(ip.value, prefix)

    return {
      ok: true,
      output: `${ipToString(info.network)}/${prefix}`,
      stats: {
        prefix,
        hosts: info.hosts,
        total: info.total,
      },
      data: {
        ip: ip.text,
        prefix,
        mask: ipToString(info.mask),
        wildcard: ipToString(info.wildcard),
        network: ipToString(info.network),
        broadcast: ipToString(info.broadcast),
        first: ipToString(info.first),
        last: ipToString(info.last),
        total: info.total,
        hosts: info.hosts,
        type: info.type,
        binary: binaryWithPrefix(info.ip, prefix),
        networkBinary: ipToBinary(info.network),
        broadcastBinary: ipToBinary(info.broadcast),
      },
    }
  } catch (error) {
    if (!(error instanceof SubnetError)) throw error
    return { ok: false, error: { code: error.code, message: subnetErrorMessage(error.code, ctx.locale) } }
  }
}
