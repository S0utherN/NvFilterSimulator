// Canvas helpers shared by all charts.

let paletteCache = null;
export function palette() {
  if (paletteCache) return paletteCache;
  const css = getComputedStyle(document.documentElement);
  const get = name => css.getPropertyValue(name).trim();
  paletteCache = {
    bg: get('--bg'), surface: get('--surface-solid'), text: get('--text'), text2: get('--text-2'), text3: get('--text-3'),
    grid: get('--grid'), border: get('--border-strong'), a: get('--side-a'), b: get('--side-b'),
    ha: get('--line-ha'), oiii: get('--line-oiii'), nii: get('--line-nii'), hb: get('--line-hb'),
    font: css.getPropertyValue('--font-sans').trim() || 'system-ui, sans-serif',
    mono: css.getPropertyValue('--font-num').trim() || 'ui-monospace, monospace'
  };
  return paletteCache;
}
export function resetPalette() { paletteCache = null; }

// Size a canvas to its CSS box at device pixel ratio; returns a context in CSS pixels.
export function fitCanvas(canvas, cssHeight) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = cssHeight ?? Math.max(1, rect.height);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(width * dpr), h = Math.round(height * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  if (cssHeight != null) canvas.style.height = cssHeight + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height, dpr };
}

export function polyline(ctx, points, color, width = 1, alpha = 1, dash = null) {
  if (points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.globalAlpha = alpha;
  if (dash) ctx.setLineDash(dash);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.beginPath();
  points.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
  ctx.stroke();
  ctx.restore();
}

export function text(ctx, value, x, y, { color, size = 12, weight = 400, align = 'left', baseline = 'alphabetic', font } = {}) {
  const p = palette();
  ctx.save();
  ctx.fillStyle = color || p.text2;
  ctx.font = weight + ' ' + size + 'px ' + (font || p.font);
  ctx.textAlign = align; ctx.textBaseline = baseline;
  ctx.fillText(value, x, y);
  ctx.restore();
}

export function withAlpha(color, alpha) {
  // Accepts #rrggbb; used for fills derived from theme tokens.
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${alpha})`;
}

// Linear axis ticks with "nice" steps.
export function niceTicks(lo, hi, count = 5) {
  const span = hi - lo, raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(s => s * mag).find(s => span / s <= count) || 10 * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

// Viridis-like perceptual colour map, t in 0..1 → [r,g,b].
const VIRIDIS = [[68, 1, 84], [72, 40, 120], [62, 74, 137], [49, 104, 142], [38, 130, 142],
  [31, 158, 137], [53, 183, 121], [110, 206, 88], [181, 222, 43], [253, 231, 37]];
export function viridis(t) {
  const x = Math.max(0, Math.min(1, t)) * (VIRIDIS.length - 1);
  const i = Math.min(VIRIDIS.length - 2, Math.floor(x)), f = x - i;
  const a = VIRIDIS[i], b = VIRIDIS[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
export const VIRIDIS_CSS = 'linear-gradient(90deg,' + VIRIDIS.map((c, i) => `rgb(${c}) ${i / (VIRIDIS.length - 1) * 100}%`).join(',') + ')';
