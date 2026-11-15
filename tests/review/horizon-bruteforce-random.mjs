// Relecture (b, suite) : 30 sites tirés au hasard (80–90°S), horizon brut à pas de 50 m contre computeHorizon,
// en séparant les azimuts dont l'horizon est proche (< 1 km, sensible au pas) et lointain (≥ 1 km).
import { terrain } from './_load.mjs';
const { computeHorizon } = await import('../../public/js/science/horizon.js');
const R = 1737400, D = Math.PI / 180;
const unit = (lat, lon) => [Math.cos(lat * D) * Math.cos(lon * D), Math.cos(lat * D) * Math.sin(lon * D), Math.sin(lat * D)];
let seed = 4242; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
let nNear = 0, nFar = 0, maxNear = 0, maxFar = 0, sumNear = 0, sumFar = 0, sumAbsFar = 0, sumAbsNear = 0;
for (let q = 0; q < 30; q++) {
  const lat = -90 + 10 * Math.sqrt(rnd()), lon = -180 + 360 * rnd();
  const hz = computeHorizon(lat, lon, 2);
  const up = unit(lat, lon), east = [-Math.sin(lon * D), Math.cos(lon * D), 0];
  const north = [up[1] * east[2] - up[2] * east[1], up[2] * east[0] - up[0] * east[2], up[0] * east[1] - up[1] * east[0]];
  const r1 = R + terrain.heightAt(lat, lon) + 2, P = up.map((v) => v * r1);
  for (let i = 0; i < 720; i += 4) {
    const az = i * 0.5 * D, t = [0, 1, 2].map((k) => north[k] * Math.cos(az) + east[k] * Math.sin(az));
    let best = -Infinity, bestS = 0;
    for (let s = 50; s <= 400000; s += 50) {
      const th = s / R, n = [0, 1, 2].map((k) => up[k] * Math.cos(th) + t[k] * Math.sin(th));
      const h = terrain.heightAt(Math.asin(n[2]) / D, Math.atan2(n[1], n[0]) / D); if (!Number.isFinite(h)) break;
      const d = n.map((v, k) => v * (R + h) - P[k]), el = Math.asin((d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) / Math.hypot(...d)) / D;
      if (el > best) { best = el; bestS = s; }
    }
    const diff = hz.elev[i] - best;
    if (bestS < 1000) { nNear++; sumNear += diff; sumAbsNear += Math.abs(diff); maxNear = Math.max(maxNear, Math.abs(diff)); }
    else { nFar++; sumFar += diff; sumAbsFar += Math.abs(diff); maxFar = Math.max(maxFar, Math.abs(diff)); }
  }
}
console.log(`horizon lointain (≥ 1 km) : ${nFar} azimuts, écart moyen ${(sumFar / nFar).toFixed(4)}°, absolu moyen ${(sumAbsFar / nFar).toFixed(4)}°, max ${maxFar.toFixed(3)}°`);
console.log(`horizon proche (< 1 km)   : ${nNear} azimuts (${(100 * nNear / (nNear + nFar)).toFixed(0)} %), écart moyen ${(sumNear / nNear).toFixed(4)}°, absolu moyen ${(sumAbsNear / nNear).toFixed(4)}°, max ${maxNear.toFixed(3)}°`);
