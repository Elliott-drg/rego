// Géométrie Soleil–Terre–Lune : positions du Soleil et de la Terre dans le repère lunaire fixe,
// puis azimut / élévation en un site.
//
// Méthode (calculée localement, sans réseau) :
//   - positions géocentriques J2000 du Soleil et de la Lune : Astronomy Engine (VSOP87 + théorie lunaire),
//   - orientation de la Lune : modèle de rotation IAU (WGCCRE) fourni par Astronomy Engine
//     (`RotationAxis`), qui inclut les librations physiques principales ; le repère obtenu est
//     proche du repère « Mean Earth / Polar Axis » des cartes LOLA,
//   - pas de réfraction (pas d'atmosphère). Temps de lumière et aberration du Soleil inclus.
// Écart mesuré par rapport à JPL Horizons (DE441) : voir docs/VALIDATION.md.

import * as A from '../../vendor/astronomy.js';
import { MOON_RADIUS_KM, DEG, RAD, enuBasis, latLonFromUnit } from '../core/coords.js';

export const KM_PER_AU = 149597870.7;
export const SUN_RADIUS_KM = 695700;
export const EARTH_RADIUS_KM = 6378.137;
export const SYNODIC_MONTH_DAYS = 29.530588853;

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const n = Math.hypot(a[0], a[1], a[2]); return [a[0] / n, a[1] / n, a[2] / n]; };

/** Axes du repère lunaire fixe exprimés en équatorial J2000 (EQJ). */
export function moonAxes(date) {
  const ax = A.RotationAxis(A.Body.Moon, date);
  const z = [ax.north.x, ax.north.y, ax.north.z];
  const q = norm(cross([0, 0, 1], z));           // nœud ascendant de l'équateur lunaire sur l'équateur J2000
  const m = cross(z, q);
  const w = ax.spin * DEG;
  const x = [q[0] * Math.cos(w) + m[0] * Math.sin(w), q[1] * Math.cos(w) + m[1] * Math.sin(w), q[2] * Math.cos(w) + m[2] * Math.sin(w)];
  const y = cross(z, x);
  return { x, y, z };
}

/**
 * Vecteurs Lune->Soleil et Lune->Terre (km) dans le repère lunaire fixe.
 * @returns {{sun:number[], earth:number[]}}
 */
export function bodiesInMoonFrame(date) {
  const t = A.MakeTime(date);
  const moon = A.GeoMoon(t);                       // Terre -> Lune, EQJ, UA
  const sun = A.GeoVector(A.Body.Sun, t, true);    // Terre -> Soleil, EQJ, UA (aberration incluse)
  const ax = moonAxes(t);
  const s = [(sun.x - moon.x) * KM_PER_AU, (sun.y - moon.y) * KM_PER_AU, (sun.z - moon.z) * KM_PER_AU];
  const e = [-moon.x * KM_PER_AU, -moon.y * KM_PER_AU, -moon.z * KM_PER_AU];
  return {
    sun: [dot(s, ax.x), dot(s, ax.y), dot(s, ax.z)],
    earth: [dot(e, ax.x), dot(e, ax.y), dot(e, ax.z)],
  };
}

/** Point subsolaire et point sub-terrestre (lat/lon sélénographiques, degrés) + distances (km). */
export function subPoints(date) {
  const b = bodiesInMoonFrame(date);
  const s = latLonFromUnit(b.sun), e = latLonFromUnit(b.earth);
  return {
    subsolar: s, subearth: e,
    sunDistKm: Math.hypot(...b.sun), earthDistKm: Math.hypot(...b.earth),
    sunVec: b.sun, earthVec: b.earth,
  };
}

/**
 * Azimut (depuis le Nord, vers l'Est) et élévation (au-dessus du plan horizontal local de la sphère)
 * d'un corps vu depuis un site. `vecKm` = vecteur centre Lune -> corps (repère lunaire fixe).
 */
export function azElFromVector(vecKm, lat, lon, heightM = 0) {
  const { east, north, up } = enuBasis(lat, lon);
  const r = MOON_RADIUS_KM + heightM / 1000;
  const d = [vecKm[0] - up[0] * r, vecKm[1] - up[1] * r, vecKm[2] - up[2] * r];
  const dist = Math.hypot(d[0], d[1], d[2]);
  const el = Math.asin(dot(d, up) / dist) * RAD;
  let az = Math.atan2(dot(d, east), dot(d, north)) * RAD;
  if (az < 0) az += 360;
  return { az, el, distKm: dist };
}

/** Soleil et Terre vus d'un site à une date : az/él, distances, demi-diamètres apparents (degrés). */
export function sunEarthAt(date, lat, lon, heightM = 0) {
  const b = bodiesInMoonFrame(date);
  const sun = azElFromVector(b.sun, lat, lon, heightM);
  const earth = azElFromVector(b.earth, lat, lon, heightM);
  sun.radiusDeg = Math.asin(SUN_RADIUS_KM / sun.distKm) * RAD;
  earth.radiusDeg = Math.asin(EARTH_RADIUS_KM / earth.distKm) * RAD;
  return { sun, earth };
}

/**
 * Série temporelle des vecteurs Soleil/Terre (indépendante du site, donc réutilisable entre sites).
 * @param {number} t0Ms début (ms UTC) @param {number} stepMs pas @param {number} n nombre de pas
 * @returns {{t0Ms:number, stepMs:number, n:number, sun:Float64Array, earth:Float64Array}} (x,y,z km entrelacés)
 */
export function ephemerisGrid(t0Ms, stepMs, n) {
  const sun = new Float64Array(n * 3), earth = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const b = bodiesInMoonFrame(new Date(t0Ms + i * stepMs));
    sun.set(b.sun, i * 3); earth.set(b.earth, i * 3);
  }
  return { t0Ms, stepMs, n, sun, earth };
}

const gridCache = new Map();
/** Version avec cache (clé = début, pas, longueur). */
export function ephemerisGridCached(t0Ms, stepMs, n) {
  const key = `${t0Ms}|${stepMs}|${n}`;
  let g = gridCache.get(key);
  if (!g) {
    g = ephemerisGrid(t0Ms, stepMs, n);
    gridCache.set(key, g);
    if (gridCache.size > 48) gridCache.delete(gridCache.keys().next().value);   // ≈ 0,2 Mo par année horaire
  }
  return g;
}

/** Phase de la Terre vue de la Lune ≈ complément de la phase lunaire ; angle de phase en degrés. */
export function moonPhaseDeg(date) { return A.MoonPhase(date); }
