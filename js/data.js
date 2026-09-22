// Shared constants for the UI. Optical math lives in model/optics.js and model/field.js.

// Six emission lines approximated from the uploaded M42 spectrum (relative photon weights).
export const LINES = Object.freeze([
  { name: 'Hβ', wavelength: 486.13, weight: 0.19, color: 'hb' },
  { name: '[OIII] 4959', wavelength: 495.89, weight: 0.20, color: 'oiii' },
  { name: '[OIII] 5007', wavelength: 500.68, weight: 0.62, color: 'oiii' },
  { name: '[NII] 6548', wavelength: 654.80, weight: 0.065, color: 'nii' },
  { name: 'Hα', wavelength: 656.28, weight: 1, color: 'ha' },
  { name: '[NII] 6584', wavelength: 658.34, weight: 0.19, color: 'nii' }
]);

export const MAIN_LINE = { ha: 656.28, oiii: 500.7 };

export const S = 420;              // simulation grid of the M42 close-up
export const SKY = 0.005;          // flat sky continuum, model photons / nm
export const NEB_CONT = 0.002;     // nebular continuum, model photons / nm
export const FIELD = 0.5005;       // angular size of the close-up, degrees
export const TELESCOPE_FOCAL = 600;
export const NV_FOCAL = 26;
export const NV_F = 1.2;
export const N_EFF = 2;
export const PUPIL_SAMPLES = 384;

export const WIDTHS = [3, 5, 7, 10, 12, 15, 20, 25, 30];
export const FOCALS = [16, 25, 35, 50, 85, 135, 200, 300];
export const DESIGN_FS = [0.95, 1.2, 1.4, 2, 2.8, 4];
export const EYEPIECES = [55, 67];
export const F_RANGE = { direct: [0.95, 6], afocal: [2.8, 8] };
export const F_STOPS = { direct: [0.95, 1.2, 1.4, 2, 2.8, 4], afocal: [2.8, 4, 5.6, 8] };

export const BANDS = [
  { value: 'ha', label: 'Hα', note: '氢 656.3 nm 红光' },
  { value: 'oiii', label: 'OIII', note: '氧 500.7 nm 蓝绿光' },
  { value: 'dual', label: 'Hα + OIII', note: '双窄带，两个通带各为所选带宽' }
];

export const POSITION_NAMES = {
  front: '前置滤镜',
  rear: '后置滤镜',
  afocalBefore: '目镜入光端',
  afocalBetween: '夜视物镜前',
  afocalAfter: '夜视物镜后'
};

// Where the filter sits, phrased as a place (used in sentences).
export const POSITION_PLACES = {
  front: '镜头前', rear: '镜头后', afocalBefore: '目镜入光端', afocalBetween: '目镜与夜视物镜之间', afocalAfter: '夜视物镜后'
};

export const POSITION_NOTES = {
  front: '天体 → 滤镜 → 镜头 → 像面。中心天体的光近乎正入射，越靠边越斜。',
  rear: '天体 → 镜头 → 滤镜 → 像面。光已经汇聚成光锥，画面中心也有大量斜光。',
  afocalBefore: '滤镜装在目镜鼻端，接到望远镜正在汇聚的光锥。',
  afocalBetween: '滤镜在目镜与夜视物镜之间：每个天体的光近似平行，但边缘倾角被目镜放大。',
  afocalAfter: '滤镜在夜视物镜与阴极之间：光再次汇聚，要按最终成像焦比计算。'
};

export const fmtF = n => 'F' + Number(n).toFixed(2).replace(/0$/, '').replace(/\.0$/, '');
export const fmtPct = (x, digits = 0) => x == null || !Number.isFinite(x) ? '—' : (x * 100).toFixed(digits) + '%';
export const fmtDeg = x => Number(x).toFixed(1) + '°';
