// Test Node de la façade du moteur (avec les données embarquées lues depuis le disque).
import fs from 'node:fs';
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
const { setDem } = await import('../public/js/science/terrain.js');
const buf = fs.readFileSync('public/data/sp_dem_240m.i16'); setDem(new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2));
const eng = await import('../public/js/science/engine.js');
const { state } = await import('../public/js/core/store.js');
state.timeMs = Date.UTC(2026, 10, 15, 12);
const site = { lat: -89.45, lon: -137.3 };
let t = performance.now();
const now = eng.siteNow(site); console.log('siteNow', (performance.now() - t).toFixed(0), 'ms', 'Soleil él', now.sun.el.toFixed(2), 'fraction', now.sun.fraction.toFixed(2), 'Terre él', now.earth.el.toFixed(2), 'visible', now.earth.visible);
t = performance.now(); const y = eng.siteWindow(site, 'year'); console.log('year', (performance.now() - t).toFixed(0), 'ms', y.metrics.sunPct.toFixed(1), '% Soleil ; nuit max', (y.metrics.longestNightH / 24).toFixed(1), 'j');
t = performance.now(); const l = eng.siteWindow(site, 'lunarDay'); console.log('lunarDay', (performance.now() - t).toFixed(0), 'ms', l.metrics.sunPct.toFixed(1), '% ; T maintenant', eng.siteTemperatureNow(site).toFixed(0), 'K');
t = performance.now(); const tr = eng.siteTransitions(site); console.log('transitions', (performance.now() - t).toFixed(0), 'ms', tr.sun.now, tr.sun.nextMs && new Date(tr.sun.nextMs).toISOString(), tr.earth.now, tr.earth.nextMs && new Date(tr.earth.nextMs).toISOString());
t = performance.now(); const ta = eng.terrainAround(site); console.log('terrain', (performance.now() - t).toFixed(0), 'ms', JSON.stringify(ta.stats && { mean: +ta.stats.meanDeg.toFixed(1), below: +ta.stats.fracBelow.toFixed(2) }));
const apollo = { lat: 0.6741, lon: 23.4731 };
const a = eng.siteWindow(apollo, 'year'); console.log('Apollo 11 : Soleil', a.metrics.sunPct.toFixed(1), '% ; nuit max', (a.metrics.longestNightH / 24).toFixed(1), 'j ; Terre', a.metrics.earthPct.toFixed(0), '% ; T', Math.min(...a.temps).toFixed(0), '–', Math.max(...a.temps).toFixed(0), 'K');
if (!(a.metrics.sunPct > 49 && a.metrics.sunPct < 52)) { console.error('ÉCHEC : ~50 % attendu à l’équateur'); process.exit(1); }
if (!(Math.abs(a.metrics.longestNightH / 24 - 14.7) < 0.6)) { console.error('ÉCHEC : nuit ~14,7 j attendue'); process.exit(1); }
if (a.metrics.earthPct !== 100) { console.error('ÉCHEC : Terre toujours visible attendue'); process.exit(1); }
console.log('OK');

// Prochains basculements : même résultat que la recherche pas à pas de référence (sitecalc.nextTransition), en moins de temps.
{
  const { nextTransition } = await import('../public/js/science/sitecalc.js');
  for (const [name, s] of [['crête de Shackleton', { lat: -89.45, lon: -137.3 }], ['Malapert flanc', { lat: -85.99, lon: -2.9 }], ['Apollo 11', { lat: 0.6741, lon: 23.4731 }], ['Mons Mouton', { lat: -84.6, lon: 31 }]]) {
    eng.clearEngineCache();
    const t0 = Math.floor(state.timeMs / 60000) * 60000;
    let t = performance.now(); const fast = eng.siteTransitions(s); const d1 = performance.now() - t;
    state.timeMs += 3 * 3600e3; t = performance.now(); eng.siteTransitions(s); const d2 = performance.now() - t; state.timeMs -= 3 * 3600e3;
    for (const body of ['sun', 'earth']) {
      const ref = nextTransition(s, t0, body, { mastM: state.params.mastM, earthMarginDeg: state.params.earthMarginDeg });
      const same = ref.now === fast[body].now && ((ref.nextMs === null && fast[body].nextMs === null) || (ref.nextMs !== null && fast[body].nextMs !== null && Math.abs(ref.nextMs - fast[body].nextMs) < 120e3));
      console.log(`transitions ${name} ${body} : ${fast[body].nextMs ? new Date(fast[body].nextMs).toISOString() : 'aucune'} ${same ? 'identique' : 'DIFFÉRENT de ' + (ref.nextMs && new Date(ref.nextMs).toISOString())}`);
      if (!same) { console.error('ÉCHEC : basculement différent de la référence'); process.exit(1); }
    }
    console.log(`   durée : ${d1.toFixed(0)} ms au premier appel, ${d2.toFixed(0)} ms 3 h plus tard`);
  }
  console.log('OK transitions');
}

// Nuits réelles : une période qui commence en pleine nuit ne doit pas la couper en deux (constat B1 de la relecture).
{
  const a11 = { lat: 0.6741, lon: 23.4731 };
  for (const [d, label] of [[Date.UTC(2027, 2, 6), '06/03/2027'], [Date.UTC(2027, 2, 1), '01/03/2027'], [Date.UTC(2027, 2, 21), '21/03/2027']]) {
    eng.clearEngineCache();
    const m = eng.siteWindow(a11, 'lunarDay', d).metrics;
    console.log(`Apollo 11, jour lunaire du ${label} : nuit réelle ${(m.longestNightH / 24).toFixed(2)} j (dans la période : ${(m.longestNightInWindowH / 24).toFixed(2)} j), jour réel ${(m.longestDayH / 24).toFixed(2)} j`);
    if (Math.abs(m.longestNightH / 24 - 14.75) > 0.3 || Math.abs(m.longestDayH / 24 - 14.8) > 0.4) { console.error('ÉCHEC : nuit ou jour réel ≠ 14,7 j'); process.exit(1); }
  }
  eng.clearEngineCache();
  const psr = eng.siteWindow({ lat: -89.67, lon: 129.2 }, 'lunarDay', Date.UTC(2027, 2, 6)).metrics;
  console.log('Fond de Shackleton : nuit', (psr.longestNightH / 24).toFixed(0), 'j, sans fin trouvée :', psr.nightCensored);
  if (!psr.nightCensored) { console.error('ÉCHEC : ombre permanente non signalée'); process.exit(1); }
  const { parseLatLon } = await import('../public/js/core/coords.js');
  const p = parseLatLon('−85,3 31'); if (!p || p.lat !== -85.3 || p.lon !== 31) { console.error('ÉCHEC : signe moins typographique', p); process.exit(1); }
  console.log('OK nuits réelles et saisie des coordonnées');
}
