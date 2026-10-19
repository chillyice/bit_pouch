#!/usr/bin/env bash
# bit_pouch 发布镜像：GitHub Releases → ihomy（由 bit-pouch-mirror.timer 每天触发，也可手动跑）。
#
# 只镜像「已发布」的 Release：GitHub 的 /releases/latest 天然排除 draft / prerelease，
# 与发布页的「先 Publish 再换版本号」口径一致——草稿不会被镜像出去。
#
# 同步内容：Release 里的安装包与静态站点包（exe / zip / deb / AppImage / dmg / msi），
# 落盘到 /opt/ihomy/uploads/bit_pouch/，发布页从 /files/bit_pouch/<文件名> 直链下载。
# 同时写一份 release.json（tag / version / 资产大小），便于排查线上到底是哪一版。
#
# 顺序：先落安装包，最后原子替换 release.json——任何时刻页面链接指向的文件都已就位。
# 旧版本文件只增不删（回滚时直接改页面版本号即可）。
#
# 环境变量（一般不用改）：
#   BIT_POUCH_MIRROR_DEST         落盘目录（默认 /opt/ihomy/uploads/bit_pouch）
#   BIT_POUCH_MIRROR_PUBLIC_BASE  对外地址前缀（默认 https://ihomy.top/files/bit_pouch）
#   BIT_POUCH_MIRROR_REPO         GitHub 仓库（默认 chillyice/bit_pouch）
#   BIT_POUCH_MIRROR_API          测试用：替换 GitHub API 地址
#   BIT_POUCH_MIRROR_FORCE=1      忽略「已同步」状态，强制重拉
set -euo pipefail

REPO="${BIT_POUCH_MIRROR_REPO:-chillyice/bit_pouch}"
DEST="${BIT_POUCH_MIRROR_DEST:-/opt/ihomy/uploads/bit_pouch}"
PUBLIC_BASE="${BIT_POUCH_MIRROR_PUBLIC_BASE:-https://ihomy.top/files/bit_pouch}"
FORCE="${BIT_POUCH_MIRROR_FORCE:-0}"
API="${BIT_POUCH_MIRROR_API:-https://api.github.com/repos/${REPO}/releases/latest}"
STATE="$DEST/.synced-tag"

log() { printf '[bit-pouch-mirror] %s\n' "$*"; }
die() { printf '[bit-pouch-mirror] 错误：%s\n' "$*" >&2; exit 1; }

command -v curl >/dev/null || die "缺少 curl"
# Ubuntu 上叫 python3；本机 Git Bash 只有 python——两者都接受。
PY="$(command -v python3 || command -v python || true)"
[ -n "$PY" ] || die "缺少 python3（用来解析 Release 与写 release.json）"

curl_json() {
  curl -fsSL --retry 3 --retry-delay 5 --connect-timeout 15 \
    -H 'Accept: application/vnd.github+json' \
    -H 'User-Agent: bit-pouch-mirror' "$1"
}

release="$(curl_json "$API")" || die "拉取 GitHub Release 失败（网络不通或被限流）"
tag="$(printf '%s' "$release" | "$PY" -c 'import json,sys; print(json.load(sys.stdin).get("tag_name",""))')"
[ -n "$tag" ] || die "Release 里没有 tag_name"

if [ "$FORCE" != "1" ] && [ -f "$STATE" ] && [ -f "$DEST/release.json" ] && [ "$(cat "$STATE")" = "$tag" ]; then
  log "已是最新（$tag），跳过"
  exit 0
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# 1. Release 资产表：name<TAB>url；只留发布页会链接的文件类型。
printf '%s' "$release" > "$tmp/release.json"
"$PY" - "$tmp/release.json" "$tmp/assets.tsv" <<'PY'
import json, re, sys
rel = json.load(open(sys.argv[1], encoding="utf-8"))
keep = re.compile(r"\.(exe|zip|deb|appimage|dmg|msi)$", re.I)
with open(sys.argv[2], "w", encoding="utf-8", newline="\n") as f:
    for a in rel.get("assets", []):
        name, url = a.get("name", ""), a.get("browser_download_url", "")
        if not keep.search(name):
            continue
        if not name or name in (".", "..") or "/" in name or "\\" in name:
            raise SystemExit("非法资产名：" + repr(name))
        f.write(name + "\t" + url + "\t" + str(a.get("size", 0)) + "\n")
PY

[ -s "$tmp/assets.tsv" ] || die "Release 里没有可镜像的安装包"
cut -f1 "$tmp/assets.tsv" > "$tmp/files.txt"

# 2. 逐个下载（失败即停；文件名已在上面限定为单段路径）。
while IFS= read -r name; do
  url="$(awk -F'\t' -v n="$name" '$1 == n { print $2 }' "$tmp/assets.tsv")"
  [ -n "$url" ] || die "资产表里找不到 $name"
  log "下载 $name"
  curl -fsSL --retry 3 --retry-delay 5 --connect-timeout 15 \
    -H 'User-Agent: bit-pouch-mirror' -o "$tmp/$name" "$url" || die "下载 $name 失败"
done < "$tmp/files.txt"

# 3. 生成清单（页面暂不读，只用于线上排查与校验）。
"$PY" - "$tmp/assets.tsv" "$tag" "$tmp/release-meta.json" <<'PY'
import json, sys
tag = sys.argv[2]
version = tag[1:] if tag[:1] in ("v", "V") else tag
assets = []
with open(sys.argv[1], encoding="utf-8") as f:
    for line in f:
        name, _url, size = line.rstrip("\r\n").split("\t")
        assets.append({"name": name, "size": int(size or 0)})
with open(sys.argv[3], "w", encoding="utf-8", newline="\n") as f:
    json.dump({"tag": tag, "version": version, "assets": assets}, f, ensure_ascii=False, indent=2)
    f.write("\n")
PY

# 4. 落盘：安装包 → 最后 release.json（同目录 rename，原子）。
mkdir -p "$DEST"
while IFS= read -r name; do
  install -m 644 "$tmp/$name" "$DEST/$name"
done < "$tmp/files.txt"
install -m 644 "$tmp/release-meta.json" "$DEST/.release.json.$$"
mv -f "$DEST/.release.json.$$" "$DEST/release.json"
printf '%s\n' "$tag" > "$DEST/.synced-tag.$$"
mv -f "$DEST/.synced-tag.$$" "$DEST/.synced-tag"

log "完成：$tag → $DEST（对外 $PUBLIC_BASE/）"
