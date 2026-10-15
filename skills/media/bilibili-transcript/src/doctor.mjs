// 自检 —— 一眼分清「接口变了」还是「该重新登录了」
import { API, getJson, wbiQuery, headers } from './api.mjs';
import { findSessdata, AUTH_PATH } from './auth.mjs';
import { probeBrowsers, sqliteBackendName } from './browser.mjs';

const R = { pass: 0, fail: 0, warn: 0 };
const ok = (m) => { R.pass++; console.log(`  ✅ ${m}`); };
const bad = (m) => { R.fail++; console.log(`  ❌ ${m}`); };
const soft = (m) => { R.warn++; console.log(`  ⚠️  ${m}`); };

export async function runDoctor({ json = false } = {}) {
  const log = json ? () => {} : console.log;

  log('\n== 运行时 ==');
  const major = Number(process.versions.node.split('.')[0]);
  major >= 18 ? ok(`Node ${process.versions.node}`) : bad(`Node ${process.versions.node} 太旧，需要 >=18（自带 fetch）`);
  typeof fetch === 'function' ? ok('全局 fetch 可用') : bad('没有全局 fetch');

  log('\n== 凭据 ==');
  const { value: sd, source } = findSessdata();
  if (sd) ok(`SESSDATA 长度 ${sd.length}，来自 ${source}`);
  else bad(`找不到凭据。运行 \`bili login\` 扫码登录（默认位置 ${AUTH_PATH}）`);

  log('\n== 浏览器 ==');
  const bp = probeBrowsers();
  const backend = sqliteBackendName();
  if (!backend) {
    soft(`读不了浏览器 cookie 库：${bp.reason}`);
  } else {
    const list = bp.found.map((b) => `${b.name}（${b.profile}）`).join('、');
    if (bp.hit) ok(`${bp.hit.name}（${bp.hit.profile}）—— 已从中取到凭据`);
    else if (bp.reason) soft(`${bp.reason}${list ? `（找到 ${list}）` : ''}`);
    else if (list) soft(`找到 ${list}，但没有 B 站登录态`);
    else soft('本机没找到浏览器 cookie 库');
  }

  if (sd) {
    log('\n== 凭据可用性 ==');
    const r = await getJson(`${API}/x/web-interface/nav`).catch(() => null);
    if (r && r.code === 0 && r.data.isLogin) ok(`已登录：${r.data.uname}（uid ${r.data.mid}）`);
    else if (r && r.code === -101) bad('凭据已失效，运行 `bili login --force` 重新登录');
    else bad(`nav 接口异常：${r ? 'code=' + r.code : '连不上'}`);
  }

  log('\n== 接口连通 ==');
  const BV = 'BV14Z4R6KEHS';   // 固定样本，便于跨时间对比
  const view = await getJson(`${API}/x/web-interface/view?bvid=${BV}`).catch(() => null);
  if (view && view.code === 0) ok(`view 接口正常（${String(view.data.title).slice(0, 20)}…）`);
  else { bad(`view 接口异常：${view ? 'code=' + view.code : '连不上'}`); return finish(json); }

  const { cid, aid, duration } = view.data;
  log('\n== 字幕接口 ==');
  let pv;
  try {
    const qs = await wbiQuery({ bvid: BV, cid, aid });
    pv = await getJson(`${API}/x/player/wbi/v2?${qs}`);
  } catch (e) { bad(`字幕接口请求失败：${e.message}`); return finish(json); }

  if (pv.code !== 0) {
    bad(`wbi/v2 异常 code=${pv.code} ${pv.message || ''}`);
  } else {
    const subs = pv.data.subtitle?.subtitles || [];
    subs.length ? ok(`wbi/v2 正常，${subs.length} 条字幕轨`)
                : bad(`wbi/v2 返回 0 条字幕轨（need_login=${pv.data.need_login_subtitle}）`);
    if (subs.length) {
      let u = subs[0].subtitle_url;
      if (u.startsWith('//')) u = 'https:' + u;
      const body = (await getJson(u).catch(() => null))?.body || [];
      body.length ? ok(`字幕正文可取（${body.length} 条）`) : bad('字幕正文取不到');
      if (body.length) {
        const end = Number(body[body.length - 1].to || 0);
        // 这一项是防「拿到别的视频字幕」的关键校验
        end >= duration * 0.7
          ? ok(`末条 ${end.toFixed(1)}s 贴合视频时长 ${duration}s（数据自洽）`)
          : bad(`末条只到 ${end.toFixed(1)}s，视频有 ${duration}s —— 可能拿到错误数据！`);
      }
    }
  }

  log('\n== AI 总结接口 ==');
  if (sd) {
    try {
      const qs = await wbiQuery({ bvid: BV, cid, up_mid: String(view.data.owner.mid) });
      const c = await getJson(`${API}/x/web-interface/view/conclusion/get?${qs}`);
      c.code === 0 && c.data ? ok('AI 总结可用') : soft(`AI 总结不可用 code=${c.code}`);
    } catch (e) { soft(`AI 总结请求失败：${e.message}`); }
  } else soft('无凭据，跳过');

  return finish(json);
}

function finish(json) {
  const line = `通过 ${R.pass} / ${R.pass + R.fail}${R.warn ? `（${R.warn} 条提示）` : ''}`;
  if (json) console.log(JSON.stringify({ ok: R.fail === 0, pass: R.pass, fail: R.fail, warn: R.warn }, null, 2));
  else console.log(`\n== 结果：${line} ==\n`);
  return R.fail === 0;
}
