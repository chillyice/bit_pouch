// 发布产物一致性校验（发版流水线与本地都能跑）。
//
// 查两件事：
//   1. 版本号四份对齐：根 VERSION（V0.2）的「主.次」= package.json = tauri.conf.json = Cargo.toml
//   2. GitHub Release 里该有的资产都在（Windows 安装版/免安装版、Linux deb/AppImage、
//      macOS dmg、Web/PWA 静态包）
//
// 工具不存在、资产名拼错不会让构建报错，只会让发布页 / 镜像指向 404；所以把它放在
// 发布流水线最后一道，红了就别 Publish 这个 draft。
//
// 用法：
//   node scripts/verify-release.mjs                 # 只查版本号
//   node scripts/verify-release.mjs --assets a.json # 再查 Release 资产（gh 的 --json assets 输出）
//   node scripts/verify-release.mjs --selftest      # 解析/匹配自检

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
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

/** `V0.2` → `0.2`；不是这个格式就返回 null。 */
function versionFromVersionFile(text) {
  const m = text.trim().match(/^V(\d+)\.(\d+)$/)
  return m ? `${m[1]}.${m[2]}` : null
}

/** `0.2.0` → `0.2`；semver 至少三段取前两段，用来和 VERSION 对齐。 */
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
    `bit_pouch_${version}_amd64.deb`,
    `bit_pouch_${version}_amd64.AppImage`,
    `bit_pouch_${version}_universal.dmg`,
    `bit_pouch_${version}_web.zip`,
  ]
}

function assetNames(json) {
  if (Array.isArray(json)) return json.map((a) => a?.name).filter(Boolean)
  if (Array.isArray(json?.assets)) return json.assets.map((a) => a?.name).filter(Boolean)
  return []
}

function checkVersions() {
  const versionFile = versionFromVersionFile(readText('VERSION'))
  if (!versionFile) fail('VERSION 格式不对，应为 V<主>.<次>（如 V0.2）')

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

  return tauri.version
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

const version = checkVersions()

const assetsPath = argValue('--assets')
if (assetsPath) checkAssets(assetsPath, version)

if (process.argv.includes('--selftest')) {
  const assert = (cond, what) => {
    if (!cond) {
      console.error(`自检失败：${what}`)
      process.exit(1)
    }
  }
  assert(versionFromVersionFile('V0.2\n') === '0.2', 'VERSION 解析')
  assert(versionFromVersionFile('V1.23') === '1.23', '两位数次版本')
  assert(versionFromVersionFile('0.2') === null, '非 V 前缀应拒绝')
  assert(majorMinor('0.2.0') === '0.2', 'semver 主次')
  assert(majorMinor('1.0.0') === '1.0', '1.0 主次')
  assert(
    cargoVersion('[package]\nname = "x"\nversion = "0.2.0"\n\n[dependencies]\nversion = "9"\n') === '0.2.0',
    'Cargo.toml 只取 [package] 的 version',
  )
  assert(expectedAssets('0.2.0').includes('bit_pouch_0.2.0_web.zip'), 'Web 包名')
  assert(assetNames({ assets: [{ name: 'a' }, { name: 'b' }] }).length === 2, 'gh 资产解析')
  console.log('解析器自检通过。')
}

if (problems.length) {
  console.error('发布产物校验失败：')
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}

console.log(`发布产物校验通过：版本 ${version}${assetsPath ? '，资产齐全' : ''}。`)
