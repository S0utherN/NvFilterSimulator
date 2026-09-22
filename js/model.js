// Turns UI state into optics configs and derived numbers. No DOM access here.
import { LINES, NV_FOCAL, NV_F, N_EFF, PUPIL_SAMPLES, POSITION_NAMES, POSITION_PLACES, WIDTHS, F_RANGE, MAIN_LINE,
  FIELD, TELESCOPE_FOCAL, fmtF, fmtPct, fmtDeg } from './data.js';

const O = window.M42Optics;
const Fd = window.M42Field;
const DEG = Math.PI / 180;

// Small bounded memo for expensive, pure computations.
const caches = new Map();
export function memo(bucket, key, compute, limit = 48) {
  let cache = caches.get(bucket);
  if (!cache) caches.set(bucket, cache = new Map());
  if (cache.has(key)) return cache.get(key);
  const value = compute();
  cache.set(key, value);
  if (cache.size > limit) cache.delete(cache.keys().next().value);
  return value;
}
const keyOf = cfg => [cfg.position, cfg.fNumber, cfg.telescopeF, cfg.eyepieceFocal, cfg.width, cfg.filterKind,
  cfg.designF, cfg.optimized, cfg.angleDeg, cfg.focalLength, cfg.targetAngle, cfg.pupilSamples, cfg.mode || ''].join('|');

export const evaluate = cfg => memo('evaluate', keyOf(cfg), () => O.evaluate(cfg), 200);
export const geometry = cfg => O.geometry(cfg);

export function effectiveCompare(state) {
  return state.path === 'afocal' && state.compare === 'focal' ? 'position' : state.compare;
}

export function pairPositions(state) {
  return state.path === 'afocal'
    ? [state.afocalPair === 'before' ? 'afocalBefore' : 'afocalBetween', 'afocalAfter']
    : ['front', 'rear'];
}

export function singlePosition(state) {
  return state.path === 'afocal' ? state.afocalPos : state.pos;
}

export function fNumberOf(state) { return state.path === 'afocal' ? state.fAfocal : state.fDirect; }
export function angleOf(state) { return state.path === 'afocal' ? state.angleAfocal : state.angleDirect; }

// Whether the off-axis control matters for the current comparison.
export function angleRelevant(state) {
  const compare = effectiveCompare(state);
  const preview = compare === 'position' ? pairPositions(state)[0] : singlePosition(state);
  return ['front', 'afocalBetween'].includes(preview) || compare === 'focal';
}

export function baseConfig(state) {
  const F = fNumberOf(state);
  return {
    position: effectiveCompare(state) === 'position' ? pairPositions(state)[0] : singlePosition(state),
    fNumber: F, telescopeF: F, eyepieceFocal: state.eyepiece, nvFocal: NV_FOCAL, nvF: NV_F,
    width: state.width, filterKind: state.band, designF: state.design, nEff: N_EFF, optimized: false,
    lines: LINES, pupilSamples: PUPIL_SAMPLES, angleDeg: 0, focalLength: state.focal,
    targetAngle: angleRelevant(state) ? angleOf(state) : 0
  };
}

// Edge of the 18 mm cathode, in the angle coordinate of the off-axis slider.
export function angleLimits(state) {
  const base = baseConfig(state);
  const focals = effectiveCompare(state) === 'focal' ? [state.focal, state.focalR] : [state.focal];
  return focals.map(focalLength => ({ focalLength, edge: Fd.geometry({ ...base, focalLength }).halfControl }));
}

export function derive(state) {
  const compare = effectiveCompare(state);
  const base = baseConfig(state);
  const withAngle = c => ({ ...c, angleDeg: O.geometry(c).mode === 'parallel' ? c.targetAngle : 0 });
  const optimized = state.filter === 'optimized';
  let configs, labels;
  if (compare === 'focal') {
    configs = [state.focal, state.focalR].map(focalLength => withAngle({ ...base, focalLength, optimized }));
    labels = configs.map(c => c.focalLength + ' mm');
  } else if (compare === 'position') {
    configs = pairPositions(state).map(position => withAngle({ ...base, position, optimized }));
    labels = configs.map(c => POSITION_NAMES[c.position]);
  } else {
    configs = [false, true].map(o => withAngle({ ...base, optimized: o }));
    labels = ['普通滤镜', '优化滤镜'];
  }
  const geometries = configs.map(c => O.geometry(c));
  const results = configs.map(c => evaluate(c));
  const reference = evaluate({ ...base, position: 'ideal', mode: 'ideal', optimized: false, angleDeg: 0 });
  const beams = configs.map((c, i) => beamInfo(c, geometries[i], results[i]));
  const subtitles = configs.map((c, i) => compare === 'focal'
    ? POSITION_NAMES[c.position] + ' · ' + fmtF(c.fNumber)
    : compare === 'position' ? beams[i].short
      : i ? '按 ' + fmtF(c.designF) + ' 预补偿' : '正入射时对准谱线');
  return { compare, base, configs, geometries, results, reference, labels, subtitles, beams,
    fields: configs.map(c => Fd.geometry(c)), targets: configs.map(c => Fd.target(c)) };
}

// Axis and cathode-edge transmission plus the radial lookup table used by the field map.
export function fieldStats(cfg) {
  const g = Fd.geometry(cfg), optical = O.geometry(cfg), parallel = optical.mode === 'parallel';
  const base = { ...cfg, angleDeg: 0 };
  return memo('field', keyOf(base) + '|' + g.halfControl, () => {
    const centerResult = O.evaluate(base);
    const edge = O.evaluate({ ...base, angleDeg: parallel ? g.halfControl : 0 }).targetLineFraction;
    const profile = parallel ? O.radialProfile(base, { bins: 512, maxAngleDeg: g.halfControl }) : null;
    return { g, optical, parallel, centerResult, center: centerResult.targetLineFraction, edge, profile };
  }, 24);
}

// Human-readable description of the light reaching a filter.
export function beamInfo(cfg, geo, result) {
  const primary = result.bands[0];
  const parallel = geo.mode === 'parallel';
  const halfAngle = parallel ? cfg.angleDeg : Math.asin(1 / (2 * geo.beamF)) / DEG;
  const qMax = Math.sqrt(1 - Math.sin(halfAngle * DEG) ** 2 / (N_EFF * N_EFF));
  const meanShift = primary.center * (1 - result.meanQ);
  const maxShift = primary.center * (1 - qMax);
  return {
    parallel, halfAngle, meanShift, maxShift, beamF: geo.beamF, finalF: geo.finalF,
    offsets: result.bands.map(b => ({ line: b.line, offset: b.offset })),
    short: parallel ? '平行束 · 入射 ' + fmtDeg(halfAngle) : '光锥 ' + fmtF(geo.beamF) + ' · 半角 ' + fmtDeg(halfAngle),
    closeupSpan: FIELD * (cfg.position === 'afocalBetween' ? TELESCOPE_FOCAL / cfg.eyepieceFocal : 1)
  };
}

const bandName = kind => ({ ha: 'Hα', oiii: 'OIII', dual: 'Hα + OIII' })[kind];

// Plain-language conclusion for the current pair.
export function conclusion(d, metrics) {
  const [a, b] = d.results, [ca, cb] = d.configs, [ba, bb] = d.beams;
  const [la, lb] = d.labels;
  const filterText = ca.optimized === cb.optimized
    ? (ca.optimized ? '按 ' + fmtF(ca.designF) + ' 优化的 ' : '普通 ')
    : '';
  const band = ca.width + ' nm ' + bandName(ca.filterKind) + ' ';
  const ta = metrics[0].targetVisible ? a.targetLineFraction : null;
  const tb = metrics[1].targetVisible ? b.targetLineFraction : null;
  const sentences = [];
  const why = (label, beam) => beam.parallel
    ? label + '接到平行光，整束以 ' + fmtDeg(beam.halfAngle) + ' 入射，通带蓝移约 ' + beam.meanShift.toFixed(1) + ' nm'
    : label + '处在 ' + fmtF(beam.beamF) + ' 光锥里，最斜的光有 ' + fmtDeg(beam.halfAngle) + '，通带平均蓝移约 ' + beam.meanShift.toFixed(1) + ' nm（最多 ' + beam.maxShift.toFixed(1) + ' nm）';

  if (d.compare === 'design') {
    const off = bb.offsets.map(o => (o.line > 600 ? 'Hα' : 'OIII') + ' +' + o.offset.toFixed(2) + ' nm').join('、');
    sentences.push('同样放在' + POSITION_PLACES[ca.position] + '，' + band.trim() + '：普通滤镜主线透过 ' + fmtPct(ta) + '，按 ' + fmtF(cb.designF) + ' 预补偿（' + off + '）的优化滤镜为 ' + fmtPct(tb) + '。');
    if (ta != null && tb != null) sentences.push(tb > ta + 0.01
      ? '预偏置抵消了一部分蓝移，所以优化滤镜更亮。'
      : tb < ta - 0.01 ? '这里的斜光不足以把预偏的通带拉回来，优化滤镜反而更暗。' : '两者几乎相同。');
    sentences.push(why('这个位置', ba) + '。');
  } else if (d.compare === 'focal') {
    const fa = d.fields[0], fb = d.fields[1];
    sentences.push('同样 ' + fmtF(ca.fNumber) + '、' + (filterText + band).trim() + '：' + la + ' 全视场 ' + (fa.halfSky * 2).toFixed(1) + '°，' + lb + ' 只有 ' + (fb.halfSky * 2).toFixed(1) + '°。');
    const edges = metrics.map(m => m.edge);
    if (ca.position === 'front') sentences.push('前置时，阴极最边缘的主线透过：' + la + ' ' + fmtPct(edges[0]) + '，' + lb + ' ' + fmtPct(edges[1]) + '。短焦把更斜的天区收进画面，边缘先变暗。');
    else sentences.push('滤镜在光锥里时，两支镜头同焦比、同光锥，损失相同（' + fmtPct(ta ?? tb) + '）；差别只在能看多宽。');
    const outside = metrics.map((m, i) => !m.targetVisible ? d.labels[i] : null).filter(Boolean);
    if (outside.length) sentences.push('当前离轴角下，' + outside.join('、') + ' 已经看不到这块天区。');
  } else {
    sentences.push('同一片' + filterText + band + '滤镜：' + la + '主线透过 ' + fmtPct(ta) + '，' + lb + ' ' + fmtPct(tb) + '。');
    sentences.push(why(la, ba) + '；' + why(lb, bb) + '。');
    if (ta != null && tb != null && Math.abs(ta - tb) > 0.02) {
      const worse = ta < tb ? la : lb;
      sentences.push(worse + '把目标谱线挤到了通带边缘，留下的光更少。');
    }
  }
  const ra = metrics[0].ratio, rb = metrics[1].ratio;
  if (ra != null && rb != null) sentences.push('星云相对天空的对比度：' + la + ' ' + fmtPct(ra) + '，' + lb + ' ' + fmtPct(rb) + '（相对无偏移的同带宽滤镜）。');
  return sentences;
}

// Main-line transmission curves for every bandwidth. Cone positions sweep the F-number;
// parallel positions are F-independent, so they sweep the off-axis angle instead.
export function overview(cfg, metric) {
  const geo = O.geometry(cfg);
  const parallel = geo.mode === 'parallel';
  const afocal = cfg.position.startsWith('afocal');
  const key = [cfg.position, cfg.filterKind, cfg.optimized, cfg.designF, cfg.eyepieceFocal, metric, parallel].join('|');
  return memo('overview', key, () => {
    const quantity = metric === 'contrast' ? 'contrastRatioToNominal' : 'targetLineFraction';
    if (parallel) {
      const maxAngle = 20, bins = 81;
      const xs = Array.from({ length: bins }, (_, i) => maxAngle * i / (bins - 1));
      const series = WIDTHS.map(width => {
        const profile = O.radialProfile({ ...cfg, width, angleDeg: 0 }, { bins, maxAngleDeg: maxAngle });
        return { width, ys: Array.from(profile[quantity]) };
      });
      return { axis: 'angle', xs, series, xLabel: afocal ? '目镜输出角' : '离轴角' };
    }
    const [lo, hi] = afocal ? F_RANGE.afocal : F_RANGE.direct;
    const xs = [];
    for (let f = lo; f <= hi + 1e-9; f += (f < 2 ? 0.025 : 0.1)) xs.push(Number(f.toFixed(3)));
    const series = WIDTHS.map(width => ({ width, ys: xs.map(f =>
      O.evaluate({ ...cfg, width, fNumber: f, telescopeF: f, angleDeg: 0, pupilSamples: 160 })[quantity]) }));
    return { axis: 'f', xs, series, xLabel: afocal ? '望远镜焦比' : '镜头焦比' };
  }, 12);
}

// Wavelength windows for the spectrum chart: one panel per band.
export function spectrumPanels(d) {
  const kinds = d.base.filterKind === 'dual' ? ['ha', 'oiii'] : [d.base.filterKind];
  const maxShift = Math.max(...d.beams.map(b => b.maxShift / (b.offsets[0].line) ));
  const width = d.base.width;
  return kinds.map(kind => {
    const line = MAIN_LINE[kind];
    const shift = line * maxShift;
    const offset = Math.max(0, ...d.results.map(r => (r.bands.find(b => b.line === line) || { offset: 0 }).offset));
    let lo = line - Math.max(width * 0.95 + shift + 2, 7);
    let hi = line + Math.max(width * 0.95 + offset + 2, 5);
    if (kind === 'oiii') lo = Math.min(lo, 493.5);
    return { kind, line, lo, hi };
  });
}
