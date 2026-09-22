// Single source of truth for UI state, with URL-hash sharing and local persistence.
import { WIDTHS, FOCALS, DESIGN_FS, EYEPIECES, F_RANGE } from './data.js';

export const DEFAULTS = Object.freeze({
  compare: 'position',      // focal | position | design
  path: 'direct',           // direct | afocal
  pos: 'rear',              // front | rear (direct, single position)
  afocalPos: 'afocalBefore',// afocalBefore | afocalBetween | afocalAfter
  afocalPair: 'before',     // before | between (position comparison in afocal)
  filter: 'normal',         // normal | optimized (focal/position comparisons)
  focal: 85, focalR: 85,
  fDirect: 1.2, fAfocal: 4,
  eyepiece: 67,
  band: 'ha', width: 7, design: 2,
  angleDirect: 0, angleAfocal: 0,
  display: 'fixed',         // fixed | sky
  color: 'gray',            // gray | false
  view: 'side',             // side | wipe | blink
  tab: 'spectrum',          // spectrum | field | rays | overview
  fieldView: 'transmission',
  rayMode: 'follow',        // follow | principle
  overviewMetric: 'target', // target | contrast
  overviewSide: 1
});

// Short keys keep shared links readable.
const KEYS = {
  compare: 'c', path: 'p', pos: 'pos', afocalPos: 'ap', afocalPair: 'pair', filter: 'flt',
  focal: 'fl', focalR: 'fr', fDirect: 'f', fAfocal: 'tf', eyepiece: 'ep', band: 'b', width: 'w',
  design: 'd', angleDirect: 'a', angleAfocal: 'aa', display: 'disp', color: 'col', view: 'v', tab: 't',
  fieldView: 'fv', rayMode: 'rm', overviewMetric: 'om', overviewSide: 'os'
};

const ENUMS = {
  compare: ['focal', 'position', 'design'], path: ['direct', 'afocal'], pos: ['front', 'rear'],
  afocalPos: ['afocalBefore', 'afocalBetween', 'afocalAfter'], afocalPair: ['before', 'between'],
  filter: ['normal', 'optimized'], band: ['ha', 'oiii', 'dual'], display: ['fixed', 'sky'],
  color: ['gray', 'false'], view: ['side', 'wipe', 'blink'], tab: ['spectrum', 'field', 'rays', 'overview'],
  fieldView: ['transmission', 'scene'], rayMode: ['follow', 'principle'], overviewMetric: ['target', 'contrast']
};
const LISTS = { focal: FOCALS, focalR: FOCALS, width: WIDTHS, design: DESIGN_FS, eyepiece: EYEPIECES, overviewSide: [0, 1] };
const RANGES = { fDirect: F_RANGE.direct, fAfocal: F_RANGE.afocal, angleDirect: [0, 45], angleAfocal: [0, 45] };

function sanitize(key, raw) {
  if (ENUMS[key]) return ENUMS[key].includes(raw) ? raw : undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  if (LISTS[key]) return LISTS[key].includes(n) ? n : undefined;
  if (RANGES[key]) return Math.min(RANGES[key][1], Math.max(RANGES[key][0], n));
  return undefined;
}

export function fromParams(params) {
  const out = {};
  for (const [key, short] of Object.entries(KEYS)) {
    if (!params.has(short)) continue;
    const value = sanitize(key, params.get(short));
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export function toHash(state) {
  const params = new URLSearchParams();
  for (const [key, short] of Object.entries(KEYS)) {
    if (state[key] !== DEFAULTS[key]) params.set(short, String(state[key]));
  }
  const text = params.toString();
  return text ? '#' + text : '';
}

const STORAGE_KEY = 'nvastro.state.v1';
const safeStorage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* storage unavailable */ } }
};
export { safeStorage };

export function loadInitial() {
  const hash = location.hash.slice(1);
  if (hash) return { ...DEFAULTS, ...fromParams(new URLSearchParams(hash)) };
  const saved = safeStorage.get(STORAGE_KEY);
  if (saved) return { ...DEFAULTS, ...fromParams(new URLSearchParams(saved)) };
  return { ...DEFAULTS };
}

export function persist(state) {
  const hash = toHash(state);
  safeStorage.set(STORAGE_KEY, hash.slice(1));
  const url = location.pathname + location.search + hash;
  if (url !== location.pathname + location.search + location.hash) history.replaceState(null, '', url);
}

// Typical scenarios from the original discussion. Each is a patch on top of the defaults.
export const PRESETS = [
  { id: 'rear-f12', icon: 'i-swap', title: '前置 vs 后置 · F1.2 · 7 nm',
    note: '同一片普通 Hα 滤镜，只换位置：后置中心也会掉光。',
    patch: { compare: 'position', path: 'direct', fDirect: 1.2, band: 'ha', width: 7, filter: 'normal', angleDirect: 0, tab: 'spectrum' } },
  { id: 'wide-vs-tele', icon: 'i-lens', title: '25 mm vs 85 mm · 前置边缘',
    note: '同为 F1.2 前置：广角把更斜的天区收进画面，边缘先变暗。',
    patch: { compare: 'focal', path: 'direct', pos: 'front', focal: 25, focalR: 85, fDirect: 1.2, band: 'ha', width: 7, filter: 'normal', angleDirect: 5, tab: 'field' } },
  { id: 'afocal-f4', icon: 'i-scope', title: '无焦 F4 + 67 mm · 滤镜装哪',
    note: '目镜入光端只承受 F4 光锥；夜视物镜后要承受约 F1.55。',
    patch: { compare: 'position', path: 'afocal', afocalPair: 'before', fAfocal: 4, eyepiece: 67, band: 'ha', width: 7, filter: 'normal', tab: 'rays' } },
  { id: 'opt-8deg', icon: 'i-spark', title: '优化滤镜前置：为何 8° 最亮',
    note: '按 F2 预偏置的 3 nm 片，正入射反而偏开，斜 8° 才对准。',
    patch: { compare: 'design', path: 'direct', pos: 'front', focal: 25, fDirect: 1.2, band: 'ha', width: 3, design: 2, angleDirect: 8, tab: 'overview', overviewSide: 1 } },
  { id: 'opt-3nm', icon: 'i-filter', title: '3 nm · F1.4 后置：普通 vs 优化',
    note: '极窄带在快镜后置时，预补偿能救回多少？',
    patch: { compare: 'design', path: 'direct', pos: 'rear', fDirect: 1.4, band: 'ha', width: 3, design: 1.4, tab: 'spectrum' } },
  { id: 'wide-30', icon: 'i-width', title: '30 nm 宽带：更耐偏移，背景也更亮',
    note: '用“统一天空”看星云是否真的更突出。',
    patch: { compare: 'position', path: 'direct', fDirect: 1.2, band: 'ha', width: 30, filter: 'normal', display: 'sky', tab: 'overview' } }
];
