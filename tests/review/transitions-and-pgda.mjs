// Relecture : (1) transition manquée par le pas d'une heure (exemple concret) ; (2) plus longue nuit coupée par le 1er janvier ;
// (3) quelle grandeur les cartes PGDA représentent-elles : « une partie du disque visible » (sunPct) ou « part moyenne du disque » (sunDiscPct) ?
import './_load.mjs';
const eng = await import('../../public/js/science/engine.js');
const sc = await import('../../public/js/science/sitecalc.js');
const reg = await import('../../public/js/data/registry.js');
await reg.ensureData('sp_sun_avg'); await reg.ensureData('sp_earth_avg');
const D = 86400e3, iso = (ms) => (ms == null ? 'null' : new Date(ms).toISOString().slice(0, 16));
const o = { mastM: 2, earthMarginDeg: 0 };
const sr = { lat: -89.45, lon: -137.3 };
console.log('--- 1. Crête de Shackleton, 15/04/2027 : état minute par minute autour de l’épisode court');
{
  let prev = null; const t0 = Date.UTC(2027, 3, 14, 0);
  for (let m = 0; m <= 3 * 1440; m++) { const t = t0 + m * 60e3, s = sc.instantState(sr, new Date(t), o); const v = s.sun.fraction > 0; if (prev !== null && v !== prev) console.log('  ', iso(t), v ? 'Soleil visible' : 'Soleil caché', 'fraction', s.sun.fraction.toFixed(3)); prev = v; }
  let fmax = 0; for (let m = 0; m <= 60; m++) { const s = sc.instantState(sr, new Date(Date.UTC(2027, 3, 15, 15, 50) + m * 60e3), o); fmax = Math.max(fmax, s.sun.fraction); }
  console.log('   fraction maximale du disque pendant l’épisode :', fmax.toFixed(3));
  for (const [h, mi] of [[13, 40], [14, 10], [14, 40], [15, 10], [15, 40]]) {
    const tq = Date.UTC(2027, 3, 15, h, mi), r = sc.nextTransition(sr, tq, 'sun', o);
    console.log('   question à', iso(tq), ': Soleil visible =', r.now, '; prochain changement annoncé :', iso(r.nextMs), '→ dans', ((r.nextMs - tq) / 3600e3).toFixed(1), 'h');
  }
}
console.log('--- 2. Plus longue nuit de l’année civile quand l’hiver austral tombe sur le 1er janvier');
for (const site of [sr, { lat: -85.99, lon: -2.9 }, { lat: -84.6, lon: 31 }]) for (let yr = 2030; yr <= 2035; yr++) {
  const y = eng.siteWindow(site, 'year', Date.UTC(yr, 5, 1));
  // nuit réelle la plus longue touchant l'année, non tronquée (série de l'année ± 40 j, même pas d'une heure)
  const S = sc.siteSeries(site, y.t0Ms - 40 * D, y.spanMs + 80 * D, { ...o, stepMs: 3600e3 }); const i0 = 40 * 24, i1 = i0 + y.series.n;
  let best = 0; for (let i = 0; i < S.n;) { if (S.sunFrac[i] === 0) { let j = i; while (j < S.n && S.sunFrac[j] === 0) j++; if (j > i0 && i < i1) best = Math.max(best, j - i); i = j; } else i++; }
  const trunc = best / 24 - y.metrics.longestNightH / 24;
  if (trunc > 0.5) console.log(site.lat, site.lon, yr, ': nuit max affichable', (y.metrics.longestNightH / 24).toFixed(2), 'j ; nuit réelle non tronquée', (best / 24).toFixed(2), 'j ; nightCensored', y.metrics.nightCensored);
}
console.log('--- 3. PGDA : sunPct (une partie du disque) ou sunDiscPct (part moyenne du disque) ?');
{
  let seed = 777; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const rows = [];
  for (let k = 0; k < 120; k++) {
    const colat = 6 * Math.sqrt(rnd()), lat = -90 + colat, lon = -180 + 360 * rnd();
    const S = sc.siteSeries({ lat, lon }, Date.UTC(2026, 0, 1), 2 * 365.25 * D, { mastM: 0, stepMs: 2 * 3600e3 });
    let any = 0, disc = 0, eAny = 0, eCtr = 0; for (let i = 0; i < S.n; i++) { if (S.sunFrac[i] > 0) any++; disc += S.sunFrac[i]; if (S.earthAbove[i] > -0.95) eAny++; if (S.earthAbove[i] > 0) eCtr++; }
    rows.push({ any: 100 * any / S.n, disc: 100 * disc / S.n, p: reg.samplePolar('sp_sun_avg', lat, lon), eAny: 100 * eAny / S.n, eCtr: 100 * eCtr / S.n, pe: reg.samplePolar('sp_earth_avg', lat, lon) });
  }
  const st = (a, b) => { const n = a.length; let mae = 0, bias = 0; for (let i = 0; i < n; i++) { mae += Math.abs(a[i] - b[i]); bias += a[i] - b[i]; } return `écart absolu moyen ${(mae / n).toFixed(2)} pt, biais ${(bias / n).toFixed(2)} pt`; };
  console.log('   Soleil, une partie du disque visible (sunPct)      vs PGDA :', st(rows.map((r) => r.any), rows.map((r) => r.p)));
  console.log('   Soleil, part moyenne du disque (sunDiscPct)        vs PGDA :', st(rows.map((r) => r.disc), rows.map((r) => r.p)));
  console.log('   Terre, une partie du disque (centre > −0,95°)      vs PGDA :', st(rows.map((r) => r.eAny), rows.map((r) => r.pe)));
  console.log('   Terre, centre au-dessus de l’horizon               vs PGDA :', st(rows.map((r) => r.eCtr), rows.map((r) => r.pe)));
  const d = rows.map((r) => r.any - r.disc); console.log('   écart sunPct − sunDiscPct : moyenne', (d.reduce((x, y) => x + y) / d.length).toFixed(2), 'pt ; max', Math.max(...d).toFixed(2), 'pt');
}
