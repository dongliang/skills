import { writeFileSync as _wfs } from 'node:fs';
import { deflateSync } from 'node:zlib';
// 纯 JS 二维码编码器 —— 零依赖
// 支持：字节模式、纠错等级 M、版本 1–10、自动选版本、掩码自动择优
// 正确性由 tests/qr-verify 与 Python qrcode 库逐模块比对验证

// ---------- GF(256) ----------
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
const gmul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

function rsGenPoly(n) {
  let p = [1];
  for (let i = 0; i < n; i++) {
    const q = [1, EXP[i]];
    const r = new Array(p.length + 1).fill(0);
    for (let a = 0; a < p.length; a++)
      for (let b = 0; b < 2; b++) r[a + b] ^= gmul(p[a], q[b]);
    p = r;
  }
  return p;
}

function rsEncode(data, ecLen) {
  const gen = rsGenPoly(ecLen);
  const res = new Array(data.length + ecLen).fill(0);
  data.forEach((v, i) => (res[i] = v));
  for (let i = 0; i < data.length; i++) {
    const coef = res[i];
    if (coef === 0) continue;
    for (let j = 0; j < gen.length; j++) res[i + j] ^= gmul(gen[j], coef);
  }
  return res.slice(data.length);
}

// ---------- 版本表（纠错等级 M，版本 1–10）----------
// [ [块数, 每块总码字, 每块数据码字], ... ]
const RS_M = {
  1:  [[1, 26, 16]],
  2:  [[1, 44, 28]],
  3:  [[1, 70, 44]],
  4:  [[2, 50, 32]],
  5:  [[2, 67, 43]],
  6:  [[4, 43, 27]],
  7:  [[4, 49, 31]],
  8:  [[2, 60, 38], [2, 61, 39]],
  9:  [[3, 58, 36], [2, 59, 37]],
  10: [[4, 69, 43], [1, 70, 44]],
};
const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
                6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };

function dataCapacity(v) {
  return RS_M[v].reduce((s, [n, , d]) => s + n * d, 0);
}
function ccBits(v) { return v <= 9 ? 8 : 16; }   // 字节模式字符计数指示符位数

// ---------- 比特流 ----------
class Bits {
  constructor() { this.arr = []; }
  put(val, len) { for (let i = len - 1; i >= 0; i--) this.arr.push((val >>> i) & 1); }
  get length() { return this.arr.length; }
}

function encodeData(bytes, v) {
  const cap = dataCapacity(v) * 8;
  const b = new Bits();
  b.put(0b0100, 4);                    // 字节模式
  b.put(bytes.length, ccBits(v));      // 字符数
  for (const x of bytes) b.put(x, 8);
  // 终止符
  const term = Math.min(4, cap - b.length);
  b.put(0, term);
  // 补齐到字节
  while (b.length % 8) b.arr.push(0);
  // 填充码字
  const pads = [0xec, 0x11];
  let i = 0;
  while (b.length < cap) { b.put(pads[i++ % 2], 8); }
  // 转成码字
  const out = [];
  for (let k = 0; k < b.length; k += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | b.arr[k + j];
    out.push(byte);
  }
  return out;
}

function interleave(dataCodewords, v) {
  const blocks = [];
  let off = 0;
  for (const [n, tot, dat] of RS_M[v]) {
    for (let i = 0; i < n; i++) {
      const d = dataCodewords.slice(off, off + dat); off += dat;
      blocks.push({ d, e: rsEncode(d, tot - dat) });
    }
  }
  const out = [];
  const maxD = Math.max(...blocks.map((b) => b.d.length));
  for (let i = 0; i < maxD; i++) for (const b of blocks) if (i < b.d.length) out.push(b.d[i]);
  const maxE = Math.max(...blocks.map((b) => b.e.length));
  for (let i = 0; i < maxE; i++) for (const b of blocks) if (i < b.e.length) out.push(b.e[i]);
  return out;
}

// ---------- 矩阵 ----------
function newMatrix(size) {
  return Array.from({ length: size }, () => new Array(size).fill(null));
}

function placeFinder(m, r, c) {
  for (let i = -1; i <= 7; i++) for (let j = -1; j <= 7; j++) {
    const y = r + i, x = c + j;
    if (y < 0 || x < 0 || y >= m.length || x >= m.length) continue;
    const on = (i >= 0 && i <= 6 && (j === 0 || j === 6)) ||
               (j >= 0 && j <= 6 && (i === 0 || i === 6)) ||
               (i >= 2 && i <= 4 && j >= 2 && j <= 4);
    m[y][x] = on;
  }
}

function placeAlignment(m, size, v) {
  const pos = ALIGN[v];
  for (const r of pos) for (const c of pos) {
    if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue;
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
      m[r + i][c + j] = Math.max(Math.abs(i), Math.abs(j)) !== 1;
    }
  }
}

function reservedMask(size, v) {
  const r = Array.from({ length: size }, () => new Array(size).fill(false));
  const mark = (rr, cc) => { if (rr >= 0 && cc >= 0 && rr < size && cc < size) r[rr][cc] = true; };
  // 定位图形 + 分隔符（锚点必须是 n-7，不是 n-8）
  for (const [y, x] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let i = -1; i <= 7; i++) for (let j = -1; j <= 7; j++) mark(y + i, x + j);
  }
  // 定时图形
  for (let i = 0; i < size; i++) { mark(6, i); mark(i, 6); }
  // 校正图形
  for (const rr of ALIGN[v]) for (const cc of ALIGN[v]) {
    if ((rr === 6 && cc === 6) || (rr === 6 && cc === size - 7) || (rr === size - 7 && cc === 6)) continue;
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) mark(rr + i, cc + j);
  }
  // 格式信息
  for (let i = 0; i <= 8; i++) { mark(8, i); mark(i, 8); }
  for (let i = 0; i < 8; i++) { mark(8, size - 1 - i); mark(size - 1 - i, 8); }
  // 版本信息（v>=7）
  if (v >= 7) {
    for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { mark(size - 11 + j, i); mark(i, size - 11 + j); }
  }
  return r;
}

function buildMatrix(v, codewords) {
  const size = 4 * v + 17;
  const m = newMatrix(size);
  const res = reservedMask(size, v);
  placeFinder(m, 0, 0); placeFinder(m, 0, size - 7); placeFinder(m, size - 7, 0);
  placeAlignment(m, size, v);
  for (let i = 8; i < size - 8; i++) { m[6][i] = i % 2 === 0; m[i][6] = i % 2 === 0; }
  m[size - 8][8] = true; // 固定暗模块

  // 数据按之字形填入
  const bits = [];
  for (const cw of codewords) for (let i = 7; i >= 0; i--) bits.push((cw >>> i) & 1);
  let bi = 0, up = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let k = 0; k < size; k++) {
      const row = up ? size - 1 - k : k;
      for (const c of [col, col - 1]) {
        if (res[row][c]) continue;
        m[row][c] = bi < bits.length ? bits[bi++] === 1 : false;
      }
    }
    up = !up;
  }
  return { m, res, size };
}

function maskFn(id, r, c) {
  switch (id) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
  }
}

function penalty(m, size) {
  let p = 0;
  // 规则 1：同色连续
  for (let r = 0; r < size; r++) {
    let run = 1;
    for (let c = 1; c < size; c++) {
      if (m[r][c] === m[r][c - 1]) run++; else { if (run >= 5) p += run - 2; run = 1; }
    }
    if (run >= 5) p += run - 2;
  }
  for (let c = 0; c < size; c++) {
    let run = 1;
    for (let r = 1; r < size; r++) {
      if (m[r][c] === m[r - 1][c]) run++; else { if (run >= 5) p += run - 2; run = 1; }
    }
    if (run >= 5) p += run - 2;
  }
  // 规则 2：2x2 同色块
  for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) {
    const v = m[r][c];
    if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) p += 3;
  }
  // 规则 3：1:1:3:1:1 图形
  const pat = [true, false, true, true, true, false, true];
  const check = (get) => {
    for (let i = 0; i + 7 <= size; i++) {
      let hit = true;
      for (let j = 0; j < 7; j++) if (get(i + j) !== pat[j]) { hit = false; break; }
      if (!hit) continue;
      const before = [i - 4, i - 3, i - 2, i - 1];
      const after = [i + 7, i + 8, i + 9, i + 10];
      const allQuiet = (idx) => idx.every((k) => k < 0 || k >= size || get(k) === false);
      if (allQuiet(before) || allQuiet(after)) p += 40;
    }
  };
  for (let r = 0; r < size; r++) check((i) => m[r][i]);
  for (let c = 0; c < size; c++) check((i) => m[i][c]);
  // 规则 4：暗模块比例
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (m[r][c]) dark++;
  const ratio = (dark * 100) / (size * size);
  p += Math.floor(Math.abs(ratio - 50) / 5) * 10;
  return p;
}

const BCH_FMT = 0x537, BCH_VER = 0x1f25;
function bch(data, gen, genBits) {
  let d = data << (genBits - 1);
  while (Math.floor(Math.log2(d)) >= genBits - 1) d ^= gen << (Math.floor(Math.log2(d)) - (genBits - 1));
  return ((data << (genBits - 1)) | d);
}

function applyFormat(m, size, ecBits, maskId) {
  const data = (ecBits << 3) | maskId;
  const f = bch(data, BCH_FMT, 11) ^ 0x5412;
  const bit = (i) => ((f >>> i) & 1) === 1;
  // 垂直（列 8）：b0-b5 在行 0-5，b6/b7 在行 7/8，b8-b14 在行 n-7..n-1
  for (let i = 0; i < 15; i++) {
    const v = bit(i);
    if (i < 6) m[i][8] = v;
    else if (i < 8) m[i + 1][8] = v;
    else m[size - 15 + i][8] = v;
  }
  // 水平（行 8）：b0-b7 在列 n-1..n-8，b8 在列 7，b9-b14 在列 5..0
  for (let i = 0; i < 15; i++) {
    const v = bit(i);
    if (i < 8) m[8][size - i - 1] = v;
    else if (i < 9) m[8][7] = v;
    else m[8][14 - i] = v;
  }
  m[size - 8][8] = true;   // 固定暗模块
}

function applyVersionInfo(m, size, v) {
  if (v < 7) return;
  let d = v;
  let rem = v;
  for (let i = 0; i < 12; i++) {
    rem = (rem << 1) ^ ((rem >>> 11) * BCH_VER);
  }
  const bits = (d << 12) | rem;
  for (let i = 0; i < 18; i++) {
    const b = ((bits >>> i) & 1) === 1;
    const r = Math.floor(i / 3), c = i % 3;
    m[size - 11 + c][r] = b;
    m[r][size - 11 + c] = b;
  }
}

/** 编码：返回二维布尔数组（true = 深色） */
export function encodeQR(text, { ecc = 'M', mask: forcedMask = null } = {}) {
  if (ecc !== 'M') throw new Error('只支持纠错等级 M');
  const bytes = [...Buffer.from(text, 'utf8')];
  let v = 1;
  // 头部位数：模式(4) + 计数(ccBits) ；需要字节对齐后的总位数 <= 容量
  for (v = 1; v <= 10; v++) {
    const need = 4 + ccBits(v) + bytes.length * 8;
    if (need <= dataCapacity(v) * 8) break;
  }
  if (v > 10) throw new Error('内容太长（超过版本 10 容量）');

  const dataCw = encodeData(bytes, v);
  const all = interleave(dataCw, v);
  const { m, res, size } = buildMatrix(v, all);

  // 掩码择优（forcedMask 用于测试）
  let best = null, bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    if (forcedMask !== null && mask !== forcedMask) continue;
    const t = m.map((row) => row.slice());
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
      if (res[r][c]) continue;
      if (maskFn(mask, r, c)) t[r][c] = !t[r][c];
    }
    applyVersionInfo(t, size, v);
    applyFormat(t, size, 0, mask);   // 纠错等级 M 的 ecBits = 0
    const s = penalty(t, size);
    if (s < bestScore) { bestScore = s; best = t; }
  }
  return best;
}

/** 渲染成文本（两个字符一行，便于终端显示） */
export function renderText(matrix, dark = '██', light = '  ') {
  return matrix.map((row) => row.map((b) => (b ? dark : light)).join('')).join('\n');
}

// ---------- 极简 PNG 写出（1 位灰度，零依赖）----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** 把矩阵写成 PNG 文件（白底黑点，带静默区） */
export function writePNG(matrix, path, { scale = 8, quiet = 4 } = {}) {
  const n = matrix.length;
  const w = (n + quiet * 2) * scale;
  const h = w;
  const rowBytes = Math.ceil(w / 8);
  const raw = Buffer.alloc((rowBytes + 1) * h, 0xff);   // 全白
  for (let y = 0; y < h; y++) raw[y * (rowBytes + 1)] = 0;  // 过滤器类型 0
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!matrix[r][c]) continue;
      for (let dy = 0; dy < scale; dy++) {
        const y = (r + quiet) * scale + dy;
        const base = y * (rowBytes + 1) + 1;
        for (let dx = 0; dx < scale; dx++) {
          const x = (c + quiet) * scale + dx;
          raw[base + (x >> 3)] &= ~(0x80 >> (x & 7));   // 置为黑
        }
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 1;   // 位深 1
  ihdr[9] = 0;   // 灰度
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  _wfs(path, png);
  return { width: w, height: h, bytes: png.length };
}

/** 调试用：导出中间产物 */
export function debugCodewords(text) {
  const bytes = [...Buffer.from(text, 'utf8')];
  let v = 1;
  for (v = 1; v <= 10; v++) {
    if (4 + ccBits(v) + bytes.length * 8 <= dataCapacity(v) * 8) break;
  }
  const dataCw = encodeData(bytes, v);
  return { version: v, dataCw, all: interleave(dataCw, v) };
}

/** 调试用：导出「非数据格」分布 */
export function debugReserved(version) {
  const size = 4 * version + 17;
  const res = reservedMask(size, version);
  return res.map((row) => row.map((b) => (b ? 1 : 0)).join(''));
}
