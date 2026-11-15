// Relecture : aux points « le mieux éclairé » proposés par regionBest, écart entre le calcul de l'appli et la carte PGDA
// selon la hauteur du mât (0 / 2 m) et la définition (une partie du disque / part moyenne du disque), 2026-2027.
import './_load.mjs';
const eng = await import('../../public/js/science/engine.js');
const sc = await import('../../public/js/science/sitecalc.js');
const reg = await import('../../public/js/data/registry.js');
for (const id of ['sp_sun_avg', 'sp_earth_avg', 'artemis_regions']) await reg.ensureData(id);
const regions = reg.getData('artemis_regions');
let rows = [];
for (const r of regions) {
  const b = eng.regionBest(r.corners); if (!b) continue;
  const out = { name: r.name, pgda: b.sun.sunAvgPct };
  for (const mast of [0, 2, 10]) {
    const S = sc.siteSeries(b.sun, Date.UTC(2026, 0, 1), 2 * 365.25 * 86400e3, { mastM: mast, stepMs: 2 * 3600e3 });
    let any = 0, disc = 0; for (let i = 0; i < S.n; i++) { if (S.sunFrac[i] > 0) any++; disc += S.sunFrac[i]; }
    out['any' + mast] = 100 * any / S.n; out['disc' + mast] = 100 * disc / S.n;
  }
  rows.push(out);
  console.log(r.name.padEnd(20), 'PGDA', out.pgda.toFixed(1), '| mât 0 m : une partie', out.any0.toFixed(1), 'disque', out.disc0.toFixed(1), '| mât 2 m : une partie', out.any2.toFixed(1), 'disque', out.disc2.toFixed(1), '| mât 10 m : une partie', out.any10.toFixed(1));
}
const mean = (k) => rows.reduce((a, r) => a + r[k] - r.pgda, 0) / rows.length;
console.log('écart moyen à la carte PGDA sur ces', rows.length, 'points : mât 0 m une partie', mean('any0').toFixed(1), '; mât 0 m disque', mean('disc0').toFixed(1), '; mât 2 m une partie (défaut de l’appli)', mean('any2').toFixed(1), '; mât 2 m disque', mean('disc2').toFixed(1), '; mât 10 m', mean('any10').toFixed(1));
