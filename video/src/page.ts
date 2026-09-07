import type { ShortScript, Timeline } from './types.ts';

export interface PageInput {
  readonly script: ShortScript;
  readonly timeline: Timeline;
  readonly width: number;
  readonly height: number;
  /** 実ファイルを指す @font-face 定義。無い場合は system フォントにフォールバックする。 */
  readonly fontFaceCss: string;
}

const ACCENT_BY_HOOK: Readonly<Record<string, string>> = {
  損失回避: '#FF4D5E',
  逆張り: '#FFB020',
  具体的数字: '#25E0A7',
};

function escapeForScript(json: string): string {
  // </script> でドキュメントが閉じないようにする。
  return json.replace(/</g, '\\u003c');
}

/**
 * 決定論的にシークできる 1 枚の HTML を生成する。
 * CSS アニメーションは使わず、すべての見た目を `__seek(timeMs)` から計算する。
 * これによりフレーム単位のスクリーンショットが再現可能になる。
 */
export function buildPage(input: PageInput): string {
  const { script, timeline, width, height, fontFaceCss } = input;
  const accent = ACCENT_BY_HOOK[script.hookType] ?? '#25E0A7';
  const payload = escapeForScript(JSON.stringify({ script, timeline, accent }));

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<style>
${fontFaceCss}
:root {
  --accent: ${accent};
  --bg: #0A0E13;
  --text: #FFFFFF;
  --muted: rgba(255,255,255,0.62);
  --font: 'Noto Sans JP', 'IPAGothic', 'Hiragino Sans', sans-serif;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body {
  width: ${width}px; height: ${height}px; overflow: hidden;
  background: var(--bg); color: var(--text);
  font-family: var(--font); font-weight: 700;
  -webkit-font-smoothing: antialiased;
}
#stage { position: relative; width: ${width}px; height: ${height}px; }
#bg-glow {
  position: absolute; inset: -20%;
  background: radial-gradient(50% 40% at 50% 32%, rgba(255,255,255,0.10), transparent 70%);
}
#bg-accent {
  position: absolute; left: 50%; top: 44%;
  width: 1400px; height: 1400px; margin: -700px 0 0 -700px; border-radius: 50%;
  background: radial-gradient(circle, var(--accent) 0%, transparent 62%);
  opacity: 0.14;
}
#grid {
  position: absolute; inset: 0; opacity: 0.05;
  background-image: linear-gradient(rgba(255,255,255,0.9) 1px, transparent 1px),
                    linear-gradient(90deg, rgba(255,255,255,0.9) 1px, transparent 1px);
  background-size: 90px 90px;
}
#progress { position: absolute; top: 0; left: 0; height: 10px; background: var(--accent); }
#hook {
  position: absolute; left: 70px; width: ${width - 140}px;
  text-align: center; font-weight: 900; letter-spacing: 0.01em;
  line-height: 1.22; text-shadow: 0 18px 60px rgba(0,0,0,0.75);
  transform-origin: 50% 50%; white-space: pre-line; text-wrap: balance;
}
#hook-rule { height: 14px; background: var(--accent); margin: 34px auto 0; border-radius: 8px; }
#scene { position: absolute; left: 90px; top: 430px; width: ${width - 180}px; height: 880px; }
.card {
  position: absolute; left: 0; width: 100%;
  background: rgba(255,255,255,0.07); border: 2px solid rgba(255,255,255,0.14);
  border-radius: 28px; padding: 30px 38px; display: flex; align-items: center; gap: 26px;
}
.card .idx {
  width: 64px; height: 64px; flex: 0 0 64px; border-radius: 18px;
  background: var(--accent); color: #05080C; font-weight: 900; font-size: 36px;
  display: flex; align-items: center; justify-content: center;
}
.card .label { font-size: 46px; font-weight: 800; }
.card .detail { font-size: 30px; font-weight: 600; color: var(--muted); margin-top: 8px; }
#scene-caption {
  position: absolute; left: 0; bottom: -8px; width: 100%; text-align: center;
  font-size: 40px; font-weight: 800; color: var(--accent);
}
#donut { position: absolute; left: 50%; top: 40px; width: 520px; height: 520px; margin-left: -260px; border-radius: 50%; }
#donut-hole {
  position: absolute; left: 50%; top: 50%; width: 300px; height: 300px; margin: -150px 0 0 -150px;
  border-radius: 50%; background: var(--bg); display: flex; flex-direction: column;
  align-items: center; justify-content: center;
}
#donut-hole .v { font-size: 64px; font-weight: 900; }
#donut-hole .k { font-size: 28px; font-weight: 700; color: var(--muted); margin-top: 6px; }
.legend { position: absolute; display: flex; align-items: center; gap: 18px; font-size: 34px; font-weight: 700; }
.legend .dot { width: 26px; height: 26px; border-radius: 8px; }
.legend .amt { margin-left: auto; font-weight: 900; }
.bar-row { position: absolute; left: 0; width: 100%; }
.bar-row .head { display: flex; justify-content: space-between; font-size: 36px; font-weight: 800; margin-bottom: 14px; }
.bar-row .track { height: 76px; background: rgba(255,255,255,0.08); border-radius: 18px; overflow: hidden; }
.bar-row .fill { height: 100%; border-radius: 18px; }
#caption-band {
  position: absolute; left: 60px; width: ${width - 120}px; top: 1420px;
  display: flex; justify-content: center;
}
#caption {
  display: inline-block; max-width: 940px; text-align: center;
  background: rgba(6,9,13,0.72); border-radius: 26px; padding: 24px 34px;
  font-size: 56px; font-weight: 800; line-height: 1.42; word-break: keep-all;
  text-shadow: 0 6px 24px rgba(0,0,0,0.9);
}
#caption em { font-style: normal; color: var(--accent); }
#cta {
  position: absolute; left: 90px; width: ${width - 180}px; top: 700px;
  background: rgba(255,255,255,0.10); border: 3px solid var(--accent);
  border-radius: 34px; padding: 52px 44px; text-align: center;
}
#cta .k { font-size: 34px; font-weight: 800; color: var(--accent); letter-spacing: 0.14em; }
#cta .v { font-size: 62px; font-weight: 900; margin-top: 22px; line-height: 1.3; white-space: pre-line; }
#cta .arrow { font-size: 74px; margin-top: 30px; }
#disclaimer {
  position: absolute; left: 80px; width: ${width - 160}px; top: 1810px;
  font-size: 24px; font-weight: 600; color: rgba(255,255,255,0.55); text-align: center; line-height: 1.5;
}
</style>
</head>
<body>
<div id="stage">
  <div id="bg-glow"></div>
  <div id="bg-accent"></div>
  <div id="grid"></div>
  <div id="progress"></div>
  <div id="hook"><span id="hook-text"></span><div id="hook-rule"></div></div>
  <div id="scene"><div id="scene-caption"></div></div>
  <div id="cta"><div class="k">NEXT STEP</div><div class="v"></div><div class="arrow">▼</div></div>
  <div id="caption-band"><div id="caption"></div></div>
  <div id="disclaimer"></div>
</div>
<script>
const DATA = ${payload};
const W = ${width}, H = ${height};

const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
const easeOutCubic = (v) => 1 - Math.pow(1 - clamp01(v), 3);
const easeOutBack = (v) => { const c = 1.70158, t = clamp01(v) - 1; return 1 + (c + 1) * t * t * t + c * t * t; };
const lerp = (a, b, v) => a + (b - a) * v;
const since = (t, start, dur) => clamp01((t - start) / dur);

const el = (id) => document.getElementById(id);
const sectionByName = (name) => DATA.timeline.sections.find((s) => s.name === name);
const HOOK = sectionByName('hook');
const SOLUTION = sectionByName('solution');
const CTA = sectionByName('cta');
const TOTAL = DATA.timeline.totalMs;

function escapeHtml(text) {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function renderEmphasis(text) {
  return escapeHtml(text).replace(/\\*\\*(.+?)\\*\\*/g, '<em>$1</em>');
}

/* 日本語の字幕は自動折り返しに任せると語中で割れる。
   句読点を優先しつつ、行長が均等になる位置で明示的に改行する。 */
const ONE_LINE_CHARS = 14;
const NO_BREAK_BEFORE = '、。」）？！ぁぃぅぇぉっゃゅょゎーゝ・々';

function plainToRawIndex(text, plainIndex) {
  let plain = 0;
  for (let raw = 0; raw < text.length; raw += 1) {
    if (text[raw] === '*' && text[raw + 1] === '*') { raw += 1; continue; }
    if (plain === plainIndex) return raw;
    plain += 1;
  }
  return text.length;
}

function insideEmphasis(text, rawIndex) {
  let open = false;
  for (let raw = 0; raw + 1 < rawIndex; raw += 1) {
    if (text[raw] === '*' && text[raw + 1] === '*') { open = !open; raw += 1; }
  }
  return open;
}

function renderCaption(text) {
  const plain = text.replace(/\\*\\*/g, '');
  if (plain.length <= ONE_LINE_CHARS) return renderEmphasis(text);

  const mid = plain.length / 2;
  let best = -1;
  let bestScore = Infinity;
  for (let i = 1; i < plain.length; i += 1) {
    if (NO_BREAK_BEFORE.indexOf(plain[i]) >= 0) continue;
    const raw = plainToRawIndex(text, i);
    if (insideEmphasis(text, raw)) continue;
    const bonus = '、。'.indexOf(plain[i - 1]) >= 0 ? 6 : 0;
    const score = Math.abs(i - mid) - bonus;
    if (score < bestScore) { bestScore = score; best = i; }
  }
  if (best < 0) return renderEmphasis(text);

  const raw = plainToRawIndex(text, best);
  return renderEmphasis(text.slice(0, raw)) + '<br>' + renderEmphasis(text.slice(raw));
}

/* ---------- 静的な組み立て（1 回だけ） ---------- */
el('hook-text').textContent = DATA.script.telopFirstFrame;
el('disclaimer').textContent = DATA.script.disclaimer;
el('cta').querySelector('.v').textContent = DATA.script.ctaLabel;

const scene = el('scene');
const visual = DATA.script.visual;
const nodes = [];

function addCard(html, top) {
  const node = document.createElement('div');
  node.className = 'card';
  node.style.top = top + 'px';
  node.innerHTML = html;
  scene.appendChild(node);
  nodes.push(node);
  return node;
}

if (visual.kind === 'bullets' || visual.kind === 'steps') {
  const items = visual.kind === 'bullets'
    ? visual.items.map((label) => ({ label, detail: '' }))
    : visual.items;
  const gap = items.length > 3 ? 150 : 190;
  items.forEach((item, i) => {
    const detail = item.detail ? '<div class="detail">' + escapeHtml(item.detail) + '</div>' : '';
    addCard('<div class="idx">' + (i + 1) + '</div><div><div class="label">'
      + escapeHtml(item.label) + '</div>' + detail + '</div>', 40 + i * gap);
  });
} else if (visual.kind === 'donut') {
  const donut = document.createElement('div');
  donut.id = 'donut';
  const hole = document.createElement('div');
  hole.id = 'donut-hole';
  hole.innerHTML = '<div class="v"></div><div class="k"></div>';
  donut.appendChild(hole);
  scene.appendChild(donut);
  visual.slices.forEach((slice, i) => {
    const row = document.createElement('div');
    row.className = 'legend';
    row.style.left = '40px';
    row.style.width = (W - 260) + 'px';
    row.innerHTML = '<span class="dot"></span><span>' + escapeHtml(slice.label)
      + '</span><span class="amt">' + escapeHtml(slice.amount) + '</span>';
    scene.appendChild(row);
    nodes.push(row);
  });
} else if (visual.kind === 'bars') {
  visual.items.forEach((item, i) => {
    const row = document.createElement('div');
    row.className = 'bar-row';
    row.innerHTML = '<div class="head"><span>' + escapeHtml(item.label)
      + '</span><span class="num"></span></div><div class="track"><div class="fill"></div></div>';
    scene.appendChild(row);
    nodes.push(row);
  });
}
el('scene-caption').textContent = visual.caption;

/* 実寸を測ってからシーン内で縦方向に中央寄せする（カードの高さは内容で変わる）。 */
function centreScene() {
  const gap = visual.kind === 'bars' ? 76 : 34;
  if (visual.kind === 'donut') {
    const donut = el('donut');
    const legendGap = 66;
    const total = 520 + 60 + legendGap * nodes.length;
    const top = Math.max(0, (scene.clientHeight - 90 - total) / 2);
    donut.style.top = top + 'px';
    nodes.forEach((node, i) => { node.style.top = (top + 580 + i * legendGap) + 'px'; });
    return;
  }
  const heights = nodes.map((node) => node.offsetHeight);
  const total = heights.reduce((sum, h) => sum + h, 0) + gap * Math.max(nodes.length - 1, 0);
  let y = Math.max(0, (scene.clientHeight - 90 - total) / 2);
  nodes.forEach((node, i) => { node.style.top = y + 'px'; y += heights[i] + gap; });
}
centreScene();

/* ---------- フレームごとの描画 ---------- */
/* 縦型の小さい画面では桁が多い数字は読めない。1 万円以上は「万円」に丸める。 */
function formatValue(value, unit) {
  if (unit === '円' && value >= 10000) return Math.round(value / 10000).toLocaleString('ja-JP') + '万円';
  return value.toLocaleString('ja-JP') + unit;
}

const SLICE_COLORS = ['#25E0A7', '#4DA6FF', 'rgba(255,255,255,0.13)', '#FFB020', '#FF4D5E'];

function drawHook(t) {
  const hook = el('hook');
  const rule = el('hook-rule');
  const pin = since(t, HOOK.durationMs, 380);           // 中央 → 上部へピン留め
  const pop = easeOutBack(since(t, 0, 420));
  const size = lerp(126, 58, easeOutCubic(pin));
  const top = lerp(H * 0.34, 128, easeOutCubic(pin));
  hook.style.fontSize = size + 'px';
  hook.style.top = top + 'px';
  hook.style.transform = 'scale(' + lerp(0.86, 1, pop) + ')';
  hook.style.opacity = String(lerp(0, 1, since(t, 0, 220)));
  rule.style.width = lerp(0, lerp(560, 260, easeOutCubic(pin)), easeOutCubic(since(t, 240, 520))) + 'px';
  rule.style.marginTop = lerp(34, 20, pin) + 'px';
  rule.style.height = lerp(14, 8, pin) + 'px';
}

function drawScene(t) {
  const p = since(t, SOLUTION.startMs, SOLUTION.durationMs);
  const enter = since(t, SOLUTION.startMs - 200, 500);
  const exit = 1 - since(t, CTA.startMs - 200, 400);
  scene.style.opacity = String(Math.min(enter, exit));
  el('scene-caption').style.opacity = String(easeOutCubic(since(t, SOLUTION.startMs + SOLUTION.durationMs * 0.72, 400)));

  if (visual.kind === 'bullets' || visual.kind === 'steps') {
    nodes.forEach((node, i) => {
      const a = easeOutCubic(clamp01((p - i * 0.16) / 0.2));
      node.style.opacity = String(a);
      node.style.transform = 'translateX(' + lerp(70, 0, a) + 'px)';
      node.style.borderColor = a > 0.98 ? 'rgba(255,255,255,0.14)' : DATA.accent;
    });
  } else if (visual.kind === 'donut') {
    const sweep = easeOutCubic(clamp01(p / 0.55));
    let acc = 0;
    const stops = visual.slices.map((slice, i) => {
      const from = acc;
      acc += slice.percent * sweep;
      return SLICE_COLORS[i % SLICE_COLORS.length] + ' ' + from + '% ' + acc + '%';
    });
    const donut = el('donut');
    donut.style.background = 'conic-gradient(from -90deg, ' + stops.join(', ')
      + ', rgba(255,255,255,0.06) ' + acc + '% 100%)';
    const shown = Math.min(visual.slices.length - 1, Math.floor(p / 0.22));
    const hole = donut.querySelector('.v');
    const key = donut.querySelector('.k');
    const active = visual.slices[Math.max(0, shown)];
    hole.textContent = active.amount;
    key.textContent = active.label;
    nodes.forEach((node, i) => {
      const a = easeOutCubic(clamp01((p - 0.06 - i * 0.11) / 0.16));
      node.style.opacity = String(a);
      node.querySelector('.dot').style.background = SLICE_COLORS[i % SLICE_COLORS.length];
    });
  } else if (visual.kind === 'bars') {
    const max = Math.max.apply(null, visual.items.map((item) => item.value));
    nodes.forEach((node, i) => {
      const a = easeOutCubic(clamp01((p - i * 0.2) / 0.4));
      const item = visual.items[i];
      node.style.opacity = String(clamp01(a * 4));
      node.querySelector('.fill').style.width = (a * (item.value / max) * 100) + '%';
      node.querySelector('.fill').style.background = item.accent ? DATA.accent : 'rgba(255,255,255,0.30)';
      node.querySelector('.num').textContent = formatValue(Math.round(item.value * a), item.unit);
      node.querySelector('.num').style.color = item.accent ? DATA.accent : '#FFFFFF';
    });
  }
}

function drawCta(t) {
  const cta = el('cta');
  const a = easeOutBack(since(t, CTA.startMs, 420));
  const visible = t >= CTA.startMs - 100;
  cta.style.opacity = visible ? String(clamp01(since(t, CTA.startMs, 260))) : '0';
  cta.style.transform = 'scale(' + lerp(0.9, 1, clamp01(a)) + ')';
  const bounce = Math.sin((t - CTA.startMs) / 190) * 12;
  cta.querySelector('.arrow').style.transform = 'translateY(' + (visible ? bounce : 0) + 'px)';
}

function drawCaption(t) {
  let active = null;
  for (const section of DATA.timeline.sections) {
    if (section.name === 'hook') continue;   // フックは大テロップ側で見せる
    for (const caption of section.captions) {
      if (t >= caption.startMs && t < caption.endMs) active = caption;
    }
  }
  const band = el('caption');
  if (active === null) { band.style.opacity = '0'; return; }
  band.innerHTML = renderCaption(active.text);
  band.style.opacity = String(easeOutCubic(since(t, active.startMs, 140)));
  band.style.transform = 'translateY(' + lerp(16, 0, easeOutCubic(since(t, active.startMs, 200))) + 'px)';
}

function seek(t) {
  el('progress').style.width = (clamp01(t / TOTAL) * W) + 'px';
  el('bg-accent').style.opacity = String(0.10 + 0.06 * Math.sin(t / 900));
  el('disclaimer').style.opacity = String(easeOutCubic(since(t, HOOK.durationMs, 400)));
  drawHook(t);
  drawScene(t);
  drawCta(t);
  drawCaption(t);
}

window.__seek = seek;
seek(0);
</script>
</body>
</html>`;
}
