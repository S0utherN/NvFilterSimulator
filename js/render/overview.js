// Transmission curves for all bandwidths — the "how much is lost at each F-number" answer.
import { fitCanvas, palette, polyline, text, niceTicks } from './util.js';
import { fmtF } from '../data.js';

// Sequential ramp from narrow (warm) to wide (cool) so neighbouring widths stay distinguishable.
const RAMP = ['#ff6b8a', '#ff8f6b', '#ffb85c', '#e8d45a', '#a8dc6a', '#5fd6a0', '#46c3d6', '#5d9cf0', '#8b80f0'];
export const widthColor = i => RAMP[i % RAMP.length];

export function renderOverview(canvas, data, { width: current, x: currentX, metric, height }) {
  const { ctx, width } = fitCanvas(canvas, height);
  const p = palette();
  const pad = { l: 44, r: 14, t: 14, b: 34 };
  const xs = data.xs;
  const lo = xs[0], hi = xs[xs.length - 1];
  const maxY = metric === 'contrast' ? Math.max(1, ...data.series.flatMap(s => s.ys)) * 1.05 : 1;
  // F-stops are geometric, so the F axis is logarithmic; angles stay linear.
  const log = data.axis === 'f';
  const tx = v => log ? Math.log(v) : v;
  const X = v => pad.l + (tx(v) - tx(lo)) / (tx(hi) - tx(lo)) * (width - pad.l - pad.r);
  const invert = px => { const u = tx(lo) + (px - pad.l) / (width - pad.l - pad.r) * (tx(hi) - tx(lo)); return log ? Math.exp(u) : u; };
  const Y = v => pad.t + (1 - v / maxY) * (height - pad.t - pad.b);
  for (const t of niceTicks(0, maxY, 4)) {
    polyline(ctx, [[pad.l, Y(t)], [width - pad.r, Y(t)]], p.grid, 1);
    text(ctx, Math.round(t * 100) + '%', pad.l - 6, Y(t) + 4, { align: 'right', size: 11, color: p.text3 });
  }
  const ticks = data.axis === 'f' ? [0.95, 1.2, 1.4, 2, 2.8, 4, 5.6, 8].filter(v => v >= lo && v <= hi) : niceTicks(lo, hi, 5);
  let lastX = -Infinity;
  for (const v of ticks) {
    if (X(v) - lastX < 38) continue;
    lastX = X(v);
    polyline(ctx, [[X(v), height - pad.b], [X(v), height - pad.b + 4]], p.text3, 1);
    text(ctx, data.axis === 'f' ? fmtF(v) : v + '°', X(v), height - 12, { align: 'center', size: 11, color: p.text3 });
  }
  const order = data.series.map((s, i) => i).sort((a, b) => (data.series[a].width === current) - (data.series[b].width === current));
  for (const i of order) {
    const s = data.series[i], active = s.width === current;
    polyline(ctx, xs.map((x, k) => [X(x), Y(s.ys[k])]), widthColor(i), active ? 3 : 1.4, active ? 1 : 0.55);
  }
  if (currentX != null && currentX >= lo && currentX <= hi) {
    polyline(ctx, [[X(currentX), pad.t], [X(currentX), height - pad.b]], p.text, 1, 0.5, [4, 4]);
    const i = data.series.findIndex(s => s.width === current);
    if (i >= 0) {
      const y = interp(xs, data.series[i].ys, currentX);
      ctx.save();
      ctx.fillStyle = widthColor(i); ctx.strokeStyle = p.surface; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(X(currentX), Y(y), 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }
  return { X, Y, invert, pad, lo, hi, width, height };
}

export function interp(xs, ys, x) {
  if (x <= xs[0]) return ys[0];
  for (let k = 1; k < xs.length; k++) if (xs[k] >= x) {
    const t = (x - xs[k - 1]) / (xs[k] - xs[k - 1]);
    return ys[k - 1] + (ys[k] - ys[k - 1]) * t;
  }
  return ys[ys.length - 1];
}
