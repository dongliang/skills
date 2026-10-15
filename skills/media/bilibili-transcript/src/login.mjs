// 扫码登录 —— 纯命令行，不需要任何浏览器
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { encodeQR, renderText, writePNG } from './qr.mjs';
import { UA, API } from './api.mjs';
import { saveAuth, AUTH_PATH, findSessdata } from './auth.mjs';

const H = { 'User-Agent': UA, Referer: 'https://www.bilibili.com/' };
const QRAPI = 'https://passport.bilibili.com/x/passport-login/web/qrcode';
const KEYFILE = '/tmp/bili_qr.json';

/** 读 cookie 头。不同 Node 构建行为不一致：getSetCookie() 可能不存在，get() 可能返回数组 */
function readSetCookies(resp) {
  const h = resp.headers;
  if (typeof h.getSetCookie === 'function') {
    const v = h.getSetCookie();
    if (v && v.length) return v;
  }
  const raw = h.get('set-cookie');
  if (Array.isArray(raw)) return raw;
  return raw ? [raw] : [];
}

export async function whoami() {
  const nav = await (await fetch(`${API}/x/web-interface/nav`, { headers: H })).json();
  return nav.data?.isLogin ? nav.data : null;
}

export async function login({ png = null, qrOnly = false, resume = false, timeout = 180, force = false, log = console.log }) {
  if (!force && !resume && !qrOnly) {
    const who = await whoami().catch(() => null);
    if (who) {
      log(`已经登录过了：${who.uname}（uid ${who.mid}）`);
      log(`凭据位置：${AUTH_PATH}`);
      log('要重新登录请加 --force');
      return { alreadyLoggedIn: true, user: who };
    }
  }

  let url, key;
  if (resume) {
    if (!existsSync(KEYFILE)) throw new Error('没有找到之前生成的二维码，请先运行 `bili login --qr-only`');
    const s = JSON.parse(readFileSync(KEYFILE, 'utf8'));
    url = s.url; key = s.key;
    const age = Math.round((Date.now() - s.ts) / 1000);
    log(`沿用 ${age}s 前生成的二维码`);
    if (age > 170) log('⚠️ 已接近过期，若失败请重新生成');
  } else {
    const gen = await (await fetch(`${QRAPI}/generate`, { headers: H })).json();
    if (gen.code !== 0) throw new Error(`生成二维码失败：code=${gen.code} ${gen.message || ''}`);
    url = gen.data.url; key = gen.data.qrcode_key;
  }

  const matrix = encodeQR(url);

  if (!resume && !qrOnly) {
    log('\n用手机 B 站 App 扫码登录：\n');
    log(renderText(matrix));
    log(`链接：${url}\n`);
  }

  if (png) {
    const r = writePNG(matrix, png, { scale: 8, quiet: 4 });
    log(`二维码图片已写入 ${png}（${r.width}×${r.height}）`);
  }

  if (qrOnly) {
    writeFileSync(KEYFILE, JSON.stringify({ url, key, ts: Date.now() }) + '\n');
    log(`已保存二维码到 ${KEYFILE}。给用户看完后用 --resume 继续轮询。`);
    return { qrOnly: true, url, key, png };
  }

  log('等待扫码…（二维码约 3 分钟过期）');
  const deadline = Date.now() + timeout * 1000;
  const jar = {};
  let lastState = null;

  while (Date.now() < deadline) {
    let resp;
    try {
      resp = await fetch(`${QRAPI}/poll?qrcode_key=${key}`, { headers: H });
    } catch {
      await sleep(2000);
      continue;
    }
    for (const c of readSetCookies(resp)) {
      const nv = c.split(';')[0];
      const i = nv.indexOf('=');
      if (i > 0) jar[nv.slice(0, i)] = nv.slice(i + 1);
    }
    let body;
    try { body = await resp.json(); } catch { await sleep(2000); continue; }
    const code = body.data?.code;
    if (code !== lastState) {
      lastState = code;
      const label = { 86101: '未扫码', 86090: '已扫码，等待确认', 86038: '二维码已过期' }[code] || `code=${code}`;
      log(`  [${new Date().toTimeString().slice(0, 8)}] ${label}`);
    }
    if (code === 0) break;
    if (code === 86038) throw new Error('二维码已过期，请重新运行');
    await sleep(2000);
  }

  if (!jar.SESSDATA) throw new Error('超时，或没能拿到凭据。请重试。');

  saveAuth(jar);
  const who = await whoami().catch(() => null);

  log('\n=== 登录成功 ===');
  if (who) log(`  账号：${who.uname}（uid ${who.mid}）`);
  log(`  拿到 ${Object.keys(jar).length} 项凭据：${Object.keys(jar).join(', ')}`);
  log(`  已保存到 ${AUTH_PATH}（权限 0600）`);

  return { ok: true, user: who, cookies: Object.keys(jar) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
