// UI wiring: state → derived numbers → DOM and canvases.
import { WIDTHS, FOCALS, DESIGN_FS, EYEPIECES, BANDS, F_RANGE, F_STOPS, POSITION_NAMES, POSITION_NOTES, POSITION_PLACES,
  fmtF, fmtPct, fmtDeg } from './data.js';
import { HELP, GLOSSARY_KEYS } from './help.js';
import { DEFAULTS, PRESETS, loadInitial, persist, safeStorage } from './state.js';
import * as M from './model.js';
import { loadTexture, renderScene } from './render/scene.js';
import { renderFieldMap, probeField, renderRadial } from './render/fieldmap.js';
import { renderSpectrum } from './render/spectrum.js';
import { renderOverview, widthColor, interp } from './render/overview.js';
import { prepareRows, drawRays, phaseText, PHASES } from './render/rays.js';
import { palette, resetPalette, VIRIDIS_CSS } from './render/util.js';

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const narrow = matchMedia('(max-width: 900px)');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

let state = loadInitial();
if (!location.hash && !safeStorage.get('nvastro.state.v1') && narrow.matches) state.view = 'wipe';
let derived = null, metrics = null, fieldStats = null, ready = false, autoSwitched = false;

/* ---------------- Option groups ---------------- */
const OPTIONS = {
  focals: FOCALS.map(v => ({ value: v, label: String(v) })),
  widths: WIDTHS.map(v => ({ value: v, label: String(v) })),
  designs: DESIGN_FS.map(v => ({ value: v, label: fmtF(v) })),
  eyepieces: EYEPIECES.map(v => ({ value: v, label: v + ' mm' })),
  bands: BANDS.map(b => ({ value: b.value, label: b.label, title: b.note }))
};
for (const el of $$('[data-options]')) {
  for (const opt of OPTIONS[el.dataset.options]) {
    const b = document.createElement('button');
    b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.value = String(opt.value); b.textContent = opt.label;
    if (opt.title) b.title = opt.title;
    el.append(b);
  }
}
const NUMERIC = new Set(['focal', 'focalR', 'width', 'design', 'eyepiece', 'overviewSide']);
const parseValue = (key, raw) => NUMERIC.has(key) ? Number(raw) : raw;

// Generic radio-group behaviour for every [data-bind] segmented control / chip row.
for (const group of $$('[data-bind]')) {
  group.addEventListener('click', event => {
    const button = event.target.closest('button[data-value]');
    if (!button || button.disabled || !group.contains(button)) return;
    const key = group.dataset.bind;
    setState({ [key]: parseValue(key, button.dataset.value) }, { user: key });
  });
  group.addEventListener('keydown', event => {
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(event.key in keys)) return;
    const buttons = [...group.querySelectorAll('button[data-value]:not(:disabled)')];
    const index = buttons.findIndex(b => b.getAttribute('aria-checked') === 'true');
    const next = buttons[(index + keys[event.key] + buttons.length) % buttons.length];
    if (!next) return;
    event.preventDefault();
    next.click(); next.focus();
  });
}

function syncGroups() {
  for (const group of $$('[data-bind]')) {
    const value = String(state[group.dataset.bind]);
    for (const b of group.querySelectorAll('button[data-value]')) {
      const on = b.dataset.value === value;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
  }
}

/* ---------------- State ---------------- */
let persistTimer = 0;
function setState(patch, { draft = false, user = null, silent = false } = {}) {
  const prev = state;
  state = { ...state, ...patch };
  if (user === 'compare') autoSwitched = false;
  if (state.path === 'afocal' && state.compare === 'focal') {
    state.compare = 'position'; autoSwitched = true;
    if (!silent) toast('无焦模式固定用 600 mm 望远镜，不能比较焦距；已改为「位置」对比。');
  } else if (user === 'path' && prev.path === 'afocal' && state.path === 'direct' && autoSwitched) {
    state.compare = 'focal'; autoSwitched = false;
    if (!silent) toast('回到直焦，已恢复「焦距」对比。');
  }
  // Keep the off-axis angle within the widest cathode.
  const maxAngle = angleMax();
  const angleKey = state.path === 'afocal' ? 'angleAfocal' : 'angleDirect';
  if (state[angleKey] > maxAngle) state[angleKey] = maxAngle;
  schedule(draft);
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => persist(state), 250);
}

function angleMax() {
  const limits = M.angleLimits(state);
  return Math.floor(Math.max(...limits.map(l => l.edge)) * 10) / 10;
}

let frame = 0, pendingDraft = false, fullTimer = 0;
function schedule(draft = false) {
  pendingDraft = frame ? pendingDraft && draft : draft;
  if (!frame) frame = requestAnimationFrame(() => { frame = 0; render(pendingDraft); });
  clearTimeout(fullTimer);
  if (draft) fullTimer = setTimeout(() => schedule(false), 160);
}

/* ---------------- Controls ---------------- */
const fRange = $('#f-range'), angleRange = $('#angle-range');
function setFill(range) {
  const min = +range.min, max = +range.max;
  range.style.setProperty('--fill', ((+range.value - min) / (max - min || 1) * 100) + '%');
}

fRange.addEventListener('input', () => setState({ [state.path === 'afocal' ? 'fAfocal' : 'fDirect']: +fRange.value }, { draft: true }));
fRange.addEventListener('change', () => schedule(false));
angleRange.addEventListener('input', () => setState({ [state.path === 'afocal' ? 'angleAfocal' : 'angleDirect']: +angleRange.value }, { draft: true }));
angleRange.addEventListener('change', () => schedule(false));
$('#f-stops').addEventListener('click', event => {
  const b = event.target.closest('button[data-f]');
  if (b) setState({ [state.path === 'afocal' ? 'fAfocal' : 'fDirect']: +b.dataset.f });
});

function syncControls() {
  syncGroups();
  const afocal = state.path === 'afocal';
  const compare = M.effectiveCompare(state);
  const F = M.fNumberOf(state);
  const filterWord = state.filter === 'optimized' ? '按 ' + fmtF(state.design) + ' 优化的滤镜' : '普通滤镜';

  // Compare
  $('[data-bind="compare"] [data-value="focal"]').disabled = afocal;
  $('[data-bind="compare"] [data-value="focal"]').title = afocal ? '无焦模式固定用 600 mm 望远镜，不能比较焦距' : '';
  $('#compare-hint').innerHTML = compare === 'focal'
    ? '左右只差<strong>镜头焦距</strong>：同为' + POSITION_NAMES[state.pos].replace('滤镜', '') + '、' + fmtF(F) + '、' + filterWord + '。'
    : compare === 'position'
      ? '左右只差<strong>滤镜位置</strong>：同一片' + filterWord + '，同样的最终焦比与曝光。'
      : '左右只差<strong>滤镜设计</strong>：同样放在' + POSITION_PLACES[M.singlePosition(state)] + '，A 普通、B 按 ' + fmtF(state.design) + ' 预补偿。';

  // Position
  $('#pos-direct').hidden = afocal || compare === 'position';
  $('#pos-afocal').hidden = !afocal || compare === 'position';
  $('#pair-direct').hidden = afocal || compare !== 'position';
  $('#pair-afocal').hidden = !afocal || compare !== 'position';
  $('#position-hint').textContent = compare === 'position'
    ? (afocal ? (state.afocalPair === 'before'
      ? '两处都在汇聚光束里，但光锥宽度不同：目镜前是望远镜 F 值，夜视物镜后是最终成像焦比。'
      : '夜视物镜前是近似平行光（边缘倾角被目镜放大），物镜后再次汇聚成光锥。')
      : '前置接到平行光，后置接到镜头汇聚后的光锥。')
    : POSITION_NOTES[M.singlePosition(state)];

  // Lens
  $('#lens-title').textContent = afocal ? '无焦组合' : '镜头焦距';
  $('#focal-a-row').hidden = afocal;
  $('#focal-b-row').hidden = afocal || compare !== 'focal';
  $('#eyepiece-row').hidden = !afocal;
  $('#focal-a-label').innerHTML = compare === 'focal' ? '<span class="tag a">A</span>镜头' : '两图共用焦距（mm）';
  const geoFinal = M.geometry(M.baseConfig(state)).finalF;
  $('#lens-hint').textContent = afocal
    ? '600 mm 望远镜 + ' + state.eyepiece + ' mm 目镜 + 26 mm F1.2 夜视物镜，最终成像约 ' + fmtF(geoFinal) + '。'
    : '配 18 mm 阴极：焦距越短，看到的天区越宽，边缘入射角越大。';

  // F-number
  const [fMin, fMax] = afocal ? F_RANGE.afocal : F_RANGE.direct;
  fRange.min = fMin; fRange.max = fMax;
  if (+fRange.value !== F) fRange.value = F;
  setFill(fRange);
  $('#f-title').textContent = afocal ? '望远镜焦比' : '镜头焦比';
  $('#f-output').textContent = fmtF(F);
  const stops = F_STOPS[state.path];
  const stopsEl = $('#f-stops');
  if (stopsEl.dataset.path !== state.path) {
    stopsEl.dataset.path = state.path;
    stopsEl.replaceChildren(...stops.map(v => {
      const b = document.createElement('button'); b.type = 'button'; b.dataset.f = v; b.textContent = fmtF(v); return b;
    }));
  }
  for (const b of stopsEl.children) b.setAttribute('aria-pressed', String(Math.abs(+b.dataset.f - F) < 1e-6));
  const frontOnly = compare !== 'position' && M.singlePosition(state) === 'front';
  $('#f-hint').innerHTML = afocal
    ? '调的是望远镜；目镜与夜视物镜把最终成像焦比变为 <strong>' + fmtF(geoFinal) + '</strong>。'
    : frontOnly ? '前置时，中心天体的入射角<strong>与焦比无关</strong>；偏移主要看离轴角。'
      : 'F 后的数字越小，光锥越宽，<strong>后置</strong>滤镜遇到的斜光越多。';

  // Filter
  $('#filter-row').hidden = compare === 'design';
  const designUsed = compare === 'design' || state.filter === 'optimized';
  $('#design-row').hidden = !designUsed;
  $('#filter-hint').textContent = compare === 'design'
    ? 'A 普通滤镜；B 优化滤镜固定按 ' + fmtF(state.design) + ' 光锥预补偿，不随实际焦比变化。'
    : state.filter === 'optimized' ? '两图使用同一片按 ' + fmtF(state.design) + ' 预补偿的滤镜。' : '';

  // Off-axis angle
  const relevant = M.angleRelevant(state);
  $('#group-angle').hidden = !relevant;
  if (relevant) {
    const max = angleMax();
    const angle = M.angleOf(state);
    angleRange.max = max;
    if (+angleRange.value !== angle) angleRange.value = angle;
    setFill(angleRange);
    $('#angle-output').textContent = fmtDeg(angle);
    const preview = compare === 'position' ? M.pairPositions(state)[0] : M.singlePosition(state);
    $('#angle-title').textContent = preview === 'afocalBetween' ? '目镜输出角' : '目标离轴角';
    const limits = M.angleLimits(state);
    const marks = $('#angle-marks');
    marks.replaceChildren(...limits.map((l, i) => {
      const m = document.createElement('div');
      const frac = Math.min(1, l.edge / max);
      m.className = 'mark' + (frac > 0.9 ? ' edge-end' : '');
      m.style.left = (frac * 100) + '%';
      m.style.color = limits.length > 1 ? (i ? 'var(--side-b)' : 'var(--side-a)') : 'var(--text-3)';
      const label = document.createElement('span');
      label.textContent = (afocal ? '阴极边缘 ' : l.focalLength + ' mm 边缘 ') + fmtDeg(l.edge);
      m.append(label);
      return m;
    }));
    $('#angle-hint').textContent = preview === 'afocalBetween'
      ? '这是经过目镜放大后的角度，不是真实天区角。'
      : compare === 'focal' ? '两图看同一真实天区方向；超过某支镜头的边缘刻线，它就看不到这块天区。'
        : '0° 是正中心；往右拖，把这块星云移向视场边缘。';
  }
}

/* ---------------- Rendering ---------------- */
const sceneCanvases = [$('#scene-a'), $('#scene-b')];

function render(draft) {
  if (!ready) return;
  syncControls();
  derived = M.derive(state);
  const { configs, results, geometries, reference, labels, subtitles } = derived;
  metrics = configs.map((cfg, i) => renderScene(sceneCanvases[i], cfg, results[i], geometries[i], reference,
    { display: state.display, color: state.color, step: draft ? 2 : 1 }));
  fieldStats = configs.map(cfg => M.fieldStats(cfg));
  metrics.forEach((m, i) => { m.center = fieldStats[i].center; m.edge = fieldStats[i].edge; });

  ['a', 'b'].forEach((side, i) => {
    $('#label-' + side).textContent = labels[i];
    $('#sub-' + side).textContent = subtitles[i];
    sceneCanvases[i].setAttribute('aria-label', labels[i] + '下的 M42 模拟，' + subtitles[i] + '，对比度保留 ' + fmtPct(metrics[i].ratio));
    $('#single-label-' + side + ' .shot-name').textContent = labels[i];
  });
  $('#stage').dataset.view = state.view;
  composeSingle();
  renderKpis();
  renderInsight();
  renderCropNote();
  renderActiveTab(draft);
  $('#sr-status').textContent = labels.map((l, i) => l + ' 对比度保留 ' + fmtPct(metrics[i].ratio)).join('，');
}

function renderCropNote() {
  const notes = metrics.map((m, i) => !m.visibleFraction ? derived.labels[i] + '：此天区在视场外'
    : m.visibleFraction < 0.999 ? derived.labels[i] + '：特写只有一部分落在阴极内' : null).filter(Boolean);
  $('#crop-note').textContent = '两图是同一块约 30′ 天区的放大特写，统一放大、同一显示规则；实际视场大小见「全视场」。' + (notes.length ? ' ' + notes.join('；') + '。' : '');
}

/* KPI cards */
function buildKpis() {
  const html = side => `
    <article class="card kpi" data-side="${side}">
      <header class="kpi-head"><span class="tag ${side}">${side.toUpperCase()}</span><div><strong data-k="label"></strong><small data-k="sub"></small></div><span class="kpi-delta" data-k="delta" hidden></span></header>
      <div class="metric"><div class="metric-top"><span>对比度保留<button class="help-btn sm" type="button" data-help="contrast" aria-label="解释对比度保留"><svg class="i"><use href="#i-help"/></svg></button></span><output data-k="contrast"></output></div><div class="bar" data-k="contrast-bar"><i></i></div></div>
      <div class="metric secondary"><div class="metric-top"><span>主线透过<button class="help-btn sm" type="button" data-help="throughput" aria-label="解释主线透过"><svg class="i"><use href="#i-help"/></svg></button></span><output data-k="target"></output></div><div class="bar" data-k="target-bar"><i></i></div></div>
    </article>`;
  $('#kpis').innerHTML = html('a') + html('b');
}
function renderKpis() {
  const cards = $$('#kpis .kpi');
  cards.forEach((card, i) => {
    const m = metrics[i], r = derived.results[i];
    const q = k => card.querySelector('[data-k="' + k + '"]');
    q('label').textContent = derived.labels[i];
    q('sub').textContent = derived.subtitles[i];
    const target = m.targetVisible ? r.targetLineFraction : null;
    q('contrast').textContent = fmtPct(m.ratio);
    q('target').textContent = fmtPct(target);
    const bar = (el, v) => { el.querySelector('i').style.width = v == null ? '0' : Math.min(100, v * 100) + '%'; el.classList.toggle('over', v > 1); };
    bar(q('contrast-bar'), m.ratio); bar(q('target-bar'), target);
    const delta = q('delta');
    if (i === 1 && metrics[0].ratio && m.ratio != null) {
      const change = m.ratio / metrics[0].ratio - 1;
      delta.hidden = false;
      delta.className = 'kpi-delta ' + (change > 0.005 ? 'up' : change < -0.005 ? 'down' : '');
      delta.textContent = Math.abs(change) < 0.005 ? '与 A 相同' : '比 A ' + (change > 0 ? '+' : '−') + Math.round(Math.abs(change) * 100) + '%';
      delta.title = 'B 的对比度保留相对 A 的变化';
    } else delta.hidden = true;
  });
  const mini = metrics.map((m, i) => '<span><span class="tag ' + 'ab'[i] + '">' + 'AB'[i] + '</span> 对比 <b>' + fmtPct(m.ratio) + '</b></span>').join('');
  $('#sheet-mini').innerHTML = mini;
  $('#fab-mini').textContent = 'A ' + fmtPct(metrics[0].ratio) + ' · B ' + fmtPct(metrics[1].ratio);
}

function renderInsight() {
  const sentences = M.conclusion(derived, metrics);
  $('#insight').replaceChildren(...sentences.map(s => { const p = document.createElement('p'); p.textContent = s; return p; }));
  const rows = [
    ['光束', b => b.parallel ? '平行束' : '汇聚光锥'],
    ['滤镜处焦比', b => b.parallel ? '—' : fmtF(b.beamF)],
    ['入射角 / 光锥半角', b => fmtDeg(b.halfAngle)],
    ['通带平均蓝移', b => b.meanShift.toFixed(2) + ' nm'],
    ['通带最大蓝移', b => b.maxShift.toFixed(2) + ' nm'],
    ['红向预偏置', b => b.offsets.some(o => o.offset > 0) ? b.offsets.map(o => '+' + o.offset.toFixed(2) + ' nm').join(' / ') : '无'],
    ['最终成像焦比', b => fmtF(b.finalF)],
    ['特写张角', b => b.closeupSpan.toFixed(2) + '°']
  ];
  const head = '<thead><tr><th></th>' + derived.labels.map((l, i) => '<th><span class="tag ' + 'ab'[i] + '">' + 'AB'[i] + '</span> ' + l + '</th>').join('') + '</tr></thead>';
  const body = '<tbody>' + rows.map(([name, fn]) => '<tr><th>' + name + '</th>' + derived.beams.map(b => '<td>' + fn(b) + '</td>').join('') + '</tr>').join('') + '</tbody>';
  $('#beam-table').innerHTML = head + body;
}

/* Wipe / blink compositing */
const single = $('#scene-single'), singleCtx = single.getContext('2d');
let wipe = 50, blinkShowB = false, blinkTimer = 0, holdSwap = false;
function composeSingle() {
  if (state.view === 'side') { stopBlink(); return; }
  const [a, b] = sceneCanvases;
  singleCtx.clearRect(0, 0, 420, 420);
  if (state.view === 'wipe') {
    stopBlink();
    const x = Math.round(420 * wipe / 100);
    singleCtx.drawImage(b, 0, 0);
    if (x > 0) { singleCtx.clearRect(0, 0, x, 420); singleCtx.drawImage(a, 0, 0, x, 420, 0, 0, x, 420); }
    const handle = $('#wipe-handle');
    handle.style.left = wipe + '%';
    handle.setAttribute('aria-valuenow', String(Math.round(wipe)));
    handle.setAttribute('aria-valuetext', '左侧 ' + derived.labels[0] + ' 占 ' + Math.round(wipe) + '%');
    $('#single-label-a').hidden = wipe < 12; $('#single-label-b').hidden = wipe > 88;
  } else {
    startBlink();
    const showB = blinkShowB !== holdSwap;
    singleCtx.drawImage(showB ? b : a, 0, 0);
    $('#single-label-a').hidden = showB; $('#single-label-b').hidden = !showB;
    $('#single-label-b').classList.remove('right');
    $('#blink-hint').textContent = reduced.matches ? '点按图像切换 A / B' : '自动交替 · 按住图像停留在另一张';
  }
  if (state.view === 'wipe') $('#single-label-b').classList.add('right');
}
function startBlink() {
  if (blinkTimer || reduced.matches) return;
  blinkTimer = setInterval(() => { blinkShowB = !blinkShowB; composeSingle(); }, 1100);
}
function stopBlink() { clearInterval(blinkTimer); blinkTimer = 0; }

let drag = null;
single.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  if (state.view === 'blink') {
    if (reduced.matches) { blinkShowB = !blinkShowB; composeSingle(); return; }
    holdSwap = true; composeSingle(); single.setPointerCapture(event.pointerId); return;
  }
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY, active: event.pointerType === 'mouse' };
  if (drag.active) { single.setPointerCapture(event.pointerId); wipeTo(event.clientX); }
});
single.addEventListener('pointermove', event => {
  if (!drag || drag.id !== event.pointerId) return;
  const dx = Math.abs(event.clientX - drag.x), dy = Math.abs(event.clientY - drag.y);
  if (!drag.active && dy > dx && dy > 8) { drag = null; return; }
  if (!drag.active && dx > 6) { drag.active = true; single.setPointerCapture(event.pointerId); }
  if (drag.active) wipeTo(event.clientX);
});
const endDrag = event => {
  if (holdSwap) { holdSwap = false; composeSingle(); }
  if (drag && drag.id === event.pointerId) { if (event.type === 'pointerup') wipeTo(event.clientX); drag = null; }
};
single.addEventListener('pointerup', endDrag);
single.addEventListener('pointercancel', endDrag);
function wipeTo(clientX) {
  const r = single.getBoundingClientRect();
  wipe = Math.max(0, Math.min(100, (clientX - r.left) / r.width * 100));
  composeSingle();
}
$('#wipe-handle').addEventListener('keydown', event => {
  const step = event.shiftKey ? 10 : 2;
  const map = { ArrowLeft: -step, ArrowRight: step, Home: -100, End: 100 };
  if (!(event.key in map)) return;
  event.preventDefault();
  wipe = Math.max(0, Math.min(100, wipe + map[event.key]));
  composeSingle();
});

/* ---------------- Tabs ---------------- */
const TABS = ['spectrum', 'field', 'rays', 'overview'];
$('#tabs').addEventListener('click', event => {
  const b = event.target.closest('[data-tab]');
  if (b) setState({ tab: b.dataset.tab });
});
$('#tabs').addEventListener('keydown', event => {
  const d = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
  if (!d) return;
  const next = TABS[(TABS.indexOf(state.tab) + d + TABS.length) % TABS.length];
  setState({ tab: next });
  $('#tab-btn-' + next).focus();
});

function renderActiveTab(draft) {
  for (const t of TABS) {
    const on = t === state.tab;
    $('#tab-' + t).hidden = !on;
    const b = $('#tab-btn-' + t);
    b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
  }
  if (state.tab === 'spectrum') renderSpectrumTab(draft);
  else if (state.tab === 'field') { if (!draft) renderFieldTab(); }
  else if (state.tab === 'rays') renderRaysTab();
  else if (state.tab === 'overview') { if (!draft) renderOverviewTab(); }
}

function renderSpectrumTab(draft = false) {
  const p = palette();
  const legend = derived.labels.map((l, i) => {
    const c = i ? p.b : p.a;
    return `<span><i class="solid" style="background:${c}"></i>${'AB'[i]} · ${l} 有效通带</span>`;
  }).join('') + '<span><i class="dash"></i>正入射通带</span><span><i style="background:' + p.ha + '"></i>发射谱线</span>';
  $('#spectrum-legend').innerHTML = legend;
  const panels = M.spectrumPanels(derived);
  const height = narrow.matches ? (panels.length > 1 && $('#spectrum-canvas').clientWidth < 560 ? 460 : 260) : 300;
  renderSpectrum($('#spectrum-canvas'), panels, derived.configs.map((cfg, i) => ({ cfg, label: derived.labels[i] })), derived.results, height, draft);
  $('#spectrum-canvas').setAttribute('aria-label', '滤镜通带与发射谱线：' + derived.labels.map((l, i) => l + ' 主线透过 ' + fmtPct(derived.results[i].targetLineFraction)).join('，'));
}

function renderFieldTab() {
  $('#colorbar').hidden = state.fieldView !== 'transmission';
  $('#colorbar-ramp').style.background = VIRIDIS_CSS;
  derived.configs.forEach((cfg, i) => {
    const side = 'ab'[i], stats = fieldStats[i];
    renderFieldMap($('#field-' + side), cfg, stats, derived.targets[i], { view: state.fieldView, display: state.display });
    const suffix = M.effectiveCompare(state) === 'focal' ? ' · ' + fmtF(cfg.fNumber) : stats.g.afocal ? '' : ' · ' + cfg.focalLength + ' mm';
    $('#field-title-' + side).textContent = derived.labels[i] + suffix;
    const m = metrics[i];
    const warn = !m.visibleFraction ? 'M42 特写在视场外' : m.visibleFraction < 0.999 ? 'M42 特写部分超出视场' : '';
    $('#field-stats-' + side).innerHTML =
      `<div><dt>全视场</dt><dd>${(stats.g.halfSky * 2).toFixed(1)}°</dd></div>` +
      `<div><dt>中心透过</dt><dd>${fmtPct(stats.center, 1)}</dd></div>` +
      `<div><dt>边缘透过</dt><dd>${fmtPct(stats.edge, 1)}</dd></div>` + (warn ? `<p class="warn">${warn}</p>` : '');
    $('#field-' + side).setAttribute('aria-label', derived.labels[i] + '，全视场 ' + (stats.g.halfSky * 2).toFixed(1) + ' 度，中心透过 ' + fmtPct(stats.center, 1) + '，边缘透过 ' + fmtPct(stats.edge, 1));
  });
  renderRadial($('#radial-canvas'), fieldStats, derived.labels, M.angleRelevant(state) ? M.angleOf(state) : null);
}
['a', 'b'].forEach((side, i) => {
  const canvas = $('#field-' + side), probe = $('#probe-' + side);
  const move = event => {
    if (!fieldStats) return;
    const hit = probeField(fieldStats[i], canvas, event.clientX, event.clientY);
    if (!hit) { probe.hidden = true; return; }
    const r = canvas.getBoundingClientRect();
    probe.hidden = false;
    probe.style.left = (event.clientX - r.left) + 'px'; probe.style.top = (event.clientY - r.top) + 'px';
    probe.textContent = '离轴 ' + fmtDeg(hit.theta) + ' · 透过 ' + fmtPct(hit.t, 1);
  };
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerdown', move);
  canvas.addEventListener('pointerleave', () => { probe.hidden = true; });
});

/* Rays */
let rayRows = [], rayProgress = 1, rayAnim = 0, rayLoop = false, rayStart = 0;
const RAY_MS = 5400;
function rayRowsFor() {
  if (state.rayMode === 'principle') {
    const base = derived.configs[0];
    const configs = ['front', 'rear'].map(position => ({ ...base, position, fNumber: derived.geometries[0].finalF, angleDeg: 0, optimized: false, targetAngle: 0 }));
    return prepareRows(configs, ['前置：先过滤，再汇聚', '后置：先汇聚，再过滤']);
  }
  return prepareRows(derived.configs, derived.labels);
}
function renderRaysTab() {
  rayRows = rayRowsFor();
  const p = palette();
  const color = derived.base.filterKind === 'oiii' ? p.oiii : p.ha;
  drawRays($('#ray-canvas'), rayRows, rayProgress, color);
  $('#ray-phase').textContent = phaseText(rayRows, rayProgress);
  const name = derived.base.filterKind === 'oiii' ? 'OIII 500.7 nm' : 'Hα 656.3 nm';
  $('#ray-legend').innerHTML = `<span>非等比例示意</span><span><i style="background:#fff"></i>进入滤镜前</span><span><i style="background:${color}"></i>${name}：越暗＝透过越少</span><span><i class="dash"></i>滤镜法线</span>`;
  $('#ray-canvas').setAttribute('aria-label', rayRows.map(r => r.label + '，入射 ' + r.angle + '，透过 ' + fmtPct(r.transmission)).join('；'));
  $('#ray-scrub').value = Math.round(rayProgress * 1000);
  setScrubFill();
  $$('.step').forEach((b, k) => b.setAttribute('aria-pressed', String(rayProgress < 1 && rayProgress >= PHASES[k] && rayProgress < PHASES[k + 1])));
}
function setScrubFill() { setFill($('#ray-scrub')); }
function setPlayButton(playing) {
  $('#ray-play').innerHTML = `<svg class="i"><use href="#i-${playing ? 'pause' : 'play'}"/></svg><span>${playing ? '暂停' : (rayProgress >= 1 ? '播放' : '继续')}</span>`;
}
function stopRays() { cancelAnimationFrame(rayAnim); rayAnim = 0; setPlayButton(false); }
function playRays() {
  if (reduced.matches) { rayProgress = 1; renderRaysTab(); return; }
  if (rayProgress >= 1) rayProgress = 0;
  rayStart = performance.now() - rayProgress * RAY_MS;
  setPlayButton(true);
  const tick = now => {
    rayProgress = Math.min(1, (now - rayStart) / RAY_MS);
    if (state.tab === 'rays') renderRaysTab();
    if (rayProgress < 1) rayAnim = requestAnimationFrame(tick);
    else if (rayLoop) { rayAnim = requestAnimationFrame(t => { rayStart = t + 700; rayProgress = 0; tick(t); }); }
    else { rayAnim = 0; setPlayButton(false); }
  };
  rayAnim = requestAnimationFrame(tick);
}
$('#ray-play').addEventListener('click', () => rayAnim ? stopRays() : playRays());
$('#ray-scrub').addEventListener('input', event => { stopRays(); rayProgress = +event.target.value / 1000; renderRaysTab(); setPlayButton(false); });
$$('.step').forEach(b => b.addEventListener('click', () => {
  stopRays();
  const k = +b.dataset.step;
  rayProgress = (PHASES[k] + PHASES[k + 1]) / 2 + (k === 3 ? 0.08 : 0);
  renderRaysTab(); setPlayButton(false);
}));
$('#ray-loop').addEventListener('click', event => {
  rayLoop = !rayLoop; event.currentTarget.setAttribute('aria-pressed', String(rayLoop));
  if (rayLoop && !rayAnim) playRays();
});

/* Overview */
let overviewData = null, overviewScale = null;
function renderOverviewTab() {
  const sideEl = $('#overview-side');
  const signature = derived.labels.join('|');
  if (sideEl.dataset.sig !== signature) {
    sideEl.dataset.sig = signature;
    sideEl.replaceChildren(...derived.labels.map((l, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.value = String(i);
      b.innerHTML = '<span class="tag ' + 'ab'[i] + '">' + 'AB'[i] + '</span>' + l; return b;
    }));
    syncGroups();
  }
  const side = state.overviewSide;
  const cfg = derived.configs[side];
  overviewData = M.overview(cfg, state.overviewMetric);
  const x = overviewData.axis === 'f' ? M.fNumberOf(state) : cfg.angleDeg;
  const metricName = state.overviewMetric === 'contrast' ? '线/背景对比' : '主线透过';
  $('#overview-lead').innerHTML = overviewData.axis === 'f'
    ? `<strong>${derived.labels[side]}</strong>：${metricName}随${overviewData.xLabel}变化，每条线一档带宽。越往左焦比越快，窄带掉得越早。`
    : `<strong>${derived.labels[side]}</strong>在平行光里，透过率<strong>与焦比无关</strong>，所以横轴改为${overviewData.xLabel}。`;
  const legend = $('#overview-legend');
  legend.replaceChildren(...WIDTHS.map((w, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.w = w;
    b.setAttribute('aria-pressed', String(w === state.width));
    b.style.color = widthColor(i);
    b.innerHTML = `<i style="background:${widthColor(i)}"></i>${w} nm`;
    b.title = '切换到 ' + w + ' nm';
    return b;
  }));
  overviewScale = renderOverview($('#overview-canvas'), overviewData,
    { width: state.width, x, metric: state.overviewMetric, height: narrow.matches ? 280 : 340 });
  $('#overview-canvas').setAttribute('aria-label', metricName + '随' + overviewData.xLabel + '变化的曲线，共 ' + WIDTHS.length + ' 档带宽');
}
$('#overview-legend').addEventListener('click', event => {
  const b = event.target.closest('button[data-w]');
  if (b) setState({ width: +b.dataset.w });
});
$('#overview-canvas').addEventListener('pointermove', event => {
  if (!overviewData || !overviewScale) return;
  const canvas = event.currentTarget, r = canvas.getBoundingClientRect();
  const px = event.clientX - r.left;
  const { pad, width, invert } = overviewScale;
  const t = (px - pad.l) / (width - pad.l - pad.r);
  const tip = $('#overview-tip');
  if (t < 0 || t > 1) { tip.hidden = true; return; }
  const x = invert(px);
  const head = overviewData.axis === 'f' ? fmtF(x) : fmtDeg(x);
  tip.innerHTML = '<b>' + overviewData.xLabel + ' ' + head + '</b>' + overviewData.series.map((s, i) =>
    `<div class="${s.width === state.width ? 'cur' : ''}"><i style="background:${widthColor(i)}"></i>${s.width} nm<span style="margin-left:auto">${fmtPct(interp(overviewData.xs, s.ys, x))}</span></div>`).join('');
  tip.hidden = false;
  tip.style.left = Math.min(width - 170, Math.max(0, px + 14)) + 'px';
});
$('#overview-canvas').addEventListener('pointerleave', () => { $('#overview-tip').hidden = true; });

/* ---------------- Help popover ---------------- */
const popover = $('#popover');
let popTrigger = null;
function closePopover(restoreFocus = true) {
  if (popover.hidden) return;
  popover.hidden = true;
  if (popTrigger) { popTrigger.setAttribute('aria-expanded', 'false'); if (restoreFocus) popTrigger.focus(); }
  popTrigger = null;
}
function openPopover(key, trigger) {
  const entry = HELP[key];
  if (!entry) return;
  if (popTrigger === trigger) { closePopover(); return; }
  closePopover(false);
  popTrigger = trigger;
  trigger.setAttribute('aria-expanded', 'true');
  popover.innerHTML = '';
  const h = document.createElement('h3');
  h.id = 'popover-title'; h.textContent = entry[0];
  const close = document.createElement('button');
  close.className = 'icon-btn'; close.type = 'button'; close.setAttribute('aria-label', '关闭说明');
  close.innerHTML = '<svg class="i"><use href="#i-close"/></svg>';
  close.addEventListener('click', () => closePopover());
  h.append(close);
  popover.append(h, ...entry.slice(1).map(t => { const p = document.createElement('p'); p.textContent = t; return p; }));
  const more = document.createElement('button');
  more.className = 'more'; more.type = 'button'; more.innerHTML = '在词典中查看 <svg class="i"><use href="#i-book"/></svg>';
  more.addEventListener('click', () => { closePopover(false); showGlossary(key); });
  popover.append(more);
  popover.setAttribute('aria-labelledby', 'popover-title');
  popover.hidden = false;
  placeFloating(popover, trigger);
  close.focus({ preventScroll: true });
}
function placeFloating(el, anchor) {
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight, vw = innerWidth, vh = innerHeight;
  if (vw < 560) { el.style.left = '12px'; el.style.top = Math.max(12, vh - h - 12) + 'px'; return; }
  let left = Math.min(vw - w - 12, Math.max(12, r.left + r.width / 2 - w / 2));
  let top = r.bottom + 8;
  if (top + h > vh - 12) top = Math.max(12, r.top - h - 8);
  el.style.left = left + 'px'; el.style.top = top + 'px';
}
document.addEventListener('click', event => {
  const trigger = event.target.closest('[data-help]');
  if (trigger) { event.preventDefault(); openPopover(trigger.dataset.help, trigger); return; }
  if (!popover.hidden && !popover.contains(event.target)) closePopover(false);
  if (!menu.hidden && !menu.contains(event.target) && !event.target.closest('#presets-btn')) closeMenu();
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (!popover.hidden) closePopover();
  else if (!menu.hidden) closeMenu(true);
  else if ($('#panel').classList.contains('open')) closeSheet();
});
addEventListener('resize', () => { closePopover(false); closeMenu(); });

/* Glossary */
function buildGlossary() {
  const list = $('#glossary-list');
  for (const key of GLOSSARY_KEYS) {
    const entry = HELP[key];
    const d = document.createElement('details'); d.id = 'g-' + key;
    const s = document.createElement('summary');
    s.innerHTML = '<svg class="i"><use href="#i-chevron"/></svg>';
    s.append(entry[0]);
    d.append(s, ...entry.slice(1).map(t => { const p = document.createElement('p'); p.textContent = t; return p; }));
    d.dataset.search = entry.join(' ').toLowerCase();
    list.append(d);
  }
  const empty = document.createElement('p'); empty.className = 'glossary-empty'; empty.textContent = '没有找到相关词条。'; empty.hidden = true;
  list.append(empty);
  $('#glossary-search').addEventListener('input', event => {
    const q = event.target.value.trim().toLowerCase();
    let shown = 0;
    for (const d of list.querySelectorAll('details')) {
      const hit = !q || d.dataset.search.includes(q);
      d.hidden = !hit; if (hit) shown++;
      if (q && hit) d.open = true;
    }
    empty.hidden = shown > 0;
  });
}
function showGlossary(key) {
  const d = $('#g-' + key);
  if (!d) return;
  $('#glossary-search').value = '';
  $$('#glossary-list details').forEach(x => { x.hidden = false; });
  d.open = true;
  d.scrollIntoView({ behavior: reduced.matches ? 'auto' : 'smooth', block: 'center' });
  d.classList.remove('flash'); void d.offsetWidth; d.classList.add('flash');
  d.querySelector('summary').focus({ preventScroll: true });
}

/* ---------------- Presets, share, reset, theme ---------------- */
const menu = $('#presets-menu');
function presetButton(preset) {
  const b = document.createElement('button');
  b.type = 'button'; b.setAttribute('role', 'menuitem');
  b.innerHTML = `<svg class="i"><use href="#${preset.icon}"/></svg><strong></strong><small></small>`;
  b.querySelector('strong').textContent = preset.title;
  b.querySelector('small').textContent = preset.note;
  b.addEventListener('click', () => applyPreset(preset));
  return b;
}
function applyPreset(preset) {
  closeMenu();
  autoSwitched = false;
  stopRays(); rayProgress = 1;
  setState({ ...DEFAULTS, view: state.view, color: state.color, ...preset.patch }, { silent: true });
  toast('已切换到：' + preset.title);
  if (narrow.matches) $('.compare-card').scrollIntoView({ behavior: reduced.matches ? 'auto' : 'smooth' });
}
menu.append(...PRESETS.map(presetButton));
function closeMenu(focus = false) {
  if (menu.hidden) return;
  menu.hidden = true; $('#presets-btn').setAttribute('aria-expanded', 'false');
  if (focus) $('#presets-btn').focus();
}
$('#presets-btn').addEventListener('click', event => {
  if (!menu.hidden) { closeMenu(); return; }
  closePopover(false);
  menu.hidden = false; event.currentTarget.setAttribute('aria-expanded', 'true');
  placeFloating(menu, event.currentTarget);
  menu.querySelector('button').focus();
});
menu.addEventListener('keydown', event => {
  const items = [...menu.querySelectorAll('button')];
  const i = items.indexOf(document.activeElement);
  const d = { ArrowDown: 1, ArrowUp: -1 }[event.key];
  if (d) { event.preventDefault(); items[(i + d + items.length) % items.length].focus(); }
});

$('#share-btn').addEventListener('click', async () => {
  persist(state);
  try { await navigator.clipboard.writeText(location.href); toast('链接已复制，打开即可看到当前这组设置。'); }
  catch { prompt('复制下面的链接：', location.href); }
});
$('#reset-btn').addEventListener('click', () => {
  autoSwitched = false; stopRays(); rayProgress = 1;
  setState({ ...DEFAULTS, view: narrow.matches ? 'wipe' : 'side' }, { silent: true });
  toast('已恢复默认设置。');
});
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const btn = $('#theme-btn');
  btn.setAttribute('aria-pressed', String(theme === 'red'));
  btn.querySelector('span').textContent = theme === 'red' ? '星空配色' : '红光夜间';
  btn.querySelector('use').setAttribute('href', theme === 'red' ? '#i-moon' : '#i-night');
  btn.title = theme === 'red' ? '切回星空配色' : '红光夜间模式：只保留红色，不破坏暗适应';
  document.querySelector('meta[name="theme-color"]').content = theme === 'red' ? '#0a0000' : '#060913';
}
$('#theme-btn').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'red' ? 'dark' : 'red';
  safeStorage.set('nvastro.theme', next);
  applyTheme(next);
  toast(next === 'red' ? '红光夜间模式：画面只剩红色，适合观测现场。' : '已切回星空配色。');
});

let toastTimer = 0;
function toast(message) {
  const el = $('#toast');
  el.textContent = message; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

/* Intro */
function setupIntro() {
  if (safeStorage.get('nvastro.intro.dismissed') === '1') return;
  const intro = $('#intro');
  intro.hidden = false;
  if (narrow.matches) $('#intro p').textContent = '光斜着穿过干涉滤镜时，通带会往短波长移动，星云谱线可能被挡在门外。点右下角「调参数」，星云、通带和光路会立刻更新。';
  $('#intro-presets').append(...PRESETS.slice(0, 3).map(p => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn';
    b.innerHTML = `<svg class="i"><use href="#${p.icon}"/></svg><span></span>`;
    b.querySelector('span').textContent = '试试：' + p.title;
    b.addEventListener('click', () => applyPreset(p));
    return b;
  }));
  $('#intro-close').addEventListener('click', () => { intro.hidden = true; safeStorage.set('nvastro.intro.dismissed', '1'); });
}

/* Mobile bottom sheet */
const panel = $('#panel'), fab = $('#fab');
function openSheet() {
  panel.classList.add('open'); fab.setAttribute('aria-expanded', 'true');
  // Bring the comparison image right under the top bar so it stays visible above the sheet.
  const top = $('#stage').getBoundingClientRect().top - $('.topbar').offsetHeight - 6;
  if (Math.abs(top) > 4) scrollTo({ top: scrollY + top, behavior: reduced.matches ? 'auto' : 'smooth' });
  $('#sheet-close').focus({ preventScroll: true });
}
function closeSheet() { panel.classList.remove('open'); fab.setAttribute('aria-expanded', 'false'); fab.focus({ preventScroll: true }); }
fab.addEventListener('click', openSheet);
$('#sheet-close').addEventListener('click', closeSheet);
narrow.addEventListener('change', () => { if (!narrow.matches) panel.classList.remove('open'); schedule(); });

/* Resize and theme */
const resizeObserver = new ResizeObserver(() => { if (derived) renderActiveTab(false); });
['#spectrum-canvas', '#radial-canvas', '#ray-canvas', '#overview-canvas', '#field-a'].forEach(s => resizeObserver.observe($(s)));
reduced.addEventListener('change', () => { stopRays(); rayProgress = 1; stopBlink(); schedule(); });
addEventListener('hashchange', () => { state = loadInitial(); schedule(); });

/* ---------------- Boot ---------------- */
buildKpis();
buildGlossary();
setupIntro();
applyTheme(document.documentElement.dataset.theme === 'red' ? 'red' : 'dark');
setPlayButton(false);
resetPalette();
loadTexture('assets/m42-template.jpg').then(() => {
  ready = true;
  syncControls();
  render(false);
  document.body.dataset.ready = 'true';
}).catch(() => {
  $('#insight').textContent = '星云形态图加载失败，请刷新页面重试。';
});

// Exposed for debugging and reproducibility checks.
window.nvastro = {
  get state() { return state; }, get derived() { return derived; }, get metrics() { return metrics; }, setState,
  renderNow(draft = false) { cancelAnimationFrame(frame); frame = 0; render(draft); }
};
