// Full 18 mm cathode view: main-line transmission map (colour) or true-scale framing (grey).
import { S, SKY, NEB_CONT, FIELD } from '../data.js';
import { fitCanvas, palette, viridis, polyline, text, niceTicks } from './util.js';
import { getTexture, stretch } from './scene.js';

const O = window.M42Optics;
const Fd = window.M42Field;
const DEG = Math.PI / 180;

export function renderFieldMap(canvas, cfg, stats, target, { view, display }) {
  const { ctx, width } = fitCanvas(canvas);
  const dpr = canvas.width / width;
  const N = canvas.width, C = N / 2, R = N / 2 - 6 * dpr;
  const { g, optical, parallel, centerResult, center, profile } = stats;
  const scene = view === 'scene';
  const texture = getTexture();
  const inverse = Fd.unprojection(cfg);
  const exposure = 7.84 / (optical.finalF * optical.finalF);
  const img = ctx.createImageData(N, N), px = img.data;
  const lookup = (name, theta) => O.lookup(profile, name, theta);
  // Transmission depends only on radius: tabulate once instead of per pixel.
  const RB = 1024, ring = new Array(RB + 1);
  if (!scene) for (let k = 0; k <= RB; k++) {
    const theta = Math.atan(k / RB * 9 / g.angleFocal) / DEG;
    ring[k] = viridis(parallel ? lookup('targetLineFraction', theta) : center);
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = (x + 0.5 - C) / R, dy = (y + 0.5 - C) / R, rho = Math.sqrt(dx * dx + dy * dy);
    if (rho > 1) continue;
    const theta = scene ? Math.atan(rho * 9 / g.angleFocal) / DEG : 0;
    let rgb;
    if (scene) {
      const sky = inverse((x + 0.5 - C) / R * 9, (y + 0.5 - C) / R * 9);
      const sx = Math.floor((sky.dx / FIELD + 0.5) * S), sy = Math.floor((sky.dy / FIELD + 0.5) * S);
      const nebula = sx >= 0 && sx < S && sy >= 0 && sy < S ? texture[sy * S + sx] : 0;
      const lineSignal = parallel ? lookup('lineSignal', theta) : centerResult.lineSignal;
      const ew = parallel ? lookup('equivalentWidth', theta) : centerResult.equivalentWidth;
      const background = SKY * ew, flux = background + nebula * (lineSignal + NEB_CONT * ew);
      const v = 255 * stretch(display === 'sky' ? flux / background * 0.04 : flux * exposure);
      rgb = [v, v, v];
    } else {
      rgb = ring[Math.round(rho * RB)];
    }
    const o = (y * N + x) * 4;
    px[o] = rgb[0]; px[o + 1] = rgb[1]; px[o + 2] = rgb[2]; px[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  // Overlays drawn in CSS pixels.
  const p = palette();
  const cx = width / 2, r = width / 2 - 6;
  ctx.save();
  ctx.strokeStyle = p.border; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cx, r, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cx, r, 0, Math.PI * 2); ctx.clip();
  polyline(ctx, [[cx - 6, cx], [cx + 6, cx]], '#ffffff', 1, 0.5);
  polyline(ctx, [[cx, cx - 6], [cx, cx + 6]], '#ffffff', 1, 0.5);
  const outline = target.corners.map(pt => [cx + pt.x / 9 * r, cx + pt.y / 9 * r]);
  outline.push(outline[0]);
  polyline(ctx, outline, '#000000', 3, 0.7);
  polyline(ctx, outline, '#ffffff', 1.4, 1);
  ctx.restore();
  return { N, R: r, cx };
}

// Readout for a pointer position over the field map.
export function probeField(stats, canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const r = rect.width / 2 - 6;
  const dx = clientX - rect.left - rect.width / 2, dy = clientY - rect.top - rect.height / 2;
  const rho = Math.hypot(dx, dy) / r;
  if (rho > 1) return null;
  const theta = Math.atan(rho * 9 / stats.g.angleFocal) / DEG;
  const t = stats.parallel ? O.lookup(stats.profile, 'targetLineFraction', theta) : stats.center;
  return { theta, t, radiusMm: rho * 9 };
}

// Radial transmission curves for both sides, with each cathode edge marked.
export function renderRadial(canvas, sides, labels, markAngle) {
  const { ctx, width, height } = fitCanvas(canvas);
  const p = palette();
  const pad = { l: 40, r: 12, t: 12, b: 30 };
  const maxX = Math.max(1, ...sides.map(s => s.g.halfControl)) * 1.04;
  const X = v => pad.l + v / maxX * (width - pad.l - pad.r);
  const Y = v => pad.t + (1 - v) * (height - pad.t - pad.b);
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    polyline(ctx, [[pad.l, Y(t)], [width - pad.r, Y(t)]], p.grid, 1);
    text(ctx, Math.round(t * 100) + '%', pad.l - 6, Y(t) + 4, { align: 'right', size: 11, color: p.text3 });
  }
  for (const v of niceTicks(0, maxX, 5)) text(ctx, v + '°', X(v), height - 10, { align: 'center', size: 11, color: p.text3 });
  sides.forEach((s, i) => {
    const color = i ? p.b : p.a;
    const edge = s.g.halfControl;
    const pts = [];
    for (let k = 0; k <= 120; k++) {
      const th = edge * k / 120;
      pts.push([X(th), Y(s.parallel ? O.lookup(s.profile, 'targetLineFraction', th) : s.center)]);
    }
    polyline(ctx, pts, color, 2.2, 1, i ? [6, 4] : null);
    polyline(ctx, [[X(edge), pad.t], [X(edge), height - pad.b]], color, 1, 0.55, [2, 3]);
    text(ctx, labels[i] + ' 边缘', X(edge) - 4, pad.t + 12 + i * 14, { align: 'right', size: 11, color });
  });
  if (markAngle != null) polyline(ctx, [[X(markAngle), pad.t], [X(markAngle), height - pad.b]], p.text, 1, 0.6, [4, 4]);
}
