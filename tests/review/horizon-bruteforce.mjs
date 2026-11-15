// Relecture (b) : horizon par une méthode indépendante (pas uniforme de 50 m, positions 3D explicites,
// élévation et azimut par produits scalaires dans la base Est/Nord/Haut, sans arrêt anticipé, jusqu'à 450 km)
// comparé à computeHorizon. Usage : node tests/review/horizon-bruteforce.mjs
import { terrain, dem } from './_load.mjs';
const { computeHorizon } = await import('../../public/js/science/horizon.js');
const R = 1737400, D = Math.PI / 180;
const unit = (lat, lon) => [Math.cos(lat * D) * Math.cos(lon * D), Math.cos(lat * D) * Math.sin(lon * D), Math.sin(lat * D)];
function brute(lat, lon, mast, maxM = 450000, step = 50, minM = step) {
  const up = unit(lat, lon);
  const east = [-Math.sin(lon * D), Math.cos(lon * D), 0];
  const north = [up[1] * east[2] - up[2] * east[1], up[2] * east[0] - up[0] * east[2], up[0] * east[1] - up[1] * east[0]]; // up × east
  const h0 = terrain.heightAt(lat, lon), r1 = R + h0 + mast;
  const P = up.map((v) => v * r1);
  const out = new Float64Array(720), far = new Float64Array(720);
  for (let i = 0; i < 720; i++) {
    const az = i * 0.5 * D, t = [0, 1, 2].map((k) => north[k] * Math.cos(az) + east[k] * Math.sin(az));
    let best = -Infinity, bestD = 0;
    for (let s = minM; s <= maxM; s += step) {
      const th = s / R, n = [0, 1, 2].map((k) => up[k] * Math.cos(th) + t[k] * Math.sin(th));
      const la = Math.asin(n[2]) / D, lo = Math.atan2(n[1], n[0]) / D;
      const h = terrain.heightAt(la, lo); if (!Number.isFinite(h)) break;
      const Q = n.map((v) => v * (R + h)), d = [Q[0] - P[0], Q[1] - P[1], Q[2] - P[2]];
      const dn = Math.hypot(...d), el = Math.asin((d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) / dn) / D;
      if (el > best) { best = el; bestD = s; }
    }
    out[i] = best; far[i] = bestD;
  }
  return { elev: out, far, h0 };
}
const sites = [
  ['Crête de Shackleton', -89.45, -137.3], ['Malapert', -85.99, -2.9], ['Fond de Shackleton', -89.67, 129.2],
  ['Pôle exact', -90, 0], ['Longitude 180', -86.0, 180], ['de Gerlache (bord)', -88.5, -67.0], ['Près du bord du MNT', -76.5, 30], ['Mons Mouton', -84.6, 31.0],
];
let dmin = Infinity, dmax = -Infinity;
for (let i = 0; i < dem.length; i++) { const v = dem[i]; if (v < dmin) dmin = v; if (v > dmax) dmax = v; }
console.log('MNT : min', dmin * 0.5, 'm ; max', dmax * 0.5, 'm (bornes supposées par horizon.js : −9000 / +9000 m)');
for (const [name, lat, lon] of sites) {
  const t0 = performance.now(); const hz = computeHorizon(lat, lon, 2); const t1 = performance.now();
  const b = brute(lat, lon, 2);
  const b2 = brute(lat, lon, 2, 450000, 50, 150);   // même méthode, sans le champ proche (< 150 m, intérieur du pixel)
  let max2 = 0, w2 = 0; for (let i = 0; i < 720; i++) { const d = Math.abs(hz.elev[i] - b2.elev[i]); if (d > max2) { max2 = d; w2 = i; } }
  let maxAbs = 0, sum = 0, worstI = 0, maxFar = 0, nBeyond = 0, maxPos = 0;
  for (let i = 0; i < 720; i++) {
    const d = hz.elev[i] - b.elev[i]; sum += d; if (Math.abs(d) > maxAbs) { maxAbs = Math.abs(d); worstI = i; }
    if (-d > maxPos) maxPos = -d;
    if (b.far[i] > maxFar) maxFar = b.far[i]; if (b.far[i] > 330000) nBeyond++;
  }
  console.log(name.padEnd(22), `h=${b.h0.toFixed(0)} m`, 'écart max', maxAbs.toFixed(4) + '°', `(az ${worstI / 2}° : appli ${hz.elev[worstI].toFixed(3)}, brut ${b.elev[worstI].toFixed(3)})`,
    'biais moyen', (sum / 720).toFixed(4) + '°', '| sous-estimation max', maxPos.toFixed(4) + '°', '| horizon le plus lointain', (maxFar / 1000).toFixed(0), 'km ; azimuts au-delà de 330 km :', nBeyond, '| appli', (t1 - t0).toFixed(0), 'ms');
  console.log('   distance du maximum brut à l’azimut du pire écart :', b.far[worstI], 'm ; sans champ proche (>= 150 m) : écart max', max2.toFixed(4) + '°', `(az ${w2 / 2}° : appli ${hz.elev[w2].toFixed(3)}, brut ${b2.elev[w2].toFixed(3)}, à ${b2.far[w2]} m)`);
}
