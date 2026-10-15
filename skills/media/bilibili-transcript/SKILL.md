---
name: bilibili-transcript
description: 提取 B 站视频的文字稿/字幕/文案，或拿 B 站官方的 AI 视频总结；也用于帮用户登录 B 站账号。当用户给了一个 bilibili.com 链接、BV 号、av 号（包括 b23.tv 短链），并说"把字幕扒下来""视频讲了什么""转成文字""要文字稿/文案""总结这个视频""提取台词"时使用。也适用于用户说"帮我看这个视频的内容"而没有时间自己看的情况。
license: MIT
compatibility: Requires Node.js 18+ and network access to bilibili.com. Bundled scripts are zero-dependency (Node built-ins only); no npm install needed.
metadata:
  version: "1.0.2"
  author: dongliang
---

# B 站视频文字稿

**命令一律用 `node src/cli.mjs`（路径相对本技能目录）。**
脚本随技能一起来，零 npm 依赖，只用 Node 内置能力。若 `src/` 不在，退回 `npx -y bili-transcript`。

## 提取文字稿

```sh
node src/cli.mjs <BV号|av号|URL> --plain     # 最常用：连续文字，无时间戳
node src/cli.mjs <目标> -o out.txt           # 长视频务必写文件
node src/cli.mjs <目标> --json               # 给程序解析
```

**b23.tv 短链先解析**：

```sh
curl -s -o /dev/null -w '%{url_effective}' -L "https://b23.tv/XXXXXX"
```

| 选项 | 作用 |
|---|---|
| `--plain` | 只出连续文字，不带时间戳。**给 AI 读、给人读都用这个** |
| `--json` | 结构化输出（含 `lines[]` / `subtitles[]` / `summary`） |
| `-p N` | 取第 N 个分P（合集视频必用） |
| `--list` | 只列出字幕轨 |
| `--summary` | 附带 B 站 AI 总结（带章节时间点） |
| `-o FILE` | 写入文件 |

## 凭据

字幕接口强制登录。凭据查找顺序（自动，不用问用户要）：

1. 环境变量 `BILI_SESSDATA`
2. `~/.config/bili/auth.json`（`login` 写的位置）
3. **本机浏览器的 cookie 库**（只读，每次现取）
4. `/var/minis/offloads/env_cookies_bilibili*.sh`（Minis 里浏览器导出的 cookie）

第 3 级覆盖 Firefox（明文，零解密）和 Chrome / Chromium / Edge / Brave / Vivaldi / Opera（AES-128-CBC + 桌面密钥环）。用户日常开着浏览器，多半这一级就命中了，**不需要扫码**。

**先跑 `doctor` 看凭据来自哪**，别急着让用户扫码。只有四级全空才轮到扫码，且**扫码前必须问用户**——`bili` 在 TTY 下会自己问，非 TTY 下会打印指引。

**任何时候不要打印 SESSDATA 的值**，只说"有没有"。

## 登录

浏览器里没有 B 站登录态时：

```sh
node src/cli.mjs login                     # 扫码；TTY 下会先问一句
node src/cli.mjs login --from-browser      # 从浏览器导入并固化到 auth.json，不扫码
node src/cli.mjs login --png /tmp/qr.png   # 额外写图片，方便手机扫
node src/cli.mjs login --qr-only           # 只生成二维码，存下 key
node src/cli.mjs login --resume            # 用存下的 key 继续轮询
node src/cli.mjs login --force             # 已登录时强制重登
```

`--from-browser` 是把浏览器凭据**固化**下来的场合用的（比如之后要清浏览器数据）。平时不用——查找链第 3 级会自动现取，写进去反而会让「浏览器登出了但 auth.json 还留着」这种状态变得难排查。

**推荐两步走**：先 `--qr-only --png <路径>` 生成 → 把图片展示给用户 → 再 `--resume`。用户有充足时间扫，不会因轮询超时白扫。

轮询间隔 2 秒，二维码约 3 分钟过期。成功后整组 5 个 cookie 存到 `~/.config/bili/auth.json`（0600）。

## 出问题了先跑自检

```sh
node src/cli.mjs doctor
```

它会分清是**接口变了**、**凭据过期了**、还是**环境有问题**。输出里的「浏览器」段会说明本机找到了哪些浏览器、凭据取自哪个。

读浏览器 cookie 库需要 Node ≥ 22.5（内置 `node:sqlite`）或系统装有 `sqlite3` 命令。都不满足时这一级会自动跳过，其余功能不受影响。

## 踩过的坑（别重犯）

1. **只用 `x/player/wbi/v2`，绝对不要碰 `x/player/v2`。** 老接口会返回**别的视频**的字幕——实测对一条无字幕的 MV 连测 4 次，得到 4 段完全无关的内容。工具已改成拿不到就明说，**不要静默给出错误数据**。
2. **wbi 签名**：`w_rid` = md5(排序后 query + mixin)。混淆表要完整。
3. **`getSetCookie()` 在部分 Node 构建上对 fetch 响应不可用**，`get('set-cookie')` 可能返回**数组**。两种都兼容。
4. `x/web-interface/search/type` 未登录会 HTTP 412（风控）。
5. 字幕 CDN 链接的 `auth_key` 有时效（几小时），别存下来当永久地址。
6. `--list` 输出每次都会变（auth_key 是时间签名），别拿它做逐字节比对。
7. **Chromium 系 cookie 解密的三个反直觉点**（`src/browser.mjs` 已处理，改代码时别踩回去）：
   - 密文前缀是 `v11`——这标记以前专指 Windows App-Bound，但 Linux 上仍是标准方案，别以为要特殊处理
   - 明文**前 32 字节是 `SHA256(host_key)`**，不是 cookie 值的一部分。不去掉长度会多 32 字节
   - 填充是 **PKCS7**。不去掉末尾会多几个字节，nav 接口会报「连不上」，很难查
8. **读 cookie 库用 `file:...?mode=ro`，不要用 `?immutable=1`**。`immutable=1` 声称「文件不会变」于是跳过 WAL，**静默**读到过期 cookie（刚登录完拿到旧值，最难查）。
   - **WAL 模式的库必须先复制再读**。SQLite 打开 WAL 库时要在同目录建 `-shm`(32KB) 和 `-wal`，**只读模式也照建**（官方文档承认只读 WAL 库需可写目录）。浏览器运行时这俩文件本就在，直读看不出问题；浏览器干净退出后它们被删了，我们再直读就会凭空留下两个文件——等于偷偷写了用户的浏览器目录。代码里靠读文件头第 18 字节（2 = WAL）判断，WAL 一律复制到 `mkdtemp` 再读，约 45ms。
   - Chrome 是传统回滚日志（不是 WAL），直读无副作用，走快路径。
9. **域名过滤不能只靠 SQL 的 `like '%bilibili%'`**，它会放过 `bilibili.com.evil.com`。取到值之后还要按标签边界判一遍，只认 `bilibili.com` / `bilibili.cn` 及其子域。
10. **Firefox 的 profile 在 `~/.config/mozilla/`，不是 `~/.mozilla/`**（XDG 布局）。且目录名随机，要解析 `profiles.ini` 的 `Default=`。
11. **字幕接口缺凭据时不抛错**，而是正常返回并带 `need_login_subtitle`。判断「要不要扫码」得看 `noSubtitleReason === 'need-login'`，不是 catch 异常。
12. **`whoami()` 必须走 `getJson()`**（带凭据）才能问出登录态。手拼 headers 不带 cookie 的话永远返回 null——这个 bug 曾让「已登录」守卫失效。
13. **临时凭据别写 `/tmp`**。二维码的 `qrcode_key` 能换到登录 cookie，谁先轮询谁拿到账号；二维码图片扫一下就能登录。`/tmp` 全局可读、默认权限 644，写在那儿等于晾给别人看。现放在 `~/.config/bili/` 下并设 0600，登录成功后删掉。

## 输出给用户时

- 长视频文字稿**不要打印到对话里**，写文件 + 给 `[name](minis://workspace/...)` 链接。
- 字幕是 **AI 自动生成**的，错别字和发音误识别很常见。实测例：`CAMM` 全篇写成 "cam"、`信号线阻值` 写成 "信号线组织"、`焊球` 写成 "气球"。
- **遇到专有名词，别信字幕，去核实物件上的丝印或官方资料。** 硬件类视频尤其如此——封面标签往往比口播准确。
- 没有字幕轨（纯音乐/MV/CG 常见）就直说没有，别硬编。

## 不接受的情况

- 用户明确说"不要登录""别用我账号"→ 只剩"下音频 + 外部 ASR"。如实说明，不要假装能本地跑。
- 用户明确说"别读我的浏览器"→ 尊重，只走环境变量和 auth.json。
- **不要打包浏览器。** 读 cookie 库是只读的：只认 bilibili 域名下的 5 个白名单字段，不落盘、不打印值、绝不写浏览器文件。
