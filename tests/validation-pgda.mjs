// Validation : indicateurs calculés (une année) contre les cartes moyennes NASA PGDA (Mazarico et al. 2011, 18,6 ans).
// Points tirés au hasard (graine fixe) entre 84°S et 90°S. Lancer : node tests/validation-pgda.mjs
import fs from 'node:fs';
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
const { setDem } = await import('../public/js/science/terrain.js');
const rd = (f, T) => { const b = fs.readFileSync('public/data/' + f); return new T(b.buffer, b.byteOffset, b.byteLength / T.BYTES_PER_ELEMENT); };
setDem(rd('sp_dem_240m.i16', Int16Array));
globalThis.fetch = async (url) => { const b = fs.readFileSync('public/' + url); return { ok: true, headers: { get: () => null }, body: null, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), json: async () => JSON.parse(b.toString()) }; };
const reg = await import('../public/js/data/registry.js');
await reg.ensureData('sp_sun_avg'); await reg.ensureData('sp_earth_avg');
const { siteSeries } = await import('../public/js/science/sitecalc.js');
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const N = 150, t0 = Date.UTC(2026, 0, 1), span = 365.25 * 86400e3 * 2;   // deux ans, pas de 2 h
const rows = [];
for (let k = 0; k < N; k++) {
  const colat = 6 * Math.sqrt(rnd()), lat = -90 + colat, lon = -180 + 360 * rnd();
  const S = siteSeries({ lat, lon }, t0, span, { mastM: 0, stepMs: 2 * 3600e3 });
  let disc = 0, earthAny = 0, earthCtr = 0;
  for (let i = 0; i < S.n; i++) { disc += S.sunFrac[i]; if (S.earthAbove[i] > -0.95) earthAny++; if (S.earthAbove[i] > 0) earthCtr++; }
  rows.push({ sun: 100 * disc / S.n, pSun: reg.samplePolar('sp_sun_avg', lat, lon), earthAny: 100 * earthAny / S.n, earthCtr: 100 * earthCtr / S.n, pEarth: reg.samplePolar('sp_earth_avg', lat, lon) });
}
const stats = (a, b) => { const n = a.length, ma = a.reduce((x, y) => x + y) / n, mb = b.reduce((x, y) => x + y) / n; let sab = 0, saa = 0, sbb = 0, mae = 0, bias = 0; for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; mae += Math.abs(a[i] - b[i]); bias += a[i] - b[i]; } return { r: sab / Math.sqrt(saa * sbb), mae: mae / n, bias: bias / n }; };
const f = (s) => `corrélation ${s.r.toFixed(3)} ; écart absolu moyen ${s.mae.toFixed(1)} points ; biais ${s.bias >= 0 ? '+' : ''}${s.bias.toFixed(1)} points`;
console.log(`${N} points, 2026-2027, mât 0 m`);
console.log('Soleil (part moyenne du disque visible) calcul vs PGDA :', f(stats(rows.map((r) => r.sun), rows.map((r) => r.pSun))));
console.log('Terre (une partie du disque visible) calcul vs PGDA    :', f(stats(rows.map((r) => r.earthAny), rows.map((r) => r.pEarth))));
console.log('Terre (centre au-dessus de l’horizon) calcul vs PGDA   :', f(stats(rows.map((r) => r.earthCtr), rows.map((r) => r.pEarth))));
const s1 = stats(rows.map((r) => r.sun), rows.map((r) => r.pSun));
if (s1.r < 0.9) { console.error('ÉCHEC : corrélation Soleil < 0,9'); process.exit(1); }
console.log('OK');
