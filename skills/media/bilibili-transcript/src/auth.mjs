// 凭据管理 —— 查找、读取、保存、校验
import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { readBrowserCookies, WANTED } from './browser.mjs';

export const AUTH_PATH = join(homedir(), '.config', 'bili', 'auth.json');
export const COOKIE_DIR = '/var/minis/offloads';

export { WANTED };

/**
 * 按 环境变量 → auth.json → 本机浏览器 → Minis 导出文件 的顺序凑齐一组 cookie。
 *
 * 浏览器那级是只读、每次现取的，不写进 auth.json ——
 * auth.json 的语义是「用户显式登录的结果」，两者混起来会让人分不清
 * 到底是浏览器登出了还是缓存过期了。
 */
export function findCredentials() {
  const env = (process.env.BILI_SESSDATA || '').trim();
  if (env) return { jar: { SESSDATA: env }, source: 'env BILI_SESSDATA' };

  if (existsSync(AUTH_PATH)) {
    try {
      const c = JSON.parse(readFileSync(AUTH_PATH, 'utf8'));
      if (c.SESSDATA) return { jar: c, source: AUTH_PATH };
    } catch { /* 坏了就当没有 */ }
  }

  const fromBrowser = readBrowserCookies();
  if (fromBrowser) return { jar: fromBrowser.jar, source: `浏览器 ${fromBrowser.source}` };

  try {
    const files = readdirSync(COOKIE_DIR)
      .filter((f) => f.startsWith('env_cookies_bilibili'))
      .map((f) => join(COOKIE_DIR, f))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    if (files.length) {
      const m = readFileSync(files[0], 'utf8').match(/^(?:export\s+)?COOKIE_SESSDATA=(.+)$/m);
      if (m) {
        return {
          jar: { SESSDATA: m[1].trim().replace(/^["']|["']$/g, '') },
          source: files[0],
        };
      }
    }
  } catch { /* 目录不存在就算了 */ }

  return { jar: null, source: null };
}

/** 只要 SESSDATA 时的薄封装（doctor、错误提示等处用） */
export function findSessdata() {
  const { jar, source } = findCredentials();
  return { value: jar?.SESSDATA || null, source: jar ? source : null };
}

/** 拼成 Cookie 头。只发白名单里那几个，不把浏览器里 B 站的其他 cookie 全转发出去 */
export function cookieHeader(jar) {
  if (!jar) return null;
  const parts = WANTED.filter((n) => jar[n]).map((n) => `${n}=${jar[n]}`);
  return parts.length ? parts.join('; ') : null;
}

export function loadAuth() {
  if (!existsSync(AUTH_PATH)) return null;
  try { return JSON.parse(readFileSync(AUTH_PATH, 'utf8')); } catch { return null; }
}

export function saveAuth(jar) {
  mkdirSync(dirname(AUTH_PATH), { recursive: true });
  writeFileSync(AUTH_PATH, JSON.stringify(jar, null, 2) + '\n', 'utf8');
  try { chmodSync(AUTH_PATH, 0o600); } catch { /* 有的文件系统不支持，忽略 */ }
  return AUTH_PATH;
}
