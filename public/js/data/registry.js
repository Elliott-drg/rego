// Registre des données embarquées (public/data). Chargement à la demande, avec suivi de progression.
// La provenance complète de chaque fichier est dans public/data/manifest.json (affichée par le Data Center).
//
//   await ensureData('sp_dem')            -> TypedArray | objet JSON
//   dataAvailable('sp_tmax')              -> false si le fichier n'a pas été livré / pas encore chargé
//   samplePolar('sp_sun_avg', lat, lon)   -> valeur physique (ou NaN) au point, pour les rasters polaires

import { emit } from '../core/store.js';
import { spXYFromLatLon } from '../core/coords.js';
import { SP_GRID, setDem } from '../science/terrain.js';

const N = SP_GRID.n;
export const DATASETS = {
  sp_dem: { file: 'sp_dem_240m.i16', type: 'i16', w: N, h: N, grid: 'polar', decode: (v) => v * 0.5, unit: 'm', core: true },
  sp_sun_avg: { file: 'sp_sun_avg_240m.u8', type: 'u8', w: N, h: N, grid: 'polar', decode: (v) => (v === 255 ? NaN : v / 2.5), unit: '%' },
  sp_earth_avg: { file: 'sp_earth_avg_240m.u8', type: 'u8', w: N, h: N, grid: 'polar', decode: (v) => (v === 255 ? NaN : v / 2.5), unit: '%' },
  sp_psr: { file: 'sp_psr_240m.u8', type: 'u8', w: N, h: N, grid: 'polar', decode: (v) => v, unit: '', nearest: true },
  sp_tmax: { file: 'sp_tmax_240m.u16', type: 'u16', w: N, h: N, grid: 'polar', decode: (v) => (v === 0 ? NaN : v / 10), unit: 'K', optional: true },
  sp_tmin: { file: 'sp_tmin_240m.u16', type: 'u16', w: N, h: N, grid: 'polar', decode: (v) => (v === 0 ? NaN : v / 10), unit: 'K', optional: true },
  sp_tavg: { file: 'sp_tavg_240m.u16', type: 'u16', w: N, h: N, grid: 'polar', decode: (v) => (v === 0 ? NaN : v / 10), unit: 'K', optional: true },
  global_ldem: { file: 'global_ldem_4ppd.i16', type: 'i16', w: 1440, h: 720, grid: 'global', decode: (v) => v, unit: 'm' },
  lpgrs: { file: 'lpgrs_5deg.json', type: 'json' },
  lp_hydrogen: { file: 'lp_hydrogen.json', type: 'json', optional: true },
  features: { file: 'features.json', type: 'json' },
  artemis_regions: { file: 'artemis_regions.json', type: 'json' },
  manifest: { file: 'manifest.json', type: 'json' },
};
const store = new Map();     // id -> données
const pending = new Map();   // id -> Promise
const failed = new Set();
let listing = null;          // noms de fichiers présents (d'après le manifeste), si connu

export function dataAvailable(id) { return store.has(id) || (!failed.has(id) && (!listing || listing.has(DATASETS[id]?.file))); }
export function dataLoaded(id) { return store.has(id); }
export function getData(id) { return store.get(id); }
export function dataFailed(id) { return failed.has(id); }

async function fetchWithProgress(url, id) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total) return res.arrayBuffer();
  const reader = res.body.getReader(); const buf = new Uint8Array(total); let got = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf.set(value, got); got += value.length; emit('data:progress', { id, loaded: got, total });
  }
  return buf.buffer;
}
export function ensureData(id) {
  if (store.has(id)) return Promise.resolve(store.get(id));
  if (pending.has(id)) return pending.get(id);
  const d = DATASETS[id]; if (!d) return Promise.reject(new Error('jeu inconnu : ' + id));
  const p = (async () => {
    try {
      const url = `data/${d.file}`;
      let v;
      if (d.type === 'json') { const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); v = await r.json(); }
      else {
        // Lecture par flux (avec progression) seulement pour le relief, chargé au démarrage ; le reste d'un bloc.
        const ab = d.core ? await fetchWithProgress(url, id) : await (async () => { const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })();
        v = d.type === 'i16' ? new Int16Array(ab) : d.type === 'u16' ? new Uint16Array(ab) : new Uint8Array(ab);
        if (d.w && v.length !== d.w * d.h) throw new Error(`taille inattendue (${v.length} au lieu de ${d.w * d.h})`);
      }
      store.set(id, v);
      if (id === 'sp_dem') setDem(v);
      if (id === 'manifest') { const files = (Array.isArray(v) ? v : v.files || []).map((f) => f.file); if (files.length) listing = new Set([...files, 'manifest.json']); }
      emit('data:ready', id);
      return v;
    } catch (e) {
      failed.add(id); pending.delete(id);
      if (!d.optional) console.warn(`[données] ${id} indisponible :`, e.message);
      emit('data:ready', id);
      throw e;
    }
  })();
  pending.set(id, p);
  return p;
}
export async function tryData(id) { try { return await ensureData(id); } catch { return null; } }

/** Valeur physique d'un raster polaire en un point (bilinéaire, ou plus proche voisin pour les masques). */
export function samplePolar(id, lat, lon) {
  const d = DATASETS[id], a = store.get(id);
  if (!d || !a || d.grid !== 'polar' || lat > SP_GRID.minLat) return NaN;
  const p = spXYFromLatLon(lat, lon);
  const c = p.x / SP_GRID.cell + SP_GRID.center, r = SP_GRID.center - p.y / SP_GRID.cell;
  if (c < 0 || r < 0 || c > N - 1 || r > N - 1) return NaN;
  if (d.nearest) return d.decode(a[Math.round(r) * N + Math.round(c)]);
  const c0 = Math.min(N - 2, Math.floor(c)), r0 = Math.min(N - 2, Math.floor(r)), fc = c - c0, fr = r - r0, i = r0 * N + c0;
  const v = [d.decode(a[i]), d.decode(a[i + 1]), d.decode(a[i + N]), d.decode(a[i + N + 1])];
  if (v.some((x) => !Number.isFinite(x))) { const near = d.decode(a[Math.round(r) * N + Math.round(c)]); return near; }
  return (v[0] * (1 - fc) + v[1] * fc) * (1 - fr) + (v[2] * (1 - fc) + v[3] * fc) * fr;
}
/** Hauteur globale LOLA (4 px/°) pour les points hors de la grille polaire. */
export function sampleGlobalHeight(lat, lon) {
  const a = store.get('global_ldem'); if (!a) return NaN;
  const x = ((lon + 180) / 360) * 1440 - 0.5, y = ((90 - lat) / 180) * 720 - 0.5;
  const x0 = Math.floor(x), y0 = Math.max(0, Math.min(718, Math.floor(y))), fx = x - x0, fy = Math.max(0, Math.min(1, y - y0));
  const g = (xx, yy) => a[yy * 1440 + ((xx % 1440) + 1440) % 1440];
  return (g(x0, y0) * (1 - fx) + g(x0 + 1, y0) * fx) * (1 - fy) + (g(x0, y0 + 1) * (1 - fx) + g(x0 + 1, y0 + 1) * fx) * fy;
}
/** Valeurs Lunar Prospector GRS (cellule de 5°) au point. */
export function sampleLpgrs(lat, lon) {
  const g = store.get('lpgrs'); if (!g) return null;
  const out = {};
  if (g.cells) {
    const c = g.cells.find((k) => lat >= k.latMin && lat <= k.latMax && lon >= k.lonMin && lon <= k.lonMax);
    if (!c) return null; for (const k of Object.keys(c)) if (!/^(lat|lon)/.test(k)) out[k] = c[k]; return out;
  }
  const { nLat, nLon, stepDeg, latTop, lonLeft } = g.grid;
  const r = Math.max(0, Math.min(nLat - 1, Math.floor((latTop - lat) / stepDeg))), c = Math.max(0, Math.min(nLon - 1, Math.floor((lon - lonLeft) / stepDeg)));
  for (const [k, arr] of Object.entries(g.layers)) out[k] = arr[r * nLon + c];
  return out;
}
/** Hydrogène Lunar Prospector (spectromètre à neutrons), grille de 0,5° : ppm, ou NaN. */
export function sampleHydrogen(lat, lon) {
  const g = store.get('lp_hydrogen'); if (!g?.layers?.H) return NaN;
  const { nLat, nLon, stepDeg, latTop, lonLeft } = g.grid;
  const r = Math.max(0, Math.min(nLat - 1, Math.floor((latTop - lat) / stepDeg))), c = Math.max(0, Math.min(nLon - 1, Math.floor((lon - lonLeft) / stepDeg)));
  const v = g.layers.H[r * nLon + c];
  return v === null || v === g.nodata ? NaN : v;
}
