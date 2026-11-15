// Relecture : fenêtres temporelles, plus longue nuit tronquée par les bords, transitions manquées par le pas d'une heure,
// cas limites (pôle exact, ±180, hors MNT, série d'un pas). Usage : node tests/review/windows-edge.mjs
import './_load.mjs';
const eng = await import('../../public/js/science/engine.js');
const sc = await import('../../public/js/science/sitecalc.js');
const { state } = await import('../../public/js/core/store.js');
const D = 86400e3, H = 3600e3, iso = (ms) => (ms == null ? 'null' : new Date(ms).toISOString().slice(0, 16));

console.log('--- 1. « Plus longue nuit » selon la fenêtre (Apollo 11 : nuit réelle ≈ 14,77 j)');
const a11 = { lat: 0.6741, lon: 23.4731 };
for (const day of [1, 6, 11, 16, 21, 26]) {
  const t = Date.UTC(2027, 2, day, 12);
  const l = eng.siteWindow(a11, 'lunarDay', t), y = eng.siteWindow(a11, 'year', t);
  console.log(iso(t), 'jour lunaire : nuit max', (l.metrics.longestNightH / 24).toFixed(2), 'j ; jour max', (l.metrics.longestDayH / 24).toFixed(2), 'j ; nightCensored', l.metrics.nightCensored,
    '| année : nuit max', (y.metrics.longestNightH / 24).toFixed(2), 'j ; Soleil', l.metrics.sunPct.toFixed(1), '% (lunaison) vs', y.metrics.sunPct.toFixed(1), '% (année)');
}
console.log('--- 1b. Même contrôle au pôle (crête de Shackleton, connecting ridge)');
const sr = { lat: -89.45, lon: -137.3 };
for (const [yy, mm, dd] of [[2027, 4, 20], [2027, 5, 5], [2027, 5, 20], [2027, 6, 5], [2027, 6, 20]]) {
  const t = Date.UTC(yy, mm, dd, 12);
  const l = eng.siteWindow(sr, 'lunarDay', t);
  // référence : nuit réelle contenant ou suivant t, mesurée sur une série de 120 j au pas de 20 min, centrée
  const S = sc.siteSeries(sr, t - 45 * D, 120 * D, { mastM: 2, stepMs: 20 * 60e3 });
  const i0 = Math.round((l.series.t0Ms - S.t0Ms) / S.stepMs), i1 = i0 + l.series.n;
  let best = 0; for (let i = 0; i < S.n;) { if (S.sunFrac[i] === 0) { let j = i; while (j < S.n && S.sunFrac[j] === 0) j++; if (j > i0 && i < i1) best = Math.max(best, j - i); i = j; } else i++; }
  console.log(iso(t), 'jour lunaire : nuit max', l.metrics.longestNightH.toFixed(1), 'h ; nuit la plus longue touchant la fenêtre, non tronquée :', (best / 3).toFixed(1), 'h ; nightCensored', l.metrics.nightCensored);
}
console.log('--- 1c. Année civile : la plus longue nuit coupée par le 1er janvier ?');
for (const site of [sr, { lat: -85.99, lon: -2.9 }, { lat: -84.6, lon: 31 }]) for (const yr of [2026, 2027, 2028]) {
  const y = eng.siteWindow(site, 'year', Date.UTC(yr, 5, 1));
  const S = y.series, first = S.sunFrac[0] === 0, last = S.sunFrac[S.n - 1] === 0;
  console.log(site.lat, site.lon, yr, 'nuit max', (y.metrics.longestNightH / 24).toFixed(2), 'j, début', iso(y.metrics.longestNightStartMs), '| nuit en cours au 1er janvier :', first, '; au 31 décembre :', last);
}
console.log('--- 2. Prochaine transition : pas d’une heure contre balayage à 2 min');
for (const site of [sr, { lat: -85.99, lon: -2.9 }, { lat: -88.8, lon: -68 }, { lat: -89.78, lon: -155.7 }]) {
  let missed = 0, total = 0, examples = [];
  const t0 = Date.UTC(2027, 0, 1), span = 120 * D, step = 2 * 60e3, n = span / step;
  const st = { sun: [], earth: [] };
  for (let i = 0; i <= n; i++) { const s = sc.instantState(site, new Date(t0 + i * step), { mastM: 2, earthMarginDeg: 0 }); st.sun.push(s.sun.fraction > 0); st.earth.push(s.earth.visible); }
  for (const body of ['sun', 'earth']) {
    const a = st[body];
    // intervalles (états constants) plus courts qu'une heure, entièrement contenus entre deux heures rondes consécutives = invisibles pour la recherche
    for (let i = 1; i <= n;) { if (a[i] !== a[i - 1]) { let j = i; while (j <= n && a[j] === a[i]) j++; const dur = (j - i) * 2; total++; if (dur < 60 && j <= n) { missed++; if (examples.length < 3) examples.push(`${body} ${a[i] ? 'visible' : 'caché'} ${dur} min dès ${iso(t0 + i * step)}`); } i = j; } else i++; }
  }
  console.log(site.lat, site.lon, ': états successifs sur 120 j :', total, '; épisodes de moins d’une heure :', missed, examples.join(' | '));
}
console.log('--- 2b. Exemple concret : nextTransition part juste avant un épisode court');
{
  const site = { lat: -85.99, lon: -2.9 };
  const t0 = Date.UTC(2027, 0, 1), step = 2 * 60e3; let found = null;
  let prev = null, runStart = 0;
  for (let i = 0; i <= 120 * D / step && !found; i++) {
    const s = sc.instantState(site, new Date(t0 + i * step), { mastM: 2, earthMarginDeg: 0 }).sun.fraction > 0;
    if (prev !== null && s !== prev) { const dur = (i - runStart) * 2; if (runStart > 0 && dur < 45) found = { start: t0 + runStart * step, end: t0 + i * step, state: prev }; runStart = i; }
    prev = s;
  }
  if (found) {
    for (const off of [-50, -30, -10]) {
      const tq = found.start + off * 60e3; const r = sc.nextTransition(site, tq, 'sun', { mastM: 2, earthMarginDeg: 0 });
      console.log('épisode', found.state ? 'éclairé' : 'sombre', iso(found.start), '→', iso(found.end), '; question posée à', iso(tq), ': état', r.now, 'prochain changement annoncé', iso(r.nextMs), '(attendu', iso(found.start) + ')');
    }
  } else console.log('aucun épisode < 45 min trouvé sur ce site');
}
console.log('--- 3. Cas limites');
for (const [name, site] of [['pôle exact', { lat: -90, lon: 0 }], ['pôle exact lon 123', { lat: -90, lon: 123 }], ['lon +180', { lat: -86, lon: 180 }], ['lon −180', { lat: -86, lon: -180 }], ['hors MNT (Apollo 11)', a11], ['bord du MNT lat −75,00 lon 0', { lat: -75.0, lon: 0 }], ['lat −74,99', { lat: -74.99, lon: 0 }], ['pôle Nord', { lat: 90, lon: 0 }]]) {
  try {
    const n = eng.siteNow(site, Date.UTC(2027, 3, 1)), p = eng.pointInfo(site.lat, site.lon);
    console.log(name.padEnd(30), 'Soleil az', n.sun.az.toFixed(3), 'él', n.sun.el.toFixed(3), 'fraction', n.sun.fraction.toFixed(2), '| Terre az', n.earth.az.toFixed(3), 'él', n.earth.el.toFixed(3), '| horizon relief :', n.horizon.terrain, 'h site', n.horizon.siteHeightM.toFixed(0), '| pointInfo polar', p.polar, 'h', Number(p.heightM).toFixed(0), 'pente', Number(p.slopeDeg).toFixed(2));
  } catch (e) { console.log(name, 'EXCEPTION', e.message); }
}
{
  const a = eng.siteNow({ lat: -90, lon: 0 }, Date.UTC(2027, 3, 1)), b = eng.siteNow({ lat: -90, lon: 123 }, Date.UTC(2027, 3, 1));
  console.log('pôle exact : azimut dépend de la longitude saisie (0 → ', a.sun.az.toFixed(2), '; 123 →', b.sun.az.toFixed(2), ') ; différence', ((a.sun.az - b.sun.az + 360) % 360).toFixed(2));
  const p = eng.siteNow({ lat: -86, lon: 180 }, Date.UTC(2027, 3, 1)), m = eng.siteNow({ lat: -86, lon: -180 }, Date.UTC(2027, 3, 1));
  console.log('±180 : écart az Soleil', Math.abs(p.sun.az - m.sun.az).toExponential(2), '; horizon max écart', Math.max(...Array.from(p.horizon.elev, (v, i) => Math.abs(v - m.horizon.elev[i]))).toExponential(2));
}
for (const span of [0, 0.001, 0.02]) {
  try { const w = eng.siteWindow(sr, span, Date.UTC(2027, 3, 1)); console.log('fenêtre de', span, 'j : n =', w.series.n, 'sunPct', w.metrics.sunPct, 'nuit max', w.metrics.longestNightH, 'h, nightCensored', w.metrics.nightCensored, 'T', Array.from(w.temps).map((v) => v.toFixed(0)).join(',')); } catch (e) { console.log('fenêtre de', span, 'j : EXCEPTION', e.message); }
}
console.log('--- 4. Fenêtre « jour lunaire » : début réel par rapport à la date demandée');
{ const t = Date.UTC(2027, 3, 1, 23, 30); const w = eng.siteWindow(sr, 'lunarDay', t); console.log('demandé', iso(t), '→ t0', iso(w.t0Ms), '; fin', iso(w.t0Ms + (w.series.n - 1) * w.series.stepMs), '; spanDays', w.metrics.spanDays.toFixed(3)); }
console.log('--- 5. Température du modèle, Apollo 11, année 2026 (VALIDATION : 88–386 K)');
{ const y = eng.siteWindow(a11, 'year', Date.UTC(2026, 5, 1)); console.log('min', Math.min(...y.temps).toFixed(1), 'max', Math.max(...y.temps).toFixed(1), '; Soleil', y.metrics.sunPct.toFixed(2), '% ; disque', y.metrics.sunDiscPct.toFixed(2), '% ; nuit max', (y.metrics.longestNightH / 24).toFixed(2), 'j ; Terre', y.metrics.earthPct); }
