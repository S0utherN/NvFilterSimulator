// M42 close-up synthesis. Same physics as the original page: shared grayscale morphology,
// flat continuum, one fixed asinh stretch for both sides (never per-image normalization).
import { S, SKY, NEB_CONT, FIELD } from '../data.js';
import { memo } from '../model.js';

const O = window.M42Optics;
const Fd = window.M42Field;
const DEG = Math.PI / 180;

let texture = null;
export function loadTexture(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = S; c.height = S;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, S, S);
      const px = ctx.getImageData(0, 0, S, S).data;
      texture = new Float32Array(S * S);
      for (let i = 0; i < texture.length; i++) texture[i] = Math.pow(px[i * 4] / 255, 1.8);
      resolve(texture);
    };
    img.onerror = reject;
    img.src = src;
  });
}
export const getTexture = () => texture;

// Precomputed tangent of each pixel-centre offset (degrees → tan) along one axis.
const tanAxis = new Float64Array(S);
for (let i = 0; i < S; i++) tanAxis[i] = Math.tan(((i + 0.5) / S - 0.5) * FIELD * DEG);

export const stretch = z => Math.max(0, Math.min(1, Math.asinh(4 * z) / Math.asinh(10)));

// Pseudo-colour tint from the share of Hα vs OIII signal that survives the filter.
export function tintOf(result) {
  let red = 0, teal = 0;
  for (const line of result.perLine) {
    if (line.wavelength > 600) red += line.signal; else teal += line.signal;
  }
  const total = red + teal || 1;
  const r = red / total, t = teal / total;
  return [255 * r + 64 * t, 92 * r + 224 * t, 96 * r + 200 * t];
}

/**
 * Render one side into an ImageData-sized canvas (S×S).
 * step > 1 renders a coarse draft while a slider is being dragged.
 */
export function renderScene(canvas, cfg, result, geo, reference, { display, color, step = 1 }) {
  const ctx = canvas.getContext('2d');
  const parallel = geo.mode === 'parallel';
  const mag = cfg.position === 'afocalBetween' ? 600 / cfg.eyepieceFocal : 1;
  const maxAngle = Math.max(0.01, (parallel ? cfg.angleDeg : 0) + FIELD * mag);
  // Parallel-beam LUT is independent of the F-number, so dragging F reuses it.
  const lutKey = [cfg.position, cfg.width, cfg.filterKind, cfg.optimized, cfg.designF, cfg.eyepieceFocal, maxAngle.toFixed(4)].join('|');
  const lut = parallel ? memo('sceneLut', lutKey, () => O.radialProfile(cfg, { bins: 384, maxAngleDeg: maxAngle }), 16) : null;
  const g = Fd.geometry(cfg);
  const a = (cfg.targetAngle || 0) * DEG;
  const skyA = g.afocal ? Math.atan(Math.tan(a) / g.magnification) : a;
  const sin = Math.sin(skyA), cos = Math.cos(skyA);
  const targetVisible = Fd.target(cfg).center.inside;
  const exposure = 7.84 / (geo.finalF * geo.finalF);
  const sky = display === 'sky';
  const tint = color === 'false' ? tintOf(result) : null;
  const data = ctx.createImageData(S, S), out = data.data;
  const lineConst = result.lineSignal, ewConst = result.equivalentWidth;
  const lineLut = lut && lut.lineSignal, ewLut = lut && lut.equivalentWidth;
  const bins = lut ? lut.bins - 1 : 0, lutMax = lut ? lut.maxAngleDeg : 1;
  let sumSignal = 0, sumBackground = 0, sumTexture = 0, visible = 0;

  for (let y = 0; y < S; y += step) {
    const v = tanAxis[y];
    for (let x = 0; x < S; x += step) {
      const u = tanAxis[x];
      const z = cos - sin * u;
      const px = g.focal * (cos * u + sin) / z, py = g.focal * v / z, r = Math.sqrt(px * px + py * py);
      if (!(z > 0 && r <= 9)) continue;
      let line = lineConst, ew = ewConst;
      if (lut) {
        const angle = Math.atan(r / g.angleFocal) / DEG;
        const fx = Math.min(bins, angle / lutMax * bins), i0 = Math.floor(fx), i1 = Math.min(i0 + 1, bins), t = fx - i0;
        line = lineLut[i0] * (1 - t) + lineLut[i1] * t;
        ew = ewLut[i0] * (1 - t) + ewLut[i1] * t;
      }
      const i = y * S + x;
      const tex = texture[i], background = SKY * ew, signal = tex * (line + NEB_CONT * ew);
      const flux = background + signal;
      const val = stretch(sky ? flux / background * 0.04 : flux * exposure);
      let cr, cg, cb;
      if (tint) {
        // Dark → tint → white ramp keeps the same luminance ordering as the grey image.
        const k = Math.min(1, val / 0.72), w = Math.max(0, (val - 0.72) / 0.28);
        cr = tint[0] * k + (255 - tint[0]) * w; cg = tint[1] * k + (255 - tint[1]) * w; cb = tint[2] * k + (255 - tint[2]) * w;
      } else cr = cg = cb = val * 255;
      for (let dy = 0; dy < step && y + dy < S; dy++) for (let dx = 0; dx < step && x + dx < S; dx++) {
        const o = ((y + dy) * S + x + dx) * 4;
        out[o] = cr; out[o + 1] = cg; out[o + 2] = cb; out[o + 3] = 255;
      }
      sumSignal += signal; sumBackground += background; sumTexture += tex; visible++;
    }
  }
  ctx.putImageData(data, 0, 0);
  const samples = Math.ceil(S / step) ** 2;
  const ratio = visible && sumTexture > 0
    ? (sumSignal / sumBackground) / ((sumTexture / visible) * (reference.lineSignal + NEB_CONT * reference.equivalentWidth) / (SKY * reference.equivalentWidth))
    : null;
  if (!visible) drawOutside(ctx);
  return { ratio, visibleFraction: visible / samples, targetVisible };
}

function drawOutside(ctx) {
  const css = getComputedStyle(document.documentElement);
  ctx.save();
  ctx.fillStyle = '#05070d'; ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = css.getPropertyValue('--text-3').trim() || '#667';
  ctx.setLineDash([8, 8]); ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(S / 2, S / 2, S * 0.3, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = css.getPropertyValue('--text-2').trim() || '#aab';
  ctx.font = '500 22px ' + (css.getPropertyValue('--font-sans').trim() || 'sans-serif');
  ctx.textAlign = 'center';
  ctx.fillText('此天区超出视场', S / 2, S / 2 + 8);
  ctx.restore();
}
