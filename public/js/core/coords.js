// Référentiel commun de Regolith Finder — TOUTES les conversions passent par ce module.
//
// Repère lunaire fixe « Mean Earth / Polar Axis » (ME), celui des produits LOLA/PDS :
//   +Z = pôle Nord, +X = méridien origine (0° de longitude, centre moyen de la face visible),
//   +Y = 90° Est. Longitudes positives vers l'Est, dans [-180, 180]. Latitudes planétocentriques.
//   Rayon de référence R = 1737,4 km (sphère LOLA). Hauteurs en mètres par rapport à cette sphère.
//
// Grille polaire Sud (rasters `sp_*`) : stéréographique polaire, vraie échelle au pôle,
//   x = rho·sin(lon), y = rho·cos(lon), rho = 2R·tan((90°+lat)/2) ; lon 0 vers le haut de l'image.
//
// Three.js (globe) : Y_three = Z_lune (Nord en haut), X_three = Y_lune, Z_three = X_lune,
//   de sorte que la face visible regarde vers +Z_three (caméra par défaut).

export const MOON_RADIUS_M = 1737400;
export const MOON_RADIUS_KM = 1737.4;
export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export function wrapLon(lon) {
  let l = ((lon + 180) % 360 + 360) % 360 - 180;
  return l === -180 ? 180 : l;
}
export function lonDiff(a, b) { return wrapLon(a - b); }
export function clampLat(lat) { return Math.max(-90, Math.min(90, lat)); }

/** Vecteur unitaire radial (repère ME) pour lat/lon en degrés. */
export function unitFromLatLon(lat, lon) {
  const cl = Math.cos(lat * DEG);
  return [cl * Math.cos(lon * DEG), cl * Math.sin(lon * DEG), Math.sin(lat * DEG)];
}
export function latLonFromUnit(v) {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return { lat: Math.asin(v[2] / n) * RAD, lon: Math.atan2(v[1], v[0]) * RAD };
}

/** Base locale Est / Nord / Haut (repère ME) en un point de la sphère. */
export function enuBasis(lat, lon) {
  const sl = Math.sin(lat * DEG), cl = Math.cos(lat * DEG);
  const so = Math.sin(lon * DEG), co = Math.cos(lon * DEG);
  return {
    east: [-so, co, 0],
    north: [-sl * co, -sl * so, cl],
    up: [cl * co, cl * so, sl],
  };
}

/** Repère ME -> Three.js (voir en-tête). r = rayon de la sphère 3D. */
export function meToThree(v, r = 1) { return [v[1] * r, v[2] * r, v[0] * r]; }
export function threeToMe(v) { return [v[2], v[0], v[1]]; }
export function latLonToThree(lat, lon, r = 1) { return meToThree(unitFromLatLon(lat, lon), r); }
export function threeToLatLon(x, y, z) { return latLonFromUnit(threeToMe([x, y, z])); }

// ---- Stéréographique polaire Sud (mètres dans le plan de carte) ----
export function spXYFromLatLon(lat, lon) {
  const rho = 2 * MOON_RADIUS_M * Math.tan((90 + lat) * DEG / 2);
  return { x: rho * Math.sin(lon * DEG), y: rho * Math.cos(lon * DEG) };
}
export function spLatLonFromXY(x, y) {
  const rho = Math.hypot(x, y);
  const lat = -90 + 2 * Math.atan(rho / (2 * MOON_RADIUS_M)) * RAD;
  const lon = rho === 0 ? 0 : Math.atan2(x, y) * RAD;
  return { lat, lon };
}
/** Facteur d'échelle local de la carte (distance carte / distance sol), >= 1. */
export function spScaleFactor(lat) { return 2 / (1 + Math.sin(-lat * DEG)); }
/** Projection directe d'un vecteur unitaire ME (sans trigonométrie). */
export function spXYFromUnit(n) {
  const k = 2 * MOON_RADIUS_M / (1 - n[2]);
  return { x: k * n[1], y: k * n[0] };
}

// ---- Distances ----
/** Distance de surface (grand cercle sur la sphère de référence), en mètres. */
export function surfaceDistance(lat1, lon1, lat2, lon2, radius = MOON_RADIUS_M) {
  const a = unitFromLatLon(lat1, lon1), b = unitFromLatLon(lat2, lon2);
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  return Math.acos(dot) * radius;
}
/** Distance euclidienne 3D entre deux points (hauteurs h1/h2 en m au-dessus de la sphère). */
export function chordDistance(lat1, lon1, h1, lat2, lon2, h2) {
  const a = unitFromLatLon(lat1, lon1), b = unitFromLatLon(lat2, lon2);
  const r1 = MOON_RADIUS_M + h1, r2 = MOON_RADIUS_M + h2;
  return Math.hypot(a[0] * r1 - b[0] * r2, a[1] * r1 - b[1] * r2, a[2] * r1 - b[2] * r2);
}
/** Point intermédiaire sur le grand cercle (t de 0 à 1). */
export function greatCirclePoint(lat1, lon1, lat2, lon2, t) {
  const a = unitFromLatLon(lat1, lon1), b = unitFromLatLon(lat2, lon2);
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const om = Math.acos(dot);
  if (om < 1e-9) return { lat: lat1, lon: lon1 };
  const s1 = Math.sin((1 - t) * om) / Math.sin(om), s2 = Math.sin(t * om) / Math.sin(om);
  return latLonFromUnit([a[0] * s1 + b[0] * s2, a[1] * s1 + b[1] * s2, a[2] * s1 + b[2] * s2]);
}

// ---- Affichage ----
export function fmtLat(lat, d = 2) { return `${Math.abs(lat).toFixed(d)}°${lat < 0 ? 'S' : 'N'}`; }
export function fmtLon(lon, d = 2, lang = 'fr') {
  const l = wrapLon(lon);
  return `${Math.abs(l).toFixed(d)}°${l < 0 ? (lang === 'fr' ? 'O' : 'W') : 'E'}`;
}
export function fmtLatLon(lat, lon, d = 2, lang = 'fr') { return `${fmtLat(lat, d)}, ${fmtLon(lon, d, lang)}`; }

/** Analyse « 85.3S 31E », « -85.3, 31 », « 85,3°S ; 31°O »… -> {lat, lon} ou null. */
export function parseLatLon(text) {
  if (!text) return null;
  // Signes moins typographiques (−, –, —) acceptés ; virgule décimale acceptée.
  const s = text.trim().toUpperCase().replace(/[\u2212\u2013\u2014]/g, '-').replace(/(\d),(\d)/g, '$1.$2');
  const m = s.match(/(-?\d+(?:\.\d+)?)\s*°?\s*([NS])?[\s,;/]+(-?\d+(?:\.\d+)?)\s*°?\s*([EWO])?/);
  if (!m) return null;
  let lat = parseFloat(m[1]), lon = parseFloat(m[3]);
  if (m[2] === 'S') lat = -Math.abs(lat);
  if (m[4] === 'W' || m[4] === 'O') lon = -Math.abs(lon);
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 360) return null;
  return { lat, lon: wrapLon(lon) };
}
