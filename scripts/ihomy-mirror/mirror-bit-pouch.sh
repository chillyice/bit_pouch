#!/usr/bin/env bash
# bit_pouch 发布镜像：GitHub Releases → ihomy（由 bit-pouch-mirror.timer 每天触发，也可手动跑）。
#
# 只镜像「已发布」的 Release：GitHub 的 /releases/latest 天然排除 draft / prerelease，
# 与发布页的「先 Publish 再换版本号」口径一致——草稿不会被镜像出去。
#
# 同步两块内容：
#   1. 发布页资产：安装包与静态站点包（exe / zip / deb / AppImage / dmg / msi），落盘到
#      /opt/ihomy/uploads/bit_pouch/，发布页从 /files/bit_pouch/<文件名> 直链下载。
#   2. 应用内更新：latest.json、清单引用的更新包与 .sig，落盘到
#      /opt/ihomy/uploads/bit_pouch/updates/，客户端从
#      https://ihomy.top/files/bit_pouch/updates/latest.json 检查更新。
#
# 信任模型：镜像只搬文件、改 URL，`signature` 原样保留。minisign 签的是安装包本身，
# 客户端仍用内嵌公钥做 Ed25519 校验；镜像改包会验签失败，也无法伪造签名。
#
# 顺序：先落安装包与 .sig，最后原子替换 latest.json / release.json——客户端任何时刻拿到的
# 清单，指向的文件都已经就位。旧版本文件只增不删（回滚时直接改页面版本号即可）。
#
# 环境变量（一般不用改）：
#   BIT_POUCH_MIRROR_DEST         落盘目录（默认 /opt/ihomy/uploads/bit_pouch）
#   BIT_POUCH_MIRROR_PUBLIC_BASE  对外地址前缀（默认 https://ihomy.top/files/bit_pouch）
#   BIT_POUCH_MIRROR_REPO         GitHub 仓库（默认 chillyice/bit_pouch）
#   BIT_POUCH_MIRROR_API          测试用：替换 GitHub API 地址
#   BIT_POUCH_MIRROR_PROXY        GitHub 加速前缀（如 https://gh-proxy.com/），留空则直连
#   BIT_POUCH_MIRROR_FORCE=1      忽略「已同步」状态，强制重拉
#
# 资产完整性：GitHub API 会返回每个资产的 sha256 digest，下载后逐个校验；代理只搬字节，
# 不参与信任链。代理失败或校验不过时自动回退直连。
set -euo pipefail

REPO="${BIT_POUCH_MIRROR_REPO:-chillyice/bit_pouch}"
DEST="${BIT_POUCH_MIRROR_DEST:-/opt/ihomy/uploads/bit_pouch}"
PUBLIC_BASE="${BIT_POUCH_MIRROR_PUBLIC_BASE:-https://ihomy.top/files/bit_pouch}"
FORCE="${BIT_POUCH_MIRROR_FORCE:-0}"
PROXY="${BIT_POUCH_MIRROR_PROXY:-}"
API="${BIT_POUCH_MIRROR_API:-https://api.github.com/repos/${REPO}/releases/latest}"
STATE="$DEST/.synced-tag"
UPDATE_DEST="$DEST/updates"
UPDATE_BASE="${PUBLIC_BASE%/}/updates"

log() { printf '[bit-pouch-mirror] %s\n' "$*"; }
die() { printf '[bit-pouch-mirror] 错误：%s\n' "$*" >&2; exit 1; }

command -v curl >/dev/null || die "缺少 curl"
# Ubuntu 上叫 python3；本机 Git Bash 只有 python——两者都接受。
PY="$(command -v python3 || command -v python || true)"
[ -n "$PY" ] || die "缺少 python3（用来解析 Release 与改写 latest.json）"

curl_json() {
  curl -fsSL --retry 3 --retry-delay 5 --connect-timeout 15 \
    -H 'Accept: application/vnd.github+json' \
    -H 'User-Agent: bit-pouch-mirror' "$1"
}

release="$(curl_json "$API")" || die "拉取 GitHub Release 失败（网络不通或被限流）"
tag="$(printf '%s' "$release" | "$PY" -c 'import json,sys; print(json.load(sys.stdin).get("tag_name",""))')"
[ -n "$tag" ] || die "Release 里没有 tag_name"

if [ "$FORCE" != "1" ] && [ -f "$STATE" ] \
  && [ -f "$DEST/release.json" ] && [ -f "$UPDATE_DEST/latest.json" ] \
  && [ "$(cat "$STATE")" = "$tag" ]; then
  log "已是最新（$tag），跳过"
  exit 0
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# 1. 资产表：name<TAB>url<TAB>size<TAB>sha256（全部资产），另出一份发布页会链接的文件类型。
printf '%s' "$release" > "$tmp/release.json"
"$PY" - "$tmp/release.json" "$tmp/assets.tsv" "$tmp/page-assets.tsv" <<'PY'
import json, re, sys
rel = json.load(open(sys.argv[1], encoding="utf-8"))
keep = re.compile(r"\.(exe|zip|deb|appimage|dmg|msi)$", re.I)
all_rows = []
page_rows = []
for a in rel.get("assets", []):
    name, url = a.get("name", ""), a.get("browser_download_url", "")
    if not name or name in (".", "..") or "/" in name or "\\" in name:
        raise SystemExit("非法资产名：" + repr(name))
    digest = a.get("digest") or ""
    sha = digest.split(":", 1)[1] if digest.startswith("sha256:") else ""
    row = "\t".join((name, url, str(a.get("size", 0)), sha)) + "\n"
    all_rows.append(row)
    if keep.search(name):
        page_rows.append(row)
with open(sys.argv[2], "w", encoding="utf-8", newline="\n") as f:
    f.writelines(all_rows)
with open(sys.argv[3], "w", encoding="utf-8", newline="\n") as f:
    f.writelines(page_rows)
PY

[ -s "$tmp/page-assets.tsv" ] || die "Release 里没有可镜像的安装包"

# 2. 下载单个资产：先代理（若配置）后直连，断点续传 + 重试 + sha256 校验。
#    GitHub 在国内常被限速/掐断，-C - 让重试从断点继续而不是从头再来。
already_ok() {
  [ -f "$tmp/$1" ] || return 1
  [ "$2" = "0" ] || [ "$(stat -c %s "$tmp/$1" 2>/dev/null || echo 0)" = "$2" ] || return 1
  [ -z "$3" ] || [ "$(sha256sum "$tmp/$1" | awk '{print $1}')" = "$3" ] || return 1
  return 0
}

fetch_asset() {
  name="$1" url="$2" size="$3" sha="$4"
  already_ok "$name" "$size" "$sha" && return 0
  rm -f "$tmp/$name"
  for base in ${PROXY:+"$PROXY"} ""; do
    [ -n "$base" ] && log "下载 $name（经代理 $base）" || log "下载 $name"
    attempt=1
    while [ "$attempt" -le 8 ]; do
      if curl -fsSL --http1.1 --connect-timeout 20 --speed-limit 1024 --speed-time 60 \
           -C - -H 'User-Agent: bit-pouch-mirror' -o "$tmp/$name" "${base}${url}"; then
        actual_size="$(stat -c %s "$tmp/$name" 2>/dev/null || echo 0)"
        actual_sha="$(sha256sum "$tmp/$name" | awk '{print $1}')"
        if [ "$size" != "0" ] && [ "$actual_size" != "$size" ]; then
          log "大小不符：$name（$actual_size != $size），重试"
          rm -f "$tmp/$name"
        elif [ -n "$sha" ] && [ "$actual_sha" != "$sha" ]; then
          log "sha256 不符：$name，丢弃并重试"
          rm -f "$tmp/$name"
        else
          [ -n "$sha" ] && log "校验通过：$name"
          return 0
        fi
      else
        rc=$?
        # 33/36：服务器不支持或无法满足断点续传；22：HTTP 错误（含 416）→ 从头再来。
        case "$rc" in 33|36|22) rm -f "$tmp/$name" ;; esac
        log "下载 $name 中断（rc=$rc，第 $attempt 次），重试"
      fi
      attempt=$((attempt + 1))
      sleep 5
    done
    [ -n "$base" ] && log "代理下载失败，回退直连：$name"
  done
  die "下载 $name 失败"
}

while IFS=$'\t' read -r name url size sha; do
  [ -n "$url" ] || die "资产表里找不到 $name"
  fetch_asset "$name" "$url" "$size" "$sha"
done < "$tmp/page-assets.tsv"

# 3. 更新清单：tauri-action 生成，别手写。清单引用的包与 .sig 都必须在资产里。
latest_url="$(awk -F'\t' '$1 == "latest.json" { print $2 }' "$tmp/assets.tsv")"
[ -n "$latest_url" ] || die "Release 里没有 latest.json（签名 / 更新流水线没跑完）"
curl_json "$latest_url" > "$tmp/github-latest.json" || die "下载 latest.json 失败"

"$PY" - "$tmp/assets.tsv" "$tmp/github-latest.json" "$tmp/update-files.txt" <<'PY'
import json, sys

assets = {}
with open(sys.argv[1], encoding="utf-8") as f:
    for line in f:
        name, url, _size, _sha = line.rstrip("\r\n").split("\t")
        assets[name] = url

manifest = json.load(open(sys.argv[2], encoding="utf-8"))
platforms = manifest.get("platforms", {})
if not platforms:
    raise SystemExit("latest.json 里没有 platforms 条目")

need = set()
for platform, entry in platforms.items():
    if not entry.get("signature"):
        raise SystemExit(f"{platform} 条目没有 signature")
    name = entry.get("url", "").split("/")[-1]
    if not name:
        raise SystemExit(f"{platform} 条目没有 url")
    need.add(name)

missing = sorted(n for n in need if n not in assets)
if missing:
    raise SystemExit("清单引用的资产不存在：" + ", ".join(missing))
missing_sig = sorted(n for n in need if n + ".sig" not in assets)
if missing_sig:
    raise SystemExit("缺少签名文件：" + ", ".join(missing_sig))

with open(sys.argv[3], "w", encoding="utf-8", newline="\n") as f:
    for name in sorted(need):
        f.write(name + "\n" + name + ".sig\n")
PY

# 4. 下载更新包与签名（发布页已经下过的文件直接复用）。
while IFS= read -r name; do
  [ -n "$name" ] || continue
  url="$(awk -F'\t' -v n="$name" '$1 == n { print $2 }' "$tmp/assets.tsv")"
  size="$(awk -F'\t' -v n="$name" '$1 == n { print $3 }' "$tmp/assets.tsv")"
  sha="$(awk -F'\t' -v n="$name" '$1 == n { print $4 }' "$tmp/assets.tsv")"
  [ -n "$url" ] || die "资产表里找不到 $name"
  fetch_asset "$name" "$url" "$size" "$sha"
done < "$tmp/update-files.txt"

# 5. 把清单里的下载地址改到 ihomy；签名与版本原样保留。
"$PY" - "$tmp/github-latest.json" "$UPDATE_BASE" "$tmp/latest.json" <<'PY'
import json, sys
manifest = json.load(open(sys.argv[1], encoding="utf-8"))
base = sys.argv[2].rstrip("/")
for entry in manifest.get("platforms", {}).values():
    entry["url"] = base + "/" + entry["url"].split("/")[-1]
with open(sys.argv[3], "w", encoding="utf-8", newline="\n") as f:
    json.dump(manifest, f, ensure_ascii=False, indent=2)
    f.write("\n")
PY

# 6. 发布页清单（页面暂不读，只用于线上排查与校验）。
"$PY" - "$tmp/page-assets.tsv" "$tag" "$tmp/release-meta.json" <<'PY'
import json, sys
tag = sys.argv[2]
version = tag[1:] if tag[:1] in ("v", "V") else tag
assets = []
with open(sys.argv[1], encoding="utf-8") as f:
    for line in f:
        name, _url, size, sha = line.rstrip("\r\n").split("\t")
        assets.append({"name": name, "size": int(size or 0), "sha256": sha})
with open(sys.argv[3], "w", encoding="utf-8", newline="\n") as f:
    json.dump({"tag": tag, "version": version, "assets": assets}, f, ensure_ascii=False, indent=2)
    f.write("\n")
PY

# 7. 落盘：更新包与签名 → latest.json；发布页资产 → release.json（同目录 rename，原子）。
mkdir -p "$DEST" "$UPDATE_DEST"
while IFS=$'\t' read -r name _url _size _sha; do
  install -m 644 "$tmp/$name" "$DEST/$name"
done < "$tmp/page-assets.tsv"

while IFS= read -r name; do
  [ -n "$name" ] || continue
  install -m 644 "$tmp/$name" "$UPDATE_DEST/$name"
done < "$tmp/update-files.txt"

install -m 644 "$tmp/latest.json" "$UPDATE_DEST/.latest.json.$$"
mv -f "$UPDATE_DEST/.latest.json.$$" "$UPDATE_DEST/latest.json"

install -m 644 "$tmp/release-meta.json" "$DEST/.release.json.$$"
mv -f "$DEST/.release.json.$$" "$DEST/release.json"

printf '%s\n' "$tag" > "$DEST/.synced-tag.$$"
mv -f "$DEST/.synced-tag.$$" "$DEST/.synced-tag"

log "完成：$tag → $DEST（发布页 $PUBLIC_BASE/，更新清单 $UPDATE_BASE/latest.json）"
