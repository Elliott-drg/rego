// Import de données géographiques : analyseurs purs (GeoJSON, CSV/TSV) + fenêtre d'import.
//
// Règle : on ne positionne jamais une donnée dont on ne connaît pas le référentiel. Les coordonnées
// acceptées sont des degrés sélénographiques (longitude Est positive) ; tout le reste est refusé
// avec un message clair. Dans les fichiers, l'ordre GeoJSON est [longitude, latitude] ; dans l'état
// de l'application (`state.imports`), l'ordre est [latitude, longitude].
//
// Les analyseurs ne renvoient que des codes (`code`, `detail`) : la traduction se fait dans l'interface.

import { state, set, on, emit, toast } from '../core/store.js';
import { t, int, deg } from '../core/i18n.js';
import '../i18n/tools.js';
import { wrapLon, unitFromLatLon, latLonFromUnit } from '../core/coords.js';
import { cat } from '../layers/palettes.js';
import { layers } from '../layers/manager.js';
import { h, clear, button, download } from './dom.js';
import { icon } from './icons.js';
import { openModal, closeModal } from './modal.js';

// ------------------------------------------------------------------ Constantes
export const MAX_FILE_BYTES = 25 * 1024 * 1024;   // au-delà, la lecture figerait la page
export const MAX_STORED_CHARS = 2_000_000;        // plafond de la mémorisation locale (~2 Mo)
const STORAGE_KEY = 'rf.imports';
const REJECT_LIST_MAX = 60;                       // lignes rejetées affichées (toutes sont comptées)

/** Formats lus par cette version, par extension. */
const EXT_FORMAT = { geojson: 'geojson', json: 'geojson', csv: 'csv', tsv: 'csv', txt: 'csv' };
/** Formats connus mais non lus : ils sont nommés dans l'interface, jamais proposés. */
export const UNSUPPORTED_FORMATS = {
  raster: ['GeoTIFF', 'TIFF', 'NetCDF', 'HDF5', 'FITS'],
  model3d: ['OBJ/MTL', 'GLB/GLTF', 'STL', 'PLY', 'FBX', 'USDZ', '3MF'],
};
/** Couleurs proposées : jeu Okabe-Ito de palettes.js, lisible pour les trois daltonismes. */
const COLOR_KEYS = ['import', 'mission', 'a', 'b', 'historic', 'artemis'];
export const IMPORT_COLORS = COLOR_KEYS.map((k) => ({ key: k, hex: cat(k, 'deuteranopia') }));

const stripBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);
const fail = (code, detail = '') => ({ ok: false, error: { code, detail } });

// ------------------------------------------------------------------ Résultat commun aux deux analyseurs
function newResult(format) {
  return { ok: true, format, features: [], rejected: [], warnings: [], counts: { point: 0, line: 0, polygon: 0 }, outOfRange: 0, bbox: null };
}
function reject(out, where, code, detail = '') {
  out.rejected.push({ where, code, detail });
  if (code === 'out_of_range') out.outOfRange++;
}
function warn(out, code) { if (!out.warnings.includes(code)) out.warnings.push(code); }
function addFeature(out, feature) { out.features.push(feature); out.counts[feature.type]++; }
function finish(out) { out.bbox = featuresBounds(out.features); return out; }

/** Emprise en latitude/longitude d'une liste d'entités ([lat, lon]) ; null si vide. */
export function featuresBounds(features) {
  let latMin = Infinity, latMax = -Infinity, lonMin = Infinity, lonMax = -Infinity;
  for (const f of features) for (const [lat, lon] of f.coords) {
    if (lat < latMin) latMin = lat; if (lat > latMax) latMax = lat;
    if (lon < lonMin) lonMin = lon; if (lon > lonMax) lonMax = lon;
  }
  return Number.isFinite(latMin) ? { latMin, latMax, lonMin, lonMax } : null;
}
/** Centre d'un jeu : direction moyenne des sommets (valable aussi autour du pôle et de l'antiméridien). */
export function featuresCenter(features) {
  const s = [0, 0, 0];
  for (const f of features) for (const [lat, lon] of f.coords) { const u = unitFromLatLon(lat, lon); s[0] += u[0]; s[1] += u[1]; s[2] += u[2]; }
  return Math.hypot(s[0], s[1], s[2]) > 1e-9 ? latLonFromUnit(s) : null;
}

/** Valide une position et la convertit : latitude dans [-90, 90], longitude dans [-180, 360] ramenée à ±180. */
function checkLatLon(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { code: 'coords_invalid' };
  if (lat < -90 || lat > 90 || lon < -180 || lon > 360) return { code: 'out_of_range' };
  return { lat, lon: lon > 180 || lon === -180 ? wrapLon(lon) : lon };   // une longitude déjà dans ±180 est gardée telle quelle
}

// ------------------------------------------------------------------ GeoJSON
/**
 * Référentiel déclaré par le membre `crs` (GeoJSON 2008).
 * kind : 'none' (absent) · 'lunar' (géographique lunaire) · 'earth' (WGS 84, degrés) · 'other' (refusé).
 */
export function classifyCrs(crs) {
  if (crs === undefined || crs === null) return { kind: 'none', name: '' };
  const name = crs && crs.type === 'name' && crs.properties ? String(crs.properties.name ?? '') : '';
  if (!name) return { kind: 'other', name: crs && crs.type === 'link' && crs.properties ? String(crs.properties.href ?? 'link') : JSON.stringify(crs).slice(0, 80) };
  const n = name.toUpperCase();
  // Codes géographiques de la Lune : IAU 30100 (sphère, planétocentrique), ESRI 104903 (GCS_Moon_2000).
  if (/IAU[_:]?(2000|2015)?:[\d.]*:?30100$/.test(n) || /ESRI:[\d.]*:?104903$/.test(n) || /^GCS[_ ]MOON/.test(n)) return { kind: 'lunar', name };
  if (/(^|:)CRS84$/.test(n) || /EPSG:[\d.]*:?4326$/.test(n)) return { kind: 'earth', name };
  return { kind: 'other', name };
}

const NAME_KEYS = ['name', 'Name', 'NAME', 'nom', 'Nom', 'title', 'titre', 'label', 'id'];
function pickName(props, id) {
  for (const k of NAME_KEYS) { const v = props?.[k]; if ((typeof v === 'string' && v.trim()) || typeof v === 'number') return String(v).trim(); }
  return typeof id === 'string' || typeof id === 'number' ? String(id) : undefined;
}
/** Ne garde que les propriétés simples (texte, nombre, booléen) ; les textes longs sont coupés. */
function cleanProps(props) {
  if (!props || typeof props !== 'object') return undefined;
  const out = {};
  for (const [k, v] of Object.entries(props)) {
    if (typeof v === 'string') out[k] = v.length > 200 ? v.slice(0, 200) : v;
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Positions GeoJSON [lon, lat(, alt)] -> [[lat, lon], …] ou {code, detail} à la première position refusée. */
function convertPositions(out, positions, minCount) {
  if (!Array.isArray(positions) || positions.length < minCount) return { code: 'coords_invalid' };
  const coords = [];
  for (const p of positions) {
    if (!Array.isArray(p) || p.length < 2) return { code: 'coords_invalid' };
    const r = checkLatLon(p[1], p[0]);
    if (r.code) return { code: r.code, detail: `${p[0]}, ${p[1]}` };
    if (p.length > 2) warn(out, 'z_ignored');
    coords.push([r.lat, r.lon]);
  }
  return coords;
}

function addGeoFeature(out, f, index) {
  if (!f || typeof f !== 'object' || f.type !== 'Feature') return reject(out, index, 'not_feature');
  const g = f.geometry;
  if (!g || typeof g !== 'object') return reject(out, index, 'geom_null');
  const name = pickName(f.properties, f.id), props = cleanProps(f.properties);
  const push = (type, positions, minCount) => {
    const coords = convertPositions(out, positions, minCount);
    if (!Array.isArray(coords)) return reject(out, index, coords.code, coords.detail);
    addFeature(out, { type, coords, ...(name !== undefined ? { name } : {}), ...(props ? { props } : {}) });
  };
  const each = (list, fn) => (Array.isArray(list) && list.length ? list.forEach(fn) : reject(out, index, 'coords_invalid'));
  // L'état de l'application ne décrit qu'un contour par polygone : les trous sont signalés, pas dessinés.
  const polygon = (rings) => {
    if (!Array.isArray(rings) || !rings.length) return reject(out, index, 'coords_invalid');
    if (rings.length > 1) warn(out, 'holes_ignored');
    push('polygon', rings[0], 4);
  };
  switch (g.type) {
    case 'Point': push('point', [g.coordinates], 1); break;
    case 'MultiPoint': each(g.coordinates, (p) => push('point', [p], 1)); break;
    case 'LineString': push('line', g.coordinates, 2); break;
    case 'MultiLineString': each(g.coordinates, (l) => push('line', l, 2)); break;
    case 'Polygon': polygon(g.coordinates); break;
    case 'MultiPolygon': each(g.coordinates, polygon); break;
    default: reject(out, index, 'geom_unsupported', String(g.type ?? ''));
  }
}

const GEOMETRY_TYPES = new Set(['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon']);

/**
 * Analyse un GeoJSON. Coordonnées lues comme [longitude, latitude] en degrés sélénographiques.
 * @returns {{ok:true, format:'geojson', crs, features, rejected, warnings, counts, outOfRange, bbox} | {ok:false, error:{code, detail}}}
 */
export function parseGeoJSON(text) {
  const src = stripBom(String(text ?? '')).trim();
  if (!src) return fail('empty');
  let root;
  try { root = JSON.parse(src); } catch (e) { return fail('json', e.message); }
  if (!root || typeof root !== 'object' || Array.isArray(root)) return fail('not_geojson');
  const crs = classifyCrs(root.crs);
  if (crs.kind === 'other') return fail('crs', crs.name);
  let list;
  if (root.type === 'FeatureCollection' && Array.isArray(root.features)) list = root.features;
  else if (root.type === 'Feature') list = [root];
  else if (GEOMETRY_TYPES.has(root.type)) list = [{ type: 'Feature', geometry: root, properties: null }];
  else return fail('not_geojson', typeof root.type === 'string' ? root.type : '');
  if (!list.length) return fail('no_features');
  const out = newResult('geojson');
  out.crs = crs;
  if (crs.kind === 'none') warn(out, 'crs_assumed'); else if (crs.kind === 'earth') warn(out, 'crs_earth');
  list.forEach((f, i) => addGeoFeature(out, f, i + 1));
  return finish(out);
}

/** Jeu importé -> FeatureCollection GeoJSON ([longitude, latitude], anneaux refermés). */
export function datasetToGeoJSON(dataset) {
  const pos = ([lat, lon]) => [lon, lat];
  const ring = (coords) => {
    const r = coords.map(pos), a = r[0], b = r[r.length - 1];
    if (a[0] !== b[0] || a[1] !== b[1]) r.push([a[0], a[1]]);
    return r;
  };
  return {
    type: 'FeatureCollection',
    name: dataset.name,
    features: dataset.features.map((f) => ({
      type: 'Feature',
      properties: { ...(f.props || {}), ...(f.name !== undefined ? { name: f.name } : {}) },
      geometry: f.type === 'point' ? { type: 'Point', coordinates: pos(f.coords[0]) }
        : f.type === 'line' ? { type: 'LineString', coordinates: f.coords.map(pos) }
          : { type: 'Polygon', coordinates: [ring(f.coords)] },
    })),
  };
}

// ------------------------------------------------------------------ CSV / TSV
const DELIMITERS = ['\t', ';', ','];   // ordre de préférence à égalité (« ; » avant « , » : virgules décimales)

function countOutsideQuotes(line, ch) {
  let n = 0, quoted = false;
  for (const c of line) { if (c === '"') quoted = !quoted; else if (c === ch && !quoted) n++; }
  return n;
}
/** Séparateur le plus plausible : présent sur toutes les premières lignes, de préférence en nombre constant. */
export function detectDelimiter(text) {
  const lines = stripBom(text).split(/\r\n|\n|\r/).filter((l) => l.trim()).slice(0, 20);
  let best = ',', bestScore = 0;
  for (const d of DELIMITERS) {
    const counts = lines.map((l) => countOutsideQuotes(l, d)), min = Math.min(...counts);
    if (min < 1) continue;
    const score = min + (counts.every((c) => c === counts[0]) ? 1000 : 0);
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}

/**
 * Découpe un texte tabulaire en enregistrements (guillemets doubles façon RFC 4180, "" = guillemet).
 * @returns {Array<{line:number, cells:string[]}>} `line` = numéro de la ligne du fichier (à partir de 1) ; lignes vides ignorées
 */
export function splitDelimited(text, delimiter) {
  const out = [];
  let cells = [], cell = '', quoted = false, line = 1, startLine = 1;
  const endRecord = () => {
    cells.push(cell); cell = '';
    if (cells.some((c) => c.trim() !== '')) out.push({ line: startLine, cells });
    cells = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else { if (c === '\n') line++; cell += c; }
    } else if (c === '"' && cell.trim() === '') { quoted = true; cell = ''; }
    else if (c === delimiter) { cells.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      endRecord(); line++; startLine = line;
    } else cell += c;
  }
  if (cell !== '' || cells.length) endRecord();
  return out;
}

/**
 * Lit une coordonnée en degrés décimaux : « -85.3 », « 85,3 » (si `decimalComma`), « 85.3S », « S 85.3 », « 31°O ».
 * axis : 'lat' (N/S admis) · 'lon' (E/W/O admis) · 'any' (détection d'en-tête). NaN si illisible ou contradictoire.
 */
export function parseCoordinate(raw, axis, decimalComma = false) {
  const m = String(raw ?? '').trim().toUpperCase().match(/^([NSEWO])?\s*([+\-−]?[\d.,]+)\s*[°º]?\s*([NSEWO])?$/);
  if (!m || (m[1] && m[3])) return NaN;
  const hemi = m[1] || m[3] || '';
  let body = m[2].replace('−', '-');
  if (decimalComma && body.includes(',') && !body.includes('.')) body = body.replace(',', '.');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(body)) return NaN;
  let v = Number(body);
  if (hemi) {
    const allowed = axis === 'lat' ? 'NS' : axis === 'lon' ? 'EWO' : 'NSEWO';
    if (!allowed.includes(hemi) || /^[+-]/.test(body)) return NaN;   // signe + hémisphère : contradictoire
    if ('SWO'.includes(hemi)) v = -v;
  }
  return v === 0 ? 0 : v;
}

const normHeader = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const LAT_TOKENS = new Set(['lat', 'latitude', 'latitud']);
const LON_TOKENS = new Set(['lon', 'long', 'longitude', 'longitud', 'lng']);
const NAME_TOKENS = new Set(['name', 'nom', 'site', 'label', 'title', 'titre', 'feature', 'id']);
const XY_TOKENS = new Set(['x', 'y', 'easting', 'northing']);

/**
 * Repère les colonnes latitude / longitude / nom d'après les en-têtes.
 * `confident` n'est vrai que s'il y a exactement une colonne possible pour chaque axe ; sinon l'utilisateur choisit.
 * reason : '' · 'no_header' · 'ambiguous' · 'xy' (colonnes x/y : référentiel inconnu) · 'not_found'.
 */
export function detectColumns(columns, hasHeader) {
  const none = { lat: -1, lon: -1, name: -1, confident: false };
  if (!hasHeader) return { ...none, reason: 'no_header' };
  const tokens = columns.map((c) => normHeader(c).split(' '));
  const find = (set_) => tokens.map((tk, i) => (tk.some((x) => set_.has(x)) ? i : -1)).filter((i) => i >= 0);
  const lats = find(LAT_TOKENS), lons = find(LON_TOKENS).filter((i) => !lats.includes(i));
  const names = find(NAME_TOKENS).filter((i) => !lats.includes(i) && !lons.includes(i));
  const name = names.length ? names[0] : -1;
  if (lats.length === 1 && lons.length === 1) return { lat: lats[0], lon: lons[0], name, confident: true, reason: '' };
  if (!lats.length && !lons.length) return { ...none, name, reason: find(XY_TOKENS).length ? 'xy' : 'not_found' };
  return { ...none, name, reason: lats.length && lons.length ? 'ambiguous' : 'not_found' };
}

/**
 * Lit la structure d'un CSV/TSV (séparateur, en-tête, colonnes) sans encore interpréter les coordonnées.
 * @returns {{ok:true, format:'csv', delimiter, decimalComma, hasHeader, columns:string[], rows:Array<{line, cells}>, detected} | {ok:false, error}}
 */
export function analyzeCSV(text) {
  const src = stripBom(String(text ?? ''));
  if (!src.trim()) return fail('empty');
  const delimiter = detectDelimiter(src);
  const records = splitDelimited(src, delimiter);
  let width = 0;
  for (const r of records) if (r.cells.length > width) width = r.cells.length;
  if (width < 2) return fail('one_column');
  // La virgule décimale n'est admise que si elle ne peut pas être confondue avec le séparateur.
  const decimalComma = delimiter !== ',';
  const first = records[0].cells;
  const hasHeader = first.some((c) => /[a-z]/i.test(c)) && first.every((c) => !Number.isFinite(parseCoordinate(c, 'any', decimalComma)));
  const rows = hasHeader ? records.slice(1) : records;
  if (!rows.length) return fail('no_rows');
  const columns = Array.from({ length: width }, (_, i) => (hasHeader ? (first[i] ?? '').trim() : ''));
  return { ok: true, format: 'csv', delimiter, decimalComma, hasHeader, columns, rows, detected: detectColumns(columns, hasHeader) };
}

/**
 * Convertit les lignes d'un tableau analysé en points, avec les colonnes choisies.
 * Chaque ligne refusée est conservée dans `rejected` (numéro de ligne, raison, contenu).
 */
export function csvToFeatures(table, cols) {
  const out = newResult('csv');
  const { lat: iLat, lon: iLon, name: iName = -1 } = cols;
  for (const { line, cells } of table.rows) {
    const raw = cells.join(table.delimiter === '\t' ? ' | ' : table.delimiter).slice(0, 120);
    if (cells.length <= Math.max(iLat, iLon)) { reject(out, line, 'short_row', raw); continue; }
    const lat = parseCoordinate(cells[iLat], 'lat', table.decimalComma), lon = parseCoordinate(cells[iLon], 'lon', table.decimalComma);
    if (!Number.isFinite(lat)) { reject(out, line, 'lat_invalid', raw); continue; }
    if (!Number.isFinite(lon)) { reject(out, line, 'lon_invalid', raw); continue; }
    const r = checkLatLon(lat, lon);
    if (r.code) { reject(out, line, r.code, raw); continue; }
    const props = {};
    cells.forEach((c, i) => { const v = c.trim(); if (i !== iLat && i !== iLon && i !== iName && v && table.columns[i]) props[table.columns[i]] = v.slice(0, 200); });
    const name = iName >= 0 ? (cells[iName] ?? '').trim() : '';
    addFeature(out, { type: 'point', coords: [[r.lat, r.lon]], ...(name ? { name } : {}), ...(Object.keys(props).length ? { props } : {}) });
  }
  return finish(out);
}

/** Format d'un fichier d'après son extension : 'geojson' | 'csv' | null (non pris en charge). */
export function formatOfFile(filename) {
  const ext = String(filename).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  return EXT_FORMAT[ext] ?? null;
}

// ------------------------------------------------------------------ Mémorisation locale
/** Jeux qui tiennent dans le plafond, dans l'ordre d'import ; les autres restent en mémoire vive seulement. */
export function planStorage(imports, maxChars = MAX_STORED_CHARS) {
  const kept = [], skipped = [];
  let used = 2;   // crochets du tableau JSON
  for (const ds of imports) {
    const size = JSON.stringify(ds).length + 1;
    if (used + size <= maxChars) { kept.push(ds); used += size; } else skipped.push(ds.id);
  }
  return { kept, skipped };
}
/** Ne garde que les jeux bien formés (un fichier de stockage abîmé ne doit pas bloquer l'application). */
export function sanitizeImports(value) {
  if (!Array.isArray(value)) return [];
  const okCoord = (c) => Array.isArray(c) && c.length === 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]) && Math.abs(c[0]) <= 90 && Math.abs(c[1]) <= 180;
  const okFeature = (f) => f && ['point', 'line', 'polygon'].includes(f.type) && Array.isArray(f.coords) && f.coords.length > 0 && f.coords.every(okCoord);
  return value.filter((d) => d && typeof d.id === 'string' && typeof d.name === 'string' && typeof d.color === 'string' && Array.isArray(d.features) && d.features.every(okFeature));
}

const sessionOnly = new Set();   // identifiants des jeux trop volumineux pour être mémorisés
function saveImports() {
  const { kept, skipped } = planStorage(state.imports);
  let stored = true;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(kept)); } catch { stored = false; }
  sessionOnly.clear();
  for (const id of stored ? skipped : state.imports.map((d) => d.id)) sessionOnly.add(id);
}
function restoreImports() {
  let saved = [];
  try { saved = sanitizeImports(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')); } catch { /* stockage indisponible ou illisible */ }
  if (saved.length && !state.imports.length) set({ imports: saved });
}
// Au chargement du module : on relit les jeux mémorisés, puis chaque changement est enregistré.
restoreImports();
on('change:imports', saveImports);

// ------------------------------------------------------------------ Fenêtre d'import
let draft = null;   // fichier en cours d'analyse : {filename, format, error?, table?, cols?, result?, name, color}
let seq = 0;

const countLabel = (n) => t(n > 1 ? 'tools.import.nFeatures' : 'tools.import.oneFeature', { n: int(n) });
const colorName = (hex) => t('tools.import.color.' + (IMPORT_COLORS.find((c) => c.hex === hex)?.key ?? 'custom'));
const errorText = (e) => t('tools.import.err.' + e.code, { detail: e.detail || '—' });

function analyzeDraft(filename, text) {
  const format = formatOfFile(filename);
  const base = { filename, format, name: filename.replace(/\.[^.]+$/, '').slice(0, 60), color: IMPORT_COLORS[state.imports.length % IMPORT_COLORS.length].hex };
  if (!format) return { ...base, error: { code: 'unsupported', detail: filename.match(/\.[^.]+$/)?.[0] ?? filename } };
  if (format === 'geojson') {
    const result = parseGeoJSON(text);
    return result.ok ? { ...base, result } : { ...base, error: result.error };
  }
  const table = analyzeCSV(text);
  if (!table.ok) return { ...base, error: table.error };
  const cols = { lat: table.detected.lat, lon: table.detected.lon, name: table.detected.name };
  return { ...base, table, cols, result: cols.lat >= 0 && cols.lon >= 0 ? csvToFeatures(table, cols) : null };
}

function readFile(file, api) {
  if (file.size > MAX_FILE_BYTES) {
    draft = { filename: file.name, error: { code: 'too_big', detail: int(file.size / 1048576) } };
    api.rerender(); return;
  }
  const reader = new FileReader();
  reader.onload = () => { draft = analyzeDraft(file.name, String(reader.result)); api.rerender(); };
  reader.onerror = () => { draft = { filename: file.name, error: { code: 'read', detail: reader.error?.message || '' } }; api.rerender(); };
  reader.readAsText(file, 'utf-8');
}

function dropZone(api) {
  const input = h('input', { type: 'file', class: 'imp-file', accept: '.geojson,.json,.csv,.tsv,.txt', 'aria-label': t('tools.import.choose'),
    onchange: () => { if (input.files[0]) readFile(input.files[0], api); input.value = ''; } });
  const zone = h('div', { class: 'imp-drop' },
    icon('upload', 26),
    h('div', { class: 'imp-drop-text' }, h('strong', {}, t('tools.import.drop')), h('span', { class: 'muted' }, t('tools.import.dropHint'))),
    h('label', { class: 'btn btn-primary imp-choose' }, t('tools.import.choose'), input));
  const over = (on_) => (e) => { e.preventDefault(); zone.classList.toggle('is-over', on_); };
  zone.addEventListener('dragover', over(true));
  zone.addEventListener('dragleave', over(false));
  zone.addEventListener('drop', (e) => { over(false)(e); const f = e.dataTransfer?.files?.[0]; if (f) readFile(f, api); });
  return zone;
}

function supportedFormats() {
  const item = (title, exts, text) => h('div', { class: 'card imp-format' }, h('div', { class: 'card-title' }, title, h('span', { class: 'mono dim' }, exts)), h('p', {}, text));
  return h('div', { class: 'imp-formats' },
    item('GeoJSON', '.geojson .json', t('tools.import.fmt.geojson')),
    item('CSV / TSV', '.csv .tsv .txt', t('tools.import.fmt.csv')));
}

function unsupportedNote() {
  return h('div', { class: 'note imp-unsupported' },
    h('strong', {}, t('tools.import.unsupported.title')),
    h('div', {}, `${t('tools.import.unsupported.raster')} ${UNSUPPORTED_FORMATS.raster.join(', ')}.`),
    h('div', {}, `${t('tools.import.unsupported.model3d')} ${UNSUPPORTED_FORMATS.model3d.join(', ')}.`),
    h('div', { class: 'dim' }, t('tools.import.unsupported.why')));
}

/** Choix manuel des colonnes d'un CSV + aperçu des 10 premières lignes. */
function csvColumns(api) {
  const { table, cols } = draft;
  const label = (i) => table.columns[i] || t('tools.import.colN', { n: i + 1 });
  const choose = (key, allowNone) => h('label', { class: 'field' }, h('span', {}, t('tools.import.col.' + key)),
    h('select', { class: 'input', dataset: { col: key }, onchange: (e) => {
      draft.cols = { ...draft.cols, [key]: Number(e.target.value) };
      const c = draft.cols;
      draft.result = c.lat >= 0 && c.lon >= 0 && c.lat !== c.lon ? csvToFeatures(table, c) : null;
      api.rerender();
      document.querySelector(`select[data-col="${key}"]`)?.focus();   // le redessin ne doit pas faire perdre le focus clavier
    } },
    h('option', { value: -1, selected: cols[key] < 0 }, allowNone ? t('tools.import.col.none') : t('tools.import.col.choose')),
    table.columns.map((_, i) => h('option', { value: i, selected: cols[key] === i }, label(i)))));
  const mark = (i) => (i === cols.lat ? 'lat' : i === cols.lon ? 'lon' : i === cols.name ? 'name' : null);
  const sep = { '\t': t('tools.import.sep.tab'), ';': t('tools.import.sep.semicolon'), ',': t('tools.import.sep.comma') }[table.delimiter];
  const reason = table.detected.reason;
  return h('div', { class: 'imp-csv' },
    h('div', { class: 'muted imp-csv-meta' }, t('tools.import.csvMeta', { sep, n: int(table.rows.length) }), ' ',
      table.hasHeader ? t('tools.import.csvHeader') : t('tools.import.csvNoHeader'), table.decimalComma ? ' ' + t('tools.import.csvDecimalComma') : ''),
    reason ? h('div', { class: 'note note-warn' }, t('tools.import.detect.' + reason)) : null,
    h('div', { class: 'form-grid' }, choose('lat', false), choose('lon', false), choose('name', true)),
    cols.lat >= 0 && cols.lat === cols.lon ? h('div', { class: 'note note-warn' }, t('tools.import.sameColumn')) : null,
    h('div', { class: 'imp-preview' }, h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, h('th', {}, t('tools.import.line')), table.columns.map((_, i) => h('th', { class: mark(i) ? 'is-used' : '' }, label(i), mark(i) ? h('small', {}, ` ${t('tools.import.role.' + mark(i))}`) : null)))),
      h('tbody', {}, table.rows.slice(0, 10).map((r) => h('tr', {}, h('td', { class: 'num dim' }, r.line), table.columns.map((_, i) => h('td', { class: 'mono' + (mark(i) ? ' is-used' : '') }, r.cells[i] ?? ''))))))));
}

function summary(result) {
  const { counts, bbox } = result, n = result.features.length;
  const kinds = ['point', 'line', 'polygon'].filter((k) => counts[k]).map((k) => `${int(counts[k])} ${t('tools.import.kind.' + k + (counts[k] > 1 ? 's' : ''))}`).join(' · ');
  const kv = (k, v, cls = '') => h('div', { class: 'kv ' + cls }, h('span', { class: 'kv-k' }, k), h('span', { class: 'kv-v' }, v));
  const other = result.rejected.length - result.outOfRange;
  return h('div', { class: 'card imp-summary' },
    kv(t('tools.import.sum.features'), n ? `${int(n)} (${kinds})` : int(0), 'kv-strong'),
    bbox ? kv(t('tools.import.sum.lat'), `${deg(bbox.latMin, 3)} → ${deg(bbox.latMax, 3)}`) : null,
    bbox ? kv(t('tools.import.sum.lon'), `${deg(bbox.lonMin, 3)} → ${deg(bbox.lonMax, 3)}`) : null,
    kv(t('tools.import.sum.outOfRange'), int(result.outOfRange), result.outOfRange ? 'is-warn' : ''),
    kv(t(result.format === 'csv' ? 'tools.import.sum.invalidRows' : 'tools.import.sum.invalidFeatures'), int(other), other ? 'is-warn' : ''),
    result.warnings.map((w) => h('div', { class: 'kv-note imp-warning' }, icon(w === 'crs_earth' ? 'warn' : 'info', 14), ' ', t('tools.import.warn.' + w, { name: result.crs?.name || '' }))));
}

function rejectedList(result) {
  if (!result.rejected.length) return null;
  const shown = result.rejected.slice(0, REJECT_LIST_MAX);
  const where = (r) => t(result.format === 'csv' ? 'tools.import.atLine' : 'tools.import.atFeature', { n: r.where });
  return h('details', { class: 'imp-rejected', open: result.rejected.length <= 8 },
    h('summary', {}, t('tools.import.rejected', { n: int(result.rejected.length) })),
    h('ul', {}, shown.map((r) => h('li', {}, h('span', { class: 'mono' }, where(r)), ' — ', t('tools.import.rej.' + r.code), r.detail ? h('span', { class: 'mono dim' }, ` (${r.detail})`) : null))),
    result.rejected.length > shown.length ? h('div', { class: 'dim' }, t('tools.import.rejectedMore', { n: int(result.rejected.length - shown.length) })) : null);
}

function colorPicker(api) {
  return h('div', { class: 'field' }, h('span', {}, t('tools.import.color')),
    h('div', { class: 'imp-colors', role: 'radiogroup', 'aria-label': t('tools.import.color') }, IMPORT_COLORS.map((c) =>
      h('button', { type: 'button', class: 'imp-color' + (draft.color === c.hex ? ' is-on' : ''), role: 'radio', 'aria-checked': String(draft.color === c.hex),
        title: colorName(c.hex), 'aria-label': colorName(c.hex), style: { background: c.hex }, onclick: () => { draft.color = c.hex; api.rerender(); document.querySelector('.imp-color.is-on')?.focus(); } },
      draft.color === c.hex ? icon('check', 14) : null)),
    h('span', { class: 'muted imp-color-name' }, colorName(draft.color))));
}

function addDraft(api) {
  const name = draft.name.trim() || draft.filename;
  const dataset = { id: `imp-${Date.now().toString(36)}-${++seq}`, name, color: draft.color, features: draft.result.features };
  set({ imports: [...state.imports, dataset] });
  if (layers.get('imports') && !layers.isOn('imports')) layers.toggle('imports', true);   // sinon le jeu ajouté resterait invisible
  toast(t('tools.import.added', { name, n: countLabel(dataset.features.length) }), 'ok');
  if (sessionOnly.has(dataset.id)) toast(t('tools.import.notStored', { name }), 'warn');
  draft = null;
  api.rerender();
}

function draftPanel(api) {
  const head = h('div', { class: 'imp-draft-head' }, icon('map', 16), h('strong', { class: 'imp-filename' }, draft.filename),
    draft.format ? h('span', { class: 'tag tag-computed' }, draft.format === 'geojson' ? 'GeoJSON' : 'CSV') : null);
  const cancel = button(t('ui.cancel'), () => { draft = null; api.rerender(); }, { kind: 'ghost' });
  if (draft.error) {
    return h('section', { class: 'imp-draft is-error' }, head,
      h('div', { class: 'note note-warn imp-error', role: 'alert' }, h('strong', {}, t('tools.import.refused')), ' ', errorText(draft.error)),
      h('div', { class: 'imp-actions' }, cancel));
  }
  const result = draft.result, n = result ? result.features.length : 0;
  return h('section', { class: 'imp-draft' }, head,
    draft.table ? csvColumns(api) : null,
    result ? summary(result) : null,
    result ? rejectedList(result) : null,
    result && !n ? h('div', { class: 'note note-warn', role: 'alert' }, t('tools.import.nothingValid')) : null,
    n ? h('div', { class: 'form-grid imp-naming' },
      h('label', { class: 'field' }, h('span', {}, t('tools.import.name')), h('input', { class: 'input', type: 'text', maxlength: 60, value: draft.name, oninput: (e) => { draft.name = e.target.value; } })),
      colorPicker(api)) : null,
    h('div', { class: 'imp-actions' }, cancel,
      button(t('tools.import.add'), () => addDraft(api), { kind: 'primary', icon: 'plus', disabled: !n })));
}

function flyToDataset(dataset) {
  const c = featuresCenter(dataset.features);
  if (!c) return;
  // Même règle que main.js : la carte 2D s'arrête à 75°S, un jeu plus au nord s'ouvre sur le globe.
  if (c.lat > -75 && state.view === 'map2d') set({ view: 'globe' });
  else if (state.view === 'compare') set({ view: c.lat > -75 ? 'globe' : 'map2d' });
  closeModal();
  emit('view:flyTo', { lat: c.lat, lon: c.lon });
}
function exportDataset(dataset) {
  const file = (dataset.name.replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '') || 'import') + '.geojson';
  download(file, JSON.stringify(datasetToGeoJSON(dataset), null, 1), 'application/geo+json');
}

function datasetList() {
  if (!state.imports.length) return h('div', { class: 'empty imp-empty' }, t('tools.import.none'));
  const act = (ic, key, fn, kind = '') => h('button', { type: 'button', class: 'iconbtn boxed ' + kind, title: t(key), 'aria-label': t(key), onclick: fn }, icon(ic, 16));
  return h('ul', { class: 'imp-list' }, state.imports.map((d) => h('li', { class: 'imp-set', dataset: { id: d.id } },
    h('span', { class: 'imp-swatch', style: { background: d.color }, title: colorName(d.color) }),
    h('div', { class: 'imp-set-text' }, h('strong', {}, d.name),
      h('span', { class: 'muted' }, countLabel(d.features.length), sessionOnly.has(d.id) ? ` · ${t('tools.import.sessionOnly')}` : '')),
    h('div', { class: 'imp-set-actions' },
      act('target', 'tools.import.center', () => flyToDataset(d)),
      act('download', 'tools.import.export', () => exportDataset(d)),
      act('trash', 'tools.import.delete', () => set({ imports: state.imports.filter((x) => x.id !== d.id) }), 'imp-del')))));
}

/** Ouvre la fenêtre d'import (glisser-déposer, analyse, jeux déjà importés). */
export function openImporter() {
  let off = () => {};
  const modal = openModal({
    id: 'importer',
    title: () => t('tools.import.title'),
    onClose: () => { off(); draft = null; },
    render: (body, api) => {
      const scrollTop = body.scrollTop;   // un redessin (choix d'une colonne, d'une couleur) garde la position de lecture
      clear(body).append(
        h('p', { class: 'muted imp-intro' }, t('tools.import.intro')),
        draft ? draftPanel(api) : h('div', {}, dropZone(api), supportedFormats()),
        h('h3', { class: 'sec-title imp-list-title' }, t('tools.import.listTitle'), h('span', {}, int(state.imports.length))),
        datasetList(),
        unsupportedNote());
      body.scrollTop = scrollTop;
    },
  });
  off = on('change:imports', () => modal.rerender());
}
