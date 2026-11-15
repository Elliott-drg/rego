// Façade du moteur scientifique : l'interface demande une analyse, elle reçoit un résultat prêt à afficher.
// Aucune dépendance à l'interface ; tout passe par les modules science/* et data/registry.js.

import { state } from '../core/store.js';
import { heightAt, slopeAt, slopeStats, inPolarGrid, hasDem } from './terrain.js';
import { siteSeries, seriesMetrics, instantState, horizonFor, LUNAR_DAY_MS, DAY_MS, HOUR_MS, runs } from './sitecalc.js';
import { temperatureSeries } from './thermal.js';
import { samplePolar, sampleGlobalHeight, sampleLpgrs, dataLoaded } from '../data/registry.js';
import { spXYFromLatLon, spLatLonFromXY, spScaleFactor } from '../core/coords.js';
import { SP_GRID } from './terrain.js';

const opts = () => ({ mastM: state.params.mastM, earthMarginDeg: state.params.earthMarginDeg });
const cache = new Map();
function memo(key, fn) {
  if (cache.has(key)) return cache.get(key);
  const v = fn(); cache.set(key, v);
  if (cache.size > 160) cache.delete(cache.keys().next().value);
  return v;
}
export function clearEngineCache() { cache.clear(); }
const siteKey = (s) => `${s.lat.toFixed(5)},${s.lon.toFixed(5)}|${state.params.mastM}|${state.params.earthMarginDeg}`;

/** Données de terrain et produits cartographiques en un point (aucun calcul temporel). */
export function pointInfo(lat, lon) {
  let polar = hasDem() && inPolarGrid(lat);
  let heightM = polar ? heightAt(lat, lon) : sampleGlobalHeight(lat, lon);
  // Tout au bord de la grille polaire (vers 75° S), le relief à 240 m peut manquer : repli sur le relief global.
  if (polar && !Number.isFinite(heightM)) { polar = false; heightM = sampleGlobalHeight(lat, lon); }
  const sl = polar ? slopeAt(lat, lon) : null;
  return {
    lat, lon, polar,
    heightM, heightSource: polar ? 'lola240' : (dataLoaded('global_ldem') ? 'lola4ppd' : null),
    slopeDeg: sl ? sl.slopeDeg : NaN, aspectDeg: sl ? sl.aspectDeg : NaN,
    sunAvgPct: samplePolar('sp_sun_avg', lat, lon), earthAvgPct: samplePolar('sp_earth_avg', lat, lon),
    psr: samplePolar('sp_psr', lat, lon),
    tmaxK: samplePolar('sp_tmax', lat, lon), tminK: samplePolar('sp_tmin', lat, lon), tavgK: samplePolar('sp_tavg', lat, lon),
    lpgrs: sampleLpgrs(lat, lon),
  };
}

/** Statistiques de pente autour d'un site + part de surface en ombre permanente dans 5 km. */
export function terrainAround(site) {
  return memo(`ter|${site.lat.toFixed(5)},${site.lon.toFixed(5)}|${state.params.landingRadiusM}|${state.params.slopeLimitDeg}`, () => {
    const stats = slopeStats(site.lat, site.lon, state.params.landingRadiusM, state.params.slopeLimitDeg);
    let psrFrac = NaN;
    if (dataLoaded('sp_psr') && inPolarGrid(site.lat)) {
      const c = spXYFromLatLon(site.lat, site.lon), k = spScaleFactor(site.lat), R = 5000 * k; let n = 0, p = 0;
      for (let dy = -R; dy <= R; dy += SP_GRID.cell) for (let dx = -R; dx <= R; dx += SP_GRID.cell) {
        if (dx * dx + dy * dy > R * R) continue;
        const ll = spLatLonFromXY(c.x + dx, c.y + dy); const v = samplePolar('sp_psr', ll.lat, ll.lon);
        if (Number.isFinite(v)) { n++; if (v > 0) p++; }
      }
      psrFrac = n ? p / n : NaN;
    }
    return { stats, psrFrac };
  });
}

/** Soleil et Terre maintenant, par rapport à l'horizon réel du site. */
export function siteNow(site, timeMs = state.timeMs) { return instantState(site, new Date(timeMs), opts()); }

/**
 * Prochains lever/coucher du Soleil et perte/retour de la Terre (mémoïsé à la minute).
 * On parcourt les séries horaires de l'année (déjà calculées pour la fiche, donc sans coût), puis on
 * affine l'instant du basculement par dichotomie (≈ 1 s). Recherche limitée à 400 jours.
 * Un passage plus court que le pas d'une heure entre deux échantillons peut être manqué.
 * @returns {{sun:{now:boolean,nextMs:number|null}, earth:{now:boolean,nextMs:number|null}}}
 */
export function siteTransitions(site, timeMs = state.timeMs) {
  const t = Math.floor(timeMs / 60000) * 60000;
  return memo(`tr|${siteKey(site)}|${t}`, () => {
    const o = opts(), end = t + 400 * DAY_MS;
    const instant = (ms) => { const st = instantState(site, new Date(ms), o); return { sun: st.sun.fraction > 0, earth: st.earth.visible }; };
    const now = instant(t);
    const find = (body) => {
      const flag = (S, i) => (body === 'sun' ? S.sunFrac[i] > 0 : S.earthVis[i] === 1);
      let cur = t;
      while (cur < end) {
        const S = yearSeries(site, cur);
        for (let i = Math.max(0, Math.ceil((cur - S.t0Ms) / S.stepMs)); i < S.n; i++) {
          const tm = S.t0Ms + i * S.stepMs;
          if (tm > end) return null;
          if (tm <= t || flag(S, i) === now[body]) continue;
          let lo = Math.max(t, tm - S.stepMs), hi = tm;
          for (let k = 0; k < 12; k++) { const mid = (lo + hi) / 2; if (instant(mid)[body] === now[body]) lo = mid; else hi = mid; }
          return hi;
        }
        cur = S.t0Ms + S.n * S.stepMs;       // début de l'année suivante
      }
      return null;
    };
    return { sun: { now: now.sun, nextMs: find('sun') }, earth: { now: now.earth, nextMs: find('earth') } };
  });
}

// Série brute d'une période (sans indicateurs), mémoïsée : sert aussi à prolonger les nuits hors période.
function rawSeries(site, t0, spanMs) {
  return memo(`ser|${siteKey(site)}|${t0}|${spanMs}`, () => siteSeries(site, t0, spanMs, opts()));
}
function yearSeries(site, ms) {
  const y = new Date(ms).getUTCFullYear(), t0 = Date.UTC(y, 0, 1);
  return rawSeries(site, t0, Date.UTC(y + 1, 0, 1) - t0);
}
const FLAGS = {
  night: (S, i) => S.sunFrac[i] === 0, day: (S, i) => S.sunFrac[i] > 0,
  blackout: (S, i) => S.earthVis[i] === 0, contact: (S, i) => S.earthVis[i] === 1,
};
export const EDGE_SEARCH_DAYS = 400;
/**
 * Durée (ms) pendant laquelle un état se prolonge au-delà d'un bord de période, lue heure par heure
 * dans les séries annuelles. dir = −1 (avant le début) ou +1 (après la fin). Plafonnée à 400 jours.
 */
function extendBeyond(site, kind, edgeMs, dir) {
  const flag = FLAGS[kind], cap = EDGE_SEARCH_DAYS * DAY_MS;
  let ext = 0, S = null;
  for (let tm = edgeMs + dir * HOUR_MS; ext < cap; tm += dir * HOUR_MS) {
    if (!S || tm < S.t0Ms || tm >= S.t0Ms + (S.n - 1) * S.stepMs) S = yearSeries(site, tm);
    const i = Math.max(0, Math.min(S.n - 1, Math.floor((tm - S.t0Ms) / S.stepMs)));
    if (!flag(S, i)) return { ms: ext, capped: false };
    ext += HOUR_MS;
  }
  return { ms: cap, capped: true };
}
/**
 * Plus longue séquence d'un état qui touche la période, avec sa durée RÉELLE : une nuit commencée avant
 * la période ou finie après est comptée en entier (sinon une période qui débute en pleine nuit la
 * couperait en deux). `censored` = aucune fin trouvée dans les 400 jours explorés d'un côté.
 */
function longestTrueRun(site, S, kind) {
  const flag = FLAGS[kind];
  let best = { h: 0, startMs: null, censored: false, beyondWindow: false }, start = -1;
  const close = (a, b) => {                       // séquence [a, b] en indices, b inclus
    let ms = (b - a + 1) * S.stepMs, startMs = S.t0Ms + a * S.stepMs, censored = false, beyond = false;
    if (a === 0) { const e = extendBeyond(site, kind, S.t0Ms, -1); ms += e.ms; startMs -= e.ms; censored ||= e.capped; beyond ||= e.ms > 0; }
    if (b === S.n - 1) { const e = extendBeyond(site, kind, S.t0Ms + (S.n - 1) * S.stepMs, +1); ms += e.ms; censored ||= e.capped; beyond ||= e.ms > 0; }
    if (ms / HOUR_MS > best.h) best = { h: ms / HOUR_MS, startMs, censored, beyondWindow: beyond };
  };
  for (let i = 0; i < S.n; i++) {
    if (flag(S, i)) { if (start < 0) start = i; } else if (start >= 0) { close(start, i - 1); start = -1; }
  }
  if (start >= 0) close(start, S.n - 1);
  return best;
}

/**
 * Analyse d'une période : série temporelle, indicateurs, températures du modèle.
 * @param {'lunarDay'|'year'|'decade'|number} span  'lunarDay' = 29,53 j à partir de 00:00 UTC du jour de la date ;
 *        'year' = année civile de la date ; 'decade' = 10 ans à partir du 1er janvier de l'année ; nombre = durée en jours
 *
 * Dans `metrics`, `longestNightH`, `longestDayH`, `longestBlackoutH` et `longestContactH` sont les durées RÉELLES
 * des plus longues séquences qui touchent la période (prolongées hors période si besoin, voir longestTrueRun) ;
 * `nightCensored` / `blackoutCensored` : aucune fin trouvée dans les 400 jours explorés (ombre ou coupure permanente
 * à cette échelle) ; `nightBeyondWindow` / `blackoutBeyondWindow` : la séquence déborde de la période.
 * Les durées limitées à la période restent disponibles : `longestNightInWindowH`, `longestBlackoutInWindowH`.
 */
export function siteWindow(site, span = 'lunarDay', timeMs = state.timeMs) {
  let t0, spanMs;
  const d = new Date(timeMs);
  if (span === 'year') { t0 = Date.UTC(d.getUTCFullYear(), 0, 1); spanMs = Date.UTC(d.getUTCFullYear() + 1, 0, 1) - t0; }
  else if (span === 'decade') { t0 = Date.UTC(d.getUTCFullYear(), 0, 1); spanMs = Date.UTC(d.getUTCFullYear() + 10, 0, 1) - t0; }
  else if (span === 'lunarDay') { t0 = Math.floor(timeMs / DAY_MS) * DAY_MS; spanMs = LUNAR_DAY_MS; }
  else { t0 = Math.floor(timeMs / DAY_MS) * DAY_MS; spanMs = span * DAY_MS; }
  return memo(`win|${siteKey(site)}|${t0}|${spanMs}`, () => {
    const series = rawSeries(site, t0, spanMs);
    const metrics = seriesMetrics(series);
    const night = longestTrueRun(site, series, 'night'), day = longestTrueRun(site, series, 'day');
    const blackout = longestTrueRun(site, series, 'blackout'), contact = longestTrueRun(site, series, 'contact');
    Object.assign(metrics, {
      longestNightInWindowH: metrics.longestNightH, longestBlackoutInWindowH: metrics.longestBlackoutH,
      longestNightH: night.h, longestNightStartMs: night.startMs, nightCensored: night.censored, nightBeyondWindow: night.beyondWindow,
      longestDayH: day.h, dayCensored: day.censored,
      longestBlackoutH: blackout.h, longestBlackoutStartMs: blackout.startMs, blackoutCensored: blackout.censored, blackoutBeyondWindow: blackout.beyondWindow,
      longestContactH: contact.h, contactCensored: contact.censored,
    });
    const info = pointInfo(site.lat, site.lon);
    // Plancher du modèle : minimum Diviner du pixel, borné à 20 K (en dessous, la mesure sort du domaine fiable de l'instrument)
    const floorK = Number.isFinite(info.tminK) ? Math.max(20, info.tminK) : undefined;
    let temps;
    if (span === 'year' || span === 'decade') {
      // Préchauffage du modèle thermique : 30 jours avant la période, pour ne pas dépendre de l'état initial
      const warm = siteSeries(site, t0 - 30 * DAY_MS, 30 * DAY_MS, { ...opts(), stepMs: series.stepMs });
      const tw = temperatureSeries(warm, { floorK });
      temps = temperatureSeries(series, { floorK, startK: tw[tw.length - 1] });
    } else {
      // Périodes courtes : on relit le modèle annuel (pas d'une heure), déjà préchauffé
      temps = new Float32Array(series.n);
      for (let i = 0; i < series.n; i++) {
        const tm = series.t0Ms + i * series.stepMs, yw = siteWindow(site, 'year', tm);
        temps[i] = valueAt(yw, yw.temps, tm);
      }
    }
    return { site: { lat: site.lat, lon: site.lon }, t0Ms: series.t0Ms, spanMs, series, metrics, temps, floorFromDiviner: floorK !== undefined };
  });
}

/** Valeur d'une série à une date (interpolation linéaire) ; NaN hors période. */
export function valueAt(win, arr, timeMs) {
  const f = (timeMs - win.series.t0Ms) / win.series.stepMs;
  if (f < 0 || f > win.series.n - 1) return NaN;
  const i = Math.floor(f), j = Math.min(win.series.n - 1, i + 1), t = f - i;
  return arr[i] * (1 - t) + arr[j] * t;
}
/** Température instantanée du modèle au site (K). */
export function siteTemperatureNow(site, timeMs = state.timeMs) {
  const w = siteWindow(site, 'year', timeMs);
  return valueAt(w, w.temps, timeMs);
}
export { horizonFor, runs, LUNAR_DAY_MS, DAY_MS, HOUR_MS };

/**
 * Meilleurs points d'une région (quadrilatère `corners` en lat/lon) d'après les cartes moyennes NASA PGDA :
 * pixel le mieux éclairé, pixel d'où la Terre est le plus souvent visible, et meilleur compromis
 * (produit des deux), parmi les pixels de pente inférieure au seuil d'atterrissage.
 * Ce sont des points de départ pour l'analyse, pas des sites recommandés.
 * @returns {{sun:{lat,lon,sunAvgPct,earthAvgPct}, earth:{…}, both:{…}, n:number}|null}
 */
export function regionBest(corners) {
  if (!corners || corners.length < 3 || !dataLoaded('sp_sun_avg') || !dataLoaded('sp_earth_avg') || !hasDem()) return null;
  return memo(`best|${corners.map((c) => `${c.lat.toFixed(3)},${c.lon.toFixed(3)}`).join(';')}|${state.params.slopeLimitDeg}`, () => {
    const pts = corners.map((c) => spXYFromLatLon(c.lat, c.lon));
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const inside = (x, y) => { let inn = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j]; if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inn = !inn; } return inn; };
    const best = { sun: null, earth: null, both: null }; let n = 0;
    const cell = SP_GRID.cell;
    for (let y = Math.min(...ys); y <= Math.max(...ys); y += cell) for (let x = Math.min(...xs); x <= Math.max(...xs); x += cell) {
      if (!inside(x, y)) continue;
      const ll = spLatLonFromXY(x, y);
      const sl = slopeAt(ll.lat, ll.lon); if (!sl || sl.slopeDeg > state.params.slopeLimitDeg) continue;
      const su = samplePolar('sp_sun_avg', ll.lat, ll.lon), ea = samplePolar('sp_earth_avg', ll.lat, ll.lon);
      if (!Number.isFinite(su) || !Number.isFinite(ea)) continue;
      n++;
      const cand = { lat: ll.lat, lon: ll.lon, sunAvgPct: su, earthAvgPct: ea, slopeDeg: sl.slopeDeg };
      if (!best.sun || su > best.sun.sunAvgPct) best.sun = cand;
      if (!best.earth || ea > best.earth.earthAvgPct) best.earth = cand;
      if (!best.both || su * ea > best.both.sunAvgPct * best.both.earthAvgPct) best.both = cand;
    }
    return n ? { ...best, n } : null;
  });
}
