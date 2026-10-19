# bit_pouch 发布镜像（GitHub → ihomy）

发布页 `https://ihomy.top/bit-pouch` 的下载按钮指向 ihomy 直链
`https://ihomy.top/files/bit_pouch/<文件名>`。本目录负责把 GitHub 上**已发布**的最新
Release 同步到服务器 `/opt/ihomy/uploads/bit_pouch/`，国内不直连 GitHub 也能下载。

## 信任模型

- 镜像**只搬文件**：GitHub Release 是唯一来源，服务器只做静态托管。
- GitHub 的 `/releases/latest` 天然排除 draft / prerelease——Release 草稿不会被镜像出去，
  所以发版流程是「先 Publish，再改发布页版本号」。
- 当前 bit_pouch **没有代码签名，也没有自动更新**：镜像不参与信任链，也不会改写任何签名。
  下载页同时保留 GitHub Releases 入口；需要强校验时请从 GitHub 下载并自行核对。
- 先落安装包，最后原子替换 `release.json`；页面不会拿到指向缺失文件的清单。
- 每个资产都用 GitHub API 返回的 **sha256 digest** 校验（`release.json` 里也记录一份），
  校验不过不会落盘。
- 直连 GitHub 资产在国内实测只有 ~16KB/s 且会被中断，默认经 `BIT_POUCH_MIRROR_PROXY`
  加速前缀下载；代理只搬字节、不参与信任链，失败或校验不过自动回退直连。
- 旧版本文件只增不删（回滚时直接改页面版本号即可）。

## 安装（ihomy 服务器，root）

依赖：`curl`、`python3`（Ubuntu 自带）。落盘目录归 `ihomy` 所有（与咔哒同款）。

```bash
cd scripts/ihomy-mirror
sudo ./install.sh
```

`install.sh` 会：装 `bit-pouch-mirror` 到 `/usr/local/bin/`、装 systemd 单元、启用每日
定时器（04:23 起随机错开 20 分钟，停机错过会补跑），并立即同步一次。

## 验证

```bash
# 线上是哪一版、有哪些文件
curl -s https://ihomy.top/files/bit_pouch/release.json | python3 -m json.tool

# 安装包匿名可下、带 nosniff
curl -sI https://ihomy.top/files/bit_pouch/bit_pouch_0.2.0_x64-setup.exe | head

# 最近一次同步
journalctl -u bit-pouch-mirror.service -n 50 --no-pager
systemctl list-timers bit-pouch-mirror.timer
```

后端 `SecurityConfig` 已把 `/files/bit_pouch/**` 设为 permitAll（与 `/files/kada/**` 同款），
nginx 继续走 `/files/` 反代，不需要新增 location。

## 手动操作

```bash
# 立即同步一次（以文件属主身份跑，别用 root）
sudo -u ihomy /usr/local/bin/bit-pouch-mirror

# 强制重拉当前 tag（忽略 .synced-tag）
sudo -u ihomy env BIT_POUCH_MIRROR_FORCE=1 /usr/local/bin/bit-pouch-mirror

# 临时换加速前缀（留空表示直连）
sudo -u ihomy env BIT_POUCH_MIRROR_PROXY=https://gh-proxy.com/ /usr/local/bin/bit-pouch-mirror

# 换落盘目录 / 对外地址（一般只在测试时用）
BIT_POUCH_MIRROR_DEST=/tmp/bit-pouch BIT_POUCH_MIRROR_PUBLIC_BASE=https://example.test/x \
  ./mirror-bit-pouch.sh
```

## 本地测试（不需要真 GitHub）

`BIT_POUCH_MIRROR_API` 可指向本地假 API：把一份 Release JSON 与其中的资产放在
`python3 -m http.server` 后面，再用 `BIT_POUCH_MIRROR_DEST` 指到临时目录即可端到端验证
「下载 → 写 release.json → 原子替换 → 第二次跳过」。
