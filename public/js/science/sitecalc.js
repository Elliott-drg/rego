// Fenêtres d'ensoleillement et de communication directe avec la Terre pour un site et une période.
// Tout est calculé : éphémérides locales (ephemeris.js) + horizon du relief LOLA (horizon.js).

import { ephemerisGridCached, azElFromVector, bodiesInMoonFrame, SUN_RADIUS_KM, EARTH_RADIUS_KM, SYNODIC_MONTH_DAYS } from './ephemeris.js';
import { computeHorizon, horizonAt, discFractionVisible } from './horizon.js';
import { RAD, DEG } from '../core/coords.js';
import { surfaceNormal } from './terrain.js';
import { enuBasis } from '../core/coords.js';

export const HOUR_MS = 3600e3, DAY_MS = 86400e3;
export const LUNAR_DAY_MS = SYNODIC_MONTH_DAYS * DAY_MS;

const horizonCache = new Map();
export function horizonFor(site, mastM = 2) {
  const key = `${site.lat.toFixed(5)}|${site.lon.toFixed(5)}|${mastM}`;
  let h = horizonCache.get(key);
  if (!h) {
    h = computeHorizon(site.lat, site.lon, mastM);
    horizonCache.set(key, h);
    if (horizonCache.size > 40) horizonCache.delete(horizonCache.keys().next().value);
  }
  return h;
}
export function clearHorizonCache() { horizonCache.clear(); }

/** État instantané : Soleil et Terre par rapport à l'horizon réel du site. */
export function instantState(site, date, opts = {}) {
  const mastM = opts.mastM ?? 2, earthMarginDeg = opts.earthMarginDeg ?? 0;
  const hz = horizonFor(site, mastM);
  const b = bodiesInMoonFrame(date);
  const sun = azElFromVector(b.sun, site.lat, site.lon, hz.siteHeightM + mastM);
  const earth = azElFromVector(b.earth, site.lat, site.lon, hz.siteHeightM + mastM);
  sun.radiusDeg = Math.asin(SUN_RADIUS_KM / sun.distKm) * RAD;
  earth.radiusDeg = Math.asin(EARTH_RADIUS_KM / earth.distKm) * RAD;
  sun.horizonDeg = horizonAt(hz, sun.az); earth.horizonDeg = horizonAt(hz, earth.az);
  sun.fraction = discFractionVisible(hz, sun.az, sun.el, sun.radiusDeg);
  sun.aboveDeg = sun.el - sun.horizonDeg;
  earth.aboveDeg = earth.el - earth.horizonDeg;
  earth.visible = earth.aboveDeg > earthMarginDeg;
  earth.fraction = discFractionVisible(hz, earth.az, earth.el, earth.radiusDeg);
  return { sun, earth, horizon: hz, sunVec: b.sun, earthVec: b.earth };
}

/** Pas de temps adapté à la durée étudiée. */
export function stepForSpan(spanMs) {
  const d = spanMs / DAY_MS;
  if (d <= 45) return 20 * 60e3;
  if (d <= 400) return HOUR_MS;
  if (d <= 1500) return 2 * HOUR_MS;
  return 3 * HOUR_MS;
}

/**
 * Série temporelle pour un site.
 * @param {{lat:number, lon:number}} site
 * @param {number} t0Ms début (aligné sur le pas pour profiter du cache) @param {number} spanMs durée
 * @returns {{t0Ms, stepMs, n, sunEl:Float32Array, sunAz:Float32Array, sunFrac:Float32Array,
 *            earthEl:Float32Array, earthAz:Float32Array, earthAbove:Float32Array, earthVis:Uint8Array, cosInc:Float32Array, horizon}}
 */
export function siteSeries(site, t0Ms, spanMs, opts = {}) {
  const mastM = opts.mastM ?? 2, earthMarginDeg = opts.earthMarginDeg ?? 0;
  const stepMs = opts.stepMs ?? stepForSpan(spanMs);
  const start = Math.floor(t0Ms / stepMs) * stepMs;
  const n = Math.ceil(spanMs / stepMs) + 1;
  const g = ephemerisGridCached(start, stepMs, n);
  const hz = horizonFor(site, mastM);
  const h = hz.siteHeightM + mastM;
  const sunEl = new Float32Array(n), sunAz = new Float32Array(n), sunFrac = new Float32Array(n);
  const earthEl = new Float32Array(n), earthAz = new Float32Array(n), earthAbove = new Float32Array(n);
  const earthVis = new Uint8Array(n), cosInc = new Float32Array(n);
  const nrm = hz.terrain ? surfaceNormal(site.lat, site.lon) : enuBasis(site.lat, site.lon).up;
  const up = enuBasis(site.lat, site.lon).up;
  const rKm = 1737.4 + h / 1000;
  for (let i = 0; i < n; i++) {
    const sv = [g.sun[i * 3], g.sun[i * 3 + 1], g.sun[i * 3 + 2]];
    const ev = [g.earth[i * 3], g.earth[i * 3 + 1], g.earth[i * 3 + 2]];
    const s = azElFromVector(sv, site.lat, site.lon, h), e = azElFromVector(ev, site.lat, site.lon, h);
    sunEl[i] = s.el; sunAz[i] = s.az; earthEl[i] = e.el; earthAz[i] = e.az;
    const sr = Math.asin(SUN_RADIUS_KM / s.distKm) * RAD;
    sunFrac[i] = s.el + sr < hz_min(hz) ? 0 : discFractionVisible(hz, s.az, s.el, sr);
    const above = e.el - horizonAt(hz, e.az);
    earthAbove[i] = above; earthVis[i] = above > earthMarginDeg ? 1 : 0;
    // cosinus de l'angle d'incidence sur la surface locale (pour le modèle thermique)
    const dx = sv[0] - up[0] * rKm, dy = sv[1] - up[1] * rKm, dz = sv[2] - up[2] * rKm, dn = Math.hypot(dx, dy, dz);
    cosInc[i] = Math.max(0, (dx * nrm[0] + dy * nrm[1] + dz * nrm[2]) / dn);
  }
  return { t0Ms: start, stepMs, n, sunEl, sunAz, sunFrac, earthEl, earthAz, earthAbove, earthVis, cosInc, horizon: hz, site: { lat: site.lat, lon: site.lon }, mastM, earthMarginDeg };
}
function hz_min(hz) {
  if (hz._min === undefined) { let m = Infinity; for (let i = 0; i < hz.n; i++) if (hz.elev[i] < m) m = hz.elev[i]; hz._min = m; }
  return hz._min;
}

function longestRun(n, pred) {
  let best = 0, cur = 0, bestStart = -1, curStart = 0;
  for (let i = 0; i < n; i++) {
    if (pred(i)) { if (cur === 0) curStart = i; cur++; if (cur > best) { best = cur; bestStart = curStart; } } else cur = 0;
  }
  return { len: best, start: bestStart };
}

/**
 * Indicateurs d'une série (sur [i0, i1[, par défaut toute la série).
 * Soleil « présent » = une partie du disque dépasse l'horizon (fraction > 0).
 */
export function seriesMetrics(S, i0 = 0, i1 = S.n) {
  const n = i1 - i0, stepH = S.stepMs / HOUR_MS;
  let lit = 0, fracSum = 0, earth = 0, elMax = -90, elSumLit = 0, vertSum = 0, horizSum = 0, eElMax = -90, eElSumVis = 0;
  for (let i = i0; i < i1; i++) {
    const f = S.sunFrac[i];
    if (f > 0) { lit++; elSumLit += S.sunEl[i]; }
    fracSum += f;
    vertSum += f * Math.cos(S.sunEl[i] * DEG);                 // panneau vertical orienté vers le Soleil
    horizSum += f * Math.max(0, Math.sin(S.sunEl[i] * DEG));   // panneau horizontal fixe
    if (S.sunEl[i] > elMax) elMax = S.sunEl[i];
    if (S.earthVis[i]) { earth++; eElSumVis += S.earthEl[i]; }
    if (S.earthEl[i] > eElMax) eElMax = S.earthEl[i];
  }
  const night = longestRun(n, (k) => S.sunFrac[i0 + k] === 0);
  const day = longestRun(n, (k) => S.sunFrac[i0 + k] > 0);
  const blackout = longestRun(n, (k) => !S.earthVis[i0 + k]);
  const contact = longestRun(n, (k) => !!S.earthVis[i0 + k]);
  const both = longestRun(n, (k) => S.sunFrac[i0 + k] > 0 && !!S.earthVis[i0 + k]);
  let bothCount = 0; for (let i = i0; i < i1; i++) if (S.sunFrac[i] > 0 && S.earthVis[i]) bothCount++;
  return {
    spanDays: n * stepH / 24,
    sunPct: 100 * lit / n,                 // % du temps avec au moins une partie du Soleil visible
    sunDiscPct: 100 * fracSum / n,         // moyenne de la fraction de disque visible (comparable aux cartes PGDA)
    powerVerticalPct: 100 * vertSum / n,   // énergie relative, panneau vertical suiveur
    powerHorizontalPct: 100 * horizSum / n,
    sunElMax: elMax, sunElMeanLit: lit ? elSumLit / lit : NaN,
    longestNightH: night.len * stepH, longestNightStartMs: night.start < 0 ? null : S.t0Ms + (i0 + night.start) * S.stepMs,
    longestDayH: day.len * stepH,
    earthPct: 100 * earth / n, earthElMax: eElMax, earthElMeanVis: earth ? eElSumVis / earth : NaN,
    longestBlackoutH: blackout.len * stepH, longestBlackoutStartMs: blackout.start < 0 ? null : S.t0Ms + (i0 + blackout.start) * S.stepMs,
    longestContactH: contact.len * stepH,
    bothPct: 100 * bothCount / n, longestBothH: both.len * stepH,
    nightCensored: night.len === n, blackoutCensored: blackout.len === n,
  };
}

/**
 * Prochain changement d'état (coucher/lever du Soleil, de la Terre) après `tMs`, affiné par dichotomie.
 * @param {'sun'|'earth'} body
 * @returns {{now:boolean, nextMs:number|null}} now = état actuel (visible ?), nextMs = date du prochain basculement
 */
export function nextTransition(site, tMs, body, opts = {}) {
  const horizonDays = opts.searchDays ?? 400;
  const state = (ms) => {
    const st = instantState(site, new Date(ms), opts);
    return body === 'sun' ? st.sun.fraction > 0 : st.earth.visible;
  };
  const now = state(tMs);
  const step = HOUR_MS;
  let prev = tMs;
  for (let t = tMs + step; t <= tMs + horizonDays * DAY_MS; t += step) {
    if (state(t) !== now) {
      let a = prev, b = t;
      for (let k = 0; k < 12; k++) { const m = (a + b) / 2; if (state(m) === now) a = m; else b = m; }
      return { now, nextMs: b };
    }
    prev = t;
  }
  return { now, nextMs: null };
}

/** Intervalles [début, fin] (ms) où un prédicat sur la série est vrai — pour dessiner les bandes de temps. */
export function runs(S, pred) {
  const out = []; let start = -1;
  for (let i = 0; i < S.n; i++) {
    const v = pred(i);
    if (v && start < 0) start = i;
    if (!v && start >= 0) { out.push([S.t0Ms + start * S.stepMs, S.t0Ms + i * S.stepMs]); start = -1; }
  }
  if (start >= 0) out.push([S.t0Ms + start * S.stepMs, S.t0Ms + (S.n - 1) * S.stepMs]);
  return out;
}
