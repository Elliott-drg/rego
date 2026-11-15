// Relecture : engine.siteTransitions (version du 15/11 03:30 UTC, balayage des séries horaires de l'année)
// autour d'un épisode de 35 min (crête de Shackleton, 15/04/2027) et comparaison à un balayage à la minute sur 40 jours.
import './_load.mjs';
const eng = await import('../../public/js/science/engine.js');
const sc = await import('../../public/js/science/sitecalc.js');
const o = { mastM: 2, earthMarginDeg: 0 }, iso = (ms) => (ms == null ? 'null' : new Date(ms).toISOString().slice(0, 16));
const sr = { lat: -89.45, lon: -137.3 };
for (const [h, mi] of [[13, 40], [14, 10], [14, 40], [15, 10], [15, 40], [16, 10], [16, 40]]) {
  const tq = Date.UTC(2027, 3, 15, h, mi), r = eng.siteTransitions(sr, tq);
  console.log('question à', iso(tq), ': Soleil visible =', r.sun.now, '; prochain changement annoncé :', iso(r.sun.nextMs), '→ dans', r.sun.nextMs ? ((r.sun.nextMs - tq) / 3600e3).toFixed(1) + ' h' : '—');
}
// épisodes courts qui ne contiennent aucune heure ronde : invisibles pour la nouvelle recherche
for (const site of [sr, { lat: -89.78, lon: -155.7 }, { lat: -88.8, lon: -68 }, { lat: -85.42, lon: 31.7 }, { lat: -89.0, lon: 60 }]) {
  const t0 = Date.UTC(2027, 0, 1), n = 200 * 1440; let prev = null, start = 0, list = [];
  for (let i = 0; i <= n; i += 2) { const v = sc.instantState(site, new Date(t0 + i * 60e3), o).sun.fraction > 0; if (prev !== null && v !== prev) { const dur = i - start; if (start > 0 && dur < 60) { const a = t0 + start * 60e3, b = t0 + i * 60e3; const hasRound = Math.floor(b / 3600e3) * 3600e3 >= a; list.push(`${prev ? 'visible' : 'caché'} ${dur} min dès ${iso(a)}${hasRound ? '' : ' (aucune heure ronde : MANQUÉ)'}`); } start = i; } prev = v; }
  console.log(site.lat, site.lon, ': épisodes < 1 h sur 200 j :', list.length ? list.join(' | ') : 'aucun');
}
