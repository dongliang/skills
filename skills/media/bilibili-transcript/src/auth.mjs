// 凭据管理 —— 查找、读取、保存、校验
import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

export const AUTH_PATH = join(homedir(), '.config', 'bili', 'auth.json');
export const COOKIE_DIR = '/var/minis/offloads';

/** 按 环境变量 → auth.json → 浏览器导出文件 的顺序找 SESSDATA */
export function findSessdata() {
  const env = (process.env.BILI_SESSDATA || '').trim();
  if (env) return { value: env, source: 'env BILI_SESSDATA' };

  if (existsSync(AUTH_PATH)) {
    try {
      const c = JSON.parse(readFileSync(AUTH_PATH, 'utf8'));
      if (c.SESSDATA) return { value: c.SESSDATA, source: AUTH_PATH };
    } catch { /* 坏了就当没有 */ }
  }

  try {
    const files = readdirSync(COOKIE_DIR)
      .filter((f) => f.startsWith('env_cookies_bilibili'))
      .map((f) => join(COOKIE_DIR, f))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    if (files.length) {
      const m = readFileSync(files[0], 'utf8').match(/^(?:export\s+)?COOKIE_SESSDATA=(.+)$/m);
      if (m) return { value: m[1].trim().replace(/^["']|["']$/g, ''), source: files[0] };
    }
  } catch { /* 目录不存在就算了 */ }

  return { value: null, source: null };
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
