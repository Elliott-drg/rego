// Relecture (c) : pente par ajustement d'un plan (moindres carrés) sur 3×3 pixels du MNT, comparée à terrain.slopeAt
// au centre du pixel. Coordonnées sol = coordonnées carte / facteur d'échelle local. Usage : node tests/review/slope-planefit.mjs
import { terrain, dem } from './_load.mjs';
const { spXYFromLatLon, spLatLonFromXY, spScaleFactor } = await import('../../public/js/core/coords.js');
const N = 3812, D = Math.PI / 180;
function planeFit(c, r) {
  const { x, y } = terrain.xyFromPx(c, r), ll = spLatLonFromXY(x, y), k = spScaleFactor(ll.lat);
  // moindres carrés z = a·X + b·Y + c sur la grille 3×3 (X, Y en mètres au sol, axes carte)
  let sxz = 0, syz = 0, sxx = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const z = dem[(r + j) * N + (c + i)] * 0.5, X = i * 240 / k, Y = -j * 240 / k;
    sxz += X * z; syz += Y * z; sxx += X * X;
  }
  const a = sxz / sxx, b = syz / sxx;                      // dz/dX (carte +x), dz/dY (carte +y)
  const sl = Math.sin(ll.lon * D), cl = Math.cos(ll.lon * D);
  const dN = a * sl + b * cl, dE = a * cl - b * sl;
  let asp = Math.atan2(-dE, -dN) / D; if (asp < 0) asp += 360;
  return { lat: ll.lat, lon: ll.lon, slope: Math.atan(Math.hypot(a, b)) / D, aspect: asp };
}
let seed = 2026; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
let n = 0, sumAbs = 0, maxAbs = 0, sum = 0, maxAsp = 0, worst = null;
for (let q = 0; q < 20000; q++) {
  const colat = 14 * Math.sqrt(rnd()), lon = -180 + 360 * rnd(), p = spXYFromLatLon(-90 + colat, lon), px = terrain.pxFromXY(p.x, p.y);
  const c = Math.round(px.c), r = Math.round(px.r); if (c < 2 || r < 2 || c > N - 3 || r > N - 3) continue;
  const f = planeFit(c, r), s = terrain.slopeAt(f.lat, f.lon); if (!s) continue;
  const d = s.slopeDeg - f.slope; n++; sum += d; sumAbs += Math.abs(d); if (Math.abs(d) > maxAbs) { maxAbs = Math.abs(d); worst = { ...f, app: s.slopeDeg }; }
  if (f.slope > 5) { let da = Math.abs(s.aspectDeg - f.aspect); if (da > 180) da = 360 - da; if (da > maxAsp) maxAsp = da; }
}
console.log(n, 'pixels tirés au hasard (75–90°S) : écart moyen', (sum / n).toFixed(3) + '°', '; écart absolu moyen', (sumAbs / n).toFixed(3) + '°', '; max', maxAbs.toFixed(2) + '°', JSON.stringify(worst));
console.log('orientation (pentes > 5°) : écart max', maxAsp.toFixed(1) + '°');
// Plan incliné synthétique : contrôle absolu de la formule et des signes
const save = dem.slice();
for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) dem[r * N + c] = Math.round(((c - 1905.5) * 240 * 0.10 + (1905.5 - r) * 240 * 0.05) / 0.5 / 4) ; // z = (0,10·x + 0,05·y)/4 en carte
for (const [lat, lon] of [[-89.9, 0], [-89.9, 90], [-89.9, 180], [-89.9, -90], [-85, 45], [-80, -120], [-75.5, 10]]) {
  const s = terrain.slopeAt(lat, lon), k = spScaleFactor(lat);
  const exp = Math.atan(Math.hypot(0.025, 0.0125) * k) / D;       // pente au sol = gradient carte × k
  // descente en carte : direction (−0,10 ; −0,05) ; azimut local = angle depuis le Nord local (sin L, cos L) vers l'Est local (cos L, −sin L)
  const sL = Math.sin(lon * D), cL = Math.cos(lon * D); let a = Math.atan2(-0.10 * cL + 0.05 * sL, -0.10 * sL - 0.05 * cL) / D; if (a < 0) a += 360;
  console.log(`plan synthétique ${lat},${lon} : pente appli ${s.slopeDeg.toFixed(3)}° attendu ${exp.toFixed(3)}° ; orientation appli ${s.aspectDeg.toFixed(1)}° attendu ${a.toFixed(1)}°`);
}
dem.set(save);
