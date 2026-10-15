#!/usr/bin/env node
// bili —— B 站视频文字稿提取工具
//
//   bili <BV号|av号|URL> [选项]     提取文字稿（最常用，可省略 fetch）
//   bili fetch <目标> [选项]        同上
//   bili login [选项]              扫码登录
//   bili doctor                    自检
//   bili install-skill [选项]      把 skill 装到本地 agent
//
import { writeFileSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchVideo, renderText } from './fetch.mjs';
import { login } from './login.mjs';

// 版本号从 package.json 读，避免写死后漂移
const VERSION = (() => {
  try {
    const p = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    return JSON.parse(readFileSync(p, 'utf8')).version;
  } catch { return 'unknown'; }
})();

const HELP = `
bili-transcript —— B 站视频文字稿提取
（命令名 bili-transcript，简写 bili，两者等价）

用法
  bili <BV号|av号|URL> [选项]     提取文字稿
  bili fetch <目标> [选项]        同上（显式写法）
  bili login [选项]              扫码登录（或 --from-browser 从浏览器导入）
  bili doctor                    自检：环境 / 凭据 / 浏览器 / 接口
  bili install-skill [选项]      安装 agent skill
  bili --help                    看这份帮助
  bili --version                 看版本

凭据从哪来（自动，按顺序找）
  1. 环境变量 BILI_SESSDATA
  2. ~/.config/bili/auth.json          扫码登录写的
  3. 本机浏览器 cookie 库               只读，每次现取
  4. /var/minis/offloads/               Minis 导出的 cookie
  都没有才会提示你扫码。

提取选项
  --plain            只出连续文字，不带时间戳（喂给 AI 用这个）
  --json             输出 JSON（给程序/agent 解析）
  -p, --page N       取第 N 个分P
  --list             只列出字幕轨，不下载正文
  --summary          附带 B 站 AI 总结
  -o, --out FILE     写入文件
  --no-login-prompt  凭据缺失时不询问，直接报错退出

登录选项
  --png <路径>       额外写出二维码图片
  --qr-only          只生成二维码，稍后用 --resume 继续
  --resume           用上次的二维码继续轮询
  --timeout N        轮询超时秒数（默认 180）
  --force            已登录时强制重新登录
  --from-browser     从浏览器导入凭据并固化到 auth.json（不扫码）

示例
  bili BV1xx411c7mD --plain
  bili "https://b23.tv/xxxxx" --summary -o out.txt
  bili login --png /tmp/qr.png
  bili login --qr-only && bili login --resume
  bili login --from-browser
`.trim();

function parseArgs(argv) {
  const o = { _: [], plain: false, json: false, list: false, summary: false, out: null, page: 1 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--plain') o.plain = true;
    else if (a === '--json') o.json = true;
    else if (a === '--list') o.list = true;
    else if (a === '--summary') o.summary = true;
    else if (a === '--qr-only') o.qrOnly = true;
    else if (a === '--resume') o.resume = true;
    else if (a === '--force') o.force = true;
    else if (a === '--from-browser') o.fromBrowser = true;
    else if (a === '--no-login-prompt') o.noLoginPrompt = true;
    else if (a === '-p' || a === '--page') o.page = parseInt(argv[++i], 10);
    else if (a === '-o' || a === '--out') o.out = argv[++i];
    else if (a === '--png') o.png = argv[++i];
    else if (a === '--timeout') o.timeout = parseInt(argv[++i], 10);
    else if (a === '-h' || a === '--help') o.help = true;
    else if (a === '-v' || a === '--version') o.version = true;
    else o._.push(a);
  }
  return o;
}

function die(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

/**
 * 凭据没了时的兜底询问。只在 TTY 下问 —— 非 TTY（agent / 管道调用）里
 * 弹二维码会把调用方卡死，那种场合打印指引让调用方自己决定。
 */
async function offerLogin() {
  const hint = '浏览器里也没找到 B 站登录态。';
  if (!process.stdin.isTTY || !process.stdout.isTTY || process.env.BILI_NO_PROMPT) {
    console.error(`${hint}\n需要扫码登录，请运行：bili login --png /tmp/qr.png`);
    return false;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const a = (await rl.question(`${hint}\n现在扫码登录吗？[y/N] `)).trim().toLowerCase();
    if (a !== 'y' && a !== 'yes') {
      console.error('已取消。');
      return false;
    }
  } finally {
    rl.close();
  }

  const r = await login({ png: '/tmp/bili-qr.png' });
  if (r?.alreadyLoggedIn) return true;
  if (!r?.ok) { console.error('登录没成功。'); return false; }
  return true;
}

/** 从浏览器导入并固化到 auth.json */
async function importFromBrowser() {
  const { readBrowserCookies } = await import('./browser.mjs');
  const { saveAuth, AUTH_PATH, WANTED } = await import('./auth.mjs');

  const got = readBrowserCookies();
  if (!got) {
    console.error('本机浏览器里没找到 B 站登录态。先确认浏览器里登录着 B 站，或改用 `bili login` 扫码。');
    return 1;
  }

  const jar = {};
  for (const n of WANTED) if (got.jar[n]) jar[n] = got.jar[n];
  saveAuth(jar);

  const { whoami } = await import('./login.mjs');
  const who = await whoami().catch(() => null);
  console.log(`已从 ${got.source} 导入 ${Object.keys(jar).length} 项凭据`);
  if (who) console.log(`  账号：${who.uname}（uid ${who.mid}）`);
  console.log(`  已写入 ${AUTH_PATH}（权限 0600）`);
  return 0;
}

async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length) { console.log(HELP); return; }

  // 允许 `bili --help` / `bili --json <url>` 这类全局选项打头
  const SUBCOMMANDS = ['fetch', 'login', 'doctor', 'install-skill'];
  let cmd, rest;
  if (SUBCOMMANDS.includes(argv[0])) {
    cmd = argv[0]; rest = argv.slice(1);
  } else {
    cmd = 'fetch'; rest = argv;
  }
  const o = parseArgs(rest);
  if (o.help) { console.log(HELP); return; }
  if (o.version) { console.log(VERSION); return; }

  // ---- login ----
  if (cmd === 'login') {
    if (o.fromBrowser) process.exit(await importFromBrowser());
    try {
      const r = await login(o);
      if (r.qrOnly && o.json) console.log(JSON.stringify(r, null, 2));
    } catch (e) { die(`登录失败：${e.message}`); }
    return;
  }

  // ---- doctor ----
  if (cmd === 'doctor') {
    const { runDoctor } = await import('./doctor.mjs');
    const ok = await runDoctor({ json: o.json });
    process.exit(ok ? 0 : 1);
  }

  // ---- install-skill ----
  if (cmd === 'install-skill') {
    const { installSkill } = await import('./install-skill.mjs');
    const ok = await installSkill(o);
    process.exit(ok ? 0 : 1);
  }

  // ---- fetch（默认动作）----
  const target = o._[0];
  if (!target) die('请提供视频 BV号 / av号 / URL。用 `bili --help` 看用法。');

  let v;
  try {
    v = await fetchVideo(target, { page: o.page, summary: o.summary });
  } catch (e) {
    die(e.message || String(e));
  }

  // 字幕接口缺凭据时不会抛错，只是返回 need-login。这时才轮到扫码兜底：
  // 先问一声，别不打招呼就把二维码糊人脸上。
  if (v.noSubtitleReason === 'need-login' && !o.noLoginPrompt && !o.json) {
    if (await offerLogin()) {
      try {
        v = await fetchVideo(target, { page: o.page, summary: o.summary });
      } catch (e) { die(e.message || String(e)); }
    }
  }

  let text;
  if (o.json) {
    text = JSON.stringify({
      ok: true,
      bvid: v.bvid, title: v.title, part: v.part, page: v.page, pageCount: v.pageCount,
      duration: v.duration, uploader: v.uploader, url: v.url,
      subtitles: v.subtitles,
      lines: v.body,
      warning: v.warning,
      noSubtitleReason: v.noSubtitleReason || null,
      summary: v.summary,
    }, null, 2) + '\n';
  } else {
    text = renderText(v, { plain: o.plain, list: o.list });
  }

  if (o.out) {
    writeFileSync(o.out, text, 'utf8');
    console.log(`已写入 ${o.out}（${text.length} 字符，${v.body.length} 条字幕）`);
  } else {
    process.stdout.write(text);
  }
}

main().catch((e) => die(e.stack || String(e)));
