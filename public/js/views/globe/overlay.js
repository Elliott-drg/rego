// Peinture des calques colorés du globe dans un canvas équirectangulaire
// (colonne 0 = longitude −180°, ligne 0 = pôle Nord), utilisé comme texture de la sphère de surcouche.
// Les données sont dessinées à leur résolution d'origine : aucune interpolation n'invente de détail.
import { ensureData } from '../../data/registry.js';
import { lut, NODATA_RGB } from '../../layers/palettes.js';
import { unitFromLatLon } from '../../core/coords.js';
import { makeCanvas } from './draw.js';

/**
 * Modèle de température instantanée du calque `g_temp` (ce n'est PAS une mesure) :
 * équilibre radiatif T = ((1 − A)·S·cos i / (ε·σ))^¼, sans relief ni inertie thermique.
 * Côté nuit (et près du terminateur, où l'équilibre tomberait plus bas) : valeur fixe de 95 K,
 * ordre de grandeur des nuits équatoriales mesurées par Diviner.
 */
export const TEMP_MODEL = { albedo: 0.12, emissivity: 0.95, solarWm2: 1361, nightK: 95 };
const SIGMA = 5.670374419e-8;
export function modelTempK(cosInc) {
  if (cosInc <= 0) return TEMP_MODEL.nightK;
  const eq = Math.pow((1 - TEMP_MODEL.albedo) * TEMP_MODEL.solarWm2 * cosInc / (TEMP_MODEL.emissivity * SIGMA), 0.25);
  return Math.max(TEMP_MODEL.nightK, eq);
}

/** Jeu de données nécessaire à un calque (null : aucun, le calque est calculé). */
export function layerDataset(layer) {
  if (layer.id === 'g_temp') return null;
  if (layer.id === 'g_topo') return 'global_ldem';
  return layer.element === 'H' ? 'lp_hydrogen' : 'lpgrs';
}
export function loadLayerData(layer) {
  const id = layerDataset(layer);
  return id ? ensureData(id) : Promise.resolve(null);
}

/** Taille de la texture : 2048×1024, sauf le modèle de température (champ lisse, repeint 2 fois/s). */
export function overlaySize(layer) { return layer.id === 'g_temp' ? [512, 256] : [2048, 1024]; }

/** Nature de la grille dessinée, pour la note de la légende : 'cells' | 'halfdeg' | 'temp' | null. */
export function overlayNote(layer) {
  if (layer.id === 'g_temp') return 'temp';
  if (layer.id === 'g_topo') return null;
  return layer.element === 'H' ? 'halfdeg' : 'cells';
}

const lutIndex = (v, min, max) => Math.max(0, Math.min(255, Math.round((v - min) / (max - min) * 255)));

/** Raster régulier (ligne 0 au nord) -> canvas temporaire à la résolution des données. */
function rasterCanvas(nLon, nLat, valueAt, colors, range) {
  const tmp = makeCanvas(nLon, nLat), ctx = tmp.getContext('2d');
  const img = ctx.createImageData(nLon, nLat), px = img.data;
  const [min, max] = range;
  for (let i = 0, n = nLon * nLat; i < n; i++) {
    const v = valueAt(i), o = i * 4;
    if (v === null || v === undefined || !Number.isFinite(v)) { px[o] = NODATA_RGB[0]; px[o + 1] = NODATA_RGB[1]; px[o + 2] = NODATA_RGB[2]; }
    else { const k = lutIndex(v, min, max) * 4; px[o] = colors[k]; px[o + 1] = colors[k + 1]; px[o + 2] = colors[k + 2]; }
    px[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return tmp;
}

/** Relief global LOLA (Int16 1440×720, m). Mesure à 4 px/° : le passage à 2048 px est un simple rééchantillonnage. */
function paintTopo(ctx, W, H, dem, colors, range) {
  const tmp = rasterCanvas(1440, 720, (i) => dem[i], colors, range);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(tmp, 0, 0, W, H);
}

/** Grille régulière {grid:{nLat, nLon, stepDeg, latTop, lonLeft}, layers:{clé:[…]}} : cases nettes, sans lissage. */
function paintGrid(ctx, W, H, data, valueAt, colors, range) {
  const { nLat, nLon, stepDeg, latTop, lonLeft } = data.grid;
  const tmp = rasterCanvas(nLon, nLat, valueAt, colors, range);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, (lonLeft + 180) / 360 * W, (90 - latTop) / 180 * H, nLon * stepDeg / 360 * W, nLat * stepDeg / 180 * H);
}

/**
 * Cellules Lunar Prospector GRS : pixels de surface égale (~5°), rangés par bandes de latitude.
 * Chaque cellule est un rectangle plein à ses limites exactes (bandes : 360°/nLon de large).
 */
function paintCells(ctx, W, H, data, valueOf, colors, range) {
  const [min, max] = range;
  const rect = (c, latMin, latMax, lonMin, lonMax) => {
    const v = valueOf(c);
    if (v === null || v === undefined || !Number.isFinite(v)) return;          // reste gris (sans donnée)
    const k = lutIndex(v, min, max) * 4;
    const x0 = Math.round((lonMin + 180) / 360 * W), x1 = Math.round((lonMax + 180) / 360 * W);
    const y0 = Math.round((90 - latMax) / 180 * H), y1 = Math.round((90 - latMin) / 180 * H);
    ctx.fillStyle = `rgb(${colors[k]},${colors[k + 1]},${colors[k + 2]})`;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  };
  const bands = data.grid?.latBands;
  if (bands) {
    for (const b of bands) {
      const w = 360 / b.nLon;
      for (let j = 0; j < b.nLon; j++) { const c = data.cells[b.first + j]; if (c) rect(c, b.latMin, b.latMax, -180 + j * w, -180 + (j + 1) * w); }
    }
  } else for (const c of data.cells) rect(c, c.latMin, c.latMax, c.lonMin, c.lonMax);
}

/** Valeur d'un élément pour une cellule ou un jeu de couches ; 'Al2O3+CaO' = somme des deux oxydes. */
function elementGetter(element) {
  const parts = element.split('+');
  return (get) => {
    let sum = 0;
    for (const p of parts) { const v = get(p); if (v === null || v === undefined || !Number.isFinite(v)) return NaN; sum += v; }
    return sum;
  };
}

/**
 * Température modélisée : une valeur par pixel, d'après l'angle d'incidence du Soleil.
 * cos(i) = n·s avec n = unitFromLatLon(lat, lon). Ce produit se factorise par ligne et par colonne :
 * n·s = cos(lat)·(e(lon)·s) + sin(lat)·s_z, où e(lon) = unitFromLatLon(0, lon) ; on évite ainsi un appel par pixel.
 */
function paintTemp(ctx, W, H, sunUnit, colors, range) {
  const img = ctx.createImageData(W, H), px = img.data;
  const [min, max] = range;
  // Table couleur par cos(i) : évite une puissance par pixel
  const N = 1024, table = new Uint16Array(N + 1);
  for (let i = 0; i <= N; i++) table[i] = lutIndex(modelTempK(i / N), min, max) * 4;
  const night = lutIndex(TEMP_MODEL.nightK, min, max) * 4;
  const equatorDot = new Float32Array(W);
  for (let c = 0; c < W; c++) { const e = unitFromLatLon(0, -180 + (c + 0.5) * 360 / W); equatorDot[c] = e[0] * sunUnit[0] + e[1] * sunUnit[1]; }
  for (let r = 0, o = 0; r < H; r++) {
    const m = unitFromLatLon(90 - (r + 0.5) * 180 / H, 0), cosLat = m[0], polar = m[2] * sunUnit[2];
    for (let c = 0; c < W; c++, o += 4) {
      const cosInc = cosLat * equatorDot[c] + polar;
      const k = cosInc <= 0 ? night : table[Math.round(Math.min(1, cosInc) * N)];
      px[o] = colors[k]; px[o + 1] = colors[k + 1]; px[o + 2] = colors[k + 2]; px[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Peint un calque dans le canvas.
 * @param {HTMLCanvasElement} canvas @param {object} layer calque (manager.js) @param {*} data jeu chargé (ou null)
 * @param {string} cvd mode daltonien @param {{sunUnit?:number[]}} ctxInfo direction unitaire du Soleil (repère ME) pour g_temp
 */
export function paintOverlay(canvas, layer, data, cvd, ctxInfo = {}) {
  const W = canvas.width, H = canvas.height, ctx = canvas.getContext('2d');
  const colors = lut(layer.palette, cvd), range = layer.range;
  ctx.fillStyle = `rgb(${NODATA_RGB.join(',')})`; ctx.fillRect(0, 0, W, H);
  if (layer.id === 'g_temp') paintTemp(ctx, W, H, ctxInfo.sunUnit, colors, range);
  else if (layer.id === 'g_topo') paintTopo(ctx, W, H, data, colors, range);
  else {
    const value = elementGetter(layer.element);
    if (data.cells) paintCells(ctx, W, H, data, (c) => value((k) => c[k]), colors, range);
    else paintGrid(ctx, W, H, data, (i) => value((k) => data.layers[k]?.[i]), colors, range);
  }
}
