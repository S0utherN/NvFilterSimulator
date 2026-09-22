
/* Ideal interference-filter model. No optical aberrations, material losses,
 * detector response, photon noise, or atmospheric attenuation are included.
 * All spectrum weights are supplied/illustrative, not an M42 measurement.
 */
(function (root) {
  'use strict';
  const LN2 = Math.LN2;
  const EW_FACTOR = 3.625609908221908 / (4 * Math.pow(LN2, 0.25));
  const DEG = Math.PI / 180;
  const DEFAULT_LINES = Object.freeze([
    { name: 'Hβ', wavelength: 486.133, weight: 1 },
    { name: '[O III] 4959', wavelength: 495.891, weight: 1 },
    { name: '[O III] 5007', wavelength: 500.7, weight: 3 },
    { name: '[N II] 6548', wavelength: 654.805, weight: 0.15 },
    { name: 'Hα', wavelength: 656.28, weight: 2.86 },
    { name: '[N II] 6583', wavelength: 658.345, weight: 0.45 },
    { name: '[S II] 6716', wavelength: 671.644, weight: 0.1 },
    { name: '[S II] 6731', wavelength: 673.082, weight: 0.1 }
  ]);
  const offsetCache = new Map();

  function finite(value, fallback) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
  }

  function profile(delta, width) {
    const x = 2 * delta / width;
    return Math.abs(x) > 5 ? 0 : Math.exp(-LN2 * x * x * x * x);
  }

  function geometry(config) {
    const c = config || {};
    const position = c.position || 'rear';
    const telescopeF = Math.max(0.51, finite(c.telescopeF, finite(c.fNumber, 4)));
    const eyepieceFocal = Math.max(1, finite(c.eyepieceFocal, 55));
    const nvFocal = Math.max(1, finite(c.nvFocal, 26));
    const nvF = Math.max(0.51, finite(c.nvF, 1.2));
    const fNumber = Math.max(0.51, finite(c.fNumber, 1.2));
    const afocal = position.startsWith('afocal') || c.afocal === true;
    const finalF = afocal ? Math.max(nvF, telescopeF * nvFocal / eyepieceFocal) : fNumber;
    // A downstream NV entrance pupil can clip an oversized telescope exit pupil.
    // In that case only the retained central part of the telescope pupil reaches
    // the image, including photons filtered BEFORE the eyepiece.
    const effectiveEntranceF = afocal ? Math.max(telescopeF, eyepieceFocal / (nvFocal / nvF)) : fNumber;
    let mode = 'cone';
    let localF = fNumber;
    let angleSemantics = 'chief-ray angle at the filter; zero for ideal image-space telecentric rear placement';
    if (position === 'front' || position === 'afocalBetween' || position === 'afocalFront') {
      mode = 'parallel';
      localF = Infinity;
      angleSemantics = position === 'afocalBetween'
        ? 'eyepiece OUTPUT angle at the NV objective; NOT true sky angle'
        : 'true sky angle relative to the front-filter normal';
    } else if (position === 'afocalBefore') localF = effectiveEntranceF;
    else if (position === 'afocalAfter') localF = finalF;
    else if (position === 'ideal') { mode = 'ideal'; localF = Infinity; }
    if (c.mode) mode = c.mode;
    if (c.beamF !== undefined) {
      localF = Number(c.beamF);
      if (c.mode !== 'ideal') mode = Number.isFinite(localF) ? 'cone' : 'parallel';
    }
    if (mode === 'cone' && !(localF > 0.5)) throw new RangeError('beamF must be greater than 0.5.');
    const sensorRadius = Math.max(0, finite(c.sensorRadius, 9));
    const focalLength = Math.max(0.01, finite(c.focalLength, 25));
    const defaultEdge = Math.atan(sensorRadius / (position === 'afocalBetween' ? nvFocal : focalLength)) / DEG;
    return {
      position, mode, beamF: localF, filterFNumber: localF,
      imageFNumber: finalF, finalF, effectiveEntranceF, telescopeF, eyepieceFocal, nvFocal, nvF,
      edgeAngleDeg: finite(c.edgeAngleDeg, defaultEdge),
      angleSemantics,
      pupilFilledDiameter: afocal ? Math.min(nvFocal / nvF, eyepieceFocal / telescopeF) : null
    };
  }

  function coneQ(fNumber, nEff, sampleCount) {
    const n = Math.max(32, Math.round(sampleCount || 192));
    const a = 1 / (4 * fNumber * fNumber * nEff * nEff);
    const q = new Float64Array(n);
    for (let i = 0; i < n; i++) q[i] = Math.sqrt(1 - a * (i + 0.5) / n);
    return q;
  }

  // width: FWHM in nm. Offset is the positive RED shift of the normal-incidence
  // passband. designF is intentionally independent of the actual optical beam.
  function optimizedOffset(width, designF, lineNm, nEff) {
    width = Math.max(0.01, finite(width, 7));
    designF = Math.max(0.51, finite(designF, 2));
    lineNm = finite(lineNm, 656.28);
    nEff = Math.max(1.01, finite(nEff, 2));
    const key = [width, designF, lineNm, nEff].join('|');
    if (offsetCache.has(key)) return offsetCache.get(key);
    const q = coneQ(designF, nEff, 384);
    const maxOffset = lineNm * (1 / Math.sqrt(1 - 1 / (4 * designF * designF * nEff * nEff)) - 1);
    function merit(offset) {
      let sum = 0;
      for (let i = 0; i < q.length; i++) sum += profile(lineNm / q[i] - lineNm - offset, width);
      return sum / q.length;
    }
    // Coarse search followed by local golden-section refinement avoids any
    // assumption that a midpoint shift maximizes the actual pupil average.
    const steps = 80;
    let best = 0, bestValue = -1;
    for (let i = 0; i <= steps; i++) {
      const x = maxOffset * i / steps, y = merit(x);
      if (y > bestValue) { best = x; bestValue = y; }
    }
    let a = Math.max(0, best - maxOffset / steps);
    let b = Math.min(maxOffset, best + maxOffset / steps);
    const ratio = (Math.sqrt(5) - 1) / 2;
    let x1 = b - ratio * (b - a), x2 = a + ratio * (b - a);
    let y1 = merit(x1), y2 = merit(x2);
    for (let i = 0; i < 38; i++) {
      if (y1 < y2) { a = x1; x1 = x2; y1 = y2; x2 = a + ratio * (b - a); y2 = merit(x2); }
      else { b = x2; x2 = x1; y2 = y1; x1 = b - ratio * (b - a); y1 = merit(x1); }
    }
    const result = (a + b) / 2;
    offsetCache.set(key, result);
    return result;
  }

  function compile(config) {
    const c = config || {};
    const geo = geometry(c);
    const width = Math.max(0.01, finite(c.width, 7));
    const nEff = Math.max(1.01, finite(c.nEff, 2));
    const designF = Math.max(0.51, finite(c.designF, 2));
    const kind = String(c.filterKind || c.kind || 'ha').toLowerCase();
    const mainLines = kind === 'dual' || kind === 'dualband' ? [656.28, 500.7]
      : kind === 'oiii' || kind === 'o3' ? [500.7] : [656.28];
    const bands = mainLines.map((line, index) => {
      const offset = c.offsets && c.offsets[index] !== undefined ? Number(c.offsets[index])
        : c.offset !== undefined ? Number(c.offset)
        : c.optimized === true ? optimizedOffset(width, designF, line, nEff) : 0;
      return { line, center: line + offset, offset, width };
    });
    const rawLines = c.lines || DEFAULT_LINES;
    const lines = rawLines.map(line => ({
      name: line.name || line.label || String(line.wavelength || line.nm),
      wavelength: finite(line.wavelength, finite(line.nm, 656.28)),
      weight: Math.max(0, finite(line.weight, finite(line.intensity, 1)))
    }));
    return { config: c, geo, width, nEff, designF, kind, bands, lines };
  }

  function incidenceQ(model, angleDeg) {
    const { config: c, geo, nEff } = model;
    if (geo.mode === 'ideal') return new Float64Array([1]);
    const alpha = finite(angleDeg, finite(c.angleDeg, 0)) * DEG;
    if (Math.abs(alpha) >= Math.PI / 2) throw new RangeError('Filter incidence angle must be less than 90 degrees.');
    if (geo.mode === 'parallel') {
      return new Float64Array([Math.sqrt(1 - Math.sin(alpha) ** 2 / (nEff * nEff))]);
    }
    if (Math.abs(alpha) < 1e-12) return coneQ(geo.beamF, nEff, c.pupilSamples);
    // Optional tilted cone. Default rear model uses angleDeg = 0 everywhere.
    const radialCount = Math.max(24, Math.round(finite(c.pupilSamples, 96)));
    const azimuthCount = Math.max(12, Math.round(finite(c.azimuthSamples, 24)));
    const qs = new Float64Array(radialCount * azimuthCount);
    let k = 0;
    for (let i = 0; i < radialCount; i++) {
      const sinTheta = Math.sqrt((i + 0.5) / radialCount) / (2 * geo.beamF);
      const cosTheta = Math.sqrt(1 - sinTheta * sinTheta);
      for (let j = 0; j < azimuthCount; j++) {
        const phi = 2 * Math.PI * (j + 0.5) / azimuthCount;
        const cosTotal = Math.cos(alpha) * cosTheta + Math.sin(alpha) * sinTheta * Math.cos(phi);
        qs[k++] = Math.sqrt(1 - (1 - cosTotal * cosTotal) / (nEff * nEff));
      }
    }
    return qs;
  }

  function throughputAtQ(wavelength, bands, qs, nominal) {
    let sum = 0;
    for (let i = 0; i < qs.length; i++) {
      let atAngle = 0;
      for (const band of bands) {
        atAngle += profile(wavelength / qs[i] - (nominal ? band.line : band.center), band.width);
      }
      // The two supported bands are widely separated, so overlap is negligible.
      sum += Math.min(1, atAngle);
    }
    return sum / qs.length;
  }

  function evaluateModel(model, angleDeg) {
    const qs = incidenceQ(model, angleDeg);
    let qMean = 0;
    for (const q of qs) qMean += q;
    qMean /= qs.length;
    let totalWeight = 0, lineSignal = 0, nominalLineSignal = 0;
    let targetWeight = 0, targetSignal = 0;
    const perLine = model.lines.map(line => {
      const transmission = throughputAtQ(line.wavelength, model.bands, qs, false);
      const nominalTransmission = throughputAtQ(line.wavelength, model.bands, [1], true);
      const signal = line.weight * transmission;
      lineSignal += signal;
      nominalLineSignal += line.weight * nominalTransmission;
      totalWeight += line.weight;
      const isMain = model.bands.some(band => Math.abs(band.line - line.wavelength) < 0.15);
      if (isMain) { targetWeight += line.weight; targetSignal += signal; }
      return { ...line, transmission, nominalTransmission, signal };
    });
    const equivalentWidth = qMean * model.bands.reduce((sum, band) => sum + EW_FACTOR * band.width, 0);
    const nominalEquivalentWidth = model.bands.reduce((sum, band) => sum + EW_FACTOR * band.width, 0);
    const imageF = model.geo.imageFNumber;
    const targetLineFraction = targetWeight > 0 ? targetSignal / targetWeight
      : model.bands.reduce((sum, band) => sum + throughputAtQ(band.line, model.bands, qs, false), 0) / model.bands.length;
    return {
      angleDeg: finite(angleDeg, finite(model.config.angleDeg, 0)),
      geometry: model.geo,
      bands: model.bands,
      perLine,
      lineSignal,
      totalLines: lineSignal,
      allLineSignal: lineSignal,
      lineFraction: totalWeight ? lineSignal / totalWeight : 0,
      allLineFraction: totalWeight ? lineSignal / totalWeight : 0,
      targetLineFraction,
      nominalLineSignal,
      nominalRatio: nominalLineSignal > 0 ? lineSignal / nominalLineSignal : 0,
      equivalentWidth,
      continuumEquivalentBandwidth: equivalentWidth,
      nominalEquivalentWidth,
      continuumFraction: equivalentWidth / nominalEquivalentWidth,
      lineToContinuum: lineSignal / equivalentWidth,
      contrastRatioToNominal: nominalLineSignal > 0 ? (lineSignal / equivalentWidth) / (nominalLineSignal / nominalEquivalentWidth) : 0,
      imageLineBrightness: lineSignal / (imageF * imageF),
      imageContinuumBrightnessPerUnitSpectralDensity: equivalentWidth / (imageF * imageF),
      meanQ: qMean
    };
  }

  function evaluate(config) {
    return evaluateModel(compile(config));
  }

  function transmission(wavelength, config) {
    const model = compile(config);
    return throughputAtQ(wavelength, model.bands, incidenceQ(model), false);
  }

  // A reusable wavelength sampler avoids repeated offset optimization and pupil
  // construction when plotting a transmission curve.
  function createSampler(config) {
    const model = compile(config);
    const qs = incidenceQ(model);
    const fn = wavelength => throughputAtQ(wavelength, model.bands, qs, false);
    fn.bands = model.bands;
    fn.geometry = model.geo;
    return fn;
  }

  // LUT coordinate is incidence CHIEF-RAY ANGLE IN DEGREES, uniform 0..maxAngleDeg.
  // For front placement this is true sky angle; for afocalBetween it is the
  // magnified output angle. Rear optics are telecentric when maxAngleDeg = 0.
  // Callers choose where their target lies within this angular coordinate.
  function radialProfile(config, options) {
    const model = compile(config);
    const opts = typeof options === 'number' ? { bins: options } : (options || {});
    const bins = Math.max(2, Math.round(finite(opts.bins, 256)));
    const maxAngleDeg = Math.max(0, finite(opts.maxAngleDeg,
      model.geo.mode === 'cone' || model.geo.mode === 'ideal' ? 0 : model.geo.edgeAngleDeg));
    const names = ['angleDeg', 'lineSignal', 'lineFraction', 'targetLineFraction', 'nominalRatio',
      'equivalentWidth', 'contrastRatioToNominal', 'imageLineBrightness',
      'imageContinuumBrightnessPerUnitSpectralDensity'];
    const output = { bins, maxAngleDeg, geometry: model.geo, bands: model.bands };
    for (const name of names) output[name] = new Float32Array(bins);
    output.perLine = model.lines.map(line => ({ ...line, transmission: new Float32Array(bins) }));
    let constant = null;
    for (let i = 0; i < bins; i++) {
      const angleDeg = maxAngleDeg * i / (bins - 1);
      const result = constant || evaluateModel(model, angleDeg);
      if (maxAngleDeg === 0) constant = result;
      for (const name of names) output[name][i] = result[name];
      for (let j = 0; j < model.lines.length; j++) output.perLine[j].transmission[i] = result.perLine[j].transmission;
    }
    output.totalLines = output.lineSignal;
    output.allLineSignal = output.lineSignal;
    output.continuumEquivalentBandwidth = output.equivalentWidth;
    output.nominalLineSignal = evaluateModel(model, 0).nominalLineSignal;
    return output;
  }

  function lookup(profileData, name, angleDeg) {
    const array = profileData[name];
    if (!array) throw new Error('Unknown profile quantity: ' + name);
    if (profileData.maxAngleDeg === 0) return array[0];
    const x = Math.min(array.length - 1, Math.max(0, Math.abs(angleDeg) / profileData.maxAngleDeg * (array.length - 1)));
    const i = Math.floor(x), j = Math.min(i + 1, array.length - 1), t = x - i;
    return array[i] * (1 - t) + array[j] * t;
  }

  const api = {
    version: '1.0.0', DEFAULT_LINES, EW_FACTOR,
    profile, geometry, optimizedOffset, transmission, createSampler,
    evaluate, radialProfile, lookup
  };
  root.M42Optics = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

