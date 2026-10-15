// 提取字幕 / AI 总结 —— 核心逻辑，返回结构化数据
import { API, getJson, wbiQuery, check, parseBvid, ts } from './api.mjs';

/**
 * 取视频信息 + 字幕 +（可选）AI 总结
 * 返回结构化对象，由调用方决定怎么渲染。
 */
export async function fetchVideo(target, { page = 1, summary = false } = {}) {
  const vid = parseBvid(target);
  const view = check(
    await getJson(vid.startsWith('av')
      ? `${API}/x/web-interface/view?aid=${vid.slice(2)}`
      : `${API}/x/web-interface/view?bvid=${vid}`),
    '视频信息');

  const bvid = view.bvid;
  const pages = view.pages;
  if (page > pages.length) {
    const e = new Error(`该视频只有 ${pages.length} 个分P`);
    e.code = 'bad-page';
    throw e;
  }
  const pg = pages[page - 1];
  const aid = view.aid;
  const cid = pg.cid;

  const result = {
    bvid,
    aid,
    cid,
    title: view.title,
    part: pages.length > 1 ? pg.part : null,
    page,
    pageCount: pages.length,
    duration: pg.duration,
    uploader: view.owner.name,
    uploaderMid: view.owner.mid,
    url: `https://www.bilibili.com/video/${bvid}`,
    subtitles: [],
    // ⚠️ 只用 wbi 版。老接口 x/player/v2 会返回别的视频的字幕，绝不回退。
    body: [],
    warning: null,
    summary: null,
  };

  const pv = check(await getJson(`${API}/x/player/wbi/v2?${await wbiQuery({ bvid, cid, aid })}`), '字幕列表');
  const subs = (pv.subtitle && pv.subtitle.subtitles) || [];
  result.subtitles = subs.map((s) => ({
    lan: s.lan,
    lanDoc: s.lan_doc,
    url: s.subtitle_url && s.subtitle_url.startsWith('//') ? 'https:' + s.subtitle_url : s.subtitle_url,
  }));

  if (!subs.length) {
    result.noSubtitleReason = pv.need_login_subtitle ? 'need-login' : 'none-available';
    return result;
  }

  const items = (await getJson(result.subtitles[0].url)).body || [];
  result.body = items
    .filter((it) => (it.content || '').trim())
    .map((it) => ({ from: Number(it.from || 0), to: Number(it.to || 0), text: it.content.trim() }));

  // 数据自洽校验：防「拿到别的视频的字幕」
  if (result.body.length) {
    const end = result.body[result.body.length - 1].to;
    if (end < pg.duration * 0.7) {
      result.warning = `字幕只到 ${end.toFixed(0)}s，视频有 ${pg.duration}s，可能是分段轨或数据不匹配，请核对。`;
    }
  }

  if (summary) {
    try {
      const qs = await wbiQuery({ bvid, cid, up_mid: String(view.owner.mid) });
      const r = await getJson(`${API}/x/web-interface/view/conclusion/get?${qs}`);
      if (r.code === 0 && r.data) {
        const m = r.data.model_result || {};
        result.summary = {
          text: m.summary || '',
          outline: (m.outline || []).map((o) => ({
            title: o.title,
            points: (o.part_outline || []).map((pt) => ({
              timestamp: Number(pt.timestamp || 0),
              text: pt.content,
            })),
          })),
        };
      }
    } catch { /* 拿不到总结不算失败 */ }
  }

  return result;
}

/** 渲染成人读的文本 */
export function renderText(v, { plain = false, list = false } = {}) {
  const out = [];
  out.push('# ' + v.title + (v.part ? `  [P${v.page} ${v.part}]` : ''));
  out.push(`UP: ${v.uploader} | 时长 ${v.duration}s | ${v.url}`);

  if (v.noSubtitleReason === 'need-login') {
    out.push('\n[字幕接口要求登录：当前无有效凭据，拿不到字幕轨。运行 `bili login` 扫码登录]');
  } else if (v.noSubtitleReason === 'none-available') {
    out.push('\n[该视频没有字幕轨。纯音乐 / MV / CG 类视频通常没有。可加 --summary 试试 B 站的 AI 总结。]');
  }

  if (list) {
    if (!v.subtitles.length) out.push('该视频没有字幕轨。');
    for (const s of v.subtitles) out.push(`- ${s.lanDoc} (${s.lan}) ${s.url}`);
  }

  if (v.body.length) {
    out.push(`\n## 字幕：${v.subtitles[0].lanDoc || v.subtitles[0].lan}（${v.body.length} 条）\n`);
    if (v.warning) out.push(`⚠️ ${v.warning}\n`);
    for (const it of v.body) out.push(plain ? it.text : `[${ts(it.from)}] ${it.text}`);
  }

  if (v.summary) {
    out.push('\n## B站 AI 总结\n');
    if (v.summary.text) out.push(v.summary.text);
    for (const o of v.summary.outline) {
      out.push(`\n### ${o.title}`);
      for (const p of o.points) out.push(`- [${ts(p.timestamp)}] ${p.text}`);
    }
  }

  return out.join('\n') + '\n';
}
