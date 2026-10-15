// 从本机浏览器的 cookie 库读 B 站登录态
//
// 纯只读：不写任何浏览器文件，也不落盘任何 cookie。
// 只认 bilibili 域名下的 5 个白名单字段，其余一律不碰。
//
// 两条路：
//   Firefox  —— 明文存在 moz_cookies.value，一条 SQL 搞定
//   Chromium —— AES-128-CBC，密钥来自桌面密钥环
import { execFileSync } from 'node:child_process';
import { chmodSync, closeSync, copyFileSync, existsSync, mkdtempSync, openSync, readFileSync, readSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { createDecipheriv, createHash, pbkdf2Sync } from 'node:crypto';
import { createRequire } from 'node:module';

const HOME = homedir();
const XDG_CONFIG = process.env.XDG_CONFIG_HOME || join(HOME, '.config');

// Node ≥ 22.5 内置；老 Node 上拿不到，届时退到 sqlite3 CLI。
// 必须在这里同步取 —— openAndQuery() 是模块顶层函数，看不到别的函数里的局部变量。
let DatabaseSync = null;
try { ({ DatabaseSync } = createRequire(import.meta.url)('node:sqlite')); } catch { /* 老 Node */ }

/** 只取这几个，其余 B 站 cookie 一概不读 */
export const WANTED = ['SESSDATA', 'bili_jct', 'DedeUserID', 'DedeUserID__ckMd5', 'sid'];

/** Chromium 系的 profile 目录 → 密钥环里的 product name */
const CHROMIUM_BROWSERS = [
  { name: 'Chrome',   dir: 'google-chrome',                product: 'chrome' },
  { name: 'Chromium', dir: 'chromium',                     product: 'chromium' },
  { name: 'Edge',     dir: 'microsoft-edge',               product: 'microsoft-edge' },
  { name: 'Brave',    dir: 'BraveSoftware/Brave-Browser',  product: 'brave' },
  { name: 'Vivaldi',  dir: 'vivaldi',                      product: 'Vivaldi' },
  { name: 'Opera',    dir: 'opera',                        product: 'opera' },
];

// ---------------------------------------------------------------- SQLite

let _backend;        // undefined=未探测, null=不可用, 否则为读取函数
let _backendName;    // 'node:sqlite' | 'sqlite3'
let _backendWhy = '';

/**
 * 判断库是不是 WAL 模式 —— 读文件头第 18 字节（1=传统回滚日志，2=WAL）。
 *
 * 为什么非要先问这个：SQLite 打开 WAL 库时必须在同目录建 `-shm`（32KB）和
 * `-wal`，**只读模式也照建不误**，这是它的设计（官方文档明说只读 WAL 库需要
 * 可写目录）。浏览器运行时这两个文件本来就在，直读没影响；但浏览器干净退出后
 * 它们会被删掉，我们再直读就会凭空留下两个文件——等于偷偷写了用户的浏览器目录。
 * 实测确认过，不是理论风险。
 */
function isWal(dbPath) {
  let fd;
  try {
    fd = openSync(dbPath, 'r');
    const buf = Buffer.alloc(1);
    return readSync(fd, buf, 0, 1, 18) === 1 && buf[0] === 2;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) try { closeSync(fd); } catch { /* ignore */ }
  }
}

/**
 * 打开一个浏览器 cookie 库并跑一条查询。
 *
 * 分两级，因为两个目标会打架：
 *   1) 直接 `mode=ro` —— 快，且会带上 WAL 里的最新数据
 *   2) 库被浏览器锁住时（报 database is locked），退而复制 db + -wal + -shm
 *      三件套到临时目录再读
 *
 * WAL 库**一律**走第 2 级：直读会在浏览器目录里留下 -shm/-wal，属于副作用。
 * 复制一次约 45ms（Firefox 1.5MB 库），且每进程只读一遍，可以接受。
 *
 * ⚠️ 不要用 `?immutable=1` 抄近路。它声称「文件不会变」于是跳过 WAL，
 * 结果是**静默**读到过期数据 —— 实测用户刚登录完，immutable 拿到的是旧值，
 * 报错还好查，静默拿错值最难查。
 */
function openAndQuery(dbPath, sql) {
  const attempt = (uri) => {
    const db = new DatabaseSync(uri, { readOnly: true });
    try { return db.prepare(sql).all(); } finally { db.close(); }
  };

  // 非 WAL（Chrome 的 rollback journal）直读无副作用，先试这条快路
  if (!isWal(dbPath)) {
    try {
      return attempt(`file:${dbPath}?mode=ro`);
    } catch { /* 多半是被锁了，走复制 */ }
  }

  const tmp = mkdtempSync(join(tmpdir(), 'bili-ck-'));
  try {
    chmodSync(tmp, 0o700);
    for (const suffix of ['', '-wal', '-shm']) {
      const src = dbPath + suffix;
      if (existsSync(src)) copyFileSync(src, join(tmp, basename(dbPath) + suffix));
    }
    return attempt(join(tmp, basename(dbPath)));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** 同理，sqlite3 CLI 版 */
function openAndQueryCli(dbPath, sql) {
  const run = (target) => {
    const out = execFileSync('sqlite3', [target, '-json', sql],
                             { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    const t = out.trim();
    return t ? JSON.parse(t) : [];
  };

  if (!isWal(dbPath)) {
    try {
      return run(`file:${dbPath}?mode=ro`);
    } catch { /* 被锁，走复制 */ }
  }

  const tmp = mkdtempSync(join(tmpdir(), 'bili-ck-'));
  try {
    chmodSync(tmp, 0o700);
    for (const suffix of ['', '-wal', '-shm']) {
      const src = dbPath + suffix;
      if (existsSync(src)) copyFileSync(src, join(tmp, basename(dbPath) + suffix));
    }
    return run(join(tmp, basename(dbPath)));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function sqliteReader() {
  if (_backend !== undefined) return _backend;

  if (DatabaseSync) {
    _backend = (dbPath, sql) => openAndQuery(dbPath, sql);
    _backendName = 'node:sqlite';
    return _backend;
  }

  try {
    execFileSync('sqlite3', ['--version'], { stdio: 'ignore' });
    _backend = (dbPath, sql) => openAndQueryCli(dbPath, sql);
    _backendName = 'sqlite3';
    return _backend;
  } catch { /* 没装 sqlite3 */ }

  _backend = null;
  _backendName = null;
  _backendWhy = '需要 Node ≥ 22.5（内置 node:sqlite）或系统装有 sqlite3 命令';
  return _backend;
}

/** 给 doctor 用：当前走的哪条读库路径 */
export function sqliteBackendName() {
  sqliteReader();
  return _backendName;
}

// ---------------------------------------------------------------- 浏览器探测

function parseIni(text) {
  const secs = {};
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const h = line.match(/^\[(.+)\]$/);
    if (h) { cur = h[1]; secs[cur] = {}; continue; }
    const i = line.indexOf('=');
    if (i > 0 && cur) secs[cur][line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return secs;
}

/** Firefox 的 profile 目录名是随机的，得解析 profiles.ini 才知道用哪个 */
function firefoxCandidates() {
  const ini = join(XDG_CONFIG, 'mozilla', 'firefox', 'profiles.ini');
  if (!existsSync(ini)) return [];

  let secs;
  try { secs = parseIni(readFileSync(ini, 'utf8')); } catch { return []; }
  const base = dirname(ini);

  // 统一成绝对路径再收集。[Install*] 段给的是裸目录名，[Profile*] 段给的是
  // 可能相对的 Path —— 两种混在一起处理才不会拼出半截路径。
  const byName = (name) => {
    for (const [k, s] of Object.entries(secs)) {
      if (k.startsWith('Profile') && s.Path && (s.Path === name || s.Name === name)) {
        return s.IsRelative === '0' ? s.Path : join(base, s.Path);
      }
    }
    return join(base, name);   // [Install*] 的 Default= 就是目录名
  };

  const paths = [];
  // [Install*] 段是 Firefox 实际在用的，优先级最高
  for (const [k, s] of Object.entries(secs)) if (k.startsWith('Install') && s.Default) paths.push(byName(s.Default));
  for (const [k, s] of Object.entries(secs)) if (k.startsWith('Profile') && s.Default === '1' && s.Path) {
    paths.push(s.IsRelative === '0' ? s.Path : join(base, s.Path));
  }
  for (const [k, s] of Object.entries(secs)) if (k.startsWith('Profile') && s.Path) {
    paths.push(s.IsRelative === '0' ? s.Path : join(base, s.Path));
  }

  return [...new Set(paths)]
    .map((p) => ({ profile: p.split('/').pop(), dbPath: join(p, 'cookies.sqlite') }))
    .filter((x) => existsSync(x.dbPath));
}

/** Chromium 系：读 Local State 里的 last_used 定位实际 profile */
function chromiumProfileDir(root) {
  let prof = 'Default';
  try {
    const ls = JSON.parse(readFileSync(join(root, 'Local State'), 'utf8'));
    if (ls.profile?.last_used) prof = ls.profile.last_used;
  } catch { /* 读不到就用 Default */ }
  return prof;
}

/** 列出本机所有能读的浏览器 cookie 库（不校验有没有凭据） */
export function detectBrowsers() {
  const out = [];
  for (const c of firefoxCandidates()) {
    out.push({ kind: 'firefox', name: 'Firefox', profile: c.profile, dbPath: c.dbPath });
  }
  for (const b of CHROMIUM_BROWSERS) {
    const root = join(XDG_CONFIG, b.dir);
    if (!existsSync(root)) continue;
    const prof = chromiumProfileDir(root);
    const dbPath = join(root, prof, 'Cookies');
    if (existsSync(dbPath)) {
      out.push({ kind: 'chromium', name: b.name, product: b.product, profile: prof, dbPath });
    }
  }
  return out;
}

// ---------------------------------------------------------------- Chromium 解密

const SALT = 'saltysalt';
const IV = Buffer.alloc(16, 0x20);   // 16 个空格，不是 0
const KEYRING_SCHEMA = 'chrome_libsecret_os_crypt_password_v2';

function deriveKey(password, len = 16) {
  return pbkdf2Sync(password, SALT, 1, len, 'sha1');
}

/**
 * 解开一条 Chromium cookie 密文。解不开返回 null，**不抛异常** ——
 * 调用方要在一堆候选密钥里逐个试，一条解不开不能掐断整轮搜索。
 *
 * 密文布局（v10 / v11 都是这套）：
 *   [3 字节前缀 "v11"][AES-128-CBC 密文]
 * 明文布局：
 *   [32 字节 SHA256(host_key)][cookie 值][PKCS7 填充]
 *
 * 三个坑：前缀是 v11 但 Linux 上仍是标准方案；前 32 字节是域名哈希不是值；
 * 填充必须去掉，否则末尾多几个字节，nav 接口会报「连不上」。
 */
function decryptChromium(encBuf, key) {
  if (key.length !== 16) return null;              // aes-128-cbc 只收 16 字节密钥

  const prefix = encBuf.subarray(0, 3).toString('latin1');
  if (prefix !== 'v10' && prefix !== 'v11') return null;

  try {
    const d = createDecipheriv('aes-128-cbc', key, IV);
    d.setAutoPadding(false);                       // 手动去填充，顺便能校验
    const plain = Buffer.concat([d.update(encBuf.subarray(3)), d.final()]);

    const pad = plain[plain.length - 1];
    const body = pad >= 1 && pad <= 16 ? plain.subarray(0, plain.length - pad) : plain;
    if (body.length < 32) return null;

    return { hostHash: body.subarray(0, 32), value: body.subarray(32).toString('utf8') };
  } catch {
    return null;    // 密文截断、长度不是 16 的倍数等，都当解不开
  }
}

/** 密钥环密码候选：先按 product 精确查，再枚举所有 Safe Storage 兜底 */
function keyringPasswords(product) {
  const out = [];
  const push = (secret) => {
    if (secret && !out.includes(secret)) out.push(secret);
  };

  // 1) 精确查 —— 快，绝大多数情况一次命中
  try {
    const v = execFileSync('secret-tool', ['lookup', 'application', product],
                           { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    push(v);
  } catch { /* 没这条，往下枚举 */ }

  // 2) 枚举兜底 —— 有的浏览器 product name 和目录名对不上。
  //    注意条目头是 `[/18]`（带斜杠），不是 `[18]`，正则漏了斜杠就只切出 1 块。
  try {
    const all = execFileSync('secret-tool', ['search', '--all', 'xdg:schema', KEYRING_SCHEMA],
                             { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1024 * 1024 });
    for (const block of all.split(/\n(?=\[\/?\d+\])/)) {
      const m = block.match(/^secret = (.+)$/m);
      if (m) push(m[1].trim());
    }
  } catch { /* 没有密钥环 */ }

  return out;
}

/** 试出能解开这个库的密钥。用 SHA256(host_key) 前缀自证，不靠猜 */
function crackChromiumKey(product, probe) {
  for (const secret of keyringPasswords(product)) {
    // secret-tool 给的是 base64 文本，Chromium 就是拿这串文本当密码用；
    // 但个别版本存的是解码后的字节，两种都试。
    for (const pw of [Buffer.from(secret, 'utf8'), Buffer.from(secret, 'base64')]) {
      if (!pw.length) continue;
      // 只用 16 字节：Chromium 在 Linux 上就是 AES-128。别顺手加 32 ——
      // aes-128-cbc 传 32 字节密钥会抛 ERR_CRYPTO_INVALID_KEYLEN。
      const got = decryptChromium(Buffer.from(probe.ev, 'hex'), deriveKey(pw, 16));
      if (!got) continue;
      const want = createHash('sha256').update(probe.host_key).digest();
      if (got.hostHash.equals(want)) return deriveKey(pw, 16);
    }
  }
  return null;
}

// ---------------------------------------------------------------- 读取

const NAMES_IN = WANTED.map((n) => `'${n}'`).join(',');

// SQL 里的 like 只是廉价预筛，真正认不认这个域名由 isBilibiliHost() 说了算。
// 两边的表结构不同：Firefox 只有明文的 value，Chromium 只有密文的 encrypted_value
const FF_SQL = `select host as host_key, name, value
                  from moz_cookies
                 where host like '%bilibili%' and name in (${NAMES_IN})`;
const CR_SQL = `select host_key, name, hex(encrypted_value) as ev
                  from cookies
                 where host_key like '%bilibili%' and name in (${NAMES_IN})`;

/**
 * 严格判定是不是 B 站自己的域名。
 *
 * SQL 的 `like '%bilibili%'` 会放过 `bilibili.com.evil.com` 这类域，光靠它
 * 可能把别人的 cookie 当凭据发给 api.bilibili.com。这里按标签边界比：
 * 只认 bilibili.com / bilibili.cn 及其子域。
 */
function isBilibiliHost(host) {
  const h = String(host || '').replace(/^\./, '').toLowerCase();
  return h === 'bilibili.com' || h.endsWith('.bilibili.com')
      || h === 'bilibili.cn'  || h.endsWith('.bilibili.cn');
}

/** 排序用：越靠前越优先。.bilibili.com 是主域，其他子域次之 */
function hostRank(host) {
  const h = String(host || '').replace(/^\./, '').toLowerCase();
  if (h === 'bilibili.com') return 0;
  if (h.endsWith('.bilibili.com')) return 1;
  return 2;
}

/** 域名先过一遍白名单，再按主域优先取每个字段的第一条 */
function pickPreferred(rows, getValue) {
  const jar = {};
  const sorted = [...rows].sort((a, b) => hostRank(a.host_key) - hostRank(b.host_key));
  for (const r of sorted) {
    if (jar[r.name] || !WANTED.includes(r.name) || !isBilibiliHost(r.host_key)) continue;
    const v = getValue(r);
    if (v) jar[r.name] = v;
  }
  return jar;
}

function readFirefox(b, read) {
  const rows = read(b.dbPath, FF_SQL);
  // Firefox 明文，值直接取
  return { jar: pickPreferred(rows, (r) => r.value) };
}

function readChromium(b, read) {
  const rows = read(b.dbPath, CR_SQL);
  if (!rows.length) return {};

  // 拿一条密文当探针试密钥。优先 SESSDATA，但它要是正好损坏了，
  // 换别的行再试 —— 否则「密钥没问题、只是这一条坏了」会被误判成「取不到密钥环」。
  const probes = [
    ...rows.filter((r) => r.name === 'SESSDATA' && r.ev),
    ...rows.filter((r) => r.ev),
  ];

  let cracked = null;
  for (const p of probes) {
    cracked = crackChromiumKey(b.product, p);
    if (cracked) break;
  }
  if (!cracked) return { needKeyring: true };

  // 解出来还要拿 SHA256(host_key) 自证，解错的行当没有
  const jar = pickPreferred(rows, (r) => {
    if (!r.ev) return null;
    const got = decryptChromium(Buffer.from(r.ev, 'hex'), cracked);
    if (!got || !got.value) return null;
    const want = createHash('sha256').update(r.host_key).digest();
    return got.hostHash.equals(want) ? got.value : null;
  });
  return jar.SESSDATA ? { jar } : {};
}

let _cache;   // 一次进程内只读一遍，headers() 会被每个请求调到

/**
 * 主入口：扫一遍本机浏览器，第一个能拿到 SESSDATA 的就用它。
 * 全程只读，不落盘。
 */
export function readBrowserCookies() {
  if (_cache !== undefined) return _cache;

  // 用户明确说别碰浏览器时，整级跳过
  if (process.env.BILI_NO_BROWSER) { _cache = null; return null; }

  const read = sqliteReader();
  if (!read) { _cache = null; return null; }

  for (const b of detectBrowsers()) {
    let r;
    try {
      r = b.kind === 'firefox' ? readFirefox(b, read) : readChromium(b, read);
    } catch { continue; }        // 单个库读坏了不该拖垮整体
    if (r && r.jar && r.jar.SESSDATA) {
      _cache = { jar: r.jar, source: `${b.name}（${b.profile}）` };
      return _cache;
    }
  }

  _cache = null;
  return null;
}

/** 诊断用：本机浏览器状况，不含 cookie 值 */
export function probeBrowsers() {
  const found = detectBrowsers();
  if (process.env.BILI_NO_BROWSER) {
    return { found, readable: false, reason: 'BILI_NO_BROWSER 已设置，跳过', hit: null };
  }
  const read = sqliteReader();
  if (!read) return { found, readable: false, reason: _backendWhy, hit: null };

  const keyringMisses = [];
  for (const b of found) {
    try {
      const r = b.kind === 'firefox' ? readFirefox(b, read) : readChromium(b, read);
      if (r && r.jar && r.jar.SESSDATA) return { found, readable: true, hit: b, reason: null };
      // 别在这里 return —— 后面还有别的浏览器，可能那个才有登录态
      if (r && r.needKeyring) keyringMisses.push(b.name);
    } catch { /* 继续看下一个 */ }
  }
  if (keyringMisses.length) {
    return {
      found, readable: true, hit: null,
      reason: `${keyringMisses.join('、')}：取不到密钥环密码（缺 secret-tool 或未解锁）`,
    };
  }
  return { found, readable: true, hit: null, reason: found.length ? '浏览器里没有 B 站登录态' : null };
}
