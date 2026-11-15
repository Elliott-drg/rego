// Connecteur JPL Horizons (https://ssd.jpl.nasa.gov/api/horizons.api), via la route interne /api/horizons
// du serveur local : le service n'envoie pas d'en-tête CORS, un navigateur ne peut pas l'appeler lui-même.
//
// Trois origines possibles pour une réponse, indiquées par `cached` :
//   false      réponse obtenue en direct de JPL,
//   'server'   relue dans le cache disque du serveur local (30 jours),
//   'browser'  relue dans le cache de ce navigateur, quand le serveur local ou Internet manque.

import { state } from '../../core/store.js';
import { sunEarthAt } from '../../science/ephemeris.js';
import { pointInfo } from '../../science/engine.js';
import { inPolarGrid } from '../../science/terrain.js';
import { tryData } from '../registry.js';
import { cacheGet, cachePut } from '../cache.js';
import { ConnectorError, serverStatus } from './server.js';

const HOUR_MS = 3600e3;
/** Instants comparés par verifyWithHorizons, en heures autour de la date demandée. */
export const VERIFY_OFFSETS_H = [-12, -6, 0, 6, 12];
/**
 * Seuil au-delà duquel un écart local / Horizons mérite d'être examiné (degrés). Il s'applique à l'écart
 * d'élévation et à l'écart d'azimut ramené sur le ciel (voir skyDifference), jamais à l'azimut brut.
 * Ordre de grandeur mesuré (4 sites, 296 instants, 2026-2031, voir tests/server.test.mjs) : moins de 0,005° en
 * élévation et en azimut ramené sur le ciel ; azimut brut jusqu'à 0,04° pour un astre presque au zénith.
 */
export const VERIFY_TOLERANCE_DEG = 0.05;

const isoMinute = (ms) => new Date(ms).toISOString().slice(0, 16) + 'Z';
/** Clé de cache d'une demande (mêmes arrondis que le serveur : 1e-6° et 0,1 m). */
export function horizonsKey({ body, lat, lon, altKm = 0, startMs, stopMs, step }) {
  const lonEast = ((lon % 360) + 360) % 360;
  return `horizons|${body}|${lat.toFixed(6)}|${lonEast.toFixed(6)}|${altKm.toFixed(4)}|${isoMinute(startMs)}|${isoMinute(stopMs)}|${step}`;
}

/**
 * Éphéméride d'observateur depuis un point de la surface lunaire.
 * @param {{body:'sun'|'earth', lat:number, lon:number, altKm?:number, startMs:number, stopMs:number, step:string}} req
 *        lon : degrés Est ; altKm : au-dessus de la sphère de 1 737,4 km ; step : « 30m », « 6h », « 1d »…
 * @returns {Promise<{source:string, queried_at:string, cached:false|'server'|'browser', rows:Array<{t:string, az:number, el:number, rangeAU:number|null}>, signature:string[]}>}
 * @throws {ConnectorError} no_server, offline, upstream_unreachable, upstream_timeout, upstream, bad_request
 */
export async function fetchHorizons(req) {
  const { body, lat, lon, altKm = 0, startMs, stopMs, step } = req;
  const key = horizonsKey(req);
  const fromBrowser = async (err) => {
    const rec = await cacheGet(key);
    if (rec) return { ...rec.value, cached: 'browser' };
    throw err;
  };
  if (state.server === null) await serverStatus();
  if (!state.server) return fromBrowser(new ConnectorError('no_server'));

  const q = new URLSearchParams({ body, lat: lat.toFixed(6), lon: lon.toFixed(6), alt_km: altKm.toFixed(4), start: isoMinute(startMs), stop: isoMinute(stopMs), step });
  let res;
  try { res = await fetch(`api/horizons?${q}`, { cache: 'no-store' }); } catch { return fromBrowser(new ConnectorError('no_server')); }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.rows) {
    const e = json?.error;
    return fromBrowser(new ConnectorError(e?.code || 'server_error', e?.message || `HTTP ${res.status}`, e?.detail || e?.param || ''));
  }
  const payload = { ...json, cached: json.cached ? 'server' : false };
  await cachePut(key, { ...json, cached: false }, { source: 'horizons' });
  return payload;
}

const wrap180 = (d) => ((d + 540) % 360) - 180;

/**
 * Écart entre deux directions données en azimut / élévation (degrés).
 * Près du zénith, l'azimut varie très vite pour un même déplacement sur le ciel (à 60° d'élévation, 1° d'azimut
 * ne vaut que 0,5° d'arc) : `dSky` = dAz × cos(élévation) est l'écart d'azimut ramené sur le ciel, comparable
 * à `dEl` et au seuil ; `dAz` reste l'écart d'azimut brut.
 * @returns {{dAz:number, dEl:number, dSky:number}}
 */
export function skyDifference(local, ref) {
  const dAz = wrap180(local.az - ref.az), dEl = local.el - ref.el;
  return { dAz, dEl, dSky: dAz * Math.cos((ref.el * Math.PI) / 180) };
}

/**
 * Compare le calcul local (Astronomy Engine) à JPL Horizons pour le Soleil et la Terre, sur 5 instants
 * répartis sur 24 h autour de la date. Les deux calculs utilisent le même point : latitude, longitude et
 * hauteur du site (relief LOLA) sur la sphère de 1 737,4 km ; ni relief ni réfraction n'entrent en jeu.
 * @param {{lat:number, lon:number}} site @param {number} [timeMs]
 * @returns {Promise<{site:{lat:number, lon:number, heightM:number, heightKnown:boolean}, timeMs:number,
 *   rows:Array<{t:number, body:'sun'|'earth', local:{az:number, el:number}, horizons:{az:number, el:number}, dAz:number, dEl:number, dSky:number}>,
 *   maxDAz:number, maxDEl:number, maxDSky:number, withinTolerance:boolean, source:string, cached:false|'server'|'browser', queriedAt:string, signature:string[]}>}
 *   `withinTolerance` : écart sur le ciel (maxDSky) et écart d'élévation (maxDEl) sous VERIFY_TOLERANCE_DEG.
 */
export async function verifyWithHorizons(site, timeMs = state.timeMs) {
  const t0 = Math.round(timeMs / 60e3) * 60e3;            // Horizons est interrogé à la minute
  // La hauteur du site vient du relief : le charger s'il ne l'est pas encore (sinon 0 m, des deux côtés)
  await tryData(inPolarGrid(site.lat) ? 'sp_dem' : 'global_ldem');
  const lat = Number(site.lat.toFixed(6)), lon = Number(site.lon.toFixed(6));
  const h = pointInfo(lat, lon).heightM;
  const heightKnown = Number.isFinite(h), heightM = heightKnown ? Math.round(h * 10) / 10 : 0;

  const first = VERIFY_OFFSETS_H[0], last = VERIFY_OFFSETS_H[VERIFY_OFFSETS_H.length - 1];
  const ask = (body) => fetchHorizons({ body, lat, lon, altKm: heightM / 1000, startMs: t0 + first * HOUR_MS, stopMs: t0 + last * HOUR_MS, step: `${VERIFY_OFFSETS_H[1] - first}h` });
  const [sun, earth] = await Promise.all([ask('sun'), ask('earth')]);

  const rows = [];
  let maxDAz = 0, maxDEl = 0, maxDSky = 0;
  for (const [body, resp] of [['sun', sun], ['earth', earth]]) {
    for (const r of resp.rows) {
      const t = Date.parse(r.t);
      const loc = sunEarthAt(new Date(t), lat, lon, heightM)[body];
      const d = skyDifference(loc, r);
      maxDAz = Math.max(maxDAz, Math.abs(d.dAz)); maxDEl = Math.max(maxDEl, Math.abs(d.dEl)); maxDSky = Math.max(maxDSky, Math.abs(d.dSky));
      rows.push({ t, body, local: { az: loc.az, el: loc.el }, horizons: { az: r.az, el: r.el }, ...d });
    }
  }
  // Origine la moins « fraîche » des deux réponses : navigateur > disque du serveur > direct
  const cached = [sun, earth].some((r) => r.cached === 'browser') ? 'browser' : [sun, earth].every((r) => r.cached === 'server') ? 'server' : false;
  return {
    site: { lat, lon, heightM, heightKnown }, timeMs: t0, rows, maxDAz, maxDEl, maxDSky,
    withinTolerance: Math.max(maxDSky, maxDEl) <= VERIFY_TOLERANCE_DEG,
    source: sun.source, cached, queriedAt: sun.queried_at < earth.queried_at ? sun.queried_at : earth.queried_at, signature: sun.signature || [],
  };
}
