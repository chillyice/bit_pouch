# bit_pouch 发布镜像（GitHub → ihomy）

发布页 `https://ihomy.top/bit-pouch` 的下载按钮指向 ihomy 直链
`https://ihomy.top/files/bit_pouch/<文件名>`。本目录负责把 GitHub 上**已发布**的最新
Release 同步到服务器 `/opt/ihomy/uploads/bit_pouch/`，国内不直连 GitHub 也能下载。

应用内「检查更新」默认读 ihomy 镜像的清单
`https://ihomy.top/files/bit_pouch/updates/latest.json`；能直连 GitHub 的人在设置页可切到
官方 Releases。本目录同时把 `latest.json`、清单引用的更新包与 `.sig` 同步到
`/opt/ihomy/uploads/bit_pouch/updates/`。

## 信任模型

- 镜像**只搬文件、改 URL**：GitHub Release 是唯一来源，服务器只做静态托管。
- `latest.json` 里的 `signature` 原样保留，签名签的是安装包本身；客户端仍用内嵌公钥做
  Ed25519 校验。镜像改包会验签失败，镜像也无法伪造签名。
- GitHub 的 `/releases/latest` 天然排除 draft / prerelease——Release 草稿不会被镜像出去，
  所以发版流程是「先 Publish，再改发布页版本号」。
- 先落安装包与 `.sig`，最后原子替换 `latest.json` / `release.json`；页面与客户端都不会
  拿到指向缺失文件的清单。
- 每个资产都用 GitHub API 返回的 **sha256 digest** 校验（`release.json` 里也记录一份），
  校验不过不会落盘。
- 直连 GitHub 资产在国内实测只有 ~16KB/s 且会被中断，默认经 `BIT_POUCH_MIRROR_PROXY`
  加速前缀下载；代理只搬字节、不参与信任链，失败或校验不过自动回退直连。
- 旧版本文件只增不删（回滚时直接改页面版本号即可；客户端可能还在下旧版本）。

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

# 更新清单能匿名取到，且平台条目 / 签名都在
curl -s https://ihomy.top/files/bit_pouch/updates/latest.json | python3 -m json.tool | head -30

# 安装包匿名可下、带 nosniff
curl -sI https://ihomy.top/files/bit_pouch/bit_pouch_0.2.0_x64-setup.exe | head

# 最近一次同步
journalctl -u bit-pouch-mirror.service -n 50 --no-pager
systemctl list-timers bit-pouch-mirror.timer
```

`latest.json` 里 Windows 应同时有 `windows-x86_64`（安装版）与
`windows-x86_64-portable`（免安装版）两个条目，各自带非空 `signature`。

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
「下载 → 改写 latest.json → 原子替换 → 第二次跳过」。假 Release 里必须带 `latest.json`
及其引用的更新包与 `.sig`，否则脚本会直接报错——这正是不让半套更新流到线上的闸门。

## 日志与失败处理

- 网络不通、GitHub 限流（403）、清单缺签名或引用的资产不存在：脚本非零退出，journal 里
  有具体原因；定时器第二天会重试。**已同步的旧清单不会被破坏**（新文件全部下载成功后才替换）。
- 磁盘只增不减：每个版本保留自己的安装包与签名（客户端可能还在下旧版本）。
