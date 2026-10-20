// 发布产物一致性校验（发版流水线与本地都能跑）。
//
// 查四件事：
//   1. 版本号四份对齐：根 VERSION（V0.4）的「主.次」= package.json = tauri.conf.json = Cargo.toml
//   2. GitHub Release 里该有的资产都在（Windows 安装版/免安装版、Linux deb/AppImage、
//      macOS dmg、Web/PWA 静态包、latest.json）
//   3. latest.json 的版本 / 平台条目 / 签名与资产一一对应
//   4. 每个 .sig 的 key id 与 tauri.conf.json 内嵌公钥一致、签名里带正确版本号
//
// 工具不存在、资产名拼错、漏签名不会让构建报错，只会在客户端表现成「检查更新没反应」
// 或「下完直接被拒装」；所以把它放在发布流水线最后一道，红了就别 Publish 这个 draft。
//
// 用法：
//   node scripts/verify-release.mjs                        # 只查版本号
//   node scripts/verify-release.mjs --assets a.json        # 再查 Release 资产（gh --json assets）
//   node scripts/verify-release.mjs --latest latest.json   # 再查更新清单
//   node scripts/verify-release.mjs --sigs <目录>          # 再查签名 key id / 版本
//   node scripts/verify-release.mjs --selftest             # 解析/匹配自检

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const problems = []
const fail = (msg) => problems.push(msg)

function readText(relative) {
  return readFileSync(join(ROOT, relative), 'utf8')
}

function argValue(flag) {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function exists(path) {
  try {
    statSync(path)
    return true
  } catch {
    return false
  }
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

/** `V0.4` → `0.4`；不是这个格式就返回 null。 */
function versionFromVersionFile(text) {
  const m = text.trim().match(/^V(\d+)\.(\d+)$/)
  return m ? `${m[1]}.${m[2]}` : null
}

/** `0.4.0` → `0.4`；semver 至少三段取前两段，用来和 VERSION 对齐。 */
function majorMinor(version) {
  const m = String(version)
    .trim()
    .match(/^(\d+)\.(\d+)(?:\.|$)/)
  return m ? `${m[1]}.${m[2]}` : null
}

function cargoVersion(text) {
  const section = text.split(/^\[/m).find((s) => s.startsWith('package]'))
  return section?.match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1] ?? null
}

function expectedAssets(version) {
  return [
    `bit_pouch_${version}_x64-setup.exe`,
    `bit_pouch_${version}_x64-portable.zip`,
    `bit_pouch_${version}_x64-portable.exe`,
    `bit_pouch_${version}_amd64.deb`,
    `bit_pouch_${version}_amd64.AppImage`,
    `bit_pouch_${version}_universal.dmg`,
    `bit_pouch_${version}_web.zip`,
    'latest.json',
  ]
}

function assetNames(json) {
  if (Array.isArray(json)) return json.map((a) => a?.name).filter(Boolean)
  if (Array.isArray(json?.assets)) return json.assets.map((a) => a?.name).filter(Boolean)
  return []
}

/** 公钥 → 8 字节 key id（hex）。conf 里的 pubkey 是「整个 .pub 文件」的 base64。 */
function pubkeyId(pubkeyB64) {
  const lines = Buffer.from(pubkeyB64, 'base64').toString('utf8').split(/\r?\n/)
  const body = lines.find((l) => !l.startsWith('untrusted comment:'))
  if (!body) throw new Error('公钥内容里找不到 base64 那一行')
  const bin = Buffer.from(body, 'base64')
  if (bin.length !== 42) throw new Error(`公钥长度不对：${bin.length}（应为 42）`)
  return bin.subarray(2, 10).toString('hex')
}

/**
 * `.sig` 是 minisign 签名文本的 base64。解开后：
 *   untrusted comment / base64(算法2+keyid8+签名64) / trusted comment: … / base64(全局签名)
 * trusted comment 里含 `version:`（requireSignedVersion 读的就是它）。
 */
function parseSig(sigFileText) {
  const lines = Buffer.from(sigFileText.trim(), 'base64')
    .toString('utf8')
    .split(/\r?\n/)
    .filter((l) => l.length > 0)
  if (lines.length < 3) throw new Error('签名文件行数不对（不是 minisign 格式？）')
  const bin = Buffer.from(lines[1], 'base64')
  if (bin.length !== 74) throw new Error(`签名块长度不对：${bin.length}（应为 74）`)
  const comment = lines[2]
  if (!comment.startsWith('trusted comment: ')) throw new Error('缺 trusted comment 行')
  const version = comment
    .slice('trusted comment: '.length)
    .split('\t')
    .find((f) => f.startsWith('version:'))
    ?.slice('version:'.length)
  return { keyId: bin.subarray(2, 10).toString('hex'), version }
}

function checkVersions() {
  const versionFile = versionFromVersionFile(readText('VERSION'))
  if (!versionFile) fail('VERSION 格式不对，应为 V<主>.<次>（如 V0.4）')

  const pkg = JSON.parse(readText('package.json'))
  const tauri = JSON.parse(readText('src-tauri/tauri.conf.json'))
  const cargo = cargoVersion(readText('src-tauri/Cargo.toml'))

  const sources = {
    'package.json': pkg.version,
    'tauri.conf.json': tauri.version,
    'Cargo.toml': cargo,
  }

  if (!tauri.version) fail('tauri.conf.json 没有 version')
  for (const [name, version] of Object.entries(sources)) {
    if (!version) fail(`${name} 没有版本号`)
    else if (!majorMinor(version)) fail(`${name} 的版本号不是 semver：${version}`)
    else if (versionFile && majorMinor(version) !== versionFile) {
      fail(`${name} 版本 ${version} 与 VERSION 的 ${versionFile} 不一致`)
    }
  }

  const unique = new Set(Object.values(sources).filter(Boolean))
  if (unique.size > 1) fail(`三处 semver 不一致：${[...unique].join(' / ')}`)

  return { version: tauri.version, tauri }
}

function checkAssets(file, version) {
  let json
  try {
    json = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    fail(`读不了资产清单 ${file}：${e.message}`)
    return
  }

  const names = new Set(assetNames(json))
  if (!names.size) fail(`${file} 里没有 assets[].name`)
  for (const name of expectedAssets(version)) {
    if (!names.has(name)) fail(`Release 缺少资产：${name}`)
  }
}

function checkLatest(file, version, assetSet) {
  let latest
  try {
    latest = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    fail(`读不了更新清单 ${file}：${e.message}`)
    return
  }

  if (String(latest.version) !== version) {
    fail(`latest.json 版本 ${latest.version} ≠ 配置版本 ${version}`)
  }

  const platforms = latest.platforms ?? {}
  const keys = Object.keys(platforms)
  if (!keys.length) fail('latest.json 里没有 platforms 条目')

  for (const key of ['windows-x86_64', 'windows-x86_64-portable', 'linux-x86_64']) {
    if (!platforms[key]) fail(`latest.json 缺少平台条目：${key}`)
  }
  if (!keys.some((key) => key.startsWith('darwin-'))) {
    fail('latest.json 缺少 macOS（darwin-*）平台条目')
  }

  for (const [platform, entry] of Object.entries(platforms)) {
    if (!entry?.signature?.trim()) fail(`latest.json 的 ${platform} 条目没有 signature`)
    const url = String(entry?.url ?? '')
    const name = decodeURIComponent(url.split('/').pop() ?? '')
    if (!name) {
      fail(`latest.json 的 ${platform} 条目没有有效 url`)
      continue
    }
    if (assetSet) {
      if (!assetSet.has(name)) fail(`latest.json 的 ${platform} 指向不存在的资产：${name}`)
      if (!assetSet.has(`${name}.sig`)) fail(`Release 缺少签名资产：${name}.sig`)
    }
  }

  const installed = platforms['windows-x86_64']
  if (installed && !String(installed.url).endsWith(`bit_pouch_${version}_x64-setup.exe`)) {
    fail('windows-x86_64 条目没有指向 NSIS 安装包')
  }
  const portable = platforms['windows-x86_64-portable']
  if (portable && !String(portable.url).endsWith(`bit_pouch_${version}_x64-portable.exe`)) {
    fail('windows-x86_64-portable 条目没有指向免安装更新包')
  }
  const linux = platforms['linux-x86_64']
  if (linux && !String(linux.url).endsWith('.AppImage')) {
    fail('linux-x86_64 条目没有指向 AppImage')
  }

  console.log(`  ✓ latest.json（${keys.join(' / ')}）`)
  return platforms
}

function checkSigs(dir, version, keyId, platforms) {
  if (!exists(dir)) {
    fail(`签名目录不存在：${dir}`)
    return
  }
  const sigs = walk(dir).filter((p) => p.endsWith('.sig'))
  if (!sigs.length) {
    fail(`签名目录里没有 .sig：${dir}`)
    return
  }

  const byName = new Map()
  for (const path of sigs) {
    const name = basename(path)
    const text = readFileSync(path, 'utf8')
    byName.set(name, text.trim())
    try {
      const sig = parseSig(text)
      if (sig.keyId !== keyId) {
        fail(`${name}：签名 key id ${sig.keyId} ≠ 内嵌公钥 ${keyId}（私钥与公钥不是同一对 → 拒装）`)
      }
      if (sig.version === undefined) {
        fail(`${name}：签名里没有 version: 字段（requireSignedVersion 已开 → MissingSignedVersion）`)
      } else if (sig.version.replace(/^v/, '') !== version) {
        fail(`${name}：签名版本 ${sig.version} ≠ 配置版本 ${version}（→ SignedVersionMismatch）`)
      }
    } catch (e) {
      fail(`${name}：解析失败 —— ${e.message}`)
    }
  }

  for (const [platform, entry] of Object.entries(platforms ?? {})) {
    const name = decodeURIComponent(String(entry?.url ?? '').split('/').pop() ?? '')
    if (!name) continue
    const sigText = byName.get(`${name}.sig`)
    if (!sigText) {
      fail(`latest.json 的 ${platform} 条目指向 ${name}，但没有下载到 ${name}.sig`)
    } else if (sigText !== String(entry.signature ?? '').trim()) {
      fail(`latest.json 的 ${platform} 条目里 signature 与 ${name}.sig 内容不一致`)
    }
  }

  console.log(`  ✓ ${sigs.length} 个签名（key id ${keyId}，版本 ${version}）`)
}

const { version, tauri } = checkVersions()

let keyId
try {
  keyId = pubkeyId(tauri.plugins?.updater?.pubkey)
} catch (e) {
  fail(`读不出 plugins.updater.pubkey 的 key id：${e.message}`)
}

const assetsPath = argValue('--assets')
const latestPath = argValue('--latest')
const sigsPath = argValue('--sigs')

let assetSet
if (assetsPath) {
  checkAssets(assetsPath, version)
  try {
    assetSet = new Set(assetNames(JSON.parse(readFileSync(assetsPath, 'utf8'))))
  } catch {
    assetSet = undefined
  }
}

let platforms
if (latestPath) platforms = checkLatest(latestPath, version, assetSet)
if (sigsPath && keyId) checkSigs(sigsPath, version, keyId, platforms)

if (process.argv.includes('--selftest')) {
  const assert = (cond, what) => {
    if (!cond) {
      console.error(`自检失败：${what}`)
      process.exit(1)
    }
  }
  assert(versionFromVersionFile('V0.4\n') === '0.4', 'VERSION 解析')
  assert(versionFromVersionFile('V1.23') === '1.23', '两位数次版本')
  assert(versionFromVersionFile('0.4') === null, '非 V 前缀应拒绝')
  assert(majorMinor('0.4.0') === '0.4', 'semver 主次')
  assert(majorMinor('1.0.0') === '1.0', '1.0 主次')
  assert(
    cargoVersion('[package]\nname = "x"\nversion = "0.4.0"\n\n[dependencies]\nversion = "9"\n') === '0.4.0',
    'Cargo.toml 只取 [package] 的 version',
  )
  assert(expectedAssets('0.4.0').includes('bit_pouch_0.4.0_web.zip'), 'Web 包名')
  assert(expectedAssets('0.4.0').includes('bit_pouch_0.4.0_x64-portable.exe'), '免安装更新包名')
  assert(expectedAssets('0.4.0').includes('latest.json'), '更新清单')

  const id = Buffer.alloc(8, 0xab)
  const pub = Buffer.concat([Buffer.from('ED'), id, Buffer.alloc(32)])
  const pubText = `untrusted comment: minisign public key ${id.toString('hex')}\n${pub.toString('base64')}`
  assert(pubkeyId(Buffer.from(pubText).toString('base64')) === id.toString('hex'), '公钥 key id 解析')
  const sig = (comment) =>
    Buffer.from(
      [
        'untrusted comment: signature from minisign secret key',
        Buffer.concat([Buffer.from('ED'), id, Buffer.alloc(64)]).toString('base64'),
        `trusted comment: ${comment}`,
        Buffer.alloc(64).toString('base64'),
      ].join('\n'),
    ).toString('base64')
  assert(parseSig(sig('timestamp:1700000000\tfile:app.tar.gz\tversion:1.2.3')).version === '1.2.3', '签名版本解析')
  assert(parseSig(sig('timestamp:1700000000\tfile:app.tar.gz')).version === undefined, '缺 version 要能看出来')
  console.log('解析器自检通过。')
}

if (problems.length) {
  console.error('发布产物校验失败：')
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}

console.log(`发布产物校验通过：版本 ${version}${assetsPath ? '，资产齐全' : ''}${latestPath ? '，清单与签名一致' : ''}。`)
