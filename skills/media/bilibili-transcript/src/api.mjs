// B 站接口封装 —— wbi 签名、请求、错误处理
import { createHash } from 'node:crypto';
import { findSessdata } from './auth.mjs';

export const API = 'https://api.bilibili.com';
export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const MIXIN_TAB = [
  46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,
  29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,
  22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52,
];

export function headers() {
  const h = { 'User-Agent': UA, Referer: 'https://www.bilibili.com/' };
  const { value } = findSessdata();
  if (value) h.Cookie = 'SESSDATA=' + value;
  return h;
}

export async function getJson(url, extraHeaders) {
  const r = await fetch(url, { headers: { ...headers(), ...(extraHeaders || {}) } });
  return r.json();
}

/** wbi 签名：w_rid = md5(排序后 query + mixin) */
export async function wbiQuery(params) {
  const nav = (await getJson(API + '/x/web-interface/nav')).data.wbi_img;
  const orig = nav.img_url.split('/').pop().split('.')[0] + nav.sub_url.split('/').pop().split('.')[0];
  const mixin = MIXIN_TAB.map((i) => orig[i]).join('').slice(0, 32);
  const p = { ...params, wts: Math.floor(Date.now() / 1000) };
  const enc = (o) => new URLSearchParams(Object.entries(o).sort((a, b) => (a[0] < b[0] ? -1 : 1))).toString();
  const q = enc(p).replace(/[!'()*]/g, '');
  p.w_rid = createHash('md5').update(q + mixin).digest('hex');
  return enc(p);
}

export class BiliError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'BiliError';
  }
}

export function check(r, what) {
  if (r.code !== 0) {
    if (r.code === -101) {
      throw new BiliError(-101, `${what}：账号未登录。请先运行 \`bili login\` 扫码登录。`);
    }
    throw new BiliError(r.code, `${what} 失败：code=${r.code} ${r.message || ''}`);
  }
  return r.data;
}

export function parseBvid(s) {
  let m = String(s).match(/BV[0-9A-Za-z]{10}/);
  if (m) return m[0];
  m = String(s).match(/av(\d+)/i);
  if (m) return 'av' + m[1];
  throw new BiliError('bad-input', `认不出视频号：${s}`);
}

/** 时间戳格式化：<1 分钟用 mm:ss.mmm，超过 1 小时用 hh:mm:ss.mmm */
export function ts(sec) {
  sec = Number(sec || 0);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const p = (n, w) => String(n).padStart(w, '0');
  const ms = p(Math.round((s % 1) * 1000), 3);
  return h ? `${p(h, 2)}:${p(m, 2)}:${p(Math.floor(s), 2)}.${ms}`
           : `${p(m, 2)}:${p(Math.floor(s), 2)}.${ms}`;
}
