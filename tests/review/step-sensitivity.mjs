// Relecture : sensibilité des indicateurs au pas de temps (1 h pour l'année, 3 h pour la décennie) et coût de la décennie.
import './_load.mjs';
const sc = await import('../../public/js/science/sitecalc.js');
const D = 86400e3, o = { mastM: 2, earthMarginDeg: 0 };
for (const [name, site] of [['Crête de Shackleton', { lat: -89.45, lon: -137.3 }], ['Malapert', { lat: -85.99, lon: -2.9 }], ['Mons Mouton', { lat: -84.6, lon: 31 }]]) {
  const t0 = Date.UTC(2027, 0, 1), span = 365 * D;
  const line = [];
  for (const stepMin of [10, 60, 120, 180]) {
    const t = performance.now(); const S = sc.siteSeries(site, t0, span, { ...o, stepMs: stepMin * 60e3 }), m = sc.seriesMetrics(S);
    line.push(`pas ${stepMin} min : Soleil ${m.sunPct.toFixed(2)} %, nuit max ${(m.longestNightH / 24).toFixed(2)} j, Terre ${m.earthPct.toFixed(2)} %, coupure max ${(m.longestBlackoutH / 24).toFixed(2)} j (${(performance.now() - t).toFixed(0)} ms)`);
  }
  console.log(name + '\n   ' + line.join('\n   '));
}
