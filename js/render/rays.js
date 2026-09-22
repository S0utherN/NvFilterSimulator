// Light-path animation: representative rays through lenses and the filter.
// Geometry follows the original page; drawing is schematic, not to scale.
import { fitCanvas, palette, polyline, text, withAlpha } from './util.js';
import { MAIN_LINE } from '../data.js';

const O = window.M42Optics;
const RHOS = [-0.96, -0.78, -0.57, -0.32, 0, 0.32, 0.57, 0.78, 0.96];
export const PHASES = [0, 0.23, 0.42, 0.72, 1];

export function rayTransmission(cfg, rho, wavelength) {
  const g = O.geometry(cfg);
  const theta = g.mode === 'parallel' ? cfg.angleDeg : Math.asin(Math.abs(rho) / (2 * g.beamF)) * 180 / Math.PI;
  return O.transmission(wavelength, { ...cfg, position: 'front', mode: 'parallel', beamF: Infinity, angleDeg: theta });
}

export function prepareRows(configs, labels) {
  const wavelength = configs[0].filterKind === 'oiii' ? MAIN_LINE.oiii : MAIN_LINE.ha;
  return configs.map((cfg, index) => {
    const g = O.geometry(cfg);
    const half = g.mode === 'parallel' ? cfg.angleDeg : Math.asin(1 / (2 * g.beamF)) * 180 / Math.PI;
    return {
      cfg, geo: g, label: labels[index], wavelength,
      angle: g.mode === 'parallel' ? half.toFixed(1) + '°' : '0°–' + half.toFixed(1) + '°',
      transmission: O.transmission(wavelength, cfg),
      rays: RHOS.map(rho => ({ rho, t: rayTransmission(cfg, rho, wavelength) }))
    };
  });
}

function makeGeometry(w, cy, cfg) {
  const afocal = cfg.position.startsWith('afocal');
  const compact = w < 520;
  const left = compact ? 14 : 24, right = w - 16, span = right - left;
  const maxR = afocal ? 36 : 46;
  const g = O.geometry(cfg);
  let filterX, components, make;
  if (!afocal) {
    const lx = left + span * 0.40, sx = left + span * 0.93;
    const radius = maxR * 0.95 / cfg.fNumber;
    const h = g.mode === 'parallel' ? 14 * cfg.angleDeg / 18 : 0;
    const incomingSlope = h / (sx - lx);
    filterX = cfg.position === 'front' ? left + span * 0.23 : left + span * 0.70;
    components = [{ x: lx, label: '物镜', type: 'lens', r: maxR }, { x: sx, label: '像面', type: 'sensor', r: maxR }];
    make = rho => [[left, cy + rho * radius - incomingSlope * (lx - left)], [lx, cy + rho * radius], [sx, cy + h]];
  } else {
    const tx = left + span * 0.17, fx = left + span * 0.43, ex = left + span * 0.57, nx = left + span * 0.77, sx = left + span * 0.95;
    const ft = fx - tx, fe = ex - fx, fn = sx - nx;
    const effectiveT = Math.max(cfg.telescopeF, cfg.eyepieceFocal / (cfg.nvFocal / cfg.nvF));
    const radius = maxR * 2.8 / effectiveT;
    const beta = cfg.position === 'afocalBetween' ? -(cfg.angleDeg / 18) * 0.07 : 0;
    const h = -fe * beta, skySlope = h / ft;
    filterX = cfg.position === 'afocalBefore' ? left + span * 0.32 : cfg.position === 'afocalBetween' ? left + span * 0.66 : left + span * 0.87;
    components = [{ x: tx, label: '望远镜', type: 'lens', r: maxR }, { x: ex, label: '目镜', type: 'lens', r: 24 },
      { x: nx, label: compact ? '夜视' : '夜视物镜', type: 'lens', r: 24 }, { x: sx, label: '阴极', type: 'sensor', r: 24 }];
    make = rho => {
      const u = rho * radius, yE = h * (1 + fe / ft) - u * fe / ft, yN = yE + beta * (nx - ex);
      return [[left, cy + u - skySlope * (tx - left)], [tx, cy + u], [fx, cy + h], [ex, cy + yE], [nx, cy + yN], [sx, cy + beta * fn]];
    };
  }
  return { filterX, components, make, left, right };
}

function splitAtX(points, x) {
  for (let i = 1; i < points.length; i++) if (points[i - 1][0] <= x && points[i][0] >= x) {
    const f = (x - points[i - 1][0]) / (points[i][0] - points[i - 1][0]);
    const q = [x, points[i - 1][1] + f * (points[i][1] - points[i - 1][1])];
    return [points.slice(0, i).concat([q]), [q].concat(points.slice(i))];
  }
  return [points, []];
}

function drawLens(ctx, x, cy, r, color) {
  ctx.save();
  ctx.fillStyle = withAlpha(color, 0.14); ctx.strokeStyle = withAlpha(color, 0.7); ctx.lineWidth = 1.2;
  const bulge = Math.max(5, r * 0.16);
  ctx.beginPath();
  ctx.moveTo(x, cy - r);
  ctx.quadraticCurveTo(x + bulge * 2, cy, x, cy + r);
  ctx.quadraticCurveTo(x - bulge * 2, cy, x, cy - r);
  ctx.fill(); ctx.stroke();
  ctx.restore();
}

export function drawRays(canvas, rows, progress, bandColor) {
  const rowH = 200;
  const { ctx, width } = fitCanvas(canvas, rowH * rows.length);
  const p = palette();
  rows.forEach((row, index) => {
    const top = index * rowH, cy = top + 112, side = index ? p.b : p.a;
    const geo = makeGeometry(width, cy, row.cfg);
    // Row header: badge + label + numbers.
    ctx.save();
    ctx.fillStyle = side; ctx.beginPath(); ctx.roundRect(10, top + 8, 20, 18, 5); ctx.fill();
    ctx.restore();
    text(ctx, index ? 'B' : 'A', 20, top + 21, { align: 'center', size: 11, weight: 700, color: '#0b1020' });
    text(ctx, row.label, 38, top + 22, { size: 13, weight: 600, color: p.text });
    text(ctx, '入射 ' + row.angle + ' · 主线透过 ' + Math.round(row.transmission * 100) + '%', 38, top + 40, { size: 12, color: p.text2 });
    polyline(ctx, [[geo.left, cy], [geo.right, cy]], p.grid, 1);
    for (const c of geo.components) {
      if (c.type === 'lens') drawLens(ctx, c.x, cy, c.r, p.text2);
      else {
        ctx.save(); ctx.fillStyle = withAlpha(p.text2, 0.5); ctx.fillRect(c.x - 2, cy - c.r, 4, c.r * 2); ctx.restore();
      }
      text(ctx, c.label, c.x, top + 188, { align: 'center', size: 11, color: p.text3 });
    }
    // Filter slab.
    ctx.save();
    ctx.fillStyle = withAlpha(side, 0.28); ctx.strokeStyle = side; ctx.lineWidth = 1.2;
    ctx.fillRect(geo.filterX - 3, cy - 56, 6, 112); ctx.strokeRect(geo.filterX - 3, cy - 56, 6, 112);
    ctx.restore();
    text(ctx, '滤镜', geo.filterX, cy - 64, { align: 'center', size: 12, weight: 600, color: side });

    const anglePath = geo.make(-0.96), parts = splitAtX(anglePath, geo.filterX), hit = parts[1][0];
    if (hit) {
      const nl = Math.min(30, width * 0.08);
      polyline(ctx, [[hit[0] - nl, hit[1]], [hit[0] + nl, hit[1]]], p.text2, 1, 0.7, [3, 3]);
      if (row.geo.mode === 'cone') {
        const prev = parts[0][parts[0].length - 2];
        const a = Math.atan2(hit[1] - prev[1], hit[0] - prev[0]);
        ctx.save(); ctx.strokeStyle = p.text; ctx.globalAlpha = 0.7; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(hit[0], hit[1], nl * 0.7, Math.PI, Math.PI + a, a < 0); ctx.stroke(); ctx.restore();
      }
    }
    row.rays.forEach(({ rho, t }, ri) => {
      const path = geo.make(rho), seg = splitAtX(path, geo.filterX);
      polyline(ctx, seg[0], p.text, 1, 0.28);
      polyline(ctx, seg[1], bandColor, 1.6, Math.max(0.04, t * 0.9));
      if (progress < 1) {
        const time = Math.max(0, Math.min(1, (progress - ri * 0.004) / 0.96));
        const x = path[0][0] + (path[path.length - 1][0] - path[0][0]) * time;
        const pos = splitAtX(path, x)[0].slice(-1)[0];
        const alpha = pos[0] > geo.filterX ? t : 1;
        if (alpha > 0.01 && time > 0 && time < 1) {
          ctx.save();
          ctx.globalAlpha = alpha; ctx.fillStyle = pos[0] > geo.filterX ? bandColor : '#ffffff';
          ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 8;
          ctx.beginPath(); ctx.arc(pos[0], pos[1], 3.4, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
        if (t < 0.25 && x >= geo.filterX && x < geo.filterX + width * 0.14) {
          const b = seg[1][0], fade = 1 - (x - geo.filterX) / (width * 0.14);
          polyline(ctx, [[b[0] - 4, b[1] - 4], [b[0] + 4, b[1] + 4]], p.text, 1.6, fade);
          polyline(ctx, [[b[0] - 4, b[1] + 4], [b[0] + 4, b[1] - 4]], p.text, 1.6, fade);
        }
      }
    });
    if (index < rows.length - 1) polyline(ctx, [[10, top + rowH - 2], [width - 10, top + rowH - 2]], p.grid, 1);
  });
}

// Narration for each animation phase.
export function phaseText(rows, progress) {
  const direct = rows[0].cfg.position === 'front' && rows[1] && rows[1].cfg.position === 'rear';
  if (progress >= 1) {
    if (direct) return '前置：整束光以 ' + rows[0].angle + ' 入射；后置：中心也有斜光，光锥越宽，偏移越大。';
    if (rows[0].cfg.position === rows[1].cfg.position) return rows[0].cfg.optimized !== rows[1].cfg.optimized
      ? '同一位置、同样的光束：差别只来自滤镜是否预先向红侧偏移。'
      : '同一天区方向的前置入射角相同；相同焦比的后置光锥也相同。焦距差异体现在视场，见“全视场”。';
    return '滤镜所在位置的光束决定偏移：平行束看入射角，光锥看这一段的焦比。';
  }
  if (progress < PHASES[1]) return '① 同一颗天体的光，从左侧近乎平行地进入。';
  if (progress < PHASES[2]) return direct ? '② 前置滤镜接到平行光，整束光的入射角为 ' + rows[0].angle + '。' : '② 留意滤镜前的光束形状：平行，还是已经在汇聚？';
  if (progress < PHASES[3]) return direct ? '③ 物镜让光汇聚：光束里开始出现不同角度的斜光。' : '③ 经过物镜或目镜后，光束形状会改变。';
  return direct ? '④ 后置滤镜接到斜光：被挡住的主线光在这里变淡。' : '④ 穿过滤镜后，光线按这个方向的透过率变亮或变暗。';
}
