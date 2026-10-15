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
3. `/var/minis/offloads/env_cookies_bilibili*.sh`（Minis 里浏览器导出的 cookie）

**任何时候不要打印 SESSDATA 的值**，只说"有没有"。

## 登录（扫码）

```sh
node src/cli.mjs login                  # 终端画出二维码（SSH / CI 也能用）
node src/cli.mjs login --png /tmp/qr.png  # 额外写图片，方便手机扫
node src/cli.mjs login --qr-only        # 只生成二维码，存下 key
node src/cli.mjs login --resume         # 用存下的 key 继续轮询
node src/cli.mjs login --force          # 已登录时强制重登
```

**推荐两步走**：先 `--qr-only --png <路径>` 生成 → 把图片展示给用户 → 再 `--resume`。用户有充足时间扫，不会因轮询超时白扫。

轮询间隔 2 秒，二维码约 3 分钟过期。成功后整组 5 个 cookie 存到 `~/.config/bili/auth.json`（0600）。

## 出问题了先跑自检

```sh
node src/cli.mjs doctor
```

它会分清是**接口变了**、**凭据过期了**、还是**环境有问题**。凭据失效时输出里会出现 `-101`，让用户 `login --force` 重登即可。

## 踩过的坑（别重犯）

1. **只用 `x/player/wbi/v2`，绝对不要碰 `x/player/v2`。** 老接口会返回**别的视频**的字幕——实测对一条无字幕的 MV 连测 4 次，得到 4 段完全无关的内容。工具已改成拿不到就明说，**不要静默给出错误数据**。
2. **wbi 签名**：`w_rid` = md5(排序后 query + mixin)。混淆表要完整。
3. **`getSetCookie()` 在部分 Node 构建上对 fetch 响应不可用**，`get('set-cookie')` 可能返回**数组**。两种都兼容。
4. `x/web-interface/search/type` 未登录会 HTTP 412（风控）。
5. 字幕 CDN 链接的 `auth_key` 有时效（几小时），别存下来当永久地址。
6. `--list` 输出每次都会变（auth_key 是时间签名），别拿它做逐字节比对。

## 输出给用户时

- 长视频文字稿**不要打印到对话里**，写文件 + 给 `[name](minis://workspace/...)` 链接。
- 字幕是 **AI 自动生成**的，错别字和发音误识别很常见。实测例：`CAMM` 全篇写成 "cam"、`信号线阻值` 写成 "信号线组织"、`焊球` 写成 "气球"。
- **遇到专有名词，别信字幕，去核实物件上的丝印或官方资料。** 硬件类视频尤其如此——封面标签往往比口播准确。
- 没有字幕轨（纯音乐/MV/CG 常见）就直说没有，别硬编。

## 不接受的情况

- 用户明确说"不要登录""别用我账号"→ 只剩"下音频 + 外部 ASR"。如实说明，不要假装能本地跑。
- **不要打包浏览器、不要去读系统浏览器的 cookie 库。** 扫码方案已验证可行且更轻。
