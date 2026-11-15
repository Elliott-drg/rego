// Relief du pôle Sud : MNT LOLA (PDS LDEM_75S_240M, 240 m/px, hauteur = DN × 0,5 m, sphère 1737,4 km).
// Fournit hauteur, pente, orientation, normale et profils. Indépendant de l'interface.

import { MOON_RADIUS_M, DEG, RAD, spXYFromLatLon, spLatLonFromXY, spScaleFactor, greatCirclePoint, surfaceDistance, unitFromLatLon, enuBasis } from '../core/coords.js';

export const SP_GRID = { n: 3812, cell: 240, center: 1905.5, minLat: -75, scale: 0.5 };

let dem = null;        // Int16Array n×n
export function setDem(int16) { dem = int16; }
export function hasDem() { return !!dem; }
export function getDem() { return dem; }

/** Coordonnées pixel (fractionnaires) d'un point de la carte polaire. */
export function pxFromXY(x, y) { return { c: x / SP_GRID.cell + SP_GRID.center, r: SP_GRID.center - y / SP_GRID.cell }; }
export function xyFromPx(c, r) { return { x: (c - SP_GRID.center) * SP_GRID.cell, y: (SP_GRID.center - r) * SP_GRID.cell }; }
export function inPolarGrid(lat) { return lat <= SP_GRID.minLat + 0.02; }

/** Hauteur (m) par interpolation bilinéaire en coordonnées carte ; NaN hors grille. */
export function heightAtXY(x, y) {
  if (!dem) return NaN;
  const n = SP_GRID.n;
  const c = x / SP_GRID.cell + SP_GRID.center, r = SP_GRID.center - y / SP_GRID.cell;
  if (c < 0 || r < 0 || c > n - 1 || r > n - 1) return NaN;
  const c0 = Math.min(n - 2, Math.floor(c)), r0 = Math.min(n - 2, Math.floor(r));
  const fc = c - c0, fr = r - r0, i = r0 * n + c0;
  return SP_GRID.scale * ((dem[i] * (1 - fc) + dem[i + 1] * fc) * (1 - fr) + (dem[i + n] * (1 - fc) + dem[i + n + 1] * fc) * fr);
}
export function heightAt(lat, lon) {
  if (!inPolarGrid(lat)) return NaN;
  const p = spXYFromLatLon(lat, lon);
  return heightAtXY(p.x, p.y);
}

/**
 * Pente et orientation à l'échelle `baselineM` (défaut : 240 m, la maille du MNT).
 * Méthode : différences centrées sur la hauteur au-dessus de la sphère, dans le repère local
 * Est/Nord (la courbure de la sphère est donc retirée : c'est la pente topographique par rapport
 * à la verticale locale, pas l'angle avec le rayon vecteur d'un maillage plan).
 * @returns {{slopeDeg:number, aspectDeg:number, dEast:number, dNorth:number}|null} aspect = azimut de la descente
 */
export function slopeAt(lat, lon, baselineM = SP_GRID.cell) {
  if (!dem || !inPolarGrid(lat)) return null;
  const p = spXYFromLatLon(lat, lon);
  const k = spScaleFactor(lat);              // 1 m au sol = k m sur la carte
  const d = baselineM * k;
  const hx1 = heightAtXY(p.x + d, p.y), hx0 = heightAtXY(p.x - d, p.y);
  const hy1 = heightAtXY(p.x, p.y + d), hy0 = heightAtXY(p.x, p.y - d);
  if (![hx1, hx0, hy1, hy0].every(Number.isFinite)) return null;
  const gx = (hx1 - hx0) / (2 * baselineM), gy = (hy1 - hy0) / (2 * baselineM);   // gradients selon x/y carte
  // Rotation carte -> Est/Nord locaux : à la longitude L, Nord = (sin L, cos L) en carte… vers l'extérieur du pôle.
  const sl = Math.sin(lon * DEG), cl = Math.cos(lon * DEG);
  const dNorth = gx * sl + gy * cl;           // vers le Nord = s'éloigner du pôle Sud
  const dEast = gx * cl - gy * sl;
  const slopeDeg = Math.atan(Math.hypot(dEast, dNorth)) * RAD;
  let aspectDeg = Math.atan2(-dEast, -dNorth) * RAD; if (aspectDeg < 0) aspectDeg += 360;
  return { slopeDeg, aspectDeg, dEast, dNorth };
}

/** Normale unitaire à la surface (repère ME) à partir de la pente locale. */
export function surfaceNormal(lat, lon, baselineM = SP_GRID.cell) {
  const { east, north, up } = enuBasis(lat, lon);
  const s = slopeAt(lat, lon, baselineM);
  if (!s) return up;
  const v = [up[0] - s.dEast * east[0] - s.dNorth * north[0], up[1] - s.dEast * east[1] - s.dNorth * north[1], up[2] - s.dEast * east[2] - s.dNorth * north[2]];
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
}

/**
 * Statistiques de pente dans un disque autour d'un point (échantillonnage à la maille du MNT).
 * @returns {{n:number, meanDeg:number, maxDeg:number, fracBelow:number, areaKm2:number, areaBelowKm2:number, hMin:number, hMax:number, hMean:number}|null}
 */
export function slopeStats(lat, lon, radiusM = 2000, thresholdDeg = 10) {
  if (!dem || !inPolarGrid(lat)) return null;
  const c0 = spXYFromLatLon(lat, lon), k = spScaleFactor(lat), step = SP_GRID.cell;
  const rMap = radiusM * k;
  let n = 0, sum = 0, max = 0, below = 0, hMin = Infinity, hMax = -Infinity, hSum = 0;
  for (let dy = -rMap; dy <= rMap; dy += step) {
    for (let dx = -rMap; dx <= rMap; dx += step) {
      if (dx * dx + dy * dy > rMap * rMap) continue;
      const ll = spLatLonFromXY(c0.x + dx, c0.y + dy);
      const s = slopeAt(ll.lat, ll.lon);
      const h = heightAtXY(c0.x + dx, c0.y + dy);
      if (!s || !Number.isFinite(h)) continue;
      n++; sum += s.slopeDeg; if (s.slopeDeg > max) max = s.slopeDeg; if (s.slopeDeg < thresholdDeg) below++;
      hSum += h; if (h < hMin) hMin = h; if (h > hMax) hMax = h;
    }
  }
  if (!n) return null;
  const cellKm2 = (step / k / 1000) ** 2;
  return { n, meanDeg: sum / n, maxDeg: max, fracBelow: below / n, areaKm2: n * cellKm2, areaBelowKm2: below * cellKm2, hMin, hMax, hMean: hSum / n };
}

/**
 * Profil altimétrique le long du grand cercle entre deux points.
 * @returns {{points:Array<{d:number,h:number,lat:number,lon:number}>, surfaceM:number, meanSlopeDeg:number, maxSlopeDeg:number, dh:number}}
 */
export function elevationProfile(a, b, samples = 0) {
  const total = surfaceDistance(a.lat, a.lon, b.lat, b.lon);
  const n = samples || Math.max(2, Math.min(600, Math.ceil(total / SP_GRID.cell) + 1));
  const points = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), p = greatCirclePoint(a.lat, a.lon, b.lat, b.lon, t);
    points.push({ d: total * t, h: heightAt(p.lat, p.lon), lat: p.lat, lon: p.lon });
  }
  let maxSlope = 0, sumAbs = 0, cnt = 0;
  for (let i = 1; i < n; i++) {
    const dh = points[i].h - points[i - 1].h, dd = points[i].d - points[i - 1].d;
    if (!Number.isFinite(dh) || dd <= 0) continue;
    const s = Math.atan(Math.abs(dh) / dd) * RAD; sumAbs += s; cnt++; if (s > maxSlope) maxSlope = s;
  }
  const h0 = points[0].h, h1 = points[n - 1].h;
  return { points, surfaceM: total, meanSlopeDeg: cnt ? sumAbs / cnt : NaN, maxSlopeDeg: maxSlope, dh: h1 - h0 };
}

export { MOON_RADIUS_M, unitFromLatLon };
