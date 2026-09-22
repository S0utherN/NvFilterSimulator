// Passband vs emission lines: shows the blue shift that pushes the target line out.
import { LINES } from '../data.js';
import { fitCanvas, palette, polyline, text, niceTicks, withAlpha } from './util.js';

const O = window.M42Optics;

const lineColor = (p, key) => ({ ha: p.ha, oiii: p.oiii, nii: p.nii, hb: p.hb })[key] || p.text2;

/**
 * panels: [{kind, line, lo, hi}], sides: [{cfg, label}], results: evaluate() outputs.
 * Returns hit data for hover readouts.
 */
export function renderSpectrum(canvas, panels, sides, results, height, draft = false) {
  const { ctx, width } = fitCanvas(canvas, height);
  const p = palette();
  const gap = 18;
  const stacked = width < 560 && panels.length > 1;
  const panelW = stacked ? width : (width - gap * (panels.length - 1)) / panels.length;
  const panelH = stacked ? (height - gap) / panels.length : height;
  // 160 pupil rings are visually indistinguishable from 384 for the curve; the dots use exact results.
  const samplers = sides.map(s => O.createSampler({ ...s.cfg, pupilSamples: draft ? 64 : 160 }));
  const nominal = sides.map(s => O.createSampler({ ...s.cfg, position: 'ideal', mode: 'ideal', angleDeg: 0 }));
  const hits = [];
  panels.forEach((panel, pi) => {
    const ox = stacked ? 0 : pi * (panelW + gap), oy = stacked ? pi * (panelH + gap) : 0;
    const pad = { l: 38, r: 10, t: 40, b: 30 };
    const X = w => ox + pad.l + (w - panel.lo) / (panel.hi - panel.lo) * (panelW - pad.l - pad.r);
    const Y = v => oy + pad.t + (1 - v) * (panelH - pad.t - pad.b);
    for (const t of [0, 0.5, 1]) {
      polyline(ctx, [[X(panel.lo), Y(t)], [X(panel.hi), Y(t)]], p.grid, 1);
      text(ctx, Math.round(t * 100) + '%', ox + pad.l - 6, Y(t) + 4, { align: 'right', size: 11, color: p.text3 });
    }
    for (const w of niceTicks(panel.lo, panel.hi, Math.max(3, Math.floor(panelW / 90)))) {
      if (X(w) > ox + panelW - pad.r - 26) continue; // leave room for the unit label
      text(ctx, String(w), X(w), oy + panelH - 10, { align: 'center', size: 11, color: p.text3 });
    }
    text(ctx, 'nm', ox + panelW - pad.r, oy + panelH - 10, { align: 'right', size: 11, color: p.text3 });

    // Emission lines as spikes scaled to the strongest line in this window.
    const inside = LINES.filter(l => l.wavelength >= panel.lo && l.wavelength <= panel.hi);
    const maxW = Math.max(...inside.map(l => l.weight), 1e-9);
    for (const l of inside) {
      const h = 0.18 + 0.78 * l.weight / maxW, c = lineColor(p, l.color);
      ctx.save();
      const grad = ctx.createLinearGradient(0, Y(h), 0, Y(0));
      grad.addColorStop(0, withAlpha(c, 0.95)); grad.addColorStop(1, withAlpha(c, 0.15));
      ctx.fillStyle = grad; ctx.fillRect(X(l.wavelength) - 1.5, Y(h), 3, Y(0) - Y(h));
      ctx.restore();
      text(ctx, l.name, X(l.wavelength), Y(h) - 6, { align: 'center', size: 11, color: c, weight: 500 });
    }

    // Passbands: dashed = normal incidence, solid + fill = effective in the current beam.
    const steps = Math.max(100, Math.round(panelW / (draft ? 5 : 2.5)));
    sides.forEach((side, si) => {
      const color = si ? p.b : p.a;
      const eff = [], nom = [];
      for (let k = 0; k <= steps; k++) {
        const w = panel.lo + (panel.hi - panel.lo) * k / steps;
        eff.push([X(w), Y(samplers[si](w))]);
        nom.push([X(w), Y(nominal[si](w))]);
      }
      ctx.save();
      ctx.beginPath(); ctx.moveTo(X(panel.lo), Y(0));
      eff.forEach(pt => ctx.lineTo(pt[0], pt[1]));
      ctx.lineTo(X(panel.hi), Y(0)); ctx.closePath();
      ctx.fillStyle = withAlpha(color, 0.12); ctx.fill();
      ctx.restore();
      polyline(ctx, nom, color, 1.2, 0.6, [5, 4]);
      polyline(ctx, eff, color, 2.2, 1);
      const main = results[si].perLine.find(l => Math.abs(l.wavelength - panel.line) < 0.2);
      const t = main ? main.transmission : samplers[si](panel.line);
      const hx = X(panel.line), hy = Y(t);
      ctx.save();
      ctx.fillStyle = color; ctx.strokeStyle = p.surface; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(hx, hy, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
      // Readout in the panel header avoids colliding with line labels.
      text(ctx, (si ? 'B ' : 'A ') + Math.round(t * 100) + '%', ox + pad.l + 72 + si * 62, oy + 12,
        { size: 12, weight: 700, color });
      hits.push({ panel: pi, side: si, x: hx, y: hy, t });
    });
    text(ctx, (panel.kind === 'ha' ? 'Hα' : 'OIII') + ' 主线', ox + pad.l, oy + 12, { size: 12, color: p.text2, weight: 500 });
    hits.push({ panel: pi, bounds: { ox, oy, w: panelW, h: panelH, pad, lo: panel.lo, hi: panel.hi } });
  });
  return { hits, samplers };
}
