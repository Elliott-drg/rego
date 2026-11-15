// Horizon local vu d'un site : pour chaque azimut, élévation maximale du relief (MNT LOLA 240 m),
// en tenant compte de la courbure de la Lune. Pas de réfraction : la Lune n'a pas d'atmosphère.
//
// Méthode : on avance le long du grand cercle de chaque azimut (pas de 120 m près du site, puis
// croissant), on lit la hauteur du MNT et on calcule l'angle exact entre le site (rayon r1) et le
// point de relief (rayon r2) séparés d'un angle au centre θ :
//     tan(él) = (r2·cos θ − r1) / (r2·sin θ)
// Hors du MNT (latitude > 75°S) ou sans MNT : horizon de la sphère lisse, él = −acos(R / r1).

import { MOON_RADIUS_M, DEG, RAD, unitFromLatLon, enuBasis } from '../core/coords.js';
import { SP_GRID, getDem, heightAt, inPolarGrid } from './terrain.js';

export const HORIZON_N = 720;                 // pas de 0,5° en azimut
const MAX_DIST_M = 330000;                    // au-delà, la courbure cache tout relief lunaire possible
const MAX_TERRAIN_M = 9000;                   // majorant de hauteur dans la zone polaire Sud

// Distances d'échantillonnage (communes à tous les azimuts)
const DIST = (() => {
  const d = []; let s = 120;
  while (s < MAX_DIST_M) { d.push(s); s += Math.max(120, Math.min(480, s * 0.004)); }
  return Float64Array.from(d);
})();
const COS_T = DIST.map((s) => Math.cos(s / MOON_RADIUS_M));
const SIN_T = DIST.map((s) => Math.sin(s / MOON_RADIUS_M));

/**
 * @param {number} lat @param {number} lon
 * @param {number} mastM hauteur de l'observateur (antenne, panneau) au-dessus du sol, en m
 * @returns {{elev:Float32Array, n:number, siteHeightM:number, mastM:number, terrain:boolean, smoothDeg:number}}
 *   elev[i] = élévation de l'horizon (degrés) à l'azimut i·360/n (0 = Nord, 90 = Est)
 */
export function computeHorizon(lat, lon, mastM = 2) {
  const dem = getDem();
  const n = HORIZON_N;
  const elev = new Float32Array(n);
  const usable = dem && inPolarGrid(lat);
  const h0 = usable ? heightAt(lat, lon) : 0;
  const siteH = Number.isFinite(h0) ? h0 : 0;
  const r1 = MOON_RADIUS_M + siteH + mastM;
  const smooth = -Math.acos(Math.min(1, MOON_RADIUS_M / r1)) * RAD;   // horizon de la sphère de référence
  if (!usable || !Number.isFinite(h0)) { elev.fill(smooth); return { elev, n, siteHeightM: siteH, mastM, terrain: false, smoothDeg: smooth }; }

  const { east, north, up } = enuBasis(lat, lon);
  const N = SP_GRID.n, cell = SP_GRID.cell, ctr = SP_GRID.center, sc = SP_GRID.scale;
  const K2R = 2 * MOON_RADIUS_M;
  // Tangente minimale possible : horizon d'une sphère au niveau le plus bas plausible (−9 km)
  const floorTan = Math.tan(-Math.acos(Math.min(1, (MOON_RADIUS_M - 9000) / r1)));
  for (let i = 0; i < n; i++) {
    const az = (i * 360 / n) * DEG, ca = Math.cos(az), sa = Math.sin(az);
    const tx = north[0] * ca + east[0] * sa, ty = north[1] * ca + east[1] * sa, tz = north[2] * ca + east[2] * sa;
    let best = floorTan;
    for (let j = 0; j < DIST.length; j++) {
      const ct = COS_T[j], st = SIN_T[j];
      // Arrêt anticipé : même un relief de hauteur maximale ne dépasserait plus l'horizon courant
      if ((((MOON_RADIUS_M + MAX_TERRAIN_M) * ct - r1) / ((MOON_RADIUS_M + MAX_TERRAIN_M) * st)) < best) break;
      const nx = up[0] * ct + tx * st, ny = up[1] * ct + ty * st, nz = up[2] * ct + tz * st;
      const k = K2R / (1 - nz);
      const c = (k * ny) / cell + ctr, r = ctr - (k * nx) / cell;
      if (c < 0 || r < 0 || c >= N - 1 || r >= N - 1) break;       // sortie du MNT
      const c0 = c | 0, r0 = r | 0, fc = c - c0, fr = r - r0, q = r0 * N + c0;
      const h = sc * ((dem[q] * (1 - fc) + dem[q + 1] * fc) * (1 - fr) + (dem[q + N] * (1 - fc) + dem[q + N + 1] * fc) * fr);
      const r2 = MOON_RADIUS_M + h;
      const tn = (r2 * ct - r1) / (r2 * st);
      if (tn > best) best = tn;
    }
    elev[i] = Math.atan(best) * RAD;
  }
  return { elev, n, siteHeightM: siteH, mastM, terrain: true, smoothDeg: smooth };
}

/** Élévation de l'horizon (degrés) à un azimut quelconque, interpolée. */
export function horizonAt(hz, azDeg) {
  const n = hz.n, f = (((azDeg % 360) + 360) % 360) * n / 360;
  const i = Math.floor(f) % n, j = (i + 1) % n, t = f - Math.floor(f);
  return hz.elev[i] * (1 - t) + hz.elev[j] * t;
}

/**
 * Fraction du disque (Soleil) visible au-dessus de l'horizon : le disque est découpé en 9 bandes
 * verticales, chacune comparée à l'horizon de son propre azimut.
 */
export function discFractionVisible(hz, azDeg, elDeg, radiusDeg) {
  const top = elDeg + radiusDeg;
  const cosEl = Math.max(0.05, Math.cos(elDeg * DEG));
  let vis = 0, tot = 0;
  for (let k = -4; k <= 4; k++) {
    const x = (k / 4.5) * radiusDeg;                       // décalage horizontal sur le ciel
    const half = Math.sqrt(Math.max(0, radiusDeg * radiusDeg - x * x));
    if (half <= 0) continue;
    const h = horizonAt(hz, azDeg + x / cosEl);
    tot += 2 * half;
    vis += Math.max(0, Math.min(2 * half, elDeg + half - h));
  }
  if (tot === 0 || top < -12) return 0;
  return vis / tot;
}
